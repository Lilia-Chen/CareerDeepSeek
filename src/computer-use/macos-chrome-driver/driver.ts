import type { ComputerUseConfig } from '../config.js'
import type { AXNode, Bounds, ChromeDomElement, WindowDescriptor, WindowObservation } from '../types.js'
import type {
  ChromeContextSnapshot,
  ChromeForegroundPolicy,
  ChromeRecognitionEvidence,
  ChromeRecognitionSource,
  ChromeRecognitionTarget,
  ChromeRecognizedItem,
  ChromeWindowRef,
  MacOSChromeCandidateRef,
  MacOSChromeObservationSnapshot,
  MacOSChromeRecognitionResult,
  OcrTextMatch,
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

  constructor(options: MacOSChromeDriverOptions) {
    if (!options.sessionId?.trim()) {
      throw new TypeError('MacOSChromeDriver requires a non-empty sessionId.')
    }
    this.#sessionId = options.sessionId
    this.#config = { ...resolveComputerUseConfig(), ...options.config }
    this.#foregroundPolicy = options.foregroundPolicy ?? 'require_chrome'
  }

  async observe(): Promise<MacOSChromeObservationSnapshot> {
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

  async recognize(target: ChromeRecognitionTarget): Promise<MacOSChromeRecognitionResult> {
    const observation = await this.observe()
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

  async click(candidate: MacOSChromeCandidateRef): Promise<void> {
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
  const viewport = findChromeViewportBounds(observation) ?? observation.chromeContext.window.bounds
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

function findChromeViewportBounds(observation: MacOSChromeObservationSnapshot): Bounds | undefined {
  const root = observation.axSnapshot?.root
  if (!root)
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
  walk(root)
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
