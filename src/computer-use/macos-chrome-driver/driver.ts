import type { ComputerUseConfig } from '../config.js'
import type { AXNode, AXSnapshot, Bounds, ChromeDomElement, WindowDescriptor, WindowObservation } from '../types.js'
import type {
  CandidatePromotion,
  ChromeContextSnapshot,
  ChromeForegroundPolicy,
  ChromeRecognitionEvidence,
  ChromeRecognitionSource,
  ChromeRecognitionTarget,
  ChromeRecognizedItem,
  ChromeWindowCapture,
  ChromeWindowRef,
  MacOSChromeCandidateRef,
  MacOSChromeObservationSnapshot,
  MacOSChromeRecognitionResult,
  ObservationSnapshot,
  OcrTextMatch,
  ProfileConfig,
  PromotedCandidate,
  RecognizedItem,
  RecognitionResult as NewRecognitionResult,
} from './types.js'

import { resolveComputerUseConfig } from '../config.js'
import { captureAXTree } from '../ax-tree.js'
import { captureChromeDom } from '../chrome-dom.js'
import {
  executeMoveAndClick,
  executeOpenApp,
  executePressKeys,
  executeScroll,
  executeTypeText,
} from '../macos-actions.js'
import { observeWindows } from '../window-observation.js'
import { buildPointerTrace } from '../pointer-trace.js'
import { captureChromeWindow } from './capture.js'
import { recognizeTextInImage } from './ocr.js'
import { requireWindowNumber } from './types.js'

// AUV two-path imports
import { normalizeToSurfaceNodes, inferObservationSource } from './surface-node.js'
import { recognizeFromCapture } from './recognition.js'
import { promoteCandidate as doPromoteCandidate } from './candidate-promotion.js'
import { loadProfileConfig, detectHardStopSignals, findAndActivateProfileWindow } from './safety-gate.js'
import { TraceStore } from './trace-store.js'

export interface MacOSChromeDriverOptions {
  sessionId: string
  config?: Partial<ComputerUseConfig>
  foregroundPolicy?: ChromeForegroundPolicy
}

const NORMAL_CHROME_MIN_WIDTH = 480
const NORMAL_CHROME_MIN_HEIGHT = 300

export class MacOSChromeDriver {
  readonly #sessionId: string
  readonly #config: ComputerUseConfig
  readonly #foregroundPolicy: ChromeForegroundPolicy
  #step = 0
  #nextObservationId = 1
  #nextRecognitionId = 1
  #lastCursorPosition?: { x: number, y: number }

  // AUV two-path fields
  #traceStore?: TraceStore
  #profileConfig?: ProfileConfig
  #profileVerified = false
  #runId: string
  #spanId = 'session'
  #lastCapture?: ChromeWindowCapture
  #lastObservation?: ObservationSnapshot

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
  // NEW API — AUV two-path architecture
  // ═══════════════════════════════════════════════════════════════

  get lastCapture(): ChromeWindowCapture | undefined {
    return this.#lastCapture
  }

