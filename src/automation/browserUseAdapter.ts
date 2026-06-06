/// <reference lib="dom" />

import { createHash } from 'node:crypto'
import type { Page } from 'playwright'
import type { ComputerUseAdapter, SourceType, VisualAction, VisualElement, VisualState } from '../types.js'

const DEFAULT_SOURCE_TYPE: SourceType = 'company_site'
const DEFAULT_MAX_VISIBLE_TEXT_LENGTH = 12000

export interface BrowserUseAdapterOptions {
  page: Page
  sessionId: string
  sourceType?: SourceType
  maxVisibleTextLength?: number
  now?: () => Date
}

interface BrowserDomCandidate {
  id: string
  role: string
  text: string
  href: string | null
  intent: string | null
  box: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface BrowserUseComputerUseAdapter extends ComputerUseAdapter {
  observe: () => Promise<VisualState>
  act: (action: VisualAction) => Promise<{ ok: true, action: VisualAction }>
}

export function createBrowserUseAdapter(options: BrowserUseAdapterOptions): BrowserUseComputerUseAdapter {
  return new BrowserUseAdapter(options)
}

class BrowserUseAdapter implements BrowserUseComputerUseAdapter {
  readonly #page: Page
  readonly #sessionId: string
  readonly #sourceType: SourceType
  readonly #maxVisibleTextLength: number
  readonly #now: () => Date
  #step = 0

  constructor(options: BrowserUseAdapterOptions) {
    if (!options.page) {
      throw new TypeError('BrowserUseAdapter requires a Playwright page.')
    }
    if (typeof options.sessionId !== 'string' || options.sessionId.trim() === '') {
      throw new TypeError('BrowserUseAdapter requires a non-empty sessionId.')
    }

    this.#page = options.page
    this.#sessionId = options.sessionId
    this.#sourceType = options.sourceType ?? DEFAULT_SOURCE_TYPE
    this.#maxVisibleTextLength = options.maxVisibleTextLength ?? DEFAULT_MAX_VISIBLE_TEXT_LENGTH
    this.#now = options.now ?? (() => new Date())
  }

