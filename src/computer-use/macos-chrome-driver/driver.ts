import type { ComputerUseConfig } from '../config.js'
import type { AXNode, AXSnapshot, Bounds, WindowDescriptor, WindowObservation } from '../types.js'
import type {
  CandidatePromotion,
  ArtifactRef,
  ChromeContextLease,
  ChromeContextSnapshot,
  ChromeForegroundPolicy,
  ChromeRecognitionTarget,
  ChromeWindowCapture,
  ChromeWindowRef,
  ObservationSnapshot,
  OcrRowSnapshot,
  OcrTextSnapshot,
  ProfileConfig,
  PromotedCandidate,
  RecognizedItem,
  RecognitionResult as NewRecognitionResult,
  SafetyCheckResult,
  SafetyFailure,
  SurfaceNode,
} from './types.js'

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { resolveComputerUseConfig } from '../config.js'
import { captureAXTree } from '../ax-tree.js'
import { captureChromeDom } from '../chrome-dom.js'
import {
  executeMoveAndClick,
  executeOpenApp,
  executePressKeys,
  executeScroll,
  executeTypeText,
  executeWindowTargetedScroll,
} from '../macos-actions.js'
import { observeWindows } from '../window-observation.js'
import { buildPointerTrace } from '../pointer-trace.js'
import { captureChromeWindow } from './capture.js'
import { produceOcrRows, recognizeTextInImage } from './ocr.js'
import { uniqueStrings } from './shared.js'
import { BUTTON_KINDS, COORDINATE_CLICK_KINDS, LINK_KINDS, TEXT_INPUT_KINDS, requireWindowNumber } from './types.js'
import { buildScrollBoundaryObservation } from './scroll-boundary.js'

// AUV-aligned observation / recognition imports
import { inferObservationSource, normalizeToSurfaceNodes } from './surface-node.js'
import { recognizeFromCapture } from './recognition.js'
import { promoteCandidate as doPromoteCandidate } from './candidate-promotion.js'
import { checkSafetyGate, detectHardStopSignals, loadProfileConfig } from './safety-gate.js'
import { TraceStore } from './trace-store.js'

export interface MacOSChromeDriverOptions {
  sessionId: string
  config?: Partial<ComputerUseConfig>
  foregroundPolicy?: ChromeForegroundPolicy
}

export interface MacOSChromeScrollOptions {
  settleMs?: number
}

type ActionType = 'click' | 'focusTextInput' | 'typeText' | 'pressKey' | 'scroll'
type ActionExecutorResult = void | {
  livenessRecheck?: Record<string, unknown>
  scrollRegion?: Record<string, unknown>
  knownLimits?: string[]
}

interface StoredPromotedCandidate {
  ref: ArtifactRef
  candidate: PromotedCandidate
}

interface FocusedTextInputLease {
  candidateLocalId: string
  candidateRef: ArtifactRef
  windowNumber?: number
  grounding: 'ax_node'
}

interface ChromeScrollRegionLease {
  apiVersion: 'careerdeepseek.chrome_scroll_region_lease.v1alpha1'
  leaseId: string
  observationSnapshotId: string
  capturedAtMillis: number
  ttlMillis: number
  observationRef: ArtifactRef
  source: 'ax_web_area' | 'window_content_fallback'
  basis: string[]
  regionWindowLocal: Bounds
  anchorWindowLocal: { x: number, y: number }
  windowRef: {
    appBundleId?: string
    ownerPid: number
    windowNumber?: number
    profilePath?: string
    profileName?: string
  }
  knownLimits: string[]
}

interface ChromeViewportBoundsCandidate {
  bounds: Bounds
  source: 'ax_web_area'
  basis: string[]
  knownLimits: string[]
}

interface ResolvedScrollRegionLease {
  lease: ChromeScrollRegionLease
  region: {
    screenBounds: Bounds
    windowLocalBounds: Bounds
  }
  anchor: {
    screenPoint: { x: number, y: number }
    windowLocalPoint: { x: number, y: number }
  }
}

interface CandidateLivenessCheck {
  item: RecognizedItem
  context: ChromeContextSnapshot
  detail: Record<string, unknown>
}

interface ManagedChromeProfileIdentity {
  profileDir: string
  profilePath: string
  profileName: string
  profileUserName?: string
  localStatePath: string
}

const NORMAL_CHROME_MIN_WIDTH = 480
const NORMAL_CHROME_MIN_HEIGHT = 300
const WINDOW_MATCH_TOLERANCE = 8
const SCROLL_REGION_LEASE_TTL_MS = 15_000
const MIN_SCROLL_REGION_WIDTH = 100
const MIN_SCROLL_REGION_HEIGHT = 100
const BROWSER_CHROME_FALLBACK_TOP_INSET = 96
const SCROLL_REGION_ANCHOR_Y_RATIO = 0.55

export class MacOSChromeDriver {
  readonly #sessionId: string
  readonly #config: ComputerUseConfig
  readonly #foregroundPolicy: ChromeForegroundPolicy
  #nextObservationId = 1
  #nextRecognitionId = 1
  #nextActionId = 1
  #lastCursorPosition?: { x: number, y: number }

  // AUV-aligned trace and capture state
  #traceStore?: TraceStore
  #profileConfig?: ProfileConfig
  #chromeContextLease?: ChromeContextLease
  #runId: string
  #spanId = 'session'
  #lastCapture?: ChromeWindowCapture
  #lastObservation?: ObservationSnapshot
  #recognitionArtifacts = new Map<string, ArtifactRef>()
  #promotedCandidateArtifacts = new Map<string, StoredPromotedCandidate>()
  #focusedTextInputLease?: FocusedTextInputLease
  #scrollRegionLease?: ChromeScrollRegionLease

  constructor(options: MacOSChromeDriverOptions) {
    if (!options.sessionId?.trim()) {
      throw new TypeError('MacOSChromeDriver requires a non-empty sessionId.')
    }
    this.#sessionId = options.sessionId
    this.#config = { ...resolveComputerUseConfig(), ...options.config }
    this.#foregroundPolicy = options.foregroundPolicy ?? 'require_chrome'

    this.#runId = `run_${options.sessionId}_${Date.now()}`
    this.#traceStore = new TraceStore(this.#config.sessionRoot, options.sessionId)
    this.#traceStore.startRun(this.#runId, { intent: 'macos_chrome_driver' })
    this.#traceStore.startSpan(this.#spanId, undefined, 'session')
  }

  // ═══════════════════════════════════════════════════════════════
  // AUV-aligned API
  // ═══════════════════════════════════════════════════════════════

  get lastCapture(): ChromeWindowCapture | undefined {
    return this.#lastCapture
  }

  /**
   * Exposes the driver-level TraceStore so invoke-entry can wire it into the invoke runtime as the trace sink.
   * Without this, the invoke runtime's events.jsonl stays empty and command_count === 0.
   */
  get traceSink(): TraceStore | undefined {
    return this.#traceStore
  }

  async checkSafetyGate(): Promise<SafetyCheckResult> {
    const precondition = await this.#checkActionPreconditions()
    return precondition.result
  }

