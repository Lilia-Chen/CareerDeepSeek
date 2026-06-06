import type {
  BrowserPageContext,
  ChromeContext,
  ChromeDomObservation,
  WindowObservation,
} from './types.js'

interface ClassifyBrowserPageInput {
  url?: string | null
  title?: string | null
  domAvailable: boolean
  signals?: string[]
}

export function classifyBrowserPage(input: ClassifyBrowserPageInput): BrowserPageContext {
  const url = normalizeNullable(input.url)
  const title = normalizeNullable(input.title)
  const signals = input.signals ?? []
  const parsed = parseUrl(url)
  const host = parsed?.hostname ?? null
  const path = parsed?.pathname ?? ''

  return {
    className: classifyUrl(host, path, url, title),
    url,
    title,
    host,
    source: url ? 'chrome_dom' : 'unknown',
    domAvailable: input.domAvailable,
    signals,
  }
}

export function buildChromeContext(params: {
  windowObs: WindowObservation
  foregroundApp: string
  chromeDomObs: ChromeDomObservation | null
}): ChromeContext {
  const { windowObs, foregroundApp, chromeDomObs } = params
  const visibleChromeWindows = windowObs.windows.filter(window =>
    window.appName.toLowerCase().includes('chrome')
    && window.isOnScreen
    && window.bounds.width >= 480
    && window.bounds.height >= 300,
  )

  return {
    running: visibleChromeWindows.length > 0 || chromeDomObs !== null,
    isFrontmost: foregroundApp.toLowerCase().includes('chrome'),
    visibleWindowCount: visibleChromeWindows.length,
    activeTabUrl: chromeDomObs?.url ?? null,
    activeTabTitle: chromeDomObs?.title ?? null,
    domAvailable: Boolean(
      chromeDomObs
      && (chromeDomObs.elements.length > 0 || chromeDomObs.visibleText.trim().length > 0),
    ),
    domElementCount: chromeDomObs?.elements.length ?? 0,
    domVisibleTextLength: chromeDomObs?.visibleText.length ?? 0,
  }
}

function classifyUrl(
  host: string | null,
  path: string,
  url: string | null,
  title: string | null,
): BrowserPageContext['className'] {
  if (!url || url === 'about:blank' || /new tab/i.test(title ?? ''))
    return 'empty_tab'

  if (!host)
    return 'unknown'

  const normalizedHost = host.replace(/^www\./, '')
  if (normalizedHost === 'google.com' || normalizedHost.endsWith('.google.com')) {
    return path.startsWith('/search') ? 'google_results' : 'google_home'
  }

  if (normalizedHost === 'linkedin.com' || normalizedHost.endsWith('.linkedin.com')) {
    if (path === '/feed/' || path === '/feed')
      return 'linkedin_feed'
    if (path.startsWith('/search/results/'))
      return 'linkedin_search_results'
    if (path.startsWith('/company/'))
      return 'linkedin_company_page'
    if (path.startsWith('/jobs/search'))
      return 'linkedin_jobs_results'
    if (path.startsWith('/jobs/view'))
      return 'linkedin_job_page'
    return 'unknown'
  }

  if (url.startsWith('http://') || url.startsWith('https://'))
    return 'company_site'

  return 'unknown'
}

function parseUrl(url: string | null): URL | null {
  if (!url)
    return null

  try {
    return new URL(url)
  }
  catch {
    return null
  }
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (typeof value !== 'string')
    return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
