import { VISUAL_ACTION_TYPES } from './actionSpace.js'
import { normalizeVisualState } from './visualState.js'
import type { CollectionSession, VisualAction, VisualState } from '../types.js'

const FORBIDDEN_ACTION_TYPES = new Set([
  'raw_http_fetch',
  'hidden_api_call',
  'sitemap_crawl',
  'solve_captcha',
  'bypass_captcha',
  'rotate_proxy',
  'headless_bulk_collect',
  'bulk_extract_platform',
  'auto_apply',
  'send_message',
  'auto_send_message',
  'auto_add_connection',
  'auto_like',
  'auto_comment',
  'auto_follow',
])

const FORBIDDEN_ELEMENT_INTENTS = new Set([
  'auto_apply',
  'send_message',
  'auto_send_message',
  'auto_add_connection',
  'login',
  'solve_captcha',
  'payment',
])

export function assertAutomationActionAllowed(action: unknown, state: VisualState): VisualAction {
  if (!action || typeof action !== 'object') {
    throw new TypeError('Automation action must be an object.')
  }

  const candidate = action as VisualAction

  if (typeof candidate.type !== 'string' || candidate.type.trim() === '') {
    throw new TypeError('Automation action type must be a non-empty string.')
  }

  if (FORBIDDEN_ACTION_TYPES.has(candidate.type)) {
    throw new Error(`forbidden automation action: ${candidate.type}`)
  }

  if (!VISUAL_ACTION_TYPES.has(candidate.type)) {
    throw new Error(`unsupported automation action: ${candidate.type}`)
  }

  if (candidate.type === 'click') {
    assertClickActionAllowed(candidate, state)
  }

  return { ...candidate } as VisualAction
}

export function stopReasonForVisualState(state: unknown, session: CollectionSession): string | null {
  const normalized = normalizeVisualState(state)
  const stopConditions = new Set(session?.stopConditions ?? [])

  for (const signal of normalized.signals) {
    if (stopConditions.has(signal)) {
      return signal
    }
  }

  return null
}

function assertClickActionAllowed(action: Extract<VisualAction, { type: 'click' }>, state: VisualState): void {
  const normalized = normalizeVisualState(state)
  const element = normalized.elements.find(item => item.id === action.elementId)
  if (!element) {
    throw new Error(`Click action references unknown element: ${action.elementId}`)
  }

  if (element.intent && FORBIDDEN_ELEMENT_INTENTS.has(element.intent)) {
    throw new Error(`forbidden element intent: ${element.intent}`)
  }
}