  async observe(): Promise<ObservationSnapshot> {
    this.#focusedTextInputLease = undefined
    await this.#ensureChromeContextLease()

    const snapshotId = `mco_${this.#nextObservationId++}`
    const spanId = `observe_${snapshotId}`

    this.#traceStore?.startSpan(spanId, this.#spanId, 'observe')

    const chromeContext = await this.#requireLeasedChromeContext()
    const capture = await captureChromeWindow({
      config: this.#config,
      sessionId: this.#sessionId,
      snapshotId,
      window: chromeContext.window,
    })
    this.#lastCapture = capture

    // Record screenshot artifact
    const screenshotArtifactId = `screenshot_${snapshotId}`
    this.#traceStore?.recordArtifact({
      artifact_id: screenshotArtifactId,
      span_id: spanId,
      role: 'screenshot',
      mime_type: 'image/png',
      path: capture.screenshot.path,
      attributes: { width: capture.screenshot.width, height: capture.screenshot.height },
    })

    const captureArtifact: ArtifactRef = { run_id: this.#runId, artifact_id: screenshotArtifactId, span_id: spanId }
    const contractArtifactId = `capture_contract_${snapshotId}`
    const captureContractArtifact: ArtifactRef = { run_id: this.#runId, artifact_id: contractArtifactId, span_id: spanId }
    this.#traceStore?.writeJsonArtifact({
      artifact_id: contractArtifactId,
      span_id: spanId,
      role: 'capture-contract',
      payload: capture.contract,
      attributes: { coordinate_contract_version: capture.contract.coordinateContractVersion },
    })

    // Parallel observation: AX, DOM, OCR
    const [axResult, domResult, ocrResult] = await Promise.allSettled([
      captureAXTree(this.#config, {
        pid: chromeContext.window.ownerPid,
        maxDepth: 15,
        maxNodes: 3000,
      }),
      captureChromeDom(this.#config, chromeDomTargetFromWindow(chromeContext.window)),
      recognizeTextInImage(this.#config, {
        imagePath: capture.screenshot.path,
        maxObservations: 256,
      }),
    ])

    const axSnapshot = axResult.status === 'fulfilled' ? axResult.value : undefined
    const chromeDomObservation
      = domResult.status === 'fulfilled' && domResult.value ? domResult.value : undefined
    const ocr = ocrResult.status === 'fulfilled'
      ? ocrResult.value
      : emptyOcrTextSnapshot(capture, ocrResult.reason)
    const ocrRows = await produceOcrRows({
      textSnapshot: ocr,
    })
      .catch(error => emptyOcrRowSnapshot(ocr, error))
    const ocrRowReportArtifact = this.#traceStore?.writeJsonArtifact({
      artifact_id: `ocr_row_report_${snapshotId}`,
      span_id: spanId,
      role: 'ocr-row-report',
      payload: ocrRows,
      attributes: {
        strategy: ocrRows.strategy,
        row_count: ocrRows.rowCount,
        raw_match_count: ocrRows.rawMatchCount,
        filtered_match_count: ocrRows.filteredMatchCount,
      },
    })
    const ocrRowReportRef = ocrRowReportArtifact
      ? { run_id: this.#runId, artifact_id: ocrRowReportArtifact.artifact_id, span_id: ocrRowReportArtifact.span_id }
      : undefined

    // Compute viewport bounds from the leased Chrome AXWindow when possible.
    const axViewportBounds = findChromeViewportBounds(axSnapshot, chromeContext.window.bounds)
    const viewportBounds = axViewportBounds?.bounds ?? chromeContext.window.bounds

    // Normalize ALL sources → SurfaceNode[]
    const nodes = normalizeToSurfaceNodes({
      ocrMatches: ocr.matches,
      ocrRows: ocrRows.rows,
      axSnapshot,
      domObservation: chromeDomObservation ?? undefined,
      contract: capture.contract,
      runId: this.#runId,
      spanId,
      viewportBounds,
      captureArtifact,
      captureContractArtifact,
    })

    const source = inferObservationSource(nodes)
    const visibleText = nodes.map(n => n.label ?? '').join('\n')
    const signals = detectHardStopSignals(visibleText)
    const capturedAtMillis = Date.now()
    const scrollBoundary = buildScrollBoundaryObservation({
      generatedAtMillis: capturedAtMillis,
      captureContractRef: captureContractArtifact,
      sourceArtifacts: [captureArtifact, captureContractArtifact],
    })
    const observationRef = {
      run_id: this.#runId,
      artifact_id: `observation_${snapshotId}`,
      span_id: spanId,
    }
    const scrollRegionLease = buildChromeScrollRegionLease({
      snapshotId,
      runId: this.#runId,
      spanId,
      capturedAtMillis,
      window: chromeContext.window,
      profile: chromeContext.profile,
      observationRef,
      viewportCandidate: axViewportBounds,
    })
    this.#scrollRegionLease = scrollRegionLease

    const result: ObservationSnapshot = {
      api_version: 'careerdeepseek.observation_snapshot.v1alpha1',
      snapshot_id: snapshotId,
      run_id: this.#runId,
      span_id: spanId,
      captured_at_millis: capturedAtMillis,
      source,
      scope: {
        surface: 'window',
        window_number: chromeContext.window.windowNumber,
        app_bundle_id: chromeContext.window.ownerBundleId,
        window_title: chromeContext.window.title ?? undefined,
        capture_artifact: captureArtifact,
      },
      capture_contract_ref: captureContractArtifact,
      evidence: [
        captureArtifact,
        captureContractArtifact,
        ...(ocrRowReportRef ? [ocrRowReportRef] : []),
      ],
      nodes,
      detail: {
        chrome_context: {
          active_tab_url: chromeContext.activeTabUrl,
          active_tab_title: chromeContext.activeTabTitle,
          lease: chromeContext.lease,
        },
        signals,
        ocr_match_count: ocr.matches.length,
        ocr_known_limits: ocr.knownLimits ?? [],
        ocr_rows: ocrRowSummary(ocrRows),
        scroll_boundary: scrollBoundary,
        scroll_region: serializeScrollRegionLease(scrollRegionLease, chromeContext.window.bounds),
      },
      known_limits: uniqueStrings([
        this.#chromeContextLease ? 'managed Chrome context lease established' : 'Chrome context lease missing, actions blocked',
        ...(ocr.knownLimits ?? []),
        ...ocrRows.knownLimits,
        ...scrollRegionLease.knownLimits,
      ]),
    }

    this.#traceStore?.writeJsonArtifact({
      artifact_id: `observation_${snapshotId}`,
      span_id: spanId,
      role: 'observation-snapshot',
      payload: result,
      attributes: { node_count: nodes.length, source },
    })
    this.#traceStore?.endSpan(spanId, 'ok', `observed ${nodes.length} nodes`)

    this.#lastObservation = result
    return result
  }

  async recognizeFromCapture(
    capture: ChromeWindowCapture,
    target: ChromeRecognitionTarget,
  ): Promise<NewRecognitionResult> {
    this.#focusedTextInputLease = undefined
    const spanId = `recognize_${this.#nextRecognitionId}`
    this.#traceStore?.startSpan(spanId, this.#spanId, 'recognize')

    // OCR-first
    const ocr = await recognizeTextInImage(this.#config, {
      imagePath: capture.screenshot.path,
      maxObservations: 256,
    }).catch(error => emptyOcrTextSnapshot(capture, error))
    const ocrRows = await produceOcrRows({
      textSnapshot: ocr,
    })
      .catch(error => emptyOcrRowSnapshot(ocr, error))
    const evidence = this.#captureEvidenceRefs(capture)
    const captureArtifact = evidence.find(ref => ref.artifact_id.startsWith('screenshot'))
    const captureContractArtifact = evidence.find(ref => ref.artifact_id.startsWith('capture_contract') || ref.artifact_id.startsWith('capture-contract'))

    const ocrItems: RecognizedItem[] = normalizeToSurfaceNodes({
      ocrMatches: ocr.matches,
      ocrRows: ocrRows.rows,
      contract: capture.contract,
      runId: this.#runId,
      spanId,
      captureArtifact,
      captureContractArtifact,
    }).map(surfaceNodeToRecognizedItem)

    // DOM/AX items from last observation (AUXILIARY for role verification)
    const domAxItems: RecognizedItem[] = (this.#lastObservation?.nodes ?? [])
      .filter(n => n.kind.startsWith('dom_') || n.kind.startsWith('ax_'))
      .filter(n => n.label && n.label.length > 0)
      .map(n => ({
        item_id: n.node_ref.node_id,
        kind: n.kind,
        text: n.label ?? undefined,
        box: n.box,
        provider_score: n.provider_score ?? 0.5,
        detail: n.kind.startsWith('dom_') && n.kind !== 'dom_evidence'
          ? detailWithCurrentCaptureProjection(n.detail, n.box, capture.contract)
          : n.detail,
      }))

    // Merge: OCR items + DOM/AX items, deduplicate by item_id
    const seenIds = new Set<string>()
    const allItems: RecognizedItem[] = []
    for (const item of [...domAxItems, ...ocrItems]) {
      if (!seenIds.has(item.item_id)) {
        seenIds.add(item.item_id)
        allItems.push(item)
      }
    }

    const result = recognizeFromCapture(
      allItems,
      target,
      capture.contract,
      capture.screenshot.path,
      this.#runId,
      spanId,
      evidence,
    )
    result.known_limits = uniqueStrings([
      ...result.known_limits,
      ...(ocr.knownLimits ?? []),
      ...ocrRows.knownLimits,
    ])
    result.detail.ocr_known_limits = ocr.knownLimits ?? []
    result.detail.ocr_row_known_limits = ocrRows.knownLimits
    const crossSourceAudit = result.detail.cross_source_audit
    const driverRecognitionKnownLimits = uniqueStrings([
      ...(ocr.knownLimits ?? []),
      ...ocrRows.knownLimits,
    ])
    if (driverRecognitionKnownLimits.length > 0 && typeof crossSourceAudit === 'object' && crossSourceAudit !== null) {
      const audit = crossSourceAudit as { status?: unknown, known_limits?: unknown }
      audit.known_limits = uniqueStrings([
        ...(Array.isArray(audit.known_limits) ? audit.known_limits.filter((limit): limit is string => typeof limit === 'string') : []),
        ...driverRecognitionKnownLimits,
      ])
      if (audit.status !== 'conflict')
        audit.status = 'unknown'
    }

    const recognitionArtifactId = `recognition_${result.recognition_id}`
    this.#traceStore?.writeJsonArtifact({
      artifact_id: recognitionArtifactId,
      span_id: spanId,
      role: 'recognition-result',
      payload: result,
      attributes: {
        found: result.found,
        filtered_count: result.filtered.length,
        total_count: result.all.length,
      },
    })
    this.#recognitionArtifacts.set(result.recognition_id, {
      run_id: this.#runId,
      artifact_id: recognitionArtifactId,
      span_id: spanId,
    })

    this.#nextRecognitionId++
    this.#traceStore?.endSpan(spanId, 'ok')
    return result
  }

  async promoteCandidate(
    recognition: NewRecognitionResult,
    capture: ChromeWindowCapture,
    targetKind?: ChromeRecognitionTarget['kind'],
  ): Promise<CandidatePromotion> {
    const chromeContext = await this.#requireLeasedChromeContext()
    const hardStopSignals = detectHardStopSignals(
      recognition.all.map(i => i.text ?? '').join('\n'),
    )

    const promotion = doPromoteCandidate(recognition, capture.contract, chromeContext.window, {
      profile_verified: true,
      chrome_foreground: chromeContext.isFrontmost,
      hard_stop_signals: hardStopSignals,
      ttl_ms: 15_000,
      run_id: this.#runId,
      span_id: this.#spanId,
      capture_artifact: recognition.scope.capture_artifact ?? this.#captureEvidenceRefs(capture).find(ref => ref.artifact_id.startsWith('screenshot')),
      recognition_artifact: this.#recognitionArtifacts.get(recognition.recognition_id),
      target_kind: targetKind,
    })
    if (promotion.status === 'promoted') {
      const candidateSnapshot = immutableJsonSnapshot(promotion.candidate)
      const promotedArtifact = this.#traceStore?.writeJsonArtifact({
        artifact_id: `promoted_${sanitizeArtifactId(recognition.recognition_id)}`,
        span_id: this.#spanId,
        role: 'promoted-candidate',
        payload: candidateSnapshot,
        attributes: {
          recognition_id: recognition.recognition_id,
          candidate_local_id: candidateSnapshot.candidate_local_id,
        },
      })
      if (promotedArtifact) {
        this.#promotedCandidateArtifacts.set(candidateSnapshot.candidate_local_id, {
          ref: {
            run_id: this.#runId,
            artifact_id: promotedArtifact.artifact_id,
            span_id: promotedArtifact.span_id,
          },
          candidate: candidateSnapshot,
        })
      }
    }
    return promotion
  }

  async click(candidate: PromotedCandidate): Promise<void> {
    const storedCandidate = this.#promotedCandidateArtifacts.get(candidate.candidate_local_id) ?? null
    const candidateArtifactRef = storedCandidate?.ref ?? null
    const callerPreconditionFailure = promotedCandidatePreconditionFailure(
      candidate,
      storedCandidate,
      isSupportedClickCandidateGrounding,
      ['ocr_anchor', 'visual_row', 'coordinate'],
    )
    await this.#executeAction('click', candidateArtifactRef, candidate.target_spec.grounding, async (context) => {
      const candidateFromArtifact = storedCandidate!.candidate
      const winNumber = candidateFromArtifact.liveness.preconditions.window_ref.window_number
      if (winNumber !== undefined && context.window.windowNumber !== winNumber) {
        throw new Error('Refusing click: Chrome window changed after candidate promotion.')
      }

      const liveness = await this.#recheckCandidateLiveness(candidateFromArtifact, candidateArtifactRef!)
      const box = liveness.item.box
      const center = centerOf(box)

      if (!pointInsideBounds(center, liveness.context.window.bounds)) {
        throw new Error('Refusing click: candidate point is outside the active Chrome window.')
      }

      const pointerTrace = buildPointerTrace({
        from: this.#lastCursorPosition,
        to: center,
        bounds: this.#config.allowedBounds,
      })
      try {
        await executeMoveAndClick(this.#config, {
          pointerTrace,
          button: 0,
          clickCount: 1,
        })
      }
      catch (err) {
        throw new ActionExecutionError((err as Error).message, liveness.detail)
      }
      this.#lastCursorPosition = center
      return { livenessRecheck: liveness.detail }
    }, callerPreconditionFailure)
  }

  async focusTextInput(candidate: PromotedCandidate): Promise<void> {
    const storedCandidate = this.#promotedCandidateArtifacts.get(candidate.candidate_local_id) ?? null
    const candidateArtifactRef = storedCandidate?.ref ?? null
    const callerPreconditionFailure = promotedCandidatePreconditionFailure(
      candidate,
      storedCandidate,
      isSupportedFocusTextInputCandidateGrounding,
      ['ax_node text_input'],
    )
    await this.#executeAction('focusTextInput', candidateArtifactRef, candidate.target_spec.grounding, async (context) => {
      const candidateFromArtifact = storedCandidate!.candidate
      const winNumber = candidateFromArtifact.liveness.preconditions.window_ref.window_number
      if (winNumber !== undefined && context.window.windowNumber !== winNumber) {
        throw new Error('Refusing focusTextInput: Chrome window changed after candidate promotion.')
      }

      const liveness = await this.#recheckCandidateLiveness(candidateFromArtifact, candidateArtifactRef!)
      const box = liveness.item.box
      const center = centerOf(box)

      if (!pointInsideBounds(center, liveness.context.window.bounds)) {
        throw new Error('Refusing focusTextInput: candidate point is outside the active Chrome window.')
      }

      const pointerTrace = buildPointerTrace({
        from: this.#lastCursorPosition,
        to: center,
        bounds: this.#config.allowedBounds,
      })
      try {
        await executeMoveAndClick(this.#config, {
          pointerTrace,
          button: 0,
          clickCount: 1,
        })
      }
      catch (err) {
        throw new ActionExecutionError((err as Error).message, liveness.detail)
      }
      this.#lastCursorPosition = center
      return { livenessRecheck: liveness.detail }
    }, callerPreconditionFailure)

    if (storedCandidate && candidateArtifactRef) {
      this.#focusedTextInputLease = {
        candidateLocalId: storedCandidate.candidate.candidate_local_id,
        candidateRef: candidateArtifactRef,
        windowNumber: storedCandidate.candidate.liveness.preconditions.window_ref.window_number,
        grounding: 'ax_node',
      }
    }
  }

  async typeText(text: string): Promise<void> {
    const focusLease = this.#focusedTextInputLease
    await this.#executeAction('typeText', focusLease?.candidateRef ?? null, focusLease?.grounding, async () => executeTypeText(this.#config, {
      pointerTrace: [],
      text,
    }), focusedTextInputPreconditionFailure(focusLease))
  }

  async pressKey(key: string, modifiers: string[] = []): Promise<void> {
    const focusLease = this.#focusedTextInputLease
    await this.#executeAction('pressKey', focusLease?.candidateRef ?? null, focusLease?.grounding, async () => executePressKeys(this.#config, { keys: [key], modifiers }), focusedTextInputPreconditionFailure(focusLease))
  }

  async scroll(deltaY = 600, deltaX = 0, options: MacOSChromeScrollOptions = {}): Promise<void> {
    rejectLegacyScrollCandidateInput(deltaY)
    rejectCallerSuppliedScrollCoordinates(options)
    const lease = this.#scrollRegionLease
    const callerPreconditionFailure = scrollRegionPreconditionFailure(lease)

    try {
      await this.#executeAction('scroll', null, 'observed_scroll_region', async (context) => {
        const resolved = resolveScrollRegionForAction(lease!, context)
        const baseKnownLimits = [
          ...resolved.lease.knownLimits,
          'caller_must_post_scroll_observe',
          'scroll_result_does_not_claim_page_boundary',
        ]

        try {
          await executeWindowTargetedScroll(this.#config, {
            pid: context.window.ownerPid,
            windowNumber: context.window.windowNumber,
            screenPoint: resolved.anchor.screenPoint,
            windowLocalPoint: resolved.anchor.windowLocalPoint,
            deltaX,
            deltaY,
            settleMs: options.settleMs,
          })
          return {
            scrollRegion: serializeScrollRegionActionDetail(resolved, {
              selectedPath: 'window_targeted_scroll',
              attemptedPaths: ['window_targeted_scroll'],
            }),
            knownLimits: baseKnownLimits,
          }
        }
        catch (error) {
          // Fall back to foreground HID delivery when the private window-targeted
          // route is unavailable. The Swift fallback restores the real cursor.
          const pointerTrace = buildPointerTrace({
            from: this.#lastCursorPosition,
            to: resolved.anchor.screenPoint,
            bounds: this.#config.allowedBounds,
          })
          await executeScroll(this.#config, {
            pointerTrace,
            deltaX,
            deltaY,
            settleMs: options.settleMs,
          })
          this.#lastCursorPosition = resolved.anchor.screenPoint
          return {
            scrollRegion: serializeScrollRegionActionDetail(resolved, {
              selectedPath: 'foreground_hid_scroll',
              attemptedPaths: ['window_targeted_scroll', 'foreground_hid_scroll'],
              fallbackReason: stringifyThrownValue(error),
            }),
            knownLimits: uniqueStrings([
              ...baseKnownLimits,
              'window_targeted_scroll_unavailable_fell_back_to_foreground_hid',
              `window_targeted_scroll_error: ${stringifyThrownValue(error)}`,
            ]),
          }
        }
      }, callerPreconditionFailure)
    }
    finally {
      this.#scrollRegionLease = undefined
    }
  }

  async #executeAction(
    actionType: ActionType,
    candidateRef: ArtifactRef | null,
    grounding: string | undefined,
    executor: (context: ChromeContextSnapshot) => Promise<ActionExecutorResult>,
    callerPreconditionFailure?: SafetyFailure,
  ): Promise<void> {
    const actionId = `action_${this.#nextActionId++}`
    const spanId = `${actionId}_${actionType}`
    this.#traceStore?.startSpan(spanId, this.#spanId, actionType)

    const precondition = await this.#checkActionPreconditions()
    const preconditionResult = callerPreconditionFailure
      ? appendSafetyFailure(precondition.result, callerPreconditionFailure)
      : precondition.result
    const context = preconditionResult.passed ? precondition.context : null
    if (!context || !preconditionResult.passed) {
      const reasons = preconditionResult.failures.map(failure => failure.code)
      this.#recordActionExecution({
        actionId,
        actionType,
        spanId,
        candidateRef,
        grounding,
        preconditionResult,
        executed: false,
        refused: true,
        refusalReasons: reasons,
        knownLimits: ['action refused before macOS event delivery'],
      })
      this.#traceStore?.endSpan(spanId, 'error', `refused: ${reasons.join(', ')}`)
      throw new Error(actionRefusalMessage(actionType, reasons))
    }

    try {
      const actionDetail = await executor(context)
      this.#recordActionExecution({
        actionId,
        actionType,
        spanId,
        candidateRef,
        grounding,
        preconditionResult,
        executed: true,
        refused: false,
        refusalReasons: [],
        knownLimits: actionDetail?.knownLimits ?? [],
        livenessRecheck: actionDetail?.livenessRecheck,
        scrollRegion: actionDetail?.scrollRegion,
      })
      this.#traceStore?.endSpan(spanId, 'ok')
    }
    catch (err) {
      if (err instanceof ActionRefusalError) {
        const failureResult = appendSafetyFailure(preconditionResult, err.failure)
        this.#recordActionExecution({
          actionId,
          actionType,
          spanId,
          candidateRef,
          grounding,
          preconditionResult: failureResult,
          executed: false,
          refused: true,
          refusalReasons: [err.code],
          knownLimits: err.knownLimits,
          livenessRecheck: err.livenessRecheck,
        })
        this.#traceStore?.endSpan(spanId, 'error', err.message)
        throw err
      }
      const failureResult = appendSafetyFailure(preconditionResult, {
        code: 'action_execution_error',
        detail: (err as Error).message,
        observed: (err as Error).message,
      })
      this.#recordActionExecution({
        actionId,
        actionType,
        spanId,
        candidateRef,
        grounding,
        preconditionResult: failureResult,
        executed: false,
        refused: true,
        refusalReasons: ['action_execution_error'],
        knownLimits: ['action failed after passing precondition gate'],
        livenessRecheck: err instanceof ActionExecutionError ? err.livenessRecheck : undefined,
      })
      this.#traceStore?.endSpan(spanId, 'error', (err as Error).message)
      throw err
    }
  }

  async #checkActionPreconditions(): Promise<{
    context: ChromeContextSnapshot | null
    result: SafetyCheckResult
  }> {
    const failures: SafetyFailure[] = []
    const lease = this.#chromeContextLease
    if (!lease) {
      failures.push({
        code: 'chrome_context_lease_missing',
        detail: 'Chrome context lease has not been established. Run observe() to bootstrap the managed Chrome context.',
        observed: null,
        expected: 'managed Chrome context lease',
      })
      return {
        context: null,
        result: safetyResultFromFailures(failures),
      }
    }
    if (!this.#profileConfig) {
      failures.push({
        code: 'profile_mismatch',
        detail: 'Profile config has not been loaded for the managed Chrome context.',
        observed: null,
        expected: 'loaded profile config',
      })
    }
    if (!lease || !this.#profileConfig) {
      return {
        context: null,
        result: safetyResultFromFailures(failures),
      }
    }

    const observation = await observeWindows(this.#config, { limit: 120 })
    const chromeWindow = findLeasedChromeWindow(observation, lease)
    if (!chromeWindow) {
      failures.push({
        code: 'chrome_context_lease_invalid',
        detail: 'The leased Chrome window identity is no longer present.',
        observed: observation.windows.map(window => ({
          windowNumber: window.windowNumber,
          ownerPid: window.ownerPid,
          ownerBundleId: window.ownerBundleId,
        })),
        expected: {
          windowNumber: lease.windowNumber,
          ownerPid: lease.ownerPid,
          ownerBundleId: lease.ownerBundleId,
        },
      })
      return {
        context: null,
        result: safetyResultFromFailures(failures),
      }
    }

    const context = await this.#chromeContextFromWindowObservation(observation, chromeWindow, lease)
    const safety = checkSafetyGate(context, this.#visibleTextForSafety(), this.#profileConfig)
    return {
      context: safety.passed ? context : null,
      result: failures.length > 0 ? mergeSafetyFailures(safety, failures) : safety,
    }
  }

  #recordActionExecution(input: {
    actionId: string
    actionType: ActionType
    spanId: string
    candidateRef: ArtifactRef | null
    grounding?: string
    preconditionResult: SafetyCheckResult
    executed: boolean
    refused: boolean
    refusalReasons: string[]
    knownLimits: string[]
    livenessRecheck?: Record<string, unknown>
    scrollRegion?: Record<string, unknown>
  }): void {
    this.#traceStore?.writeJsonArtifact({
      artifact_id: `action_execution_${input.actionId}`,
      span_id: input.spanId,
      role: 'action-execution',
      payload: {
        action_id: input.actionId,
        action_type: input.actionType,
        run_id: this.#runId,
        span_id: input.spanId,
        candidate_ref: input.candidateRef,
        grounding: input.grounding,
        precondition_result: input.preconditionResult,
        executed: input.executed,
        refused: input.refused,
        refusal_reasons: input.refusalReasons,
        liveness_recheck: input.livenessRecheck,
        scroll_region: input.scrollRegion,
        timestamp_millis: Date.now(),
        known_limits: input.knownLimits,
      },
      attributes: {
        action_type: input.actionType,
        executed: input.executed,
        refused: input.refused,
      },
    })
  }

  async #recheckCandidateLiveness(
    candidate: PromotedCandidate,
    candidateRef: ArtifactRef,
  ): Promise<CandidateLivenessCheck> {
    const target = recognitionTargetForCandidate(candidate)
    let freshObservation: ObservationSnapshot
    try {
      freshObservation = await this.observe()
    }
    catch (err) {
      const code = freshObserveFailureCode(err)
      const detail = livenessDetail({
        candidate,
        candidateRef,
        target,
        freshObservation: null,
        freshRecognition: null,
        freshRecognitionRef: undefined,
        status: 'refused',
        refusalReason: code,
        knownLimits: [`fresh observe failed: ${stringifyThrownValue(err)}`],
      })
      throw new ActionRefusalError({
        code,
        message: `Refusing click: ${code} during candidate liveness recheck.`,
        detail,
        knownLimits: ['action refused before macOS event delivery', `fresh observe failed: ${stringifyThrownValue(err)}`],
      })
    }
    const freshCapture = this.#lastCapture
    if (!freshCapture) {
      const detail = livenessDetail({
        candidate,
        candidateRef,
        target,
        freshObservation,
        freshRecognition: null,
        freshRecognitionRef: undefined,
        status: 'refused',
        refusalReason: 'fresh_capture_missing',
        knownLimits: ['liveness recheck could not capture current Chrome window'],
      })
      throw new ActionRefusalError({
        code: 'fresh_capture_missing',
        message: 'Refusing click: fresh_capture_missing during candidate liveness recheck.',
        detail,
        knownLimits: ['action refused before macOS event delivery', 'liveness recheck could not capture current Chrome window'],
      })
    }

    if (!target) {
      const detail = livenessDetail({
        candidate,
        candidateRef,
        target,
        freshObservation,
        freshRecognition: null,
        freshRecognitionRef: undefined,
        status: 'refused',
        refusalReason: 'anchor_recheck_unavailable',
        knownLimits: ['candidate has no anchor text for liveness recheck'],
      })
      throw new ActionRefusalError({
        code: 'anchor_recheck_unavailable',
        message: 'Refusing click: anchor_recheck_unavailable for promoted candidate.',
        detail,
        knownLimits: ['action refused before macOS event delivery', 'candidate has no anchor text for liveness recheck'],
      })
    }

    const freshRecognition = await this.recognizeFromCapture(freshCapture, target)
    const freshRecognitionRef = this.#recognitionArtifacts.get(freshRecognition.recognition_id)
    const knownLimits = uniqueStrings([
      ...freshObservation.known_limits,
      ...freshRecognition.known_limits,
    ])
    const sourceCompatibleItems = freshRecognition.filtered
      .filter(item => isFreshSourceCompatible(candidate, item))

    if (sourceCompatibleItems.length > 1) {
      const detail = livenessDetail({
        candidate,
        candidateRef,
        target,
        freshObservation,
        freshRecognition,
        freshRecognitionRef,
        status: 'refused',
        refusalReason: 'anchor_recheck_ambiguous',
        knownLimits,
      })
      throw new ActionRefusalError({
        code: 'anchor_recheck_ambiguous',
        message: 'Refusing click: anchor_recheck_ambiguous in current Chrome observation.',
        detail,
        knownLimits: ['action refused before macOS event delivery', ...knownLimits],
      })
    }

    if (!freshRecognition.best) {
      const detail = livenessDetail({
        candidate,
        candidateRef,
        target,
        freshObservation,
        freshRecognition,
        freshRecognitionRef,
        status: 'refused',
        refusalReason: 'anchor_recheck_missing',
        knownLimits,
      })
      throw new ActionRefusalError({
        code: 'anchor_recheck_missing',
        message: 'Refusing click: anchor_recheck_missing in current Chrome observation.',
        detail,
        knownLimits: ['action refused before macOS event delivery', ...knownLimits],
      })
    }

    const selected = sourceCompatibleItems[0]
    if (!selected) {
      const detail = livenessDetail({
        candidate,
        candidateRef,
        target,
        freshObservation,
        freshRecognition,
        freshRecognitionRef,
        selected: freshRecognition.best,
        status: 'refused',
        refusalReason: 'anchor_recheck_incompatible_source',
        knownLimits,
      })
      throw new ActionRefusalError({
        code: 'anchor_recheck_incompatible_source',
        message: 'Refusing click: anchor_recheck_incompatible_source in current Chrome observation.',
        detail,
        knownLimits: ['action refused before macOS event delivery', ...knownLimits],
      })
    }

    if (!hasTrustworthyCurrentProjection(selected)) {
      const detail = livenessDetail({
        candidate,
        candidateRef,
        target,
        freshObservation,
        freshRecognition,
        freshRecognitionRef,
        selected,
        status: 'refused',
        refusalReason: 'anchor_recheck_projection_unavailable',
        knownLimits,
      })
      throw new ActionRefusalError({
        code: 'anchor_recheck_projection_unavailable',
        message: 'Refusing click: anchor_recheck_projection_unavailable in current Chrome observation.',
        detail,
        knownLimits: ['action refused before macOS event delivery', ...knownLimits],
      })
    }

    const expectedConfidence = candidate.liveness.preconditions.anchor_recheck?.expected_min_confidence
    if (expectedConfidence !== undefined && (!Number.isFinite(selected.provider_score) || selected.provider_score! < expectedConfidence)) {
      const detail = livenessDetail({
        candidate,
        candidateRef,
        target,
        freshObservation,
        freshRecognition,
        freshRecognitionRef,
        selected,
        status: 'refused',
        refusalReason: 'anchor_recheck_low_confidence',
        knownLimits,
      })
      throw new ActionRefusalError({
        code: 'anchor_recheck_low_confidence',
        message: 'Refusing click: anchor_recheck_low_confidence in current Chrome observation.',
        detail,
        knownLimits: ['action refused before macOS event delivery', ...knownLimits],
      })
    }

    const originalCenter = centerOf(candidate.target_spec.box)
    const freshCenter = centerOf(selected.box)
    const pixelDistance = distanceBetween(originalCenter, freshCenter)
    const maxPixelDistance = candidate.liveness.preconditions.anchor_recheck?.max_pixel_distance
    if (maxPixelDistance !== undefined && pixelDistance > maxPixelDistance) {
      const detail = livenessDetail({
        candidate,
        candidateRef,
        target,
        freshObservation,
        freshRecognition,
        freshRecognitionRef,
        selected,
        status: 'refused',
        refusalReason: 'anchor_recheck_moved',
        pixelDistance,
        maxPixelDistance,
        knownLimits,
      })
      throw new ActionRefusalError({
        code: 'anchor_recheck_moved',
        message: 'Refusing click: anchor_recheck_moved beyond max_pixel_distance.',
        detail,
        knownLimits: ['action refused before macOS event delivery', ...knownLimits],
      })
    }

    const freshPrecondition = await this.#checkActionPreconditions()
    if (!freshPrecondition.context || !freshPrecondition.result.passed) {
      const reason = freshPrecondition.result.failures[0]?.code ?? 'fresh_safety_gate_failed'
      const detail = livenessDetail({
        candidate,
        candidateRef,
        target,
        freshObservation,
        freshRecognition,
        freshRecognitionRef,
        selected,
        status: 'refused',
        refusalReason: reason,
        pixelDistance,
        maxPixelDistance,
        freshSafetyResult: freshPrecondition.result,
        knownLimits,
      })
      throw new ActionRefusalError({
        code: reason,
        message: `Refusing click: ${reason} after fresh Chrome observation.`,
        detail,
        knownLimits: ['action refused before macOS event delivery', ...knownLimits],
      })
    }

    if (!pointInsideBounds(freshCenter, freshPrecondition.context.window.bounds)) {
      const detail = livenessDetail({
        candidate,
        candidateRef,
        target,
        freshObservation,
        freshRecognition,
        freshRecognitionRef,
        selected,
        status: 'refused',
        refusalReason: 'anchor_recheck_outside_window',
        pixelDistance,
        maxPixelDistance,
        freshSafetyResult: freshPrecondition.result,
        knownLimits,
      })
      throw new ActionRefusalError({
        code: 'anchor_recheck_outside_window',
        message: 'Refusing click: anchor_recheck_outside_window in current Chrome observation.',
        detail,
        knownLimits: ['action refused before macOS event delivery', ...knownLimits],
      })
    }

    return {
      item: selected,
      context: freshPrecondition.context,
      detail: livenessDetail({
        candidate,
        candidateRef,
        target,
        freshObservation,
        freshRecognition,
        freshRecognitionRef,
        selected,
        status: 'passed',
        pixelDistance,
        maxPixelDistance,
        freshSafetyResult: freshPrecondition.result,
        knownLimits,
      }),
    }
  }

  #captureEvidenceRefs(capture: ChromeWindowCapture): ArtifactRef[] {
    const refs: ArtifactRef[] = []
    const observation = this.#lastObservation
    const screenshotRef = observation?.evidence.find(ref => ref.artifact_id === `screenshot_${capture.snapshotId}`)
    const contractRef = observation?.capture_contract_ref?.artifact_id === `capture_contract_${capture.snapshotId}`
      ? observation.capture_contract_ref
      : undefined
    if (screenshotRef)
      refs.push(screenshotRef)
    if (contractRef)
      refs.push(contractRef)
    return refs
  }

  #visibleTextForSafety(): string {
    return (this.#lastObservation?.nodes ?? [])
      .map(node => node.label ?? '')
      .filter(Boolean)
      .join('\n')
  }

  async #ensureChromeContextLease(): Promise<void> {
    if (this.#chromeContextLease) {
      return
    }

    this.#profileConfig = await loadProfileConfig(this.#config.sessionRoot)
    const profileIdentity = resolveManagedChromeProfileIdentity(this.#profileConfig)
    await executeOpenApp(this.#config, 'Google Chrome', {
      args: [`--profile-directory=${profileIdentity.profileDir}`],
    })
    await sleep(500)

    const chromeContext = await this.#resolveChromeContext({
      activateIfNeeded: true,
      profileIdentity,
    })
    const now = new Date().toISOString()
    this.#chromeContextLease = {
      leaseId: `lease_${this.#runId}_${chromeContext.window.windowNumber}`,
      sessionId: this.#sessionId,
      runId: this.#runId,
      profileMode: 'managed',
      profileDir: profileIdentity.profileDir,
      profilePath: profileIdentity.profilePath,
      profileName: profileIdentity.profileName,
      profileUserName: profileIdentity.profileUserName,
      ownerPid: chromeContext.window.ownerPid,
      windowNumber: chromeContext.window.windowNumber,
      ownerBundleId: chromeContext.window.ownerBundleId,
      appBundleId: chromeContext.window.ownerBundleId,
      createdAt: now,
      verifiedAt: now,
    }

    this.#traceStore?.recordEvent({
      event_id: `evt_chrome_context_lease_${Date.now()}`,
      span_id: this.#spanId,
      name: 'chrome_context_lease_established',
      timestamp_millis: Date.now(),
      attributes: {
        lease_id: this.#chromeContextLease.leaseId,
        profile_path: this.#chromeContextLease.profilePath,
        profile_name: this.#chromeContextLease.profileName,
        profile_user_name: this.#chromeContextLease.profileUserName,
        window_number: this.#chromeContextLease.windowNumber,
        owner_pid: this.#chromeContextLease.ownerPid,
        owner_bundle_id: this.#chromeContextLease.ownerBundleId,
      },
      message: `Managed Chrome context lease established for window ${this.#chromeContextLease.windowNumber}.`,
      artifact_ids: [],
    })
  }

  async #requireLeasedChromeContext(): Promise<ChromeContextSnapshot> {
    const lease = this.#chromeContextLease
    if (!lease) {
      throw new Error('Chrome context lease has not been established. Run observe() to bootstrap the managed Chrome context.')
    }

    let observation = await observeWindows(this.#config, { limit: 120 })
    if (!isChromeApp(observation.frontmostAppName) && this.#foregroundPolicy === 'auto_focus_chrome') {
      await executeOpenApp(this.#config, 'Google Chrome')
      await sleep(500)
      observation = await observeWindows(this.#config, { limit: 120 })
    }

    const chromeWindow = findLeasedChromeWindow(observation, lease)
    if (!chromeWindow) {
      throw new Error('Chrome context lease is no longer valid. Run observe() in a new driver session to bootstrap the managed Chrome context again.')
    }
    if (!isChromeApp(observation.frontmostAppName)) {
      throw new Error(
        `Google Chrome must be the foreground app for the active lease; current frontmost app is ${observation.frontmostAppName ?? 'unknown'}.`,
      )
    }

    lease.verifiedAt = new Date().toISOString()
    return this.#chromeContextFromWindowObservation(observation, chromeWindow, lease)
  }

  async #resolveChromeContext(options: {
    activateIfNeeded?: boolean
    profileIdentity?: ManagedChromeProfileIdentity
  } = {}): Promise<ChromeContextSnapshot> {
    let observation = await observeWindows(this.#config, { limit: 120 })
    let chromeWindow = await this.#findChromeWindow(observation, options.profileIdentity)
    if (!isChromeApp(observation.frontmostAppName) || !chromeWindow) {
      if (options.activateIfNeeded || this.#foregroundPolicy === 'auto_focus_chrome') {
        await executeOpenApp(this.#config, 'Google Chrome')
        await sleep(500)
        observation = await observeWindows(this.#config, { limit: 120 })
        chromeWindow = await this.#findChromeWindow(observation, options.profileIdentity)
      }
    }

    if (!chromeWindow) {
      throw new Error('No visible Google Chrome window found for macOS Chrome driver.')
    }
    if (!isChromeApp(observation.frontmostAppName)) {
      throw new Error(
        `Google Chrome must be the foreground app; current frontmost app is ${observation.frontmostAppName ?? 'unknown'}.`,
      )
    }

    return this.#chromeContextFromWindowObservation(observation, chromeWindow)
  }

  async #findChromeWindow(
    observation: WindowObservation,
    profileIdentity?: ManagedChromeProfileIdentity,
  ): Promise<WindowDescriptor | undefined> {
    if (!profileIdentity)
      return findChromeWindow(observation)

    const chromePid = findChromePid(observation)
    if (chromePid === undefined)
      return undefined

    const axSnapshot = await captureAXTree(this.#config, {
      pid: chromePid,
      maxDepth: 8,
      maxNodes: 1200,
    }).catch(() => undefined)
    const profileWindow = axSnapshot
      ? findChromeWindowByProfileAX(observation, axSnapshot, profileIdentity.profileName)
      : undefined
    if (profileWindow)
      return profileWindow

    throw new Error(
      `Could not verify a visible Google Chrome window for managed profile "${profileIdentity.profileName}" (${profileIdentity.profilePath}).`,
    )
  }

  async #chromeContextFromWindowObservation(
    observation: WindowObservation,
    chromeWindow: WindowDescriptor,
    lease?: ChromeContextLease,
  ): Promise<ChromeContextSnapshot> {
    const window = chromeWindowRef(chromeWindow)
    const tab = await captureChromeDom(this.#config, chromeDomTargetFromWindow(window)).catch(() => null)
    return {
      running: true,
      isFrontmost: true,
      frontmostAppName: observation.frontmostAppName,
      frontmostAppBundleId: observation.frontmostAppBundleId,
      activeTabUrl: tab?.url ?? null,
      activeTabTitle: tab?.title ?? observation.frontmostWindowTitle ?? null,
      profile: {
        status: lease ? 'verified' : 'unverified',
        reason: lease
          ? 'Managed Chrome context lease is valid for the observed OS window; profile identity was verified against Chrome Local State and AXWindow title evidence during bootstrap.'
          : 'Chrome profile identity is not verified by tab inspection.',
        profile_path: lease?.profilePath,
        profile_name: lease?.profileName,
        profile_user_name: lease?.profileUserName,
      },
      window,
      lease,
    }
  }
}

