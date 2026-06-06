const ALLOWED_BROWSER_ACTIONS = new Set([
  'search',
  'refine_query',
  'click_visible_link',
  'read_visible_page',
  'capture_screenshot',
  'extract_evidence',
  'classify_candidate',
  'score_candidate',
  'write_private_record',
  'write_review_queue',
  'stop_session',
])

const FORBIDDEN_BROWSER_ACTIONS = new Set([
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

export interface BrowserAction {
  type: string
  [key: string]: unknown
}

export function assertBrowserActionAllowed(action: unknown): BrowserAction {
  if (!action || typeof action !== 'object') {
    throw new TypeError('Browser action must be an object.')
  }

  const candidate = action as BrowserAction

  if (typeof candidate.type !== 'string' || candidate.type.trim() === '') {
    throw new TypeError('Browser action type must be a non-empty string.')
  }

  if (FORBIDDEN_BROWSER_ACTIONS.has(candidate.type)) {
    throw new Error(`forbidden browser action: ${candidate.type}`)
  }

  if (!ALLOWED_BROWSER_ACTIONS.has(candidate.type)) {
    throw new Error(`unsupported browser action: ${candidate.type}`)
  }

  return { ...candidate }
}
