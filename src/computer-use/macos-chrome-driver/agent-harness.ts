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

import { detectBlockingStopSignal, planOverlayDismissal } from '../overlay-resolver.js'

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
  typeText: (text: string) => Promise<void>
  pressKey: (key: string, modifiers?: string[]) => Promise<void>
  scroll: (
    deltaY?: number,
    deltaX?: number,
    options?: { windowLocalPoint?: { x: number, y: number }, settleMs?: number },
  ) => Promise<void>
}

export interface AgentHarnessActionOptions {
  reason: string
  settleMs?: number
}

export interface AgentHarnessScrollOptions extends AgentHarnessActionOptions {
  amount?: number
  windowLocalPoint?: { x: number, y: number }
}

export interface AgentPageObservation {
  snapshot: ObservationSnapshot
  capture: ChromeWindowCapture
  url: string | null
  title: string | null
  visibleText: string
  visualState: VisualState
}

export interface AgentActionResult {
  action: 'click' | 'type' | 'press' | 'scroll'
  reason: string
  before: ObservationSnapshot
  after: ObservationSnapshot
}

export type OverlayDismissResult
  = | {
    dismissed: true
    kind: 'cookie_consent' | 'marketing_modal'
    reason: string
    before: ObservationSnapshot
    after: ObservationSnapshot
  }
  | {
    dismissed: false
    reason: string
    stopSignal?: string
    before: ObservationSnapshot
  }

const DEFAULT_SCROLL_AMOUNT = 700

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
    return this.#clickObservedTarget({ kind: 'button', text }, options)
  }

  async clickObservedLink(
    text: string | RegExp,
    options: AgentHarnessActionOptions,
  ): Promise<AgentActionResult> {
    return this.#clickObservedTarget({ kind: 'link', text }, options)
  }

  async typeIntoObservedInput(
    name: string | RegExp,
    text: string,
    options: AgentHarnessActionOptions,
  ): Promise<AgentActionResult> {
    const before = await this.observePage()
    const candidate = await this.#promoteOrThrow(
      before,
      { kind: 'text_input', name },
    )

    await this.#driver.click(candidate)
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
    const before = await this.observePage()
    await this.#driver.pressKey('enter')
    const after = await this.observePage()

    return {
      action: 'press',
      reason: options.reason,
      before: before.snapshot,
      after: after.snapshot,
    }
  }

  async scrollDown(options: AgentHarnessScrollOptions): Promise<AgentActionResult> {
    return this.#scrollSemantic('down', options)
  }

  async scrollUp(options: AgentHarnessScrollOptions): Promise<AgentActionResult> {
    return this.#scrollSemantic('up', options)
  }

  async goBack(options: AgentHarnessActionOptions): Promise<AgentActionResult> {
    return this.clickObservedButton(/^Back$/i, options)
  }

  async dismissKnownOverlay(): Promise<OverlayDismissResult> {
    const before = await this.observePage()
    const stopSignal = detectBlockingStopSignal(before.visualState)
    if (stopSignal) {
      return {
        dismissed: false,
        reason: `Hard stop signal detected: ${stopSignal}.`,
        stopSignal,
        before: before.snapshot,
      }
    }

    const decision = planOverlayDismissal(before.visualState)
    if (!decision) {
      return {
        dismissed: false,
        reason: 'No known dismissible overlay was detected.',
        before: before.snapshot,
      }
    }

    const text = decision.action.target.text?.trim()
    if (!text) {
      return {
        dismissed: false,
        reason: 'Overlay dismissal target has no stable text label.',
        before: before.snapshot,
      }
    }

    const target: ChromeRecognitionTarget = /link/i.test(decision.action.target.role)
      ? { kind: 'link', text: exactTextPattern(text) }
      : { kind: 'button', text: exactTextPattern(text) }
    const candidate = await this.#promoteOrThrow(before, target)

    await this.#driver.click(candidate)
    const after = await this.observePage()

    return {
      dismissed: true,
      kind: decision.kind,
      reason: decision.reason,
      before: before.snapshot,
      after: after.snapshot,
    }
  }

  async #clickObservedTarget(
    target: Extract<ChromeRecognitionTarget, { kind: 'button' | 'link' }>,
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

  async #scrollSemantic(
    direction: 'down' | 'up',
    options: AgentHarnessScrollOptions,
  ): Promise<AgentActionResult> {
    const before = await this.observePage()
    const amount = Math.abs(options.amount ?? DEFAULT_SCROLL_AMOUNT)
    const deltaY = direction === 'down' ? -amount : amount

    await this.#driver.scroll(deltaY, 0, {
      settleMs: options.settleMs,
      windowLocalPoint: options.windowLocalPoint,
    })
    const after = await this.observePage()

    return {
      action: 'scroll',
      reason: options.reason,
      before: before.snapshot,
      after: after.snapshot,
    }
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
  if (!isRecord(context))
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

function exactTextPattern(text: string): RegExp {
  return new RegExp(`^${escapeRegExp(text)}$`, 'i')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