class ActionRefusalError extends Error {
  readonly code: string
  readonly failure: SafetyFailure
  readonly knownLimits: string[]
  readonly livenessRecheck?: Record<string, unknown>

  constructor(input: {
    code: string
    message: string
    detail: Record<string, unknown>
    knownLimits: string[]
    expected?: string
  }) {
    super(input.message)
    this.name = 'ActionRefusalError'
    this.code = input.code
    this.knownLimits = input.knownLimits
    this.livenessRecheck = input.detail
    this.failure = {
      code: input.code,
      detail: input.message,
      observed: input.detail,
      expected: input.expected ?? 'fresh promoted-candidate liveness check before macOS event delivery',
    }
  }
}

class ActionExecutionError extends Error {
  readonly livenessRecheck: Record<string, unknown>

  constructor(message: string, livenessRecheck: Record<string, unknown>) {
    super(message)
    this.name = 'ActionExecutionError'
    this.livenessRecheck = livenessRecheck
  }
}

function promotedCandidatePreconditionFailure(
  candidate: PromotedCandidate,
  stored: StoredPromotedCandidate | null,
  isSupported: (candidate: PromotedCandidate) => boolean,
  expectedGroundings: string[],
): SafetyFailure | undefined {
  if (!stored) {
    return {
      code: 'missing_promoted_candidate_artifact',
      detail: 'Action candidate was not promoted by this driver session.',
      observed: candidate.candidate_local_id,
      expected: 'promoted-candidate artifact written by driver.promoteCandidate()',
    }
  }
  if (!sameJson(candidate, stored.candidate)) {
    return {
      code: 'promoted_candidate_artifact_mismatch',
      detail: 'Action candidate does not match the promoted-candidate artifact written by this driver session.',
      observed: {
        candidate_local_id: candidate.candidate_local_id,
        source_operation_id: candidate.source_operation_id,
      },
      expected: {
        candidate_local_id: stored.candidate.candidate_local_id,
        source_operation_id: stored.candidate.source_operation_id,
      },
    }
  }
  if (!isSupported(candidate)) {
    return {
      code: 'unsupported_click_candidate_kind',
      detail: 'Candidate grounding is not supported for this macOS event delivery.',
      observed: {
        kind: candidate.kind,
        grounding: candidate.target_spec.grounding,
      },
      expected: expectedGroundings,
    }
  }
  return undefined
}

