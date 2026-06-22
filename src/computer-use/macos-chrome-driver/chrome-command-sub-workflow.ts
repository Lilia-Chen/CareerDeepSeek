import type { ComputerUseConfig } from '../config.js'
import type { AXSnapshot, Bounds, ChromeDomObservation } from '../types.js'
import { unlink } from 'node:fs/promises'
import type {
  AtomicClickResult,
  AtomicClickTargetKind,
  AtomicCrossSourceAudit,
  BrowserChromeDomainCommandResult,
  AtomicFindResult,
  AtomicMatch,
  AtomicKeyResult,
  AtomicScrollRegionResult,
  AtomicTargetCandidate,
  AtomicTargetHint,
  AtomicTypeTextResult,
  AtomicWaitForTextResult,
} from './atomic-types.js'
import type {
  ArtifactRef,
  ChromeContextSnapshot,
  ChromeWindowCapture,
  ObservationSnapshot,
  OcrTextSnapshot,
  SurfaceNode,
} from './types.js'
import { captureAXTree } from '../ax-tree.js'
import { captureChromeDom } from '../chrome-dom.js'
import {
  executeMoveAndClick,
  executePressKeys,
  executeScroll,
  executeTypeText,
} from '../macos-actions.js'
import { captureChromeWindow } from './capture.js'
import { runChromeAppleEventsTabCommand } from './chrome-apple-events.js'
import { recognizeTextInImage } from './ocr.js'
import { auditSurfaceNodes, centerOf, normalizeBoxToWindow, projectPixelBoxToLogicalMatch, relatedNodesForBox } from './atomic-recognition.js'
import { safeErrorMessage, uniqueStrings } from './shared.js'
import { inferObservationSource, normalizeToSurfaceNodes } from './surface-node.js'
import type { ChromeWindowRegionMap } from './chrome-window-regions.js'
import { buildChromeWindowRegionMap, requirePageViewport, viewportOcrRegionRatio } from './chrome-window-regions.js'
import { buildChromeScrollBoundary, compareChromeScrollBoundaries } from './scroll-boundary.js'
import type { ChromeScrollBoundary } from './scroll-boundary.js'

interface AtomicTraceSink {
  startSpan?: (spanId: string, parentSpanId: string | undefined, name: string) => unknown
  endSpan?: (spanId: string, statusCode: 'ok' | 'error', summary?: string) => void
  recordArtifact?: (artifact: {
    artifact_id: string
    span_id: string
    role: string
    mime_type: string
    path: string
    attributes: Record<string, unknown>
    summary?: string
  }) => void
  writeJsonArtifact?: (input: {
    artifact_id: string
    span_id: string
    role: string
    payload: unknown
    attributes?: Record<string, unknown>
    summary?: string
  }) => { artifact_id: string, span_id: string }
}

export interface LiveMacOSChromeAtomicCommandInput {
  config: ComputerUseConfig
  sessionId: string
  runId: string
  parentSpanId?: string
  traceSink?: AtomicTraceSink
  resolveChromeContext: () => Promise<ChromeContextSnapshot>
  getLastCursorPosition?: () => { x: number, y: number } | undefined
  setLastCursorPosition?: (position: { x: number, y: number }) => void
  nextAtomicId?: () => number
}

export interface MacOSChromeAtomicCommands {
  findText: (input: { query: string }) => Promise<AtomicFindResult>
  waitForText: (input: { query: string, timeoutMs?: number, pollIntervalMs?: number }) => Promise<AtomicWaitForTextResult>
  clickTarget: (input: { query: string, kind: AtomicClickTargetKind, hint?: AtomicTargetHint }) => Promise<AtomicClickResult>
  typeInput: (input: { query: string, text: string, submitKey?: string, hint?: AtomicTargetHint }) => Promise<AtomicTypeTextResult>
  key: (input: { key: string, modifiers?: string[] }) => Promise<AtomicKeyResult>
  scrollRegion: (input: {
    direction?: string
    amount?: number
    region?: { left: number, top: number, right: number, bottom: number }
  }) => Promise<AtomicScrollRegionResult>
  back: () => Promise<BrowserChromeDomainCommandResult>
  forward: () => Promise<BrowserChromeDomainCommandResult>
  reload: () => Promise<BrowserChromeDomainCommandResult>
  addressBarSubmit: (input: { text: string }) => Promise<BrowserChromeDomainCommandResult>
}

interface CapturedWindowAtomicContext {
  context: ChromeContextSnapshot
  capture: ChromeWindowCapture
  spanId: string
  evidence: ArtifactRef[]
}

interface AtomicOcrContext extends CapturedWindowAtomicContext {
  ocr: OcrTextSnapshot
  matches: AtomicMatch[]
  nodes?: SurfaceNode[]
  audit?: AtomicCrossSourceAudit
  axSnapshot?: AXSnapshot
  regionMap?: ChromeWindowRegionMap
  domObservation?: ChromeDomObservation | null
  scrollBoundary?: ChromeScrollBoundary
  knownLimits: string[]
}

export interface MacOSChromeOperationCall {
  commandId: string
  operation: string
  inputs: Record<string, unknown>
}

export type MacOSChromeOperationResponse
  = | AtomicFindResult
    | AtomicWaitForTextResult
    | AtomicClickResult
    | AtomicTypeTextResult
    | AtomicKeyResult
    | AtomicScrollRegionResult
    | BrowserChromeDomainCommandResult

const INPUT_NODE_KINDS = new Set(['ax_textfield', 'ax_textarea', 'ax_combobox', 'dom_textbox', 'dom_searchbox', 'dom_combobox'])
const STATIC_TEXT_NODE_KINDS = new Set(['ocr_text', 'ocr_row', 'ax_static_text', 'dom_text', 'dom_heading', 'dom_listitem'])
const INTERACTIVE_AX_KINDS = new Set([
  'ax_button',
  'ax_link',
  'ax_menu_item',
  'ax_menubutton',
  'ax_checkbox',
  'ax_radiobutton',
  'ax_popupbutton',
])
const ACTIONABLE_DOM_KINDS = new Set(['dom_button', 'dom_link', 'dom_menuitem'])
const CLICK_TARGET_KINDS = new Set<AtomicClickTargetKind>(['text', 'button', 'link', 'menuitem', 'any'])

export class LiveMacOSChromeAtomicCommands implements MacOSChromeAtomicCommands {
  readonly #config: ComputerUseConfig
  readonly #sessionId: string
  readonly #runId: string
  readonly #parentSpanId: string | undefined
  readonly #traceSink: AtomicTraceSink | undefined
  readonly #resolveChromeContext: () => Promise<ChromeContextSnapshot>
  readonly #getLastCursorPosition: (() => { x: number, y: number } | undefined) | undefined
  readonly #setLastCursorPosition: ((position: { x: number, y: number }) => void) | undefined
  readonly #nextExternalAtomicId: (() => number) | undefined
  #nextAtomicId = 1

