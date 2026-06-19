import type { SourceType, VisualElement, VisualState } from '../../types.js'
import type {
  CandidatePromotion,
  ChromeRecognitionTarget,
  ChromeWindowCapture,
  ObservationSnapshot,
  PromotedCandidate,
  RecognitionResult,
  SurfaceNode,
} from './types.js'

export interface MacOSChromeAgentDriver {
  readonly lastCapture?: ChromeWindowCapture
  observe: () => Promise<ObservationSnapshot>
  recognizeFromCapture: (
    capture: ChromeWindowCapture,
    target: ChromeRecognitionTarget,
  ) => Promise<RecognitionResult>
  promoteCandidate: (
    recognition: RecognitionResult,
    capture: ChromeWindowCapture,
  ) => Promise<CandidatePromotion>
  click: (candidate: PromotedCandidate) => Promise<void>
  focusTextInput: (candidate: PromotedCandidate) => Promise<void>
  typeText: (text: string) => Promise<void>
  pressKey: (key: string, modifiers?: string[]) => Promise<void>
}

export interface AgentHarnessActionOptions {
  reason: string
  settleMs?: number
}

export interface AgentPageObservation {
  snapshot: ObservationSnapshot
  capture: ChromeWindowCapture
  url: string | null
  title: string | null
  visibleText: string
  visualState: VisualState
}

interface AgentNonScrollActionResult {
  action: 'click' | 'type' | 'press'
  reason: string
  before: ObservationSnapshot
  after: ObservationSnapshot
}

export type AgentActionResult = AgentNonScrollActionResult

export class MacOSChromeAgentHarness {
  readonly #driver: MacOSChromeAgentDriver

  constructor(driver: MacOSChromeAgentDriver) {
    this.#driver = driver
  }

  async observePage(): Promise<AgentPageObservation> {
    const snapshot = await this.#driver.observe()
    const capture = this.#driver.lastCapture
    if (!capture) {
      throw new Error('Driver did not expose lastCapture after observe().')
    }

    const url = readChromeContextString(snapshot, 'active_tab_url')
    const title = readChromeContextString(snapshot, 'active_tab_title')
    const visibleText = snapshot.nodes
      .map(node => node.label ?? '')
      .filter(Boolean)
      .join('\n')

    return {
      snapshot,
      capture,
      url,
      title,
      visibleText,
      visualState: toVisualState(snapshot, capture, url, title, visibleText),
    }
  }

  async clickObservedButton(
    text: string | RegExp,
    options: AgentHarnessActionOptions,
  ): Promise<AgentActionResult> {
    return this.#clickObservedTarget({ kind: 'ocr_text', text }, options)
  }

  async clickObservedLink(
    text: string | RegExp,
    options: AgentHarnessActionOptions,
  ): Promise<AgentActionResult> {
    return this.#clickObservedTarget({ kind: 'ocr_text', text }, options)
  }

  async typeIntoObservedInput(
    name: string | RegExp,
    text: string,
    options: AgentHarnessActionOptions,
  ): Promise<AgentActionResult> {
    const before = await this.observePage()
    let candidate: PromotedCandidate
    try {
      candidate = await this.#promoteOrThrow(
        before,
        { kind: 'text_input', name },
      )
    }
    catch (error) {
      throw new Error(`text_input recognition failed before typing: ${stringifyThrownValue(error)}`)
    }

    await this.#driver.focusTextInput(candidate)
    await this.#driver.typeText(text)
    const after = await this.observePage()