function focusedTextInputPreconditionFailure(
  lease: FocusedTextInputLease | undefined,
): SafetyFailure | undefined {
  if (lease)
    return undefined

  return {
    code: 'focused_text_input_missing',
    detail: 'Keyboard action requires a successful focusTextInput action in the current driver command sequence.',
    observed: null,
    expected: 'current ax_node text-input focus lease from driver.focusTextInput(candidate)',
  }
}

function recognitionTargetForCandidate(candidate: PromotedCandidate): ChromeRecognitionTarget | null {
  if (!isSupportedLivenessCandidateGrounding(candidate))
    return null

  const grounding = candidate.target_spec.grounding
  const anchorText = candidate.liveness.preconditions.anchor_recheck?.text
    ?? candidate.target_spec.anchor_text
    ?? candidate.label
  if (!anchorText?.trim())
    return null

  const text = exactTextPattern(anchorText)
  if (grounding === 'ocr_anchor')
    return { kind: 'ocr_text', text }
  if (grounding === 'visual_row')
    return { kind: 'ocr_row', text }
  if (grounding === 'ax_node')
    return { kind: 'text_input', name: text }
  if (grounding === 'coordinate') {
    if (BUTTON_KINDS.has(candidate.kind))
      return { kind: 'button', text }
    if (LINK_KINDS.has(candidate.kind))
      return { kind: 'link', text }
  }
  return null
}