  constructor(input: LiveMacOSChromeAtomicCommandInput) {
    this.#config = input.config
    this.#sessionId = input.sessionId
    this.#runId = input.runId
    this.#parentSpanId = input.parentSpanId
    this.#traceSink = input.traceSink
    this.#resolveChromeContext = input.resolveChromeContext
    this.#getLastCursorPosition = input.getLastCursorPosition
    this.#setLastCursorPosition = input.setLastCursorPosition
    this.#nextExternalAtomicId = input.nextAtomicId
  }

  async findText(input: { query: string }): Promise<AtomicFindResult> {
    const ocr = await this.#captureAndRecognizeText(input.query, 'find-text', { enrich: true, pageViewportOnly: true })
    const nodes = pageViewportNodes(ocr.nodes ?? [])
    const matches = surfaceNodeMatches(input.query, nodes, ocr.audit, pageViewportBounds(ocr))
    return {
      found: matches.length > 0,
      recognitionId: this.#recognitionId('text'),
      matchCount: matches.length,
      best: matches[0],
      matches,
      nodes,
      audit: ocr.audit,
      scrollBoundary: ocr.scrollBoundary,
      evidence: ocr.evidence,
      knownLimits: uniqueStrings([
        ...ocr.knownLimits,
        ...(matches.length === 0 ? textMissKnownLimits(ocr.scrollBoundary) : []),
      ]),
    }
  }

  async waitForText(input: {
    query: string
    timeoutMs?: number
    pollIntervalMs?: number
  }): Promise<AtomicWaitForTextResult> {
    const timeoutMs = input.timeoutMs ?? 3000
    const pollIntervalMs = input.pollIntervalMs ?? 250
    const startedAt = Date.now()
    let pollCount = 0
    let previousScreenshotPath: string | undefined
    const viewport = await this.#resolvePageViewportForCommand()

    while (true) {
      pollCount += 1
      const ocr = await this.#captureAndRecognizeText(input.query, `wait-text-${pollCount}`, {
        enrich: false,
        pageViewportOnly: true,
        regionMap: viewport.regionMap,
        axSnapshot: viewport.axSnapshot,
      })
      const elapsedMs = Date.now() - startedAt
      const timedOut = elapsedMs >= timeoutMs
      if (ocr.matches.length > 0 || timedOut) {
        await removeIfPresent(previousScreenshotPath)
        const enriched = await this.#enrichOcrContext(ocr)
        const nodes = pageViewportNodes(enriched.nodes ?? [])
        return {
          found: enriched.matches.length > 0,
          query: input.query,
          elapsedMs,
          pollCount,
          best: enriched.matches[0],
          matches: enriched.matches.length > 0 ? enriched.matches : [],
          nodes,
          audit: enriched.audit,
          scrollBoundary: enriched.scrollBoundary,
          evidence: enriched.evidence,
          knownLimits: uniqueStrings(['wait_for_text_final_enrichment_only', ...enriched.knownLimits]),
        }
      }