  async observe(): Promise<ObservationSnapshot> {
    // Lazy profile load + verify on first observe
    if (!this.#profileConfig) {
      try {
        this.#profileConfig = await loadProfileConfig(this.#config.sessionRoot)
        // Find and activate the Chrome window that uses the expected profile
        const result = await findAndActivateProfileWindow(this.#profileConfig.profile_path)
        this.#profileVerified = result.verified
        if (!result.verified) {
          const msg = `Profile "${this.#profileConfig.profile_path}" not found in any Chrome window: ${result.error ?? 'unknown'}`
          this.#traceStore?.recordEvent({
            event_id: `evt_profile_mismatch_${Date.now()}`,
            span_id: this.#spanId,
            name: 'profile_verification_failed',
            timestamp_millis: Date.now(),
            attributes: {
              expected: this.#profileConfig.profile_path,
              error: result.error ?? null,
            },
            message: msg,
            artifact_ids: [],
          })
        } else {
          this.#traceStore?.recordEvent({
            event_id: `evt_profile_verified_${Date.now()}`,
            span_id: this.#spanId,
            name: 'profile_verified',
            timestamp_millis: Date.now(),
            attributes: {
              profile: result.observedPath ?? '',
              window_index: result.windowIndex ?? -1,
            },
            message: `Profile verified and activated: ${result.observedPath} (window ${result.windowIndex})`,
            artifact_ids: [],
          })
          // Wait briefly for Chrome window to come to foreground
          await new Promise(r => setTimeout(r, 500))
        }
      } catch (err) {
        this.#profileVerified = false
        this.#traceStore?.recordEvent({
          event_id: `evt_profile_error_${Date.now()}`,
          span_id: this.#spanId,
          name: 'profile_verification_failed',
          timestamp_millis: Date.now(),
          attributes: { error: (err as Error).message },
          message: (err as Error).message,
          artifact_ids: [],
        })
      }
    }

    this.#step++
    const snapshotId = `mco_${this.#nextObservationId++}`
    const spanId = `observe_${snapshotId}`

    this.#traceStore?.startSpan(spanId, this.#spanId, 'observe')

    const chromeContext = await this.#resolveChromeContext()
    const capture = await captureChromeWindow({
      config: this.#config, sessionId: this.#sessionId, snapshotId, window: chromeContext.window,
    })
    this.#lastCapture = capture

    // Record screenshot artifact
    const screenshotArtifactId = `screenshot_${snapshotId}`
    this.#traceStore?.recordArtifact({
      artifact_id: screenshotArtifactId, span_id: spanId, role: 'screenshot',
      mime_type: 'image/png', path: capture.screenshot.path,
      attributes: { width: capture.screenshot.width, height: capture.screenshot.height },
    })

    // Record capture contract artifact
    const contractArtifactId = `capture_contract_${snapshotId}`
    this.#traceStore?.recordArtifact({
      artifact_id: contractArtifactId, span_id: spanId, role: 'capture_contract',
      mime_type: 'application/json',
      path: `${this.#config.sessionRoot}/traces/${this.#sessionId}/contract_${snapshotId}.json`,
      attributes: { coordinate_contract_version: capture.contract.coordinateContractVersion },
    })

    // Parallel observation: AX, DOM, OCR
    const [axResult, domResult, ocrResult] = await Promise.allSettled([
      captureAXTree(this.#config, {
        pid: chromeContext.window.ownerPid, maxDepth: 15, maxNodes: 3000,
      }),
      captureChromeDom(this.#config),
      recognizeTextInImage(this.#config, {
        imagePath: capture.screenshot.path, maxObservations: 256,
      }),
    ])

    const axSnapshot = axResult.status === 'fulfilled' ? axResult.value : undefined
    const chromeDomObservation
      = domResult.status === 'fulfilled' && domResult.value ? domResult.value : undefined
    const ocr = ocrResult.status === 'fulfilled'
      ? ocrResult.value
      : {
          recognizedAt: new Date().toISOString(),
          imagePath: capture.screenshot.path,
          imageWidth: capture.screenshot.width ?? 0,
          imageHeight: capture.screenshot.height ?? 0,
          matches: [],
        }

    // Compute viewport bounds from AX tree (falls back to window bounds)
    const viewportBounds = findChromeViewportBounds(axSnapshot) ?? chromeContext.window.bounds

    // Normalize ALL sources → SurfaceNode[]
    const nodes = normalizeToSurfaceNodes({
      ocrMatches: ocr.matches,
      axSnapshot,
      domObservation: chromeDomObservation ?? undefined,
      contract: capture.contract,
      runId: this.#runId,
      spanId,
      viewportBounds,
    })

    const source = inferObservationSource(nodes)
    const visibleText = nodes.map(n => n.label ?? '').join('\n')
    const signals = detectHardStopSignals(visibleText)

    // Record observation snapshot artifact
    this.#traceStore?.recordArtifact({
      artifact_id: `observation_${snapshotId}`, span_id: spanId,
      role: 'observation_snapshot', mime_type: 'application/json',
      path: `${this.#config.sessionRoot}/traces/${this.#sessionId}/observation_${snapshotId}.json`,
      attributes: { node_count: nodes.length, source },
    })

    this.#traceStore?.endSpan(spanId, 'ok', `observed ${nodes.length} nodes`)

    const result: ObservationSnapshot = {
      api_version: 'careerdeepseek.observation_snapshot.v1alpha1',
      snapshot_id: snapshotId,
      run_id: this.#runId,
      span_id: spanId,
      captured_at_millis: Date.now(),
      source,
      scope: {
        surface: 'window',
        window_number: chromeContext.window.windowNumber,
        app_bundle_id: chromeContext.window.ownerBundleId,
        window_title: chromeContext.window.title ?? undefined,
        capture_artifact: { run_id: this.#runId, artifact_id: screenshotArtifactId, span_id: spanId },
      },
      capture_contract_ref: { run_id: this.#runId, artifact_id: contractArtifactId, span_id: spanId },
      evidence: [{ run_id: this.#runId, artifact_id: screenshotArtifactId, span_id: spanId }],
      nodes,
      detail: {
        chrome_context: { active_tab_url: chromeContext.activeTabUrl, active_tab_title: chromeContext.activeTabTitle },
        signals,
        ocr_match_count: ocr.matches.length,
      },
      known_limits: [this.#profileVerified ? 'profile loaded' : 'profile config missing, actions blocked'],
    }

    this.#lastObservation = result
    return result
  }

  async recognizeFromCapture(
    capture: ChromeWindowCapture,
    target: ChromeRecognitionTarget,
  ): Promise<NewRecognitionResult> {
    const spanId = `recognize_${this.#nextRecognitionId}`
    this.#traceStore?.startSpan(spanId, this.#spanId, 'recognize')

    // OCR-first
    const ocr = await recognizeTextInImage(this.#config, {
      imagePath: capture.screenshot.path, maxObservations: 256,
    }).catch(() => ({
      recognizedAt: new Date().toISOString(),
      imagePath: capture.screenshot.path,
      imageWidth: capture.screenshot.width ?? 0,
      imageHeight: capture.screenshot.height ?? 0,
      matches: [],
    }))

    // OCR items
    const ocrItems: RecognizedItem[] = ocr.matches.map((match, i) => ({
      item_id: `ocr_${i}`,
      kind: 'ocr_text',
      text: match.text,
      box: {
        x: capture.contract.sourceGlobalLogicalBounds.x + match.bounds.x * capture.contract.pixelToLogicalScale.x,
        y: capture.contract.sourceGlobalLogicalBounds.y + match.bounds.y * capture.contract.pixelToLogicalScale.y,
        width: match.bounds.width * capture.contract.pixelToLogicalScale.x,
        height: match.bounds.height * capture.contract.pixelToLogicalScale.y,
      },
      provider_score: match.confidence,
      detail: { match_index: match.matchIndex, raw_pixel_bounds: match.bounds },
    }))

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
        detail: n.detail,
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
      allItems, target, capture.contract, capture.screenshot.path, this.#runId, spanId,
    )

    this.#nextRecognitionId++
    this.#traceStore?.endSpan(spanId, 'ok')
    return result
  }

  async promoteCandidate(
    recognition: NewRecognitionResult,
    capture: ChromeWindowCapture,
  ): Promise<CandidatePromotion> {
    const chromeContext = await this.#resolveChromeContext()
    const hardStopSignals = detectHardStopSignals(
      recognition.all.map(i => i.text ?? '').join('\n'),
    )

    return doPromoteCandidate(recognition, capture.contract, chromeContext.window, {
      profile_verified: this.#profileVerified,
      chrome_foreground: chromeContext.isFrontmost,
      hard_stop_signals: hardStopSignals,
      ttl_ms: 15_000,
      run_id: this.#runId,
      span_id: this.#spanId,
    })
  }

  async click(candidate: PromotedCandidate): Promise<void> {
    // Safety gate: profile must be verified
    if (!this.#profileVerified) {
      throw new Error('Safety gate: profile not verified, refusing click.')
    }

    const context = await this.#resolveChromeContext()

    // Window number check from candidate's liveness preconditions
    const winNumber = candidate.liveness.preconditions.window_ref.window_number
    if (winNumber !== undefined && context.window.windowNumber !== winNumber) {
      throw new Error('Refusing click: Chrome window changed after candidate promotion.')
    }

    const box = candidate.target_spec.box
    const center = centerOf(box)

    if (!pointInsideBounds(center, context.window.bounds)) {
      throw new Error('Refusing click: candidate point is outside the active Chrome window.')
    }

    const pointerTrace = buildPointerTrace({
      from: this.#lastCursorPosition,
      to: center,
      bounds: this.#config.allowedBounds,
    })
    await executeMoveAndClick(this.#config, {
      pointerTrace,
      button: 0,
      clickCount: 1,
    })
    this.#lastCursorPosition = center
  }

  // ═══════════════════════════════════════════════════════════════
  // LEGACY API — deprecated, kept for backward compatibility
  // ═══════════════════════════════════════════════════════════════

  /** @deprecated Use observe() which returns ObservationSnapshot instead. */
  async observeLegacy(): Promise<MacOSChromeObservationSnapshot> {
    const step = this.#step++
    const snapshotId = `mco_${this.#nextObservationId++}`
    const chromeContext = await this.#resolveChromeContext()
    const capture = await captureChromeWindow({
      config: this.#config,
      sessionId: this.#sessionId,
      snapshotId,
      window: chromeContext.window,
    })

    const [axResult, domResult, ocrResult] = await Promise.allSettled([
      captureAXTree(this.#config, {
        pid: chromeContext.window.ownerPid,
        maxDepth: 15,
        maxNodes: 3000,
      }),
      captureChromeDom(this.#config),
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
      : {
          recognizedAt: new Date().toISOString(),
          imagePath: capture.screenshot.path,
          imageWidth: capture.screenshot.width ?? 0,
          imageHeight: capture.screenshot.height ?? 0,
          matches: [],
        }

    const signals = uniqueStrings([
      ...(chromeDomObservation?.signals ?? []),
      ...deriveRiskSignals(`${chromeDomObservation?.visibleText ?? ''}\n${ocr.matches.map(item => item.text).join('\n')}`),
    ])

    return {
      kind: 'macos_chrome_observation',
      snapshotId,
      sessionId: this.#sessionId,
      step,
      observedAt: new Date().toISOString(),
      chromeContext,
      capture,
      axSnapshot,
      chromeDomObservation,
      ocr,
      visibleText: visibleTextFromSources(chromeDomObservation?.visibleText, ocr.matches),
      signals,
    }
  }

  /** @deprecated Use recognizeFromCapture() with the new two-path flow instead. */
  async recognizeLegacy(target: ChromeRecognitionTarget): Promise<MacOSChromeRecognitionResult> {
    const observation = await this.observeLegacy()
    const all = collectRecognizedItems(observation)
    const filtered = all
      .filter(item => matchesTarget(item, target))
      .sort(compareRecognizedItems)
    const best = filtered[0] ?? null

    return {
      kind: 'macos_chrome_recognition',
      recognitionId: `mcr_${this.#nextRecognitionId++}`,
      target,
      observation,
      found: best !== null,
      best,
      filtered,
      all,
      evidence: recognitionEvidence(observation),
      knownLimits: [
        'Chrome profile identity is not yet machine-verified by this driver.',
        'DOM coordinates are projected through AXWebArea when available and through the Chrome window bounds otherwise.',
      ],
    }
  }

  /** @deprecated Use click(PromotedCandidate) with the new two-path flow instead. */
  async clickLegacy(candidate: MacOSChromeCandidateRef): Promise<void> {
    const context = await this.#resolveChromeContext()
    if (context.window.windowNumber !== candidate.window.windowNumber) {
      throw new Error('Refusing click: Chrome window changed after candidate recognition.')
    }
    if (!pointInsideBounds(candidate.center, context.window.bounds)) {
      throw new Error('Refusing click: candidate point is outside the active Chrome window.')
    }

    const pointerTrace = buildPointerTrace({
      from: this.#lastCursorPosition,
      to: candidate.center,
      bounds: this.#config.allowedBounds,
    })
    await executeMoveAndClick(this.#config, {
      pointerTrace,
      button: 0,
      clickCount: 1,
    })
    this.#lastCursorPosition = candidate.center
  }

  async typeText(text: string): Promise<void> {
    await this.#resolveChromeContext()
    await executeTypeText(this.#config, {
      pointerTrace: [],
      text,
    })
  }

  async pressKey(key: string, modifiers: string[] = []): Promise<void> {
    await this.#resolveChromeContext()
    await executePressKeys(this.#config, { keys: [key], modifiers })
  }

  async scroll(deltaY = 600, deltaX = 0): Promise<void> {
    await this.#resolveChromeContext()
    await executeScroll(this.#config, { deltaX, deltaY })
  }

  async #resolveChromeContext(): Promise<ChromeContextSnapshot> {
    let observation = await observeWindows(this.#config, { limit: 120 })
    let chromeWindow = findChromeWindow(observation)
    if (!isChromeApp(observation.frontmostAppName) || !chromeWindow) {
      if (this.#foregroundPolicy === 'auto_focus_chrome') {
        await executeOpenApp(this.#config, 'Google Chrome')
        await sleep(500)
        observation = await observeWindows(this.#config, { limit: 120 })
        chromeWindow = findChromeWindow(observation)
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

    const window = chromeWindowRef(chromeWindow)
    const tab = await captureChromeDom(this.#config).catch(() => null)
    return {
      running: true,
      isFrontmost: true,
      frontmostAppName: observation.frontmostAppName,
      frontmostAppBundleId: observation.frontmostAppBundleId,
      activeTabUrl: tab?.url ?? null,
      activeTabTitle: tab?.title ?? observation.frontmostWindowTitle ?? null,
      profile: {
        status: 'unverified',
        reason: 'Chrome does not expose active profile identity through the current local driver contract.',
      },
      window,
    }
  }
}

export function promoteChromeCandidate(
  recognition: MacOSChromeRecognitionResult,
): MacOSChromeCandidateRef {
  if (!recognition.found || !recognition.best) {
    throw new Error('Cannot promote Chrome candidate: recognition did not find a target.')
  }
  if (!recognition.best.actionable) {
    throw new Error('Cannot promote Chrome candidate: recognized item is not actionable.')
  }

  const candidateId = `${recognition.recognitionId}:${recognition.best.itemId}`
  return {
    kind: 'macos_chrome_candidate',
    candidateId,
    recognitionId: recognition.recognitionId,
    captureSnapshotId: recognition.observation.capture.snapshotId,
    source: recognition.best.source,
    role: recognition.best.role,
    text: recognition.best.text,
    bounds: recognition.best.bounds,
    center: recognition.best.center,
    href: recognition.best.href,
    window: recognition.observation.chromeContext.window,
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

function collectRecognizedItems(observation: MacOSChromeObservationSnapshot): ChromeRecognizedItem[] {
  return [
    ...domRecognizedItems(observation),
    ...axRecognizedItems(observation),
    ...ocrRecognizedItems(observation),
  ]
}

function domRecognizedItems(observation: MacOSChromeObservationSnapshot): ChromeRecognizedItem[] {
  const dom = observation.chromeDomObservation
  if (!dom)
    return []
  const viewport = findChromeViewportBounds(observation.axSnapshot) ?? observation.chromeContext.window.bounds
  return dom.elements.map((element): ChromeRecognizedItem => {
    const text = element.name || element.text || element.role
    const bounds = offsetBounds(element.bounds, viewport)
    return {
      itemId: `dom:${element.id}`,
      source: 'chrome_dom',
      role: normalizeDomRole(element),
      text,
      bounds,
      center: {
        x: viewport.x + element.center.x,
        y: viewport.y + element.center.y,
      },
      confidence: element.confidence,
      actionable: element.actionable,
      href: element.href,
      detail: { tagName: element.tagName },
    }
  })
}

function axRecognizedItems(observation: MacOSChromeObservationSnapshot): ChromeRecognizedItem[] {
  const ax = observation.axSnapshot
  if (!ax)
    return []
  const items: ChromeRecognizedItem[] = []
  function walk(node: AXNode) {
    if (node.bounds && node.bounds.width > 0 && node.bounds.height > 0) {
      const text = node.title || node.description || node.value || ''
      if (text.trim()) {
        items.push({
          itemId: `ax:${node.uid}`,
          source: 'ax',
          role: node.role,
          text,
          bounds: node.bounds,
          center: centerOf(node.bounds),
          confidence: 0.75,
          actionable: axRoleIsActionable(node.role),
          detail: {
            focused: node.focused,
            enabled: node.enabled,
          },
        })
      }
    }
    for (const child of node.children) {
      walk(child)
    }
  }
  walk(ax.root)
  return items
}

function ocrRecognizedItems(observation: MacOSChromeObservationSnapshot): ChromeRecognizedItem[] {
  const contract = observation.capture.contract
  return observation.ocr.matches.map((match): ChromeRecognizedItem => {
    const bounds = projectOcrBounds(match.bounds, contract.sourceGlobalLogicalBounds, contract.pixelToLogicalScale)
    return {
      itemId: `ocr:${match.matchIndex}`,
      source: 'ocr',
      role: 'text',
      text: match.text,
      bounds,
      center: centerOf(bounds),
      confidence: match.confidence,
      actionable: false,
    }
  })
}

function matchesTarget(item: ChromeRecognizedItem, target: ChromeRecognitionTarget): boolean {
  switch (target.kind) {
    case 'text_input':
      return isTextInputRole(item.role) && textMatches(item.text, target.name)
    case 'button':
      return isButtonRole(item.role) && textMatches(item.text, target.text)
    case 'link':
      return isLinkRole(item.role) && textMatches(item.text, target.text)
    case 'visible_text':
      return textMatches(item.text, target.text)
  }
}

function compareRecognizedItems(a: ChromeRecognizedItem, b: ChromeRecognizedItem): number {
  const sourcePriority: Record<ChromeRecognitionSource, number> = {
    chrome_dom: 0,
    ax: 1,
    ocr: 2,
  }
  const actionableDelta = Number(b.actionable) - Number(a.actionable)
  if (actionableDelta !== 0)
    return actionableDelta
  const sourceDelta = sourcePriority[a.source] - sourcePriority[b.source]
  if (sourceDelta !== 0)
    return sourceDelta
  return b.confidence - a.confidence
}

function recognitionEvidence(observation: MacOSChromeObservationSnapshot): ChromeRecognitionEvidence[] {
  const evidence: ChromeRecognitionEvidence[] = [
    { kind: 'screenshot', ref: observation.capture.screenshot.path },
    { kind: 'ocr', ref: observation.ocr.imagePath },
  ]
  if (observation.chromeDomObservation) {
    evidence.push({ kind: 'chrome_dom', ref: observation.chromeDomObservation.url })
  }
  if (observation.axSnapshot) {
    evidence.push({ kind: 'ax', ref: observation.axSnapshot.snapshotId })
  }
  return evidence
}

/**
 * Finds the AXWebArea viewport bounds from an accessibility snapshot.
 * Falls back to undefined when no AXWebArea is found (caller should use
 * window bounds instead).
 */
function findChromeViewportBounds(axSnapshot?: AXSnapshot): Bounds | undefined {
  if (!axSnapshot)
    return undefined
  let result: Bounds | undefined
  function walk(node: AXNode) {
    if (result)
      return
    if (node.role === 'AXWebArea' && node.bounds && node.bounds.width > 0 && node.bounds.height > 0) {
      result = node.bounds
      return
    }
    for (const child of node.children) {
      walk(child)
    }
  }
  walk(axSnapshot.root)
  return result
}

function normalizeDomRole(element: ChromeDomElement): string {
  if (element.role === 'textbox' && element.tagName === 'input')
    return 'textbox'
  return element.role
}

function isTextInputRole(role: string): boolean {
  const normalized = role.toLowerCase()
  return normalized === 'textbox'
    || normalized === 'searchbox'
    || normalized === 'combobox'
    || normalized === 'axtextfield'
    || normalized === 'axtextarea'
}

function isButtonRole(role: string): boolean {
  const normalized = role.toLowerCase()
  return normalized === 'button' || normalized === 'axbutton'
}

function isLinkRole(role: string): boolean {
  const normalized = role.toLowerCase()
  return normalized === 'link' || normalized === 'axlink'
}

function axRoleIsActionable(role: string): boolean {
  return [
    'AXButton',
    'AXLink',
    'AXTextField',
    'AXTextArea',
    'AXComboBox',
    'AXMenuItem',
    'AXTab',
  ].includes(role)
}

function textMatches(text: string, expected: string | RegExp): boolean {
  if (expected instanceof RegExp)
    return expected.test(text)
  return text.toLowerCase().includes(expected.toLowerCase())
}

function visibleTextFromSources(domText: string | undefined, ocrMatches: OcrTextMatch[]): string {
  return uniqueStrings([
    domText?.trim() ?? '',
    ...ocrMatches.map(match => match.text.trim()),
  ]).join('\n')
}

function deriveRiskSignals(text: string): string[] {
  const signals: string[] = []
  if (/\b(?:captcha|verify you are human|human verification)\b/i.test(text))
    signals.push('captcha')
  if (/\b(?:payment details|billing details|credit card|pay now|checkout)\b/i.test(text))
    signals.push('payment_required')
  if (/\b(?:sign in|log in|login).{0,40}(?:to continue|required)\b/i.test(text))
    signals.push('login_required')
  return signals
}

function offsetBounds(bounds: Bounds, offset: Bounds): Bounds {
  return {
    x: offset.x + bounds.x,
    y: offset.y + bounds.y,
    width: bounds.width,
    height: bounds.height,
  }
}

function projectOcrBounds(bounds: Bounds, globalBounds: Bounds, scale: { x: number, y: number }): Bounds {
  return {
    x: globalBounds.x + bounds.x * scale.x,
    y: globalBounds.y + bounds.y * scale.y,
    width: bounds.width * scale.x,
    height: bounds.height * scale.y,
  }
}

function centerOf(bounds: Bounds): { x: number, y: number } {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