function isFreshSourceCompatible(candidate: PromotedCandidate, selected: RecognizedItem): boolean {
  if (!isSupportedLivenessCandidateGrounding(candidate))
    return false
  const grounding = candidate.target_spec.grounding
  if (grounding === 'ocr_anchor')
    return selected.kind === 'ocr_text'
  if (grounding === 'visual_row')
    return selected.kind === 'ocr_row'
  if (grounding === 'ax_node')
    return selected.kind === candidate.kind
  if (grounding === 'coordinate')
    return selected.kind === candidate.kind && COORDINATE_CLICK_KINDS.has(candidate.kind)
  return false
}

function isSupportedClickCandidateGrounding(candidate: PromotedCandidate): boolean {
  const grounding = candidate.target_spec.grounding
  return (grounding === 'ocr_anchor' && candidate.kind === 'ocr_text')
    || (grounding === 'visual_row' && candidate.kind === 'ocr_row')
    || (grounding === 'coordinate' && COORDINATE_CLICK_KINDS.has(candidate.kind))
}

function isSupportedFocusTextInputCandidateGrounding(candidate: PromotedCandidate): boolean {
  return candidate.target_spec.grounding === 'ax_node'
    && TEXT_INPUT_KINDS.has(candidate.kind)
}

function isSupportedLivenessCandidateGrounding(candidate: PromotedCandidate): boolean {
  return isSupportedClickCandidateGrounding(candidate)
    || isSupportedFocusTextInputCandidateGrounding(candidate)
}

