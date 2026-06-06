/**
 * MacOSComputerUseAdapter — real macOS desktop observation and control.
 *
 * Implements CareerDeepSeek's ComputerUseAdapter interface using:
 *   - screencapture -x → screenshots
 *   - CGWindowList → window enumeration
 *   - AXUIElement → accessibility tree
 *   - AppleScript execute JS → Chrome DOM observation
 *   - CGEvent → mouse, keyboard, scroll actions
 *
 * The adapter runs as a visible user — Chrome sees real mouse movements
 * and keystrokes through the HID event tap. No CDP, no extension, no
 * navigator.webdriver flag.
 */

import type {
  ComputerUseAdapter,
  VisualAction,
  VisualElement,
  VisualScreenshot,
  SourceType,
} from '../types.js'

import type { ComputerUseConfig } from './config.js'
import type { DesktopGroundingSnapshot, DesktopTargetCandidate } from './types.js'

import { resolveComputerUseConfig } from './config.js'
import { captureDesktopGrounding } from './desktop-grounding.js'
import { buildPointerTrace } from './pointer-trace.js'
import {
  executeMoveAndClick,
  executeOpenApp,
  executePressKeys,
  executeScroll,
  executeTypeText,
} from './macos-actions.js'
import { observeWindows } from './window-observation.js'

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

export interface MacOSAdapterOptions {
  /** Session identifier — flows into every VisualState. */
  sessionId: string
  /** Override specific config values. */
  config?: Partial<ComputerUseConfig>
  /** Default source type when Chrome URL cannot be parsed. */
  defaultSourceType?: SourceType
  /**
   * How CGEvent actions handle foreground context.
   *
   * `require_chrome` refuses to send input unless Chrome is already frontmost.
   * `auto_focus_chrome` may use OS-level app activation, then re-checks before input.
   */
  foregroundPolicy?: 'require_chrome' | 'auto_focus_chrome'
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export class MacOSComputerUseAdapter implements ComputerUseAdapter {
  readonly #sessionId: string
  readonly #config: ComputerUseConfig
  readonly #defaultSourceType: SourceType
  readonly #foregroundPolicy: 'require_chrome' | 'auto_focus_chrome'
  #step = 0
  #lastCursorPosition?: { x: number, y: number }

  constructor(options: MacOSAdapterOptions) {
    if (!options.sessionId?.trim()) {
      throw new TypeError('MacOSComputerUseAdapter requires a non-empty sessionId.')
    }
    this.#sessionId = options.sessionId
    this.#config = { ...resolveComputerUseConfig(), ...options.config }
    this.#defaultSourceType = options.defaultSourceType ?? 'company_site'
    this.#foregroundPolicy = options.foregroundPolicy ?? 'require_chrome'
  }

  // -----------------------------------------------------------------------
  // observe() — capture all sources and return a VisualState-compatible shape
  // -----------------------------------------------------------------------

  async observe(): Promise<Record<string, unknown>> {
    const currentStep = this.#step++

    await this.#ensureChromeForeground()
    const grounding = await captureDesktopGrounding(this.#config)

    return this.#visualStateFromGrounding(grounding, currentStep)
  }

  // -----------------------------------------------------------------------
  // act() — execute a single visual action
  // -----------------------------------------------------------------------

  async act(action: VisualAction): Promise<{ ok: true, action: VisualAction }> {
    if (this.#requiresChromeForeground(action)) {
      await this.#ensureChromeForeground()
    }

    switch (action.type) {
      case 'click': {
        if (!action.point) {
          throw new TypeError('Click action requires a viewport point.')
        }
        const clickTrace = buildPointerTrace({
          from: this.#lastCursorPosition,
          to: { x: action.point.x, y: action.point.y },
          bounds: this.#config.allowedBounds,
        })
        if (clickTrace.length > 0) {
          await executeMoveAndClick(this.#config, {
            pointerTrace: clickTrace,
            button: 0,
            clickCount: 1,
          })
          this.#lastCursorPosition = {
            x: clickTrace.at(-1)!.x,
            y: clickTrace.at(-1)!.y,
          }
        }
        break
      }

      case 'type': {
        const typeTrace = this.#lastCursorPosition
          ? buildPointerTrace({
              from: this.#lastCursorPosition,
              to: this.#lastCursorPosition,
              bounds: this.#config.allowedBounds,
              steps: 4,
            })
          : []
        await executeTypeText(this.#config, {
          pointerTrace: typeTrace,
          text: action.text,
        })
        break
      }

      case 'press': {
        await executePressKeys(this.#config, {
          keys: [String(action.key ?? '')],
          modifiers: Array.isArray(action.modifiers) ? action.modifiers as string[] : [],
        })
        break
      }