    return {
      action: 'type',
      reason: options.reason,
      before: before.snapshot,
      after: after.snapshot,
    }
  }

  async pressEnter(options: AgentHarnessActionOptions): Promise<AgentActionResult> {
    void options
    throw new Error('pressEnter requires explicit focusTextInput provenance in the current command sequence.')
  }

  /**
   * @deprecated P1.5 does not model browser recovery/back/close. Browser
   * recovery requires a P2 transition contract before it can act safely.
   */
  async goBack(_options: AgentHarnessActionOptions): Promise<AgentActionResult> {
    throw new Error('browser recovery/back/close requires P2 transition contract')
  }

  async #clickObservedTarget(
    target: Extract<ChromeRecognitionTarget, { kind: 'ocr_text' | 'ocr_row' }>,
    options: AgentHarnessActionOptions,
  ): Promise<AgentActionResult> {
    const before = await this.observePage()
    const candidate = await this.#promoteOrThrow(before, target)

    await this.#driver.click(candidate)
    const after = await this.observePage()

    return {
      action: 'click',
      reason: options.reason,
      before: before.snapshot,
      after: after.snapshot,
    }
  }

  async #promoteOrThrow(
    page: AgentPageObservation,
    target: ChromeRecognitionTarget,
  ): Promise<PromotedCandidate> {
    const recognition = await this.#driver.recognizeFromCapture(page.capture, target)
    const promotion = await this.#driver.promoteCandidate(recognition, page.capture)

    if (promotion.status === 'refused') {
      throw new Error(`Promotion refused: ${promotion.reasons.join(', ')}`)
    }

    return promotion.candidate
  }
}

function toVisualState(
  snapshot: ObservationSnapshot,
  capture: ChromeWindowCapture,
  url: string | null,
  title: string | null,
  visibleText: string,
): VisualState {
  return {
    sessionId: snapshot.run_id,
    step: snapshot.captured_at_millis,
    url: url ?? 'about:blank',
    title: title ?? snapshot.scope.window_title ?? 'Chrome',
    sourceType: inferSourceType(url),
    observedAt: new Date(snapshot.captured_at_millis).toISOString(),
    screenshot: {
      id: capture.snapshotId,
      width: capture.screenshot.width ?? capture.contract.screenshotPixelSize.width,
      height: capture.screenshot.height ?? capture.contract.screenshotPixelSize.height,
    },
    visibleText,
    elements: snapshot.nodes.map(toVisualElement).filter((element): element is VisualElement => element !== null),
    signals: readSignals(snapshot),
    evidence: [],
    extracted: {},
  }
}

function toVisualElement(node: SurfaceNode): VisualElement | null {
  const text = node.label?.trim()
  if (!text)
    return null
  if (node.box.width <= 0 || node.box.height <= 0)
    return null

  return {
    id: node.node_ref.node_id,
    role: roleFromKind(node.kind),
    text,
    href: typeof node.detail.href === 'string' ? node.detail.href : null,
    intent: typeof node.detail.intent === 'string' ? node.detail.intent : null,
    source: sourceFromKind(node.kind),
    box: node.box,
    center: node.center ?? {
      x: node.box.x + node.box.width / 2,
      y: node.box.y + node.box.height / 2,
    },
  }
}

function roleFromKind(kind: string): string {
  if (kind.startsWith('dom_'))
    return kind.slice(4)
  if (kind.startsWith('ax_'))
    return kind.slice(3)
  return kind
}

function sourceFromKind(kind: string): string {
  if (kind.startsWith('dom_'))
    return 'chrome_dom'
  if (kind.startsWith('ax_'))
    return 'ax'
  if (kind.startsWith('ocr_'))
    return 'ocr'
  return 'unknown'
}

function inferSourceType(url: string | null): SourceType {
  if (!url)
    return 'company_site'

  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (host === 'google.com' || host.endsWith('.google.com'))
      return 'search_engine'
  }
  catch {
    return 'company_site'
  }

  return 'company_site'
}

function readChromeContextString(snapshot: ObservationSnapshot, key: string): string | null {
  const context = snapshot.detail.chrome_context
  if (!isNonArrayRecord(context))
    return null
  const value = context[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readSignals(snapshot: ObservationSnapshot): string[] {
  const signals = snapshot.detail.signals
  return Array.isArray(signals)
    ? signals.filter((signal): signal is string => typeof signal === 'string')
    : []
}

function stringifyThrownValue(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isNonArrayRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