function livenessDetail(input: {
  candidate: PromotedCandidate
  candidateRef: ArtifactRef
  target: ChromeRecognitionTarget | null
  freshObservation: ObservationSnapshot | null
  freshRecognition: NewRecognitionResult | null
  freshRecognitionRef?: ArtifactRef
  selected?: RecognizedItem | null
  status: 'passed' | 'refused'
  refusalReason?: string
  pixelDistance?: number
  maxPixelDistance?: number
  freshSafetyResult?: SafetyCheckResult
  knownLimits: string[]
}): Record<string, unknown> {
  return {
    status: input.status,
    refusal_reason: input.refusalReason,
    original_candidate_ref: input.candidateRef,
    grounding: input.candidate.target_spec.grounding,
    original_candidate: {
      candidate_local_id: input.candidate.candidate_local_id,
      kind: input.candidate.kind,
      label: input.candidate.label,
      grounding: input.candidate.target_spec.grounding,
      source_operation_id: input.candidate.source_operation_id,
      source_artifact_id: input.candidate.source_artifact_id,
    },
    original_box: input.candidate.target_spec.box,
    anchor_recheck: input.candidate.liveness.preconditions.anchor_recheck,
    fresh_target: serializeRecognitionTarget(input.target),
    fresh_observation_ref: input.freshObservation
      ? {
          run_id: input.freshObservation.run_id,
          span_id: input.freshObservation.span_id,
          artifact_id: `observation_${input.freshObservation.snapshot_id}`,
        }
      : null,
    fresh_capture_ref: input.freshObservation?.scope.capture_artifact ?? null,
    fresh_recognition_ref: input.freshRecognitionRef,
    fresh_recognition_id: input.freshRecognition?.recognition_id,
    fresh_filtered_count: input.freshRecognition?.filtered.length,
    fresh_all_count: input.freshRecognition?.all.length,
    fresh_selected_item: input.selected ? selectedItemDetail(input.selected) : null,
    fresh_box: input.selected?.box ?? null,
    fresh_safety_result: input.freshSafetyResult,
    pixel_distance: input.pixelDistance,
    max_pixel_distance: input.maxPixelDistance,
    known_limits: input.knownLimits,
  }
}

function selectedItemDetail(item: RecognizedItem): Record<string, unknown> {
  return {
    item_id: item.item_id,
    kind: item.kind,
    text: item.text,
    box: item.box,
    provider_score: item.provider_score,
    detail: item.detail,
  }
}

function serializeRecognitionTarget(target: ChromeRecognitionTarget | null): Record<string, unknown> | null {
  if (!target)
    return null
  if (target.kind === 'text_input') {
    return {
      kind: target.kind,
      name: serializeTextMatcher(target.name),
    }
  }
  return {
    kind: target.kind,
    text: serializeTextMatcher(target.text),
  }
}

function serializeTextMatcher(value: string | RegExp): Record<string, unknown> {
  if (value instanceof RegExp) {
    return {
      kind: 'regexp',
      source: value.source,
      flags: value.flags,
    }
  }
  return {
    kind: 'text',
    value,
  }
}

function hasTrustworthyCurrentProjection(item: RecognizedItem): boolean {
  if (!validRecognitionBox(item.box))
    return false
  if (item.kind === 'ocr_text')
    return hasCaptureProjectedBounds(item.detail.bounds, item.box)
  if (item.kind === 'ocr_row')
    return hasCaptureProjectedBounds(item.detail.row_bounds, item.box)
  return hasProjectedLogicalBounds(item.detail.bounds, item.box)
    || hasProjectedLogicalBounds(item.detail.row_bounds, item.box)
    || hasCaptureProjectedBounds(item.detail.bounds, item.box)
    || hasCaptureProjectedBounds(item.detail.row_bounds, item.box)
}

function detailWithCurrentCaptureProjection(
  detail: Record<string, unknown>,
  box: RecognizedItem['box'],
  contract: ChromeWindowCapture['contract'],
): Record<string, unknown> {
  const bounds = isObjectLikeRecord(detail.bounds) ? detail.bounds : undefined
  if (!bounds || isObjectLikeRecord(bounds.capture_pixel) || !validRecognitionBox(bounds.source_global_logical))
    return detail
  return {
    ...detail,
    bounds: {
      ...bounds,
      capture_pixel: projectLogicalToPixel(box, contract),
    },
  }
}

function hasCaptureProjectedBounds(value: unknown, expectedBox: RecognizedItem['box']): boolean {
  return isObjectLikeRecord(value)
    && validRecognitionBox(value.capture_pixel)
    && validRecognitionBox(value.source_global_logical)
    && boxesMatch(value.source_global_logical, expectedBox)
}

function hasProjectedLogicalBounds(value: unknown, expectedBox: RecognizedItem['box']): boolean {
  return isObjectLikeRecord(value)
    && validRecognitionBox(value.source_global_logical)
    && boxesMatch(value.source_global_logical, expectedBox)
}

function validRecognitionBox(value: unknown): value is RecognizedItem['box'] {
  return isObjectLikeRecord(value)
    && typeof value.x === 'number'
    && typeof value.y === 'number'
    && typeof value.width === 'number'
    && typeof value.height === 'number'
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0
}

function boxesMatch(a: RecognizedItem['box'], b: RecognizedItem['box']): boolean {
  const tolerance = 0.5
  return Math.abs(a.x - b.x) <= tolerance
    && Math.abs(a.y - b.y) <= tolerance
    && Math.abs(a.width - b.width) <= tolerance
    && Math.abs(a.height - b.height) <= tolerance
}

function projectLogicalToPixel(
  logicalBounds: RecognizedItem['box'],
  contract: ChromeWindowCapture['contract'],
): RecognizedItem['box'] {
  return {
    x: (logicalBounds.x - contract.sourceGlobalLogicalBounds.x) * contract.logicalToPixelScale.x,
    y: (logicalBounds.y - contract.sourceGlobalLogicalBounds.y) * contract.logicalToPixelScale.y,
    width: logicalBounds.width * contract.logicalToPixelScale.x,
    height: logicalBounds.height * contract.logicalToPixelScale.y,
  }
}

function findChromeWindow(observation: WindowObservation): WindowDescriptor | undefined {
  return observation.windows.find(window =>
    isChromeApp(window.appName)
    && window.isOnScreen
    && window.bounds.width >= NORMAL_CHROME_MIN_WIDTH
    && window.bounds.height >= NORMAL_CHROME_MIN_HEIGHT
    && window.layer === 0,
  ) ?? observation.windows.find(window =>
    isChromeApp(window.appName)
    && window.isOnScreen
    && window.bounds.width >= NORMAL_CHROME_MIN_WIDTH
    && window.bounds.height >= NORMAL_CHROME_MIN_HEIGHT,
  )
}

function findChromePid(observation: WindowObservation): number | undefined {
  return chromeWindowCandidates(observation)[0]?.ownerPid
}

function chromeWindowCandidates(observation: WindowObservation): WindowDescriptor[] {
  const normal = observation.windows.filter(window =>
    isChromeApp(window.appName)
    && window.isOnScreen
    && window.bounds.width >= NORMAL_CHROME_MIN_WIDTH
    && window.bounds.height >= NORMAL_CHROME_MIN_HEIGHT
    && window.layer === 0,
  )
  if (normal.length > 0)
    return normal

  return observation.windows.filter(window =>
    isChromeApp(window.appName)
    && window.isOnScreen
    && window.bounds.width >= NORMAL_CHROME_MIN_WIDTH
    && window.bounds.height >= NORMAL_CHROME_MIN_HEIGHT,
  )
}

function findChromeWindowByProfileAX(
  observation: WindowObservation,
  axSnapshot: AXSnapshot,
  profileName: string,
): WindowDescriptor | undefined {
  const suffix = ` - Google Chrome - ${profileName}`
  const axWindows = collectAXWindows(axSnapshot)
    .filter(node => node.title?.endsWith(suffix))
  const candidates = chromeWindowCandidates(observation)

  for (const axWindow of axWindows) {
    const axTitle = axWindow.title ?? ''
    const windowTitle = axTitle.slice(0, axTitle.length - suffix.length)
    const matching = candidates
      .filter(window => window.title === windowTitle)
      .filter(window => !axWindow.bounds || boundsNear(window.bounds, axWindow.bounds))
    if (matching.length === 1)
      return matching[0]

    const boundsOnly = candidates.filter(window =>
      axWindow.bounds !== undefined && boundsNear(window.bounds, axWindow.bounds),
    )
    if (boundsOnly.length === 1)
      return boundsOnly[0]
  }

  return undefined
}

function collectAXWindows(snapshot: AXSnapshot): AXNode[] {
  const windows: AXNode[] = []
  function walk(node: AXNode): void {
    if (node.role === 'AXWindow')
      windows.push(node)
    for (const child of node.children)
      walk(child)
  }
  walk(snapshot.root)
  return windows
}