  async observe(): Promise<VisualState> {
    const currentStep = this.#step
    this.#step += 1

    const [screenshot, domObservation] = await Promise.all([
      this.#page.screenshot({ type: 'png' }),
      this.#page.evaluate((maxVisibleTextLength) => {
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const visibleText = renderedText(document.body).slice(0, maxVisibleTextLength)
        const selector = [
          'a[href]',
          'button',
          'input',
          'textarea',
          'select',
          '[role]',
          '[tabindex]:not([tabindex="-1"])',
        ].join(',')

        const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
          .map((element, index) => toCandidate(element, index, viewportWidth, viewportHeight))
          .filter((candidate): candidate is BrowserDomCandidate => candidate !== null)

        return {
          title: document.title || window.location.href,
          url: window.location.href,
          visibleText,
          elements,
          signals: detectStopSignals(visibleText),
          viewport: {
            width: viewportWidth,
            height: viewportHeight,
          },
        }

        function toCandidate(
          element: HTMLElement,
          index: number,
          viewportWidth: number,
          viewportHeight: number,
        ): BrowserDomCandidate | null {
          const style = window.getComputedStyle(element)
          const tagName = element.tagName.toLowerCase()
          if (
            style.display === 'none'
            || style.visibility === 'hidden'
            || style.opacity === '0'
            || style.pointerEvents === 'none'
            || element.hidden
            || element.getAttribute('aria-hidden') === 'true'
            || element.getAttribute('aria-disabled') === 'true'
            || isDisabled(element)
            || (tagName === 'input' && (element as HTMLInputElement).type === 'hidden')
          ) {
            return null
          }

          const rect = firstUsableRect(element)
          if (!rect) {
            return null
          }

          const box = intersectRect(rect, {
            x: 0,
            y: 0,
            width: viewportWidth,
            height: viewportHeight,
          })
          if (!box || box.width < 2 || box.height < 2) {
            return null
          }

          const center = {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
          }
          const topElement = document.elementFromPoint(center.x, center.y)
          if (!topElement || (topElement !== element && !element.contains(topElement))) {
            return null
          }

          const text = candidateText(element, tagName)
          if (!text && tagName !== 'input' && tagName !== 'textarea' && tagName !== 'select') {
            return null
          }

          return {
            id: element.id || `dom-${index}`,
            role: inferRole(element, tagName),
            text,
            href: element instanceof HTMLAnchorElement ? element.href : null,
            intent: inferIntent(element, text),
            box,
          }
        }

        function firstUsableRect(element: HTMLElement) {
          for (const clientRect of Array.from(element.getClientRects())) {
            const rect = {
              x: clientRect.x,
              y: clientRect.y,
              width: clientRect.width,
              height: clientRect.height,
            }
            if (rect.width > 0 && rect.height > 0) {
              return rect
            }
          }
          const rect = element.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) {
            return null
          }
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          }
        }

        function intersectRect(
          rect: { x: number, y: number, width: number, height: number },
          viewport: { x: number, y: number, width: number, height: number },
        ) {
          const x = Math.max(rect.x, viewport.x)
          const y = Math.max(rect.y, viewport.y)
          const right = Math.min(rect.x + rect.width, viewport.x + viewport.width)
          const bottom = Math.min(rect.y + rect.height, viewport.y + viewport.height)
          const width = right - x
          const height = bottom - y
          if (width <= 0 || height <= 0) {
            return null
          }
          return {
            x,
            y,
            width,
            height,
          }
        }

        function isDisabled(element: HTMLElement): boolean {
          return element instanceof HTMLButtonElement
            || element instanceof HTMLInputElement
            || element instanceof HTMLTextAreaElement
            || element instanceof HTMLSelectElement
            ? element.disabled
            : false
        }

        function candidateText(element: HTMLElement, tagName: string): string {
          const labelledBy = element.getAttribute('aria-labelledby')
          const labelledByText = labelledBy
            ?.split(/\s+/)
            .map(id => renderedText(document.getElementById(id)).trim())
            .filter((value): value is string => Boolean(value))
            .join(' ')
          return normalizeText(
            element.getAttribute('aria-label')
            || labelledByText
            || element.getAttribute('title')
            || element.getAttribute('placeholder')
            || ('value' in element && tagName !== 'button' ? String(element.value ?? '') : '')
            || renderedText(element)
            || element.textContent
            || '',
          )
        }

        function inferRole(element: HTMLElement, tagName: string): string {
          const explicitRole = element.getAttribute('role')
          if (explicitRole) {
            return explicitRole
          }

          if (tagName === 'a') {
            return 'link'
          }
          if (tagName === 'button') {
            return 'button'
          }
          if (tagName === 'textarea' || tagName === 'select') {
            return tagName
          }
          if (tagName === 'input') {
            const type = (element as HTMLInputElement).type
            if (type === 'checkbox' || type === 'radio') {
              return type
            }
            return 'textbox'
          }
          return 'element'
        }

        function inferIntent(element: HTMLElement, text: string): string | null {
          const raw = `${text} ${element.id} ${element.getAttribute('name') ?? ''} ${element.getAttribute('href') ?? ''}`.toLowerCase()
          if (raw.includes('captcha') || raw.includes('verify you are human')) {
            return 'solve_captcha'
          }
          if (raw.includes('log in') || raw.includes('login') || raw.includes('sign in')) {
            return 'login'
          }
          if (raw.includes('apply')) {
            return 'auto_apply'
          }
          if (raw.includes('send message') || raw.includes('connect')) {
            return 'send_message'
          }
          return null
        }

        function detectStopSignals(text: string): string[] {
          const lower = text.toLowerCase()
          const signals: string[] = []
          if (
            lower.includes('captcha')
            || lower.includes('verify you are human')
            || text.includes('自动程序')
          ) {
            signals.push('captcha')
          }
          if (lower.includes('sign in') || lower.includes('log in') || lower.includes('login')) {
            signals.push('login_required')
          }
          if (
            lower.includes('too many requests')
            || lower.includes('rate limit')
            || lower.includes('unusual traffic')
            || lower.includes('detected unusual')
            || text.includes('异常流量')
          ) {
            signals.push('rate_limited')
          }
          return signals
        }

        function normalizeText(value: string): string {
          return value.replace(/\s+/g, ' ').trim()
        }

        function renderedText(element: HTMLElement | null): string {
          const value = element ? Reflect.get(element, 'innerText') : ''
          return typeof value === 'string' ? value : element?.textContent ?? ''
        }
      }, this.#maxVisibleTextLength),
    ])

    const screenshotHash = createHash('sha256').update(screenshot).digest('hex').slice(0, 12)
    const viewportSize = this.#page.viewportSize()
    const screenshotWidth = viewportSize?.width ?? domObservation.viewport.width
    const screenshotHeight = viewportSize?.height ?? domObservation.viewport.height

    return {
      sessionId: this.#sessionId,
      step: currentStep,
      url: domObservation.url,
      title: domObservation.title,
      sourceType: this.#sourceType,
      observedAt: this.#now().toISOString(),
      screenshot: {
        id: `${this.#sessionId}-shot-${screenshotHash}`,
        width: screenshotWidth,
        height: screenshotHeight,
      },
      visibleText: domObservation.visibleText,
      elements: domObservation.elements.map(toVisualElement),
      signals: domObservation.signals,
      evidence: [],
      extracted: {},
    }
  }

  async act(action: VisualAction): Promise<{ ok: true, action: VisualAction }> {
    switch (action.type) {
      case 'open_url':
        await this.#page.goto(action.url, { waitUntil: 'domcontentloaded' })
        break
      case 'click':
        assertFinitePoint(action.point)
        await this.#page.mouse.move(action.point.x, action.point.y)
        await this.#page.mouse.click(action.point.x, action.point.y)
        break
      case 'type':
        await this.#page.keyboard.type(action.text)
        break
      case 'press':
        await this.#page.keyboard.press(textProperty(action, 'key'))
        break
      case 'scroll':
        await this.#page.mouse.wheel(numberProperty(action, 'deltaX', 0), numberProperty(action, 'deltaY', 600))
        break
      case 'wait':
        await this.#page.waitForTimeout(numberProperty(action, 'durationMs', 500))
        break
      case 'capture_screenshot':
        await this.#page.screenshot({ type: 'png' })
        break
      case 'stop':
        break
      default:
        assertNever(action)
    }

    return {
      ok: true,
      action,
    }
  }
}

function toVisualElement(candidate: BrowserDomCandidate): VisualElement {
  return {
    ...candidate,
    center: {
      x: candidate.box.x + candidate.box.width / 2,
      y: candidate.box.y + candidate.box.height / 2,
    },
  }
}

function assertFinitePoint(point: unknown): asserts point is { x: number, y: number } {
  if (
    !point
    || typeof point !== 'object'
    || !Number.isFinite((point as { x?: unknown }).x)
    || !Number.isFinite((point as { y?: unknown }).y)
  ) {
    throw new TypeError('Click action requires a finite viewport point.')
  }
}

function textProperty(action: Record<string, unknown>, key: string): string {
  const value = action[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Action property ${key} must be a non-empty string.`)
  }
  return value
}

function numberProperty(action: Record<string, unknown>, key: string, fallback: number): number {
  const value = action[key]
  return Number.isFinite(value) ? value as number : fallback
}

function assertNever(value: never): never {
  throw new Error(`Unsupported browser-use action: ${JSON.stringify(value)}`)
}