      await removeIfPresent(previousScreenshotPath)
      previousScreenshotPath = ocr.capture.screenshot.path
      await sleep(pollIntervalMs)
    }
  }

  async clickTarget(input: {
    query: string
    kind: AtomicClickTargetKind
    hint?: AtomicTargetHint
  }): Promise<AtomicClickResult> {
    if (!CLICK_TARGET_KINDS.has(input.kind))
      throw Object.assign(new Error(`Unsupported clickTarget kind ${input.kind}.`), { code: 'invalid_kind' })
    const observed = await this.#captureAndRecognizeText(input.query, 'click-target', { enrich: true, pageViewportOnly: true })
    const resolved = resolveWithEvidence(() => resolveClickTarget({
      query: input.query,
      kind: input.kind,
      hint: input.hint,
      nodes: pageViewportNodes(observed.nodes ?? []),
      viewportBounds: pageViewportBounds(observed),
      evidence: observed.evidence,
    }), observed.evidence)
    const selected = resolved.selected
    await this.#clickLogicalPoint(selected.match.logicalPoint, observed.evidence)

    const actionRef = this.#recordJsonArtifact(observed.spanId, `action_click_target_${observed.spanId}`, 'action-result', {
      query: input.query,
      kind: input.kind,
      hint: input.hint ?? null,
      clicked: selected,
    })

    return {
      clicked: { ...selected.match, anchorOffset: { x: 0, y: 0 } },
      candidates: resolved.candidates,
      evidence: compactArtifactRefs([...observed.evidence, actionRef]),
      knownLimits: uniqueStrings([...observed.knownLimits, ...resolved.knownLimits]),
    }
  }

  async typeInput(input: { query: string, text: string, submitKey?: string, hint?: AtomicTargetHint }): Promise<AtomicTypeTextResult> {
    const observed = await this.#captureAndRecognizeText(input.query, 'type-input', { enrich: true, pageViewportOnly: true })
    const resolved = resolveWithEvidence(() => resolveTypeInputTarget({
      query: input.query,
      hint: input.hint,
      nodes: pageViewportNodes(observed.nodes ?? []),
      viewportBounds: pageViewportBounds(observed),
      evidence: observed.evidence,
    }), observed.evidence)
    await this.#clickLogicalPoint(resolved.selected.match.logicalPoint, observed.evidence)
    await executePressKeys(this.#config, { keys: ['a'], modifiers: ['command'] })
    await executeTypeText(this.#config, { pointerTrace: [], text: input.text })
    if (input.submitKey)
      await executePressKeys(this.#config, { keys: [input.submitKey], modifiers: [] })

    const actionRef = this.#recordJsonArtifact(observed.spanId, `action_type_input_${observed.spanId}`, 'action-result', {
      query: input.query,
      target: resolved.selected,
      input_mode: 'replace',
      text_length: input.text.length,
      submit_key: input.submitKey ?? null,
    })
    return {
      typed: {
        textLength: input.text.length,
        submitKey: input.submitKey ?? null,
        target: resolved.selected.match,
        inputMode: 'replace',
      },
      candidates: resolved.candidates,
      evidence: compactArtifactRefs([...observed.evidence, actionRef]),
      knownLimits: uniqueStrings([...observed.knownLimits, ...resolved.knownLimits]),
    }
  }

  async key(input: { key: string, modifiers?: string[] }): Promise<AtomicKeyResult> {
    await this.#resolveChromeContext()
    const spanId = this.#startSpan('key')
    const modifiers = input.modifiers ?? []
    await executePressKeys(this.#config, { keys: [input.key], modifiers })
    const evidence = compactArtifactRefs([
      this.#recordJsonArtifact(spanId, `action_key_${spanId}`, 'action-result', {
        key: input.key,
        modifiers,
      }),
    ])
    this.#endSpan(spanId, 'ok', 'pressed key')
    return {
      pressed: { key: input.key, modifiers },
      evidence,
      knownLimits: ['key_active_app_only'],
    }
  }

  async scrollRegion(input: {
    direction?: string
    amount?: number
    region?: { left: number, top: number, right: number, bottom: number }
  }): Promise<AtomicScrollRegionResult> {
    const context = await this.#resolveChromeContext()
    const spanId = this.#startSpan('scroll-region')
    const direction = input.direction ?? 'down'
    const amount = input.amount ?? 6
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error('chrome.scrollRegion amount must be greater than 0.')
    const region = input.region ?? { left: 0, top: 0, right: 1, bottom: 1 }
    const viewportContext = await this.#resolvePageViewportForCommand(context)
    const viewport = requirePageViewport(viewportContext.regionMap)
    const beforeDom = await captureChromeDom(this.#config, chromeDomTargetFromWindow(context.window))
    const scrollBoundaryBefore = buildChromeScrollBoundary({
      axSnapshot: viewportContext.axSnapshot,
      domObservation: beforeDom,
      regionMap: viewportContext.regionMap,
    })
    const windowLocalPoint = {
      x: viewport.width * ((region.left + region.right) / 2),
      y: viewport.height * ((region.top + region.bottom) / 2),
    }
    const logicalPoint = {
      x: viewport.x + windowLocalPoint.x,
      y: viewport.y + windowLocalPoint.y,
    }
    const delta = atomicScrollDelta(direction, amount)
    const knownLimits: string[] = ['scroll_region_self_contained', 'foreground_hid_scroll_delivery']
    await executeScroll(this.#config, {
      pointerTrace: [{ ...logicalPoint, delayMs: 0 }],
      deltaX: delta.x,
      deltaY: delta.y,
      settleMs: 250,
    })

    const postObservation = await this.#captureViewportObservation('scroll-region-post', context)
    const scrollBoundaryAfter = postObservation.scrollBoundary
    const scrollProgress = compareChromeScrollBoundaries({
      before: scrollBoundaryBefore,
      after: scrollBoundaryAfter,
      direction: direction === 'up' ? 'up' : 'down',
    })
    const evidence = compactArtifactRefs([
      ...postObservation.snapshot.evidence,
      this.#recordJsonArtifact(spanId, `action_scroll_region_${spanId}`, 'action-result', {
        direction,
        amount,
        region,
        chrome_window_region: 'page_viewport',
        viewport_bounds: viewport,
        logical_point: logicalPoint,
        delta,
        scroll_boundary_before: scrollBoundaryBefore,
        scroll_boundary_after: scrollBoundaryAfter,
        scroll_progress: scrollProgress,
      }),
    ])
    this.#endSpan(spanId, 'ok', 'scrolled region')
    return {
      scrolled: {
        direction,
        amount,
        logicalPoint,
        region,
      },
      scrollBoundaryBefore,
      scrollBoundaryAfter,
      scrollProgress,
      postObservation: postObservation.snapshot,
      evidence,
      knownLimits: uniqueStrings([
        ...knownLimits,
        ...viewportContext.regionMap.knownLimits,
        ...scrollBoundaryBefore.knownLimits,
        ...scrollBoundaryAfter.knownLimits,
        ...scrollProgress.knownLimits,
        ...postObservation.snapshot.known_limits,
      ]),
    }
  }

  async back(): Promise<BrowserChromeDomainCommandResult> {
    return await this.#browserChromeTabCommand('back')
  }

  async forward(): Promise<BrowserChromeDomainCommandResult> {
    return await this.#browserChromeTabCommand('forward')
  }

  async reload(): Promise<BrowserChromeDomainCommandResult> {
    return await this.#browserChromeTabCommand('reload')
  }

  async addressBarSubmit(input: { text: string }): Promise<BrowserChromeDomainCommandResult> {
    const context = await this.#resolveChromeContext()
    const spanId = this.#startSpan('address-bar-submit')
    const before = await runChromeAppleEventsTabCommand({
      config: this.#config,
      targetWindow: context.window,
      command: 'inspect',
    })
    await executePressKeys(this.#config, { keys: ['l'], modifiers: ['command'] })
    await executeTypeText(this.#config, { pointerTrace: [], text: input.text })
    await executePressKeys(this.#config, { keys: ['return'], modifiers: [] })
    const after = await runChromeAppleEventsTabCommand({
      config: this.#config,
      targetWindow: context.window,
      command: 'inspect',
    })
    const actionRef = this.#recordJsonArtifact(spanId, `action_address_bar_submit_${spanId}`, 'action-result', {
      command: 'addressBarSubmit',
      delivery_path: 'foreground_keyboard',
      text_length: input.text.length,
      before_active_tab: before.ok ? before.before : undefined,
      after_active_tab: after.ok ? after.before : undefined,
      apple_events_binding_before: summarizeAppleEvents(before),
      apple_events_binding_after: summarizeAppleEvents(after),
    })
    this.#endSpan(spanId, 'ok', 'submitted omnibox text')
    return {
      command: 'addressBarSubmit',
      delivered: true,
      deliveryPath: 'foreground_keyboard',
      textLength: input.text.length,
      appleEvents: summarizeAppleEvents(after),
      evidence: compactArtifactRefs([actionRef]),
      knownLimits: uniqueStrings([
        'address_bar_submit_uses_foreground_keyboard',
        'omnibox_autocomplete_history_navigation_behavior_not_deterministic',
        ...appleEventsKnownLimits(before),
        ...appleEventsKnownLimits(after),
      ]),
    }
  }

  async #captureWindow(label: string, resolvedContext?: ChromeContextSnapshot): Promise<CapturedWindowAtomicContext> {
    const context = resolvedContext ?? await this.#resolveChromeContext()
    const spanId = this.#startSpan(label)
    const snapshotId = `${spanId}_capture`
    const capture = await captureChromeWindow({
      config: this.#config,
      sessionId: this.#sessionId,
      snapshotId,
      window: context.window,
    })
    const evidence = compactArtifactRefs([
      this.#recordScreenshotArtifact(capture, spanId),
      this.#recordJsonArtifact(spanId, `capture_contract_${snapshotId}`, 'capture-contract', capture.contract, {
        coordinate_contract_version: capture.contract.coordinateContractVersion,
      }),
    ])
    return { context, capture, spanId, evidence }
  }

  async #browserChromeTabCommand(command: 'back' | 'forward' | 'reload'): Promise<BrowserChromeDomainCommandResult> {
    const context = await this.#resolveChromeContext()
    const spanId = this.#startSpan(command)
    const appleEvents = await runChromeAppleEventsTabCommand({
      config: this.#config,
      targetWindow: context.window,
      command,
    })
    let delivered = appleEvents.ok
    let deliveryPath: BrowserChromeDomainCommandResult['deliveryPath'] = 'apple_events'
    let keyboardFallback: BrowserChromeDomainCommandResult['keyboardFallback'] | undefined

    if (!appleEvents.ok) {
      const shortcut = browserChromeShortcut(command)
      await executePressKeys(this.#config, { keys: shortcut.keys, modifiers: shortcut.modifiers })
      delivered = true
      deliveryPath = 'apple_events_then_keyboard_fallback'
      keyboardFallback = {
        attempted: true,
        keys: shortcut.keys,
        modifiers: shortcut.modifiers,
        reason: appleEvents.reason,
      }
    }

    const actionRef = this.#recordJsonArtifact(spanId, `action_browser_chrome_${command}_${spanId}`, 'action-result', {
      command,
      delivered,
      delivery_path: deliveryPath,
      apple_events: summarizeAppleEvents(appleEvents),
      keyboard_fallback: keyboardFallback,
    })
    this.#endSpan(spanId, 'ok', `${command} delivered`)
    return {
      command,
      delivered,
      deliveryPath,
      appleEvents: summarizeAppleEvents(appleEvents),
      keyboardFallback,
      evidence: compactArtifactRefs([actionRef]),
      knownLimits: uniqueStrings([
        'browser_chrome_command_requires_same_invocation_profile_window_tab_preflight',
        ...(!appleEvents.ok ? ['apple_events_binding_unavailable_keyboard_fallback_used'] : []),
        ...appleEventsKnownLimits(appleEvents),
      ]),
    }
  }

  async #captureViewportObservation(
    label: string,
    resolvedContext?: ChromeContextSnapshot,
  ): Promise<{
    snapshot: ObservationSnapshot
    scrollBoundary: ChromeScrollBoundary
    axSnapshot?: AXSnapshot
    regionMap: ChromeWindowRegionMap
    domObservation?: ChromeDomObservation | null
  }> {
    const captured = await this.#captureWindow(label, resolvedContext)
    const [axResult, domResult, ocrResult] = await Promise.allSettled([
      captureAXTree(this.#config, {
        pid: captured.context.window.ownerPid,
        maxDepth: 15,
        maxNodes: 3000,
      }),
      captureChromeDom(this.#config, chromeDomTargetFromWindow(captured.context.window)),
      recognizeTextInImage(this.#config, {
        imagePath: captured.capture.screenshot.path,
        maxObservations: 256,
      }),
    ])
    const axSnapshot = axResult.status === 'fulfilled' ? axResult.value : undefined
    const domObservation = domResult.status === 'fulfilled' ? domResult.value : null
    const ocr = ocrResult.status === 'fulfilled' && ocrResult.value
      ? ocrResult.value
      : emptyOcrTextSnapshot(captured.capture.screenshot.path, ocrResult.status === 'rejected' ? safeErrorMessage(ocrResult.reason) : 'ocr_unavailable')
    const regionMap = buildChromeWindowRegionMap({
      windowBounds: captured.context.window.bounds,
      axRoot: axSnapshot?.root,
    })
    const axRef = axSnapshot
      ? this.#recordJsonArtifact(captured.spanId, `ax_tree_${captured.spanId}`, 'ax-tree', axSnapshot)
      : undefined
    const domRef = domObservation
      ? this.#recordJsonArtifact(captured.spanId, `chrome_dom_${captured.spanId}`, 'chrome-dom', domObservation)
      : undefined
    const scrollBoundary = buildChromeScrollBoundary({
      axSnapshot,
      domObservation,
      regionMap,
      sourceArtifacts: compactArtifactRefs([...captured.evidence, axRef, domRef]),
    })
    const boundaryRef = this.#recordJsonArtifact(
      captured.spanId,
      `scroll_boundary_${captured.spanId}`,
      'scroll-boundary',
      scrollBoundary,
    )
    const evidence = compactArtifactRefs([...captured.evidence, axRef, domRef, boundaryRef])
    const nodes = normalizeToSurfaceNodes({
      ocrMatches: ocr.matches,
      axSnapshot,
      domObservation: domObservation ?? undefined,
      contract: captured.capture.contract,
      runId: this.#runId,
      spanId: captured.spanId,
      viewportBounds: regionMap.pageViewport?.bounds,
      regionMap,
      captureArtifact: evidence.find(ref => ref.artifact_id.startsWith('screenshot_')),
      captureContractArtifact: evidence.find(ref => ref.artifact_id.startsWith('capture_contract_')),
    })
    const viewportNodes = pageViewportNodes(nodes)
    const snapshot: ObservationSnapshot = {
      api_version: 'careerdeepseek.observation_snapshot.v1alpha1',
      snapshot_id: captured.capture.snapshotId,
      run_id: this.#runId,
      span_id: captured.spanId,
      captured_at_millis: Date.now(),
      source: inferObservationSource(viewportNodes),
      scope: {
        surface: 'window',
        window_number: captured.context.window.windowNumber,
        app_bundle_id: captured.context.window.ownerBundleId,
        window_title: captured.context.window.title ?? undefined,
        capture_artifact: evidence.find(ref => ref.artifact_id.startsWith('screenshot_')),
      },
      capture_contract_ref: evidence.find(ref => ref.artifact_id.startsWith('capture_contract_')),
      evidence,
      nodes: viewportNodes,
      detail: {
        chrome_context: {
          active_tab_url: captured.context.activeTabUrl,
          active_tab_title: captured.context.activeTabTitle,
          lease: captured.context.lease,
        },
        chrome_window_regions: regionMap,
        observation_scope: 'viewport',
        scroll_boundary: scrollBoundary,
        ocr_match_count: ocr.matches.length,
        ocr_known_limits: ocr.knownLimits ?? [],
        dom_viewport_metrics: domObservation?.viewport,
      },
      known_limits: uniqueStrings([
        ...regionMap.knownLimits,
        ...scrollBoundary.knownLimits,
        ...(ocr.knownLimits ?? []),
        ...(domObservation?.knownLimits ?? []),
        ...(axResult.status === 'rejected' ? ['ax_tree_capture_unavailable_for_post_scroll_observation'] : []),
        ...(domResult.status === 'rejected' || domObservation === null ? ['chrome_dom_capture_unavailable_for_post_scroll_observation'] : []),
      ]),
    }
    this.#endSpan(captured.spanId, 'ok', `captured ${viewportNodes.length} post-scroll viewport node(s)`)
    return { snapshot, scrollBoundary, axSnapshot, regionMap, domObservation }
  }

  async #captureAndRecognizeText(
    query: string,
    label: string,
    options: { enrich: boolean, pageViewportOnly?: boolean, regionMap?: ChromeWindowRegionMap, axSnapshot?: AXSnapshot },
  ): Promise<AtomicOcrContext> {
    const captured = await this.#captureWindow(label)
    let axSnapshot = options.axSnapshot
    let regionMap = options.regionMap
    const knownLimits: string[] = []
    if (options.pageViewportOnly) {
      if (!axSnapshot) {
        axSnapshot = await captureAXTree(this.#config, {
          pid: captured.context.window.ownerPid,
          maxDepth: 15,
          maxNodes: 3000,
        })
      }
      regionMap = regionMap ?? buildChromeWindowRegionMap({
        windowBounds: captured.context.window.bounds,
        axRoot: axSnapshot.root,
      })
      requirePageViewport(regionMap)
      knownLimits.push(...regionMap.knownLimits)
    }
    const ocr = await recognizeTextInImage(this.#config, {
      imagePath: captured.capture.screenshot.path,
      query,
      ...(options.pageViewportOnly && regionMap?.pageViewport
        ? { region: viewportOcrRegionRatio({
            viewportBounds: regionMap.pageViewport.bounds,
            sourceGlobalLogicalBounds: captured.capture.contract.sourceGlobalLogicalBounds,
          }) }
        : {}),
    })
    const ocrRef = this.#recordJsonArtifact(captured.spanId, `ocr_text_${captured.capture.snapshotId}`, 'ocr-text', ocr)
    const evidence = compactArtifactRefs([...captured.evidence, ocrRef])
    const matches = ocr.matches.map((match, matchIndex) =>
      normalizeMatchForRegion(projectPixelBoxToLogicalMatch({
        kind: 'ocr_text',
        text: match.text,
        confidence: match.confidence,
        matchIndex,
        pixelBox: match.bounds,
        contract: captured.capture.contract,
        detail: { source: 'ocr_text', matchIndex: match.matchIndex },
      }), regionMap))

    this.#endSpan(captured.spanId, 'ok', `recognized ${matches.length} text match(es)`)
    const context: AtomicOcrContext = {
      ...captured,
      ocr,
      matches,
      evidence,
      axSnapshot,
      regionMap,
      knownLimits: uniqueStrings([...(ocr.knownLimits ?? []), ...knownLimits]),
    }
    return options.enrich ? await this.#enrichOcrContext(context) : context
  }

  async #enrichOcrContext(context: AtomicOcrContext): Promise<AtomicOcrContext> {
    const [axResult, domResult] = await Promise.allSettled([
      context.axSnapshot
        ? Promise.resolve(context.axSnapshot)
        : captureAXTree(this.#config, {
            pid: context.context.window.ownerPid,
            maxDepth: 15,
            maxNodes: 3000,
          }),
      captureChromeDom(this.#config, chromeDomTargetFromWindow(context.context.window)),
    ])
    const axSnapshot = axResult.status === 'fulfilled' ? axResult.value : undefined
    const regionMap = context.regionMap ?? buildChromeWindowRegionMap({
      windowBounds: context.context.window.bounds,
      axRoot: axSnapshot?.root,
    })
    const domObservation = domResult.status === 'fulfilled' ? domResult.value : null
    const axRef = axSnapshot
      ? this.#recordJsonArtifact(context.spanId, `ax_tree_${context.spanId}`, 'ax-tree', axSnapshot)
      : undefined
    const domRef = domObservation
      ? this.#recordJsonArtifact(context.spanId, `chrome_dom_${context.spanId}`, 'chrome-dom', domObservation)
      : undefined
    const scrollBoundary = buildChromeScrollBoundary({
      axSnapshot,
      domObservation,
      regionMap,
      sourceArtifacts: compactArtifactRefs([...context.evidence, axRef, domRef]),
    })
    const scrollBoundaryRef = this.#recordJsonArtifact(
      context.spanId,
      `scroll_boundary_${context.spanId}`,
      'scroll-boundary',
      scrollBoundary,
    )
    const nodes = normalizeToSurfaceNodes({
      ocrMatches: context.ocr.matches,
      axSnapshot,
      domObservation: domObservation ?? undefined,
      contract: context.capture.contract,
      runId: this.#runId,
      spanId: context.spanId,
      viewportBounds: regionMap.pageViewport?.bounds,
      regionMap,
      captureArtifact: context.evidence.find(ref => ref.artifact_id.startsWith('screenshot_')),
      captureContractArtifact: context.evidence.find(ref => ref.artifact_id.startsWith('capture_contract_')),
    })
    const audit = auditSurfaceNodes(nodes)
    const matches = context.matches.map(match => ({
      ...match,
      detail: {
        ...match.detail,
        relatedNodes: relatedNodesForBox(nodes, match.box),
        crossSourceAudit: audit,
      },
    }))
    return {
      ...context,
      matches,
      nodes,
      audit,
      axSnapshot,
      regionMap,
      domObservation,
      scrollBoundary,
      evidence: compactArtifactRefs([...context.evidence, axRef, domRef, scrollBoundaryRef]),
      knownLimits: uniqueStrings([
        ...context.knownLimits,
        ...(axResult.status === 'rejected' ? ['ax_tree_capture_unavailable_for_enrichment'] : []),
        ...(domResult.status === 'rejected' || domObservation === null ? ['chrome_dom_capture_unavailable_for_enrichment'] : []),
        ...(domObservation?.knownLimits ?? []),
        ...scrollBoundary.knownLimits,
        ...regionMap.knownLimits,
        ...audit.knownLimits,
      ]),
    }
  }

  async #resolvePageViewportForCommand(context?: ChromeContextSnapshot): Promise<{ axSnapshot: AXSnapshot, regionMap: ChromeWindowRegionMap }> {
    const chromeContext = context ?? await this.#resolveChromeContext()
    const axSnapshot = await captureAXTree(this.#config, {
      pid: chromeContext.window.ownerPid,
      maxDepth: 15,
      maxNodes: 3000,
    })
    const regionMap = buildChromeWindowRegionMap({
      windowBounds: chromeContext.window.bounds,
      axRoot: axSnapshot.root,
    })
    requirePageViewport(regionMap)
    return { axSnapshot, regionMap }
  }

  async #clickLogicalPoint(point: { x: number, y: number }, evidence: ArtifactRef[]): Promise<void> {
    try {
      await executeMoveAndClick(this.#config, {
        pointerTrace: [
          ...(this.#getLastCursorPosition?.()
            ? [{ ...this.#getLastCursorPosition()!, delayMs: 0 }]
            : []),
          { ...point, delayMs: 0 },
        ],
        button: 0,
        clickCount: 1,
      })
    }
    catch (error) {
      throw atomicError(safeErrorMessage(error), atomicErrorCode(error) ?? 'click_delivery_failed', evidence)
    }
    this.#setLastCursorPosition?.(point)
  }

  #startSpan(label: string): string {
    const ordinal = this.#nextExternalAtomicId?.() ?? this.#nextAtomicId++
    const spanId = `atomic_${ordinal}_${sanitizeId(label)}`
    this.#traceSink?.startSpan?.(spanId, this.#parentSpanId, label)
    return spanId
  }

  #endSpan(spanId: string, statusCode: 'ok' | 'error', summary: string): void {
    this.#traceSink?.endSpan?.(spanId, statusCode, summary)
  }

  #recordScreenshotArtifact(capture: ChromeWindowCapture, spanId: string): ArtifactRef | undefined {
    const artifactId = `screenshot_${capture.snapshotId}`
    this.#traceSink?.recordArtifact?.({
      artifact_id: artifactId,
      span_id: spanId,
      role: 'screenshot',
      mime_type: 'image/png',
      path: capture.screenshot.path,
      attributes: {
        width: capture.screenshot.width,
        height: capture.screenshot.height,
      },
    })
    return this.#traceSink ? { run_id: this.#runId, artifact_id: artifactId, span_id: spanId } : undefined
  }

  #recordJsonArtifact(
    spanId: string,
    artifactId: string,
    role: string,
    payload: unknown,
    attributes?: Record<string, unknown>,
  ): ArtifactRef | undefined {
    const artifact = this.#traceSink?.writeJsonArtifact?.({
      artifact_id: artifactId,
      span_id: spanId,
      role,
      payload,
      attributes,
    })
    return artifact ? { run_id: this.#runId, artifact_id: artifact.artifact_id, span_id: artifact.span_id } : undefined
  }

  #recognitionId(kind: string): string {
    return `atomic_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }
}

export async function invokeMacOSChromeOperation(
  context: LiveMacOSChromeAtomicCommandInput,
  call: MacOSChromeOperationCall,
): Promise<MacOSChromeOperationResponse> {
  const commands = new LiveMacOSChromeAtomicCommands(context)
  switch (call.operation) {
    case 'findText':
      return commands.findText({ query: stringInput(call, 'query') })
    case 'waitForText':
      return commands.waitForText({
        query: stringInput(call, 'query'),
        timeoutMs: optionalNumberInput(call, 'timeoutMs'),
        pollIntervalMs: optionalNumberInput(call, 'pollIntervalMs'),
      })
    case 'clickTarget':
      return commands.clickTarget({
        query: stringInput(call, 'query'),
        kind: clickTargetKindInput(call, 'kind'),
        hint: optionalTargetHintInput(call, 'hint'),
      })
    case 'typeInput':
      return commands.typeInput({
        query: stringInput(call, 'query'),
        text: stringInput(call, 'text'),
        submitKey: optionalStringInput(call, 'submitKey'),
        hint: optionalTargetHintInput(call, 'hint'),
      })
    case 'key':
      return commands.key({
        key: stringInput(call, 'key'),
        modifiers: optionalStringArrayInput(call, 'modifiers'),
      })
    case 'scrollRegion':
      return commands.scrollRegion({
        direction: optionalStringInput(call, 'direction'),
        amount: optionalNumberInput(call, 'amount'),
        region: optionalRegionInput(call, 'region'),
      })
    case 'back':
      return commands.back()
    case 'forward':
      return commands.forward()
    case 'reload':
      return commands.reload()
    case 'addressBarSubmit':
      return commands.addressBarSubmit({ text: stringInput(call, 'text') })
    default:
      throw Object.assign(new Error(`Unsupported macOS Chrome operation ${call.operation}.`), { code: 'unsupported_operation' })
  }
}

function browserChromeShortcut(command: 'back' | 'forward' | 'reload'): { keys: string[], modifiers: string[] } {
  switch (command) {
    case 'back':
      return { keys: ['['], modifiers: ['command'] }
    case 'forward':
      return { keys: [']'], modifiers: ['command'] }
    case 'reload':
      return { keys: ['r'], modifiers: ['command'] }
  }
}

function summarizeAppleEvents(result: Awaited<ReturnType<typeof runChromeAppleEventsTabCommand>>): BrowserChromeDomainCommandResult['appleEvents'] {
  return {
    ok: result.ok,
    reason: result.reason,
    candidateCount: result.candidateCount,
    matchingCandidateCount: result.matchingCandidateCount,
    selectedWindow: result.selectedWindow,
    before: result.before,
    after: result.after,
  }
}

function appleEventsKnownLimits(result: Awaited<ReturnType<typeof runChromeAppleEventsTabCommand>>): string[] {
  return result.ok
    ? []
    : [`apple_events_${result.reason ?? 'unavailable'}`]
}

function stringInput(call: MacOSChromeOperationCall, key: string): string {
  const value = call.inputs[key]
  if (typeof value !== 'string')
    throw Object.assign(new Error(`${call.commandId} operation input ${key} must be a string.`), { code: `invalid_${key}` })
  return value
}

function optionalStringInput(call: MacOSChromeOperationCall, key: string): string | undefined {
  const value = call.inputs[key]
  if (value === undefined)
    return undefined
  if (typeof value !== 'string')
    throw Object.assign(new Error(`${call.commandId} operation input ${key} must be a string.`), { code: `invalid_${key}` })
  return value
}

function optionalNumberInput(call: MacOSChromeOperationCall, key: string): number | undefined {
  const value = call.inputs[key]
  if (value === undefined)
    return undefined
  if (typeof value !== 'number')
    throw Object.assign(new Error(`${call.commandId} operation input ${key} must be a number.`), { code: `invalid_${key}` })
  return value
}

function optionalStringArrayInput(call: MacOSChromeOperationCall, key: string): string[] | undefined {
  const value = call.inputs[key]
  if (value === undefined)
    return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
    throw Object.assign(new Error(`${call.commandId} operation input ${key} must be a string array.`), { code: `invalid_${key}` })
  return value
}

function optionalRegionInput(
  call: MacOSChromeOperationCall,
  key: string,
): { left: number, top: number, right: number, bottom: number } | undefined {
  const value = call.inputs[key]
  if (value === undefined)
    return undefined
  if (!isAtomicRegionInput(value))
    throw Object.assign(new Error(`${call.commandId} operation input ${key} must be a region object.`), { code: `invalid_${key}` })
  return value
}

function isAtomicRegionInput(value: unknown): value is { left: number, top: number, right: number, bottom: number } {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && ['left', 'top', 'right', 'bottom'].every((key) => {
      const item = (value as Record<string, unknown>)[key]
      return typeof item === 'number' && Number.isFinite(item)
    })
}

function pointInsideBounds(point: { x: number, y: number }, bounds: { x: number, y: number, width: number, height: number }): boolean {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height
}

function clickTargetKindInput(call: MacOSChromeOperationCall, key: string): AtomicClickTargetKind {
  const value = call.inputs[key]
  if (value === 'text' || value === 'button' || value === 'link' || value === 'menuitem' || value === 'any')
    return value
  throw Object.assign(new Error(`${call.commandId} operation input ${key} must be text, button, link, menuitem, or any.`), { code: `invalid_${key}` })
}

function optionalTargetHintInput(call: MacOSChromeOperationCall, key: string): AtomicTargetHint | undefined {
  const value = call.inputs[key]
  if (value === undefined)
    return undefined
  if (!isAtomicRegionInput(value))
    throw Object.assign(new Error(`${call.commandId} operation input ${key} must be a normalized hint object.`), { code: `invalid_${key}` })
  return value
}

function resolveClickTarget(input: {
  query: string
  kind: AtomicClickTargetKind
  hint?: AtomicTargetHint
  nodes: SurfaceNode[]
  viewportBounds: Bounds
  evidence: ArtifactRef[]
}): { selected: { match: AtomicMatch, candidate: AtomicTargetCandidate }, candidates: AtomicTargetCandidate[], knownLimits: string[] } {
  const candidates = buildTargetCandidates(input.nodes, input.viewportBounds, input.evidence)
    .filter(candidate => candidateLabelMatches(candidate, input.query))
    .filter(candidate => clickKindMatches(candidate, input.kind))
    .filter(candidate => input.hint ? hintCompatible(candidate.normalizedBox, input.hint) : true)
  return selectCandidate(candidates, input.hint, input.hint ? 'stale_target' : 'ambiguous_target', {
    useSourceTierRanking: input.kind === 'any',
  })
}

function resolveTypeInputTarget(input: {
  query: string
  hint?: AtomicTargetHint
  nodes: SurfaceNode[]
  viewportBounds: Bounds
  evidence: ArtifactRef[]
}): { selected: { match: AtomicMatch, candidate: AtomicTargetCandidate }, candidates: AtomicTargetCandidate[], knownLimits: string[] } {
  const candidates = buildTargetCandidates(input.nodes, input.viewportBounds, input.evidence)
    .filter(candidate => candidate.inputCapable)
    .filter(candidate => candidateLabelMatches(candidate, input.query))
    .filter(candidate => input.hint ? hintCompatible(candidate.normalizedBox, input.hint) : true)
  return selectCandidate(candidates, input.hint, input.hint ? 'stale_target' : 'ambiguous_target', {
    useSourceTierRanking: false,
  })
}

function selectCandidate(
  candidates: AtomicTargetCandidate[],
  hint: AtomicTargetHint | undefined,
  emptyCode: 'stale_target' | 'ambiguous_target',
  options: { useSourceTierRanking: boolean },
): { selected: { match: AtomicMatch, candidate: AtomicTargetCandidate }, candidates: AtomicTargetCandidate[], knownLimits: string[] } {
  if (candidates.length === 0)
    throw Object.assign(new Error(hint ? 'No fresh candidate matched the supplied hint.' : 'No matching target candidate found.'), { code: emptyCode, candidates })

  const sorted = sortCandidates(candidates, hint, options.useSourceTierRanking)
  if (!hint) {
    const selectable = options.useSourceTierRanking
      ? sorted.filter(candidate => candidate.sourceTier === sorted[0].sourceTier)
      : sorted
    if (selectable.length !== 1) {
      const message = options.useSourceTierRanking
        ? 'Multiple fresh candidates remain in the highest source tier.'
        : 'Multiple fresh candidates remain.'
      throw Object.assign(new Error(message), { code: 'ambiguous_target', candidates: selectable.slice(0, 8) })
    }
  }

  const candidate = sorted[0]
  return {
    selected: { match: candidateToAtomicMatch(candidate, 0), candidate },
    candidates: sorted.slice(0, 8),
    knownLimits: ['foreground_pointer_delivery_only'],
  }
}

function buildTargetCandidates(nodes: SurfaceNode[], normalizationBounds: Bounds, evidence: ArtifactRef[]): AtomicTargetCandidate[] {
  const filtered = nodes
    .filter(node => node.label && validBounds(node.box))
  const groups: SurfaceNode[][] = []
  for (const node of filtered) {
    const group = groups.find(items => items.some(item => sameVisualTarget(item, node)))
    if (group)
      group.push(node)
    else
      groups.push([node])
  }
  return groups.map((group) => {
    const primary = primaryNodeForGroup(group)
    return {
      kind: primary.kind,
      label: primary.label ?? '',
      box: primary.box,
      normalizedBox: normalizeBox(primary.box, normalizationBounds),
      sourceTier: sourceTierForGroup(group),
      sourceSummary: uniqueStrings(group.map(node => `${sourceGroup(node)}:${node.kind}`)),
      inputCapable: group.some(node => INPUT_NODE_KINDS.has(node.kind)),
      targetable: group.some(node => findTextMatchableNode(node)),
      providerScore: Math.max(...group.map(node => node.provider_score ?? 0)),
      evidenceRefs: evidence,
      detail: {
        grouped_node_refs: group.map(node => node.node_ref),
        grouped_kinds: group.map(node => node.kind),
      },
    }
  })
}

function clickKindMatches(candidate: AtomicTargetCandidate, kind: AtomicClickTargetKind): boolean {
  if (candidate.inputCapable)
    return false
  switch (kind) {
    case 'any':
      return candidate.targetable
    case 'text':
      return candidate.kind === 'ocr_text' || candidate.kind === 'ax_static_text' || candidate.kind === 'dom_text'
    case 'button':
      return candidate.kind === 'ax_button' || candidate.kind === 'dom_button'
    case 'link':
      return candidate.kind === 'ax_link' || candidate.kind === 'dom_link'
    case 'menuitem':
      return candidate.kind === 'ax_menu_item' || candidate.kind === 'dom_menuitem'
  }
}

function sourceTierForGroup(group: SurfaceNode[]): AtomicTargetCandidate['sourceTier'] {
  if (group.some(node => INTERACTIVE_AX_KINDS.has(node.kind)))
    return 'interactive_ax'
  if (group.some(node => ACTIONABLE_DOM_KINDS.has(node.kind)))
    return 'actionable_dom'
  return 'ocr_only'
}

function primaryNodeForGroup(group: SurfaceNode[]): SurfaceNode {
  return [...group].sort((a, b) =>
    nodePrimaryRank(a) - nodePrimaryRank(b)
    || tierRank(sourceTierForGroup([a])) - tierRank(sourceTierForGroup([b]))
    || (b.provider_score ?? 0) - (a.provider_score ?? 0))[0]
}

function nodePrimaryRank(node: SurfaceNode): number {
  if (INPUT_NODE_KINDS.has(node.kind))
    return 0
  if (INTERACTIVE_AX_KINDS.has(node.kind) || ACTIONABLE_DOM_KINDS.has(node.kind))
    return 1
  if (STATIC_TEXT_NODE_KINDS.has(node.kind))
    return 2
  return 3
}

function sortCandidates(candidates: AtomicTargetCandidate[], hint: AtomicTargetHint | undefined, useSourceTierRanking: boolean): AtomicTargetCandidate[] {
  return [...candidates].sort((a, b) =>
    (useSourceTierRanking ? tierRank(a.sourceTier) - tierRank(b.sourceTier) : 0)
    || (hint ? hintDistance(a.normalizedBox, hint) - hintDistance(b.normalizedBox, hint) : 0)
    || (hint ? hintOverlapRatio(b.normalizedBox, hint) - hintOverlapRatio(a.normalizedBox, hint) : 0)
    || b.providerScore - a.providerScore)
}

function tierRank(tier: AtomicTargetCandidate['sourceTier']): number {
  return tier === 'interactive_ax' ? 0 : tier === 'actionable_dom' ? 1 : 2
}

function candidateToAtomicMatch(candidate: AtomicTargetCandidate, matchIndex: number): AtomicMatch {
  return {
    kind: candidate.kind,
    text: candidate.label,
    box: candidate.box,
    normalizedBox: candidate.normalizedBox,
    confidence: candidate.providerScore,
    logicalPoint: centerOf(candidate.box),
    matchIndex,
    detail: candidate.detail,
  }
}

function candidateLabelMatches(candidate: AtomicTargetCandidate, query: string): boolean {
  return candidate.label.toLowerCase().includes(query.toLowerCase())
}

function sameVisualTarget(a: SurfaceNode, b: SurfaceNode): boolean {
  if (!a.label || !b.label || a.label.toLowerCase() !== b.label.toLowerCase())
    return false
  return boundsOverlapRatio(a.box, b.box) >= 0.25 || pointInsideBounds(centerOf(a.box), b.box) || pointInsideBounds(centerOf(b.box), a.box)
}

function surfaceNodeMatches(
  query: string,
  nodes: SurfaceNode[],
  audit: AtomicCrossSourceAudit | undefined,
  windowBounds: Bounds,
): AtomicMatch[] {
  return nodes
    .filter(node => node.label && validBounds(node.box))
    .filter(node => findTextMatchableNode(node))
    .filter(node => node.label!.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x || (b.provider_score ?? 0) - (a.provider_score ?? 0))
    .map((node, matchIndex) => ({
      kind: node.kind,
      text: node.label ?? '',
      box: node.box,
      normalizedBox: normalizeBoxToWindow(node.box, windowBounds),
      confidence: node.provider_score ?? 0,
      logicalPoint: centerOf(node.box),
      matchIndex,
      detail: {
        nodeRef: node.node_ref,
        sourceArtifacts: node.source_artifacts,
        relatedNodes: relatedNodesForBox(nodes, node.box),
        crossSourceAudit: audit,
      },
    }))
}

function findTextMatchableNode(node: SurfaceNode): boolean {
  return STATIC_TEXT_NODE_KINDS.has(node.kind)
    || INPUT_NODE_KINDS.has(node.kind)
    || INTERACTIVE_AX_KINDS.has(node.kind)
    || ACTIONABLE_DOM_KINDS.has(node.kind)
}

function pageViewportNodes(nodes: SurfaceNode[]): SurfaceNode[] {
  return nodes.filter(node => node.region === 'page_viewport')
}

function pageViewportBounds(context: AtomicOcrContext): Bounds {
  if (!context.regionMap)
    throw Object.assign(new Error('Verified page viewport is unavailable for normalized page command coordinates.'), { code: 'page_viewport_unavailable' })
  return requirePageViewport(context.regionMap)
}

function normalizeMatchForRegion(match: AtomicMatch, regionMap: ChromeWindowRegionMap | undefined): AtomicMatch {
  if (!regionMap?.pageViewport)
    return match
  return {
    ...match,
    normalizedBox: normalizeBoxToWindow(match.box, regionMap.pageViewport.bounds),
  }
}

function hintCompatible(box: AtomicTargetHint, hint: AtomicTargetHint): boolean {
  const expanded = expandHint(hint)
  const center = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }
  if (center.x >= expanded.left && center.x <= expanded.right && center.y >= expanded.top && center.y <= expanded.bottom)
    return true
  return hintOverlapRatio(box, expanded) >= 0.1
}

function hintDistance(box: AtomicTargetHint, hint: AtomicTargetHint): number {
  const ax = (box.left + box.right) / 2
  const ay = (box.top + box.bottom) / 2
  const bx = (hint.left + hint.right) / 2
  const by = (hint.top + hint.bottom) / 2
  return Math.hypot(ax - bx, ay - by)
}

function expandHint(hint: AtomicTargetHint): AtomicTargetHint {
  return {
    left: Math.max(0, hint.left - 0.03),
    top: Math.max(0, hint.top - 0.03),
    right: Math.min(1, hint.right + 0.03),
    bottom: Math.min(1, hint.bottom + 0.03),
  }
}

function normalizeBox(box: Bounds, windowBounds: Bounds): AtomicTargetHint {
  return normalizeBoxToWindow(box, windowBounds)
}

function sourceGroup(node: SurfaceNode): string {
  if (node.kind.startsWith('ax_'))
    return 'ax'
  if (node.kind.startsWith('dom_'))
    return 'chrome_dom'
  if (node.kind.startsWith('ocr_'))
    return 'ocr_text'
  return node.recognition_source ?? 'unknown'
}

function boundsOverlapRatio(a: Bounds, b: Bounds): number {
  const intersection = intersectionArea(a, b)
  const smaller = Math.min(a.width * a.height, b.width * b.height)
  return smaller > 0 ? intersection / smaller : 0
}

function hintOverlapRatio(a: AtomicTargetHint, b: AtomicTargetHint): number {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.right, b.right)
  const bottom = Math.min(a.bottom, b.bottom)
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top)
  const smaller = Math.min((a.right - a.left) * (a.bottom - a.top), (b.right - b.left) * (b.bottom - b.top))
  return smaller > 0 ? intersection / smaller : 0
}

function intersectionArea(a: Bounds, b: Bounds): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

function validBounds(bounds: Bounds): boolean {
  return Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width > 0
    && bounds.height > 0
}

function chromeDomTargetFromWindow(window: ChromeContextSnapshot['window']) {
  return {
    windowNumber: window.windowNumber,
    ownerPid: window.ownerPid,
    ownerBundleId: window.ownerBundleId,
    title: window.title,
    bounds: window.bounds,
  }
}

function textMissKnownLimits(scrollBoundary: ChromeScrollBoundary | undefined): string[] {
  return uniqueStrings([
    'text_not_found_in_current_viewport',
    ...(scrollBoundary?.canScrollDown === true || scrollBoundary?.canScrollDown === 'unknown'
      ? ['text_may_be_below_viewport']
      : []),
  ])
}

function emptyOcrTextSnapshot(imagePath: string, reason: string): OcrTextSnapshot {
  return {
    recognizedAt: new Date().toISOString(),
    imagePath,
    imageWidth: 0,
    imageHeight: 0,
    query: '',
    exact: false,
    caseSensitive: false,
    normalizedQuery: '',
    ocrScaleFactor: 1,
    matches: [],
    rawMatchCount: 0,
    filteredMatchCount: 0,
    knownLimits: [reason],
  }
}

export function atomicScrollDelta(direction: string, amount: number): { x: number, y: number } {
  const pixels = amount * 100
  // macOS CGEvent scroll deltas are wheel deltas, not page-content movement vectors.
  switch (direction) {
    case 'up':
      return { x: 0, y: pixels }
    case 'left':
      return { x: pixels, y: 0 }
    case 'right':
      return { x: -pixels, y: 0 }
    case 'down':
    default:
      return { x: 0, y: -pixels }
  }
}

function compactArtifactRefs(refs: Array<ArtifactRef | undefined>): ArtifactRef[] {
  return refs.filter((ref): ref is ArtifactRef => ref !== undefined)
}

function resolveWithEvidence<T>(resolver: () => T, evidence: ArtifactRef[]): T {
  try {
    return resolver()
  }
  catch (error) {
    throw atomicError(safeErrorMessage(error), atomicErrorCode(error) ?? 'target_resolution_failed', evidence)
  }
}

function atomicError(message: string, code: string, evidence: ArtifactRef[]): Error & { code: string, evidence: ArtifactRef[] } {
  return Object.assign(new Error(message), { code, evidence })
}

function atomicErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function removeIfPresent(path: string | undefined): Promise<void> {
  if (!path)
    return
  await unlink(path).catch(() => {})
}

function sanitizeId(value: string): string {
  return value.replace(/[^\w.-]/g, '_').slice(0, 80)
}