function boundsNear(a: Bounds, b: Bounds): boolean {
  return Math.abs(a.x - b.x) <= WINDOW_MATCH_TOLERANCE
    && Math.abs(a.y - b.y) <= WINDOW_MATCH_TOLERANCE
    && Math.abs(a.width - b.width) <= WINDOW_MATCH_TOLERANCE
    && Math.abs(a.height - b.height) <= WINDOW_MATCH_TOLERANCE
}

function findLeasedChromeWindow(observation: WindowObservation, lease: ChromeContextLease): WindowDescriptor | undefined {
  return observation.windows.find(window =>
    window.isOnScreen
    && isChromeApp(window.appName)
    && requireWindowNumber(window) === lease.windowNumber
    && window.ownerPid === lease.ownerPid
    && (!lease.ownerBundleId || window.ownerBundleId === lease.ownerBundleId)
    && window.bounds.width >= NORMAL_CHROME_MIN_WIDTH
    && window.bounds.height >= NORMAL_CHROME_MIN_HEIGHT,
  )
}

function chromeWindowRef(window: WindowDescriptor): ChromeWindowRef {
  return {
    id: window.id,
    windowNumber: requireWindowNumber(window),
    appName: window.appName,
    ownerPid: window.ownerPid,
    ownerBundleId: window.ownerBundleId,
    title: window.title,
    bounds: window.bounds,
    layer: window.layer,
  }
}

function chromeDomTargetFromWindow(window: ChromeWindowRef) {
  return {
    windowNumber: window.windowNumber,
    ownerPid: window.ownerPid,
    ownerBundleId: window.ownerBundleId,
    title: window.title,
    bounds: window.bounds,
  }
}

function profileDirFromPath(profilePath: string): string {
  return profilePath.split('/').filter(Boolean).at(-1) ?? profilePath
}

function resolveManagedChromeProfileIdentity(profileConfig: ProfileConfig): ManagedChromeProfileIdentity {
  const profileDir = profileDirFromPath(profileConfig.profile_path)
  const localStatePath = chromeLocalStatePath()
  const info = readChromeLocalStateProfileInfo(localStatePath, profileDir)
  if (!info?.name?.trim()) {
    throw new Error(
      `Chrome profile "${profileConfig.profile_path}" was not found in Chrome Local State at ${localStatePath}.`,
    )
  }

  const configuredName = profileConfig.profile_name?.trim()
  const actualName = info.name.trim()
  if (configuredName && configuredName !== actualName) {
    throw new Error(
      `Chrome profile config mismatch: "${profileConfig.profile_path}" is "${actualName}" in Chrome Local State, not "${configuredName}".`,
    )
  }

  return {
    profileDir,
    profilePath: profileConfig.profile_path,
    profileName: actualName,
    profileUserName: info.user_name,
    localStatePath,
  }
}

function chromeLocalStatePath(): string {
  return process.env.COMPUTER_USE_CHROME_LOCAL_STATE_PATH?.trim()
    || join(homedir(), 'Library/Application Support/Google/Chrome/Local State')
}

function readChromeLocalStateProfileInfo(
  localStatePath: string,
  profileDir: string,
): { name?: string, user_name?: string } | undefined {
  const raw = readFileSync(localStatePath, 'utf-8')
  const parsed = JSON.parse(raw) as {
    profile?: {
      info_cache?: Record<string, { name?: string, user_name?: string }>
    }
  }
  return parsed.profile?.info_cache?.[profileDir]
}

/**
 * Finds a usable AXWebArea viewport inside the leased Chrome window.
 * Falls back to undefined when no valid AXWebArea intersects the window.
 */
function findChromeViewportBounds(
  axSnapshot: AXSnapshot | undefined,
  windowBounds: Bounds,
): ChromeViewportBoundsCandidate | undefined {
  if (!axSnapshot)
    return undefined

  const exactWindow = collectAXWindows(axSnapshot)
    .find(node => node.bounds && boundsNear(node.bounds, windowBounds))
  if (exactWindow) {
    const candidate = selectLargestValidWebArea(exactWindow, windowBounds)
    if (candidate) {
      return {
        bounds: candidate,
        source: 'ax_web_area',
        basis: ['ax_window_bounds_match', 'ax_web_area_bounds', 'chrome_window_intersection'],
        knownLimits: [],
      }
    }
    return undefined
  }

  return undefined
}

function selectLargestValidWebArea(root: AXNode, windowBounds: Bounds): Bounds | undefined {
  const candidates = collectAXWebAreas(root)
    .map(node => node.bounds ? intersectBounds(node.bounds, windowBounds) : undefined)
    .filter((bounds): bounds is Bounds => isValidScrollRegionBounds(bounds))
    .sort((a, b) => areaOfBounds(b) - areaOfBounds(a))

  return candidates[0]
}

function collectAXWebAreas(root: AXNode): AXNode[] {
  const webAreas: AXNode[] = []
  function walk(node: AXNode): void {
    if (node.role === 'AXWebArea')
      webAreas.push(node)
    for (const child of node.children)
      walk(child)
  }
  walk(root)
  return webAreas
}

function buildChromeScrollRegionLease(input: {
  snapshotId: string
  runId: string
  spanId: string
  capturedAtMillis: number
  window: ChromeWindowRef
  profile: ChromeContextSnapshot['profile']
  observationRef: ArtifactRef
  viewportCandidate?: ChromeViewportBoundsCandidate
}): ChromeScrollRegionLease {
  const source = input.viewportCandidate?.source ?? 'window_content_fallback'
  const regionScreenBounds = input.viewportCandidate?.bounds
    ?? windowContentFallbackBounds(input.window.bounds)
  const basis = input.viewportCandidate?.basis ?? [
    'chrome_window_bounds',
    'browser_chrome_height_estimate',
    'conservative_content_region',
  ]
  const knownLimits = uniqueStrings([
    ...(input.viewportCandidate?.knownLimits ?? []),
    ...(input.viewportCandidate
      ? []
      : ['scroll_region_uses_window_bounds_fallback', 'browser_chrome_height_estimated']),
  ])
  const anchorScreenPoint = scrollRegionAnchorScreenPoint(regionScreenBounds, input.window.bounds, source)

  return {
    apiVersion: 'careerdeepseek.chrome_scroll_region_lease.v1alpha1',
    leaseId: `scroll_region_${input.snapshotId}`,
    observationSnapshotId: input.snapshotId,
    capturedAtMillis: input.capturedAtMillis,
    ttlMillis: SCROLL_REGION_LEASE_TTL_MS,
    observationRef: input.observationRef,
    source,
    basis,
    regionWindowLocal: boundsToWindowLocal(regionScreenBounds, input.window.bounds),
    anchorWindowLocal: pointToWindowLocal(anchorScreenPoint, input.window.bounds),
    windowRef: {
      appBundleId: input.window.ownerBundleId,
      ownerPid: input.window.ownerPid,
      windowNumber: input.window.windowNumber,
      profilePath: input.profile.profile_path,
      profileName: input.profile.profile_name,
    },
    knownLimits,
  }
}

function windowContentFallbackBounds(windowBounds: Bounds): Bounds {
  const topInset = Math.min(
    BROWSER_CHROME_FALLBACK_TOP_INSET,
    Math.max(0, windowBounds.height - MIN_SCROLL_REGION_HEIGHT),
  )
  return {
    x: windowBounds.x,
    y: windowBounds.y + topInset,
    width: windowBounds.width,
    height: windowBounds.height - topInset,
  }
}

function scrollRegionAnchorScreenPoint(
  regionScreenBounds: Bounds,
  windowBounds: Bounds,
  source: ChromeScrollRegionLease['source'],
): { x: number, y: number } {
  const y = source === 'window_content_fallback'
    ? windowBounds.y + windowBounds.height * SCROLL_REGION_ANCHOR_Y_RATIO
    : regionScreenBounds.y + regionScreenBounds.height * SCROLL_REGION_ANCHOR_Y_RATIO
  return {
    x: Math.round(regionScreenBounds.x + regionScreenBounds.width / 2),
    y: Math.round(y),
  }
}

function resolveScrollRegionForAction(
  lease: ChromeScrollRegionLease,
  context: ChromeContextSnapshot,
): ResolvedScrollRegionLease {
  const mismatch = scrollRegionWindowMismatch(lease, context)
  if (mismatch) {
    throw new ActionRefusalError({
      code: 'scroll_region_window_changed',
      message: `Refusing scroll: ${mismatch}. Run observe() again before scrolling.`,
      detail: {
        lease: serializeScrollRegionLease(lease, context.window.bounds),
        current_window: context.window,
      },
      expected: 'current Chrome window matches observe-derived scroll region lease',
      knownLimits: ['action refused before macOS event delivery'],
    })
  }

  const regionScreenBounds = boundsFromWindowLocal(lease.regionWindowLocal, context.window.bounds)
  const anchorScreenPoint = pointFromWindowLocal(lease.anchorWindowLocal, context.window.bounds)
  if (!pointInsideBounds(anchorScreenPoint, context.window.bounds)) {
    throw new ActionRefusalError({
      code: 'scroll_region_outside_window',
      message: 'Refusing scroll: observed scroll anchor is outside the current Chrome window.',
      detail: {
        lease: serializeScrollRegionLease(lease, context.window.bounds),
        current_window: context.window,
      },
      expected: 'observe-derived scroll anchor inside current Chrome window bounds',
      knownLimits: ['action refused before macOS event delivery'],
    })
  }

  return {
    lease,
    region: {
      screenBounds: regionScreenBounds,
      windowLocalBounds: lease.regionWindowLocal,
    },
    anchor: {
      screenPoint: anchorScreenPoint,
      windowLocalPoint: lease.anchorWindowLocal,
    },
  }
}

function scrollRegionWindowMismatch(lease: ChromeScrollRegionLease, context: ChromeContextSnapshot): string | undefined {
  if (lease.windowRef.windowNumber !== undefined && context.window.windowNumber !== lease.windowRef.windowNumber)
    return 'window_number_changed'
  if (context.window.ownerPid !== lease.windowRef.ownerPid)
    return 'owner_pid_changed'
  if (lease.windowRef.appBundleId && context.window.ownerBundleId !== lease.windowRef.appBundleId)
    return 'app_bundle_id_changed'
  if (lease.windowRef.profilePath && context.profile.profile_path !== lease.windowRef.profilePath)
    return 'profile_path_changed'
  if (lease.windowRef.profileName && context.profile.profile_name !== lease.windowRef.profileName)
    return 'profile_name_changed'
  return undefined
}