      case 'scroll': {
        const scrollTrace = this.#lastCursorPosition
          ? buildPointerTrace({
              from: this.#lastCursorPosition,
              to: this.#lastCursorPosition,
              bounds: this.#config.allowedBounds,
              steps: 4,
            })
          : []
        await executeScroll(this.#config, {
          pointerTrace: scrollTrace,
          deltaX: typeof action.deltaX === 'number' ? action.deltaX as number : 0,
          deltaY: typeof action.deltaY === 'number' ? action.deltaY as number : 600,
        })
        break
      }

      case 'wait': {
        const duration = typeof action.durationMs === 'number' ? action.durationMs as number : 500
        await this.#sleep(duration)
        break
      }

      case 'capture_screenshot':
        // Screenshot is already captured on every observe().
        // This is a no-op at the action level; the next observe()
        // returns the latest screen state.
        break

      case 'stop':
        break

      default:
        throw new Error(`Unsupported action type: ${(action as { type: string }).type}`)
    }

    return { ok: true, action }
  }

  // -----------------------------------------------------------------------
  // Internal: convert DesktopGroundingSnapshot → VisualState-compatible shape
  // -----------------------------------------------------------------------

  #visualStateFromGrounding(
    g: DesktopGroundingSnapshot,
    step: number,
  ): Record<string, unknown> {
    const url = g.chromeDomObservation?.url ?? this.#deriveUrl(g)
    const title = g.chromeDomObservation?.title ?? g.windows[0]?.title ?? url
    const sourceType = this.#inferSourceType(url, title)

    return {
      sessionId: this.#sessionId,
      step,
      url,
      title,
      sourceType,
      observedAt: g.capturedAt,
      screenshot: this.#screenshotFromGrounding(g),
      desktop: {
        foregroundApp: g.foregroundApp,
        windowCount: g.windows.length,
        staleFlags: g.staleFlags,
      },
      chrome: g.chromeContext,
      page: g.pageContext,
      visibleText: g.chromeDomObservation?.visibleText ?? '',
      elements: g.targetCandidates.map(c => this.#candidateToElement(c)),
      signals: g.chromeDomObservation?.signals ?? [],
      evidence: [],
      extracted: {},
    }
  }

  #screenshotFromGrounding(g: DesktopGroundingSnapshot): VisualScreenshot {
    return {
      id: `${this.#sessionId}-shot-${g.snapshotId}`,
      width: g.screenshot.width ?? g.screenshot?.width ?? 0,
      height: g.screenshot.height ?? g.screenshot?.height ?? 0,
    }
  }

  #candidateToElement(c: DesktopTargetCandidate): VisualElement {
    return {
      id: c.id,
      role: c.role,
      text: c.label,
      href: c.href ?? null,
      intent: null,
      source: c.source,
      box: c.bounds,
      center: c.center,
    }
  }

  #deriveUrl(g: DesktopGroundingSnapshot): string {
    // Fall back to frontmost window title or Chrome window title.
    const chromeWindow = g.windows.find(
      w => w.appName.toLowerCase().includes('chrome') && w.title,
    )
    const title = chromeWindow?.title ?? g.windows[0]?.title ?? ''
    // Try to extract a URL-like pattern from the title.
    const urlMatch = title.match(/https?:\/\/\S+/)
    return urlMatch ? urlMatch[0] : `about:${title.replace(/\s+/g, '-').toLowerCase() || 'blank'}`
  }

  #inferSourceType(url: string, _title: string): SourceType {
    if (url.startsWith('https://www.google.') || url.startsWith('https://search.')) {
      return 'search_engine'
    }
    if (url.includes('/careers') || url.includes('/jobs') || url.includes('/about')) {
      return 'company_site'
    }
    if (url.includes('github.com')) {
      return 'github_org'
    }
    if (url.includes('blog.') || url.includes('/blog') || url.includes('/engineering')) {
      return 'engineering_blog'
    }
    return this.#defaultSourceType
  }

  #sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.min(ms, 5000)))
  }

  #requiresChromeForeground(action: VisualAction): boolean {
    return action.type === 'click'
      || action.type === 'type'
      || action.type === 'press'
      || action.type === 'scroll'
  }

  async #ensureChromeForeground(): Promise<void> {
    const before = await observeWindows(this.#config, { limit: 20 })
    if (this.#isChromeApp(before.frontmostAppName)) {
      return
    }

    if (this.#foregroundPolicy === 'auto_focus_chrome') {
      await executeOpenApp(this.#config, 'Google Chrome')
      await this.#sleep(500)
      const after = await observeWindows(this.#config, { limit: 20 })
      if (this.#isChromeApp(after.frontmostAppName)) {
        return
      }
    }

    throw new Error(
      `Computer-use foreground app must be Google Chrome before input; current frontmost app is ${before.frontmostAppName ?? 'unknown'}.`,
    )
  }

  #isChromeApp(appName: string | undefined): boolean {
    return typeof appName === 'string' && appName.toLowerCase().includes('chrome')
  }
}
