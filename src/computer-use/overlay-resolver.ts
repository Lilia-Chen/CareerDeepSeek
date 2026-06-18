import { normalizeVisualState } from '../automation/visualState.js'
import type { VisualElement, VisualState } from '../types.js'

export type BlockingStopSignal
  = | 'login_required'
    | 'captcha'
    | 'payment_required'
    | 'apply_or_send_required'

const HIGH_RISK_SIGNAL_PATTERNS: Array<[BlockingStopSignal, RegExp]> = [
  ['captcha', /\b(captcha|verify you are human|human verification|complete (this )?security check|quick check needed|confirm (you(?:'re| are)(?: a)? )?real person|real person|check the box below)\b/i],
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

function stateText(state: VisualState): string {
  const elementText = state.elements
    .filter(isActionableElement)
    .map(element => element.text)
    .join('\n')
  return `${state.visibleText}\n${elementText}`
}

function isActionableElement(element: VisualElement): boolean {
  const role = element.role.toLowerCase()
  return Boolean(element.href)
    || Boolean(element.intent)
    || ['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'tab'].includes(role)
}