function serializeScrollRegionLease(
  lease: ChromeScrollRegionLease,
  windowBounds: Bounds,
): Record<string, unknown> {
  return {
    api_version: lease.apiVersion,
    lease_id: lease.leaseId,
    observation_snapshot_id: lease.observationSnapshotId,
    captured_at_millis: lease.capturedAtMillis,
    ttl_millis: lease.ttlMillis,
    source: lease.source,
    basis: lease.basis,
    window_ref: lease.windowRef,
    observation_ref: lease.observationRef,
    region: {
      window_local_bounds: lease.regionWindowLocal,
      screen_bounds: boundsFromWindowLocal(lease.regionWindowLocal, windowBounds),
    },
    anchor: {
      window_local_point: lease.anchorWindowLocal,
      screen_point: pointFromWindowLocal(lease.anchorWindowLocal, windowBounds),
    },
    known_limits: lease.knownLimits,
  }
}

function serializeScrollRegionActionDetail(
  resolved: ResolvedScrollRegionLease,
  delivery: {
    selectedPath: string
    attemptedPaths: string[]
    fallbackReason?: string
  },
): Record<string, unknown> {
  return {
    api_version: resolved.lease.apiVersion,
    lease_id: resolved.lease.leaseId,
    observation_snapshot_id: resolved.lease.observationSnapshotId,
    captured_at_millis: resolved.lease.capturedAtMillis,
    ttl_millis: resolved.lease.ttlMillis,
    source: resolved.lease.source,
    basis: resolved.lease.basis,
    window_ref: resolved.lease.windowRef,
    observation_ref: resolved.lease.observationRef,
    region: {
      window_local_bounds: resolved.region.windowLocalBounds,
      screen_bounds: resolved.region.screenBounds,
    },
    anchor: {
      window_local_point: resolved.anchor.windowLocalPoint,
      screen_point: resolved.anchor.screenPoint,
    },
    known_limits: resolved.lease.knownLimits,
    delivery,
  }
}

function scrollRegionPreconditionFailure(lease: ChromeScrollRegionLease | undefined): SafetyFailure | undefined {
  if (!lease) {
    return {
      code: 'scroll_region_not_observed',
      detail: 'Scroll requires an observe-derived Chrome scroll region lease from the current command sequence.',
      observed: null,
      expected: 'driver.observe() before driver.scroll()',
    }
  }

  const ageMillis = Date.now() - lease.capturedAtMillis
  if (ageMillis > lease.ttlMillis) {
    return {
      code: 'scroll_region_stale',
      detail: 'Observed Chrome scroll region lease is stale. Run observe() again before scrolling.',
      observed: { age_millis: ageMillis, ttl_millis: lease.ttlMillis },
      expected: 'fresh observe-derived Chrome scroll region lease',
    }
  }

  return undefined
}

function boundsToWindowLocal(bounds: Bounds, windowBounds: Bounds): Bounds {
  return {
    x: Math.round(bounds.x - windowBounds.x),
    y: Math.round(bounds.y - windowBounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  }
}

function boundsFromWindowLocal(bounds: Bounds, windowBounds: Bounds): Bounds {
  return {
    x: Math.round(windowBounds.x + bounds.x),
    y: Math.round(windowBounds.y + bounds.y),
    width: bounds.width,
    height: bounds.height,
  }
}

function pointToWindowLocal(point: { x: number, y: number }, windowBounds: Bounds): { x: number, y: number } {
  return {
    x: Math.round(point.x - windowBounds.x),
    y: Math.round(point.y - windowBounds.y),
  }
}

function pointFromWindowLocal(point: { x: number, y: number }, windowBounds: Bounds): { x: number, y: number } {
  return {
    x: Math.round(windowBounds.x + point.x),
    y: Math.round(windowBounds.y + point.y),
  }
}

function intersectBounds(a: Bounds, b: Bounds): Bounds | undefined {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  if (x2 <= x1 || y2 <= y1)
    return undefined
  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  }
}

function isValidScrollRegionBounds(bounds: Bounds | undefined): bounds is Bounds {
  return bounds !== undefined
    && bounds.width >= MIN_SCROLL_REGION_WIDTH
    && bounds.height >= MIN_SCROLL_REGION_HEIGHT
}

function areaOfBounds(bounds: Bounds): number {
  return bounds.width * bounds.height
}

function emptyOcrTextSnapshot(capture: ChromeWindowCapture, error?: unknown): OcrTextSnapshot {
  const knownLimits = error === undefined
    ? []
    : ['raw OCR failed', `raw OCR failed: ${stringifyThrownValue(error)}`]
  return {
    recognizedAt: new Date().toISOString(),
    imagePath: capture.screenshot.path,
    imageWidth: capture.screenshot.width ?? 0,
    imageHeight: capture.screenshot.height ?? 0,
    query: '',
    exact: false,
    caseSensitive: false,
    normalizedQuery: '',
    ocrScaleFactor: 1,
    matches: [],
    rawMatchCount: 0,
    filteredMatchCount: 0,
    knownLimits,
  }
}

function emptyOcrRowSnapshot(
  ocr: OcrTextSnapshot,
  error: unknown,
): OcrRowSnapshot {
  return {
    strategy: 'ocr-text',
    imagePath: ocr.imagePath,
    imageWidth: ocr.imageWidth,
    imageHeight: ocr.imageHeight,
    rawMatchCount: ocr.rawMatchCount,
    filteredMatchCount: ocr.filteredMatchCount,
    rowCount: 0,
    rows: [],
    providerDetail: {
      provider: 'careerdeepseek.macos_chrome_driver.ocr_rows',
      error: error instanceof Error ? error.message : String(error),
    },
    knownLimits: uniqueStrings([
      'ocr row production failed',
      `ocr row production failed: ${stringifyThrownValue(error)}`,
    ]),
  }
}

function ocrRowSummary(ocrRows: OcrRowSnapshot): Record<string, unknown> {
  return {
    strategy: ocrRows.strategy,
    row_count: ocrRows.rowCount,
    raw_match_count: ocrRows.rawMatchCount,
    filtered_match_count: ocrRows.filteredMatchCount,
    known_limits: ocrRows.knownLimits,
  }
}

function surfaceNodeToRecognizedItem(node: SurfaceNode): RecognizedItem {
  return {
    item_id: node.node_ref.node_id,
    kind: node.kind,
    text: node.label,
    box: node.box,
    provider_score: node.provider_score,
    detail: node.detail,
  }
}

function stringifyThrownValue(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function centerOf(bounds: Bounds): { x: number, y: number } {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  }
}

function distanceBetween(a: { x: number, y: number }, b: { x: number, y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function exactTextPattern(text: string): RegExp {
  return new RegExp(`^${escapeRegExp(text)}$`, 'i')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function freshObserveFailureCode(error: unknown): 'fresh_window_mismatch' | 'fresh_observe_failed' {
  const message = stringifyThrownValue(error).toLowerCase()
  if (message.includes('lease is no longer valid')
    || message.includes('window changed')
    || message.includes('leased chrome window')
    || message.includes('chrome context lease is no longer valid')) {
    return 'fresh_window_mismatch'
  }
  return 'fresh_observe_failed'
}

function immutableJsonSnapshot<T>(value: T): T {
  return deepFreeze(JSON.parse(JSON.stringify(value)) as T)
}

function deepFreeze<T>(value: T): T {
  if (!isObjectLikeRecord(value) && !Array.isArray(value))
    return value
  Object.freeze(value)
  for (const child of Object.values(value))
    deepFreeze(child)
  return value
}

function isObjectLikeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function rejectCallerSuppliedScrollCoordinates(options: MacOSChromeScrollOptions): void {
  const rawOptions = options as Record<string, unknown>
  if (Object.hasOwn(rawOptions, 'screenPoint')) {
    throw new Error('MacOSChromeDriver.scroll does not accept screenPoint; run observe() first so the driver can derive coordinates from the observed Chrome scroll region.')
  }
  if (Object.hasOwn(rawOptions, 'windowLocalPoint')) {
    throw new Error('MacOSChromeDriver.scroll does not accept windowLocalPoint; run observe() first so the driver can derive coordinates from the observed Chrome scroll region.')
  }
}

function rejectLegacyScrollCandidateInput(deltaY: unknown): void {
  if (isObjectLikeRecord(deltaY)
    && typeof deltaY.candidate_local_id === 'string'
    && isObjectLikeRecord(deltaY.target_spec)) {
    throw new Error('MacOSChromeDriver.scroll does not accept promoted candidates; run observe() first and call scroll(deltaY, deltaX, options).')
  }
}

function pointInsideBounds(point: { x: number, y: number }, bounds: Bounds): boolean {
  return point.x >= bounds.x
    && point.y >= bounds.y
    && point.x <= bounds.x + bounds.width
    && point.y <= bounds.y + bounds.height
}

function isChromeApp(appName: string | undefined): boolean {
  return typeof appName === 'string' && appName.toLowerCase().includes('chrome')
}

function safetyResultFromFailures(failures: SafetyFailure[]): SafetyCheckResult {
  return {
    passed: failures.length === 0,
    checks: {
      profile_verified: !failures.some(failure => failure.code === 'profile_mismatch'),
      chrome_foreground: !failures.some(failure => failure.code === 'chrome_not_foreground'),
      no_hard_stop_signal: !failures.some(failure => failure.code === 'hard_stop_signal'),
    },
    failures,
  }
}

function mergeSafetyFailures(result: SafetyCheckResult, failures: SafetyFailure[]): SafetyCheckResult {
  const merged = [...failures, ...result.failures]
  return {
    ...result,
    passed: merged.length === 0,
    failures: merged,
  }
}

function appendSafetyFailure(result: SafetyCheckResult, failure: SafetyFailure): SafetyCheckResult {
  return {
    ...result,
    passed: false,
    failures: [...result.failures, failure],
  }
}

function actionRefusalMessage(actionType: ActionType, reasons: string[]): string {
  if (reasons.includes('chrome_context_lease_missing')) {
    return 'Chrome context lease has not been established. Run observe() to bootstrap the managed Chrome context.'
  }
  if (reasons.includes('chrome_context_lease_invalid')) {
    return 'Chrome context lease is no longer valid. Run observe() in a new driver session to bootstrap the managed Chrome context again.'
  }
  return `Safety gate refused ${actionType}: ${reasons.join(', ')}`
}

function sanitizeArtifactId(value: string): string {
  return value.replace(/[^\w.-]/g, '_').slice(0, 120)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
