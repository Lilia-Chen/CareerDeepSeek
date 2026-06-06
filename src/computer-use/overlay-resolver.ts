import { normalizeVisualState } from '../automation/visualState.js'
import type { VisualAction, VisualElement, VisualState } from '../types.js'

export type BlockingStopSignal
  = | 'login_required'
    | 'captcha'
    | 'payment_required'
    | 'apply_or_send_required'

export type OverlayDismissalKind
  = | 'cookie_consent'
    | 'marketing_modal'

export interface OverlayDismissalDecision {
  kind: OverlayDismissalKind
  action: Extract<VisualAction, { type: 'click' }>
  reason: string
}

const HIGH_RISK_SIGNAL_PATTERNS: Array<[BlockingStopSignal, RegExp]> = [
  ['captcha', /\b(captcha|verify you are human|human verification|complete (this )?security check)\b/i],
  ['payment_required', /\b(enter|provide|add).{0,24}(payment details|billing details|credit card|card details)|\b(pay now|checkout to continue|purchase required)\b/i],
  ['apply_or_send_required', /\b(submit application|send application|send message to continue|connect with .{0,40} to continue|follow .{0,40} to continue)\b/i],
  ['login_required', /\b(please )?(sign in|log in|login|create an account|create account|register).{0,40}(to continue|before continuing|required)|\b(to continue).{0,40}(sign in|log in|login|required)\b/i],
]

const HIGH_RISK_SIGNALS = new Set([
  'captcha',
  'login_required',
  'payment_required',
  'apply_or_send_required',
])

const COOKIE_OVERLAY_PATTERNS = [
  /\bcookies?\b/i,
  /\bcookie consent\b/i,
  /\bprivacy policy\b/i,
  /\bprivacy statement\b/i,
]

const MARKETING_OVERLAY_PATTERNS = [
  /\bsubscribe\b/i,
  /\bsign up for (our )?(newsletter|updates)\b/i,
  /\bread the report\b/i,
  /\bdownload (the )?(report|guide|whitepaper)\b/i,
  /\bbook a demo\b/i,
  /\brequest a demo\b/i,
]

const COOKIE_ACCEPT_PATTERNS = [
  /\byes,\s*i agree\b/i,
  /\bi agree\b/i,
  /\baccept all( cookies)?\b/i,
  /\ballow all( cookies)?\b/i,
  /\bagree\b/i,
  /\bok\b/i,
]

const COOKIE_FALLBACK_PATTERNS = [
  /\breject additional\b/i,
  /\breject all( cookies)?\b/i,
  /\bdecline\b/i,
  /\bonly necessary\b/i,
  /\bnecessary only\b/i,
]

const COOKIE_NESTED_FLOW_PATTERNS = [
  /\bcookie consent manager\b/i,
  /\bcookie settings\b/i,
  /\bcookies settings\b/i,
  /\bmanage preferences\b/i,
  /\bpreferences\b/i,
]

const CLOSE_PATTERNS = [
  /^x$/i,
  /^×$/i,
  /\b(close|dismiss|no thanks|not now)\b/i,
]

const CLOSE_EXCLUDE_PATTERNS = [
  /\bskip to main content\b/i,
  /\baccessibility help\b/i,
]

export function detectBlockingStopSignal(state: unknown): BlockingStopSignal | null {
  const normalized = normalizeVisualState(state)
  for (const signal of normalized.signals) {
    if (HIGH_RISK_SIGNALS.has(signal))
      return signal as BlockingStopSignal
  }

  const haystack = stateText(normalized)
  for (const [signal, pattern] of HIGH_RISK_SIGNAL_PATTERNS) {
    if (pattern.test(haystack))
      return signal
  }

  return null
}

export function planOverlayDismissal(state: unknown): OverlayDismissalDecision | null {
  const normalized = normalizeVisualState(state)
  if (detectBlockingStopSignal(normalized))
    return null

  const haystack = stateText(normalized)
  if (looksLikeCookieOverlay(haystack)) {
    const target = findFirstMatchingElement(normalized, COOKIE_ACCEPT_PATTERNS, COOKIE_NESTED_FLOW_PATTERNS)
      ?? findFirstMatchingElement(normalized, COOKIE_FALLBACK_PATTERNS, COOKIE_NESTED_FLOW_PATTERNS)
      ?? findFirstMatchingElement(normalized, CLOSE_PATTERNS, COOKIE_NESTED_FLOW_PATTERNS)

    if (!target)
      return null

    return {
      kind: 'cookie_consent',
      action: clickAction(target, 'Dismiss cookie consent overlay before reading page evidence.'),
      reason: 'Cookie consent overlay is blocking the real page content; dismiss it before evidence extraction.',
    }
  }

  if (looksLikeMarketingOverlay(haystack)) {
    const target = findFirstMatchingElement(normalized, CLOSE_PATTERNS, CLOSE_EXCLUDE_PATTERNS)
    if (!target)
      return null

    return {
      kind: 'marketing_modal',
      action: clickAction(target, 'Dismiss marketing overlay before reading page evidence.'),
      reason: 'Marketing modal is blocking the real page content; close it before evidence extraction.',
    }
  }

  return null
}

function stateText(state: VisualState): string {
  const elementText = state.elements.map(element => element.text).join('\n')
  return `${state.visibleText}\n${elementText}`
}

function looksLikeCookieOverlay(text: string): boolean {
  return COOKIE_OVERLAY_PATTERNS.some(pattern => pattern.test(text))
}

function looksLikeMarketingOverlay(text: string): boolean {
  return MARKETING_OVERLAY_PATTERNS.some(pattern => pattern.test(text))
}

function findFirstMatchingElement(
  state: VisualState,
  includePatterns: RegExp[],
  excludePatterns: RegExp[] = [],
): VisualElement | null {
  for (const element of state.elements) {
    if (element.source !== 'chrome_dom')
      continue
    const text = element.text.trim()
    if (!text)
      continue
    if (excludePatterns.some(pattern => pattern.test(text)))
      continue
    if (includePatterns.some(pattern => pattern.test(text)))
      return element
  }
  return null
}

function clickAction(element: VisualElement, reason: string): Extract<VisualAction, { type: 'click' }> {
  return {
    type: 'click',
    elementId: element.id,
    point: element.center,
    target: {
      role: element.role,
      text: element.text,
      href: element.href,
      intent: element.intent,
    },
    reason,
    expectedChange: 'The blocking overlay disappears and the page content becomes readable.',
  }
}
