#!/usr/bin/env node
/**
 * Company discovery task.
 *
 * Address-bar navigation is allowed only for startup navigation to Google.
 * Search-result deep dives must click currently observed result links.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import {
  captureAXTree,
  captureScreenshot,
  executeOpenApp,
  MacOSComputerUseAdapter,
  observeWindows,
  resolveComputerUseConfig,
} from '../src/computer-use/index.js'
import type { AXNode, Bounds, ComputerUseConfig, WindowDescriptor } from '../src/computer-use/index.js'
import { runProcess } from '../src/computer-use/process.js'
import { detectBlockingStopSignal, planOverlayDismissal } from '../src/computer-use/overlay-resolver.js'
import type { VisualAction } from '../src/types.js'

const SEARCH_QUERIES = [
  'production AI agent platform companies enterprise agents',
  'AI agent infrastructure runtime memory eval observability company',
  'agentic workflow automation platform AI agents companies hiring',
]

const COMPANIES_PER_QUERY = 5
const MAX_RESULT_SCROLLS = 4
const MAX_OVERLAY_DISMISSALS = 3
const BLOCKED_CANDIDATE_HOSTS = [
  'glassdoor.com',
  'indeed.com',
  'linkedin.com',
  'youtube.com',
  'reddit.com',
  'totaljobs.com',
  'simplyhired.co.uk',
  'reed.co.uk',
  'monster.co.uk',
  'ziprecruiter.com',
  'otta.com',
  'wellfound.com',
  'studysmarter.co.uk',
  'aimultiple.com',
  'cbinsights.com',
  'entrepreneurloop.com',
  'startupnetworks.co.uk',
  'wellows.com',
]
const NON_CANDIDATE_LINK_TEXTS = new Set([
  'about us',
  'contact us',
  'download',
  'download now',
  'get a demo',
  'get demo',
  'learn more',
  'read more',
  'request a demo',
  'services offered',
  'watch demo',
  'watch the demo',
])
const TRACKING_PARAM_PREFIXES = ['utm_', 'hsa_']
const TRACKING_PARAM_NAMES = new Set([
  'gad_source',
  'gad_campaignid',
  'gbraid',
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
  'sa',
  'ved',
])

interface Point {
  x: number
  y: number
}

interface CollectedLink {
  elementId: string
  text: string
  href: string
  canonicalHref: string
  center: Point
  role: string
}

interface TraceActionSummary {
  type: string
  elementId?: string
  point?: Point
  key?: string
  modifiers?: string[]
  deltaY?: number
  textLength?: number
  target?: Record<string, unknown>
}

interface TraceObservationSummary {
  url: string | null
  title: string | null
  observedAt: string | null
  screenshot: Record<string, unknown> | null
  elementCount: number
  linkCount: number
  visibleTextSnippet: string
}

interface TraceStep {
  id: number
  phase: string
  query?: string
  rank?: number
  startedAt: string
  endedAt: string
  durationMs: number
  decision: string
  action: TraceActionSummary
  before: TraceObservationSummary | null
  after: TraceObservationSummary | null
  result?: Record<string, unknown>
  error?: string
}

class BlockingStopSignalError extends Error {
  readonly signal: string

  constructor(signal: string) {
    super(`Blocking browser state detected: ${signal}`)
    this.name = 'BlockingStopSignalError'
    this.signal = signal
  }
}

interface ChromeTabContext {
  tabCount: number
  url: string | null
  title: string | null
}

interface ClickVisitObservation {
  link: CollectedLink
  beforeState: Record<string, unknown>
  afterState: Record<string, unknown>
  beforeTab: ChromeTabContext | null
  afterTab: ChromeTabContext | null
  observedUrl: unknown
  title: unknown
  visibleText: string
  elementCount: number
  links: CollectedLink[]
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function elementsOf(state: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(state.elements) ? state.elements as Array<Record<string, unknown>> : []
}

function collectVisibleText(state: Record<string, unknown>): string {
  return String(state.visibleText || '').slice(0, 3000)
}

function elementText(el: Record<string, unknown>): string {
  return String(el.text || '').replace(/\s+/g, ' ').trim()
}

function summarizeState(state: Record<string, unknown> | null): TraceObservationSummary | null {
  if (!state)
    return null

  const screenshot = state.screenshot && typeof state.screenshot === 'object'
    ? state.screenshot as Record<string, unknown>
    : null
  const links = collectLinks(state)

  return {
    url: typeof state.url === 'string' ? state.url : null,
    title: typeof state.title === 'string' ? state.title : null,
    observedAt: typeof state.observedAt === 'string' ? state.observedAt : null,
    screenshot: screenshot
      ? {
          id: screenshot.id,
          width: screenshot.width,
          height: screenshot.height,
        }
      : null,
    elementCount: elementsOf(state).length,
    linkCount: links.length,
    visibleTextSnippet: collectVisibleText(state).slice(0, 700),
  }
}

function recordStep(
  trace: TraceStep[],
  input: {
    phase: string
    query?: string
    rank?: number
    startedAt: number
    endedAt: number
    decision: string
    action: TraceActionSummary
    before: Record<string, unknown> | null
    after: Record<string, unknown> | null
    result?: Record<string, unknown>
    error?: string
  },
): void {
  trace.push({
    id: trace.length + 1,
    phase: input.phase,
    query: input.query,
    rank: input.rank,
    startedAt: iso(input.startedAt),
    endedAt: iso(input.endedAt),
    durationMs: input.endedAt - input.startedAt,
    decision: input.decision,
    action: input.action,
    before: summarizeState(input.before),
    after: summarizeState(input.after),
    result: input.result,
    error: input.error,
  })
}

function summarizeClickAction(action: Extract<VisualAction, { type: 'click' }>): TraceActionSummary {
  return {
    type: action.type,
    elementId: action.elementId,
    point: action.point,
    target: {
      role: action.target.role,
      text: action.target.text,
      href: action.target.href,
      intent: action.target.intent,
    },
  }
}

async function resolveBlockingPageState(
  adapter: MacOSComputerUseAdapter,
  trace: TraceStep[],
  state: Record<string, unknown>,
  context: { phase: string, query?: string, rank?: number },
): Promise<Record<string, unknown>> {
  let current = patchStateUrlFromTab(state, await readChromeTabContext())

  for (let attempt = 0; attempt <= MAX_OVERLAY_DISMISSALS; attempt++) {
    const stopSignal = detectBlockingStopSignal(current)
    if (stopSignal) {
      const now = Date.now()
      recordStep(trace, {
        phase: 'blocking_stop_signal',
        query: context.query,
        rank: context.rank,
        startedAt: now,
        endedAt: now,
        decision: 'Hardcoded browser safety gate detected a high-risk blocking state; stop instead of clicking through.',
        action: { type: 'stop', target: { signal: stopSignal, contextPhase: context.phase } },
        before: current,
        after: current,
        result: { signal: stopSignal, contextPhase: context.phase },
      })
      throw new BlockingStopSignalError(stopSignal)
    }

    const dismissal = planOverlayDismissal(current)
    if (!dismissal)
      return current

    const startedAt = Date.now()
    await adapter.act(dismissal.action)
    await sleep(900)
    const after = await adapter.observe() as Record<string, unknown>
    const afterTab = await readChromeTabContext()
    const patchedAfter = patchStateUrlFromTab(after, afterTab)
    const endedAt = Date.now()

    recordStep(trace, {
      phase: 'overlay_dismissal',
      query: context.query,
      rank: context.rank,
      startedAt,
      endedAt,
      decision: dismissal.reason,
      action: summarizeClickAction(dismissal.action),
      before: current,
      after: patchedAfter,
      result: {
        kind: dismissal.kind,
        attempt: attempt + 1,
        contextPhase: context.phase,
        tabAfterDismissal: afterTab,
      },
    })

    current = patchedAfter
  }

  throw new Error(`Could not clear blocking overlays after ${MAX_OVERLAY_DISMISSALS} attempts.`)
}

async function writeTraceFile(
  tracePath: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeFile(tracePath, JSON.stringify(payload, null, 2), 'utf-8')
}

async function readChromeTabContext(): Promise<ChromeTabContext | null> {
  const config = resolveComputerUseConfig()
  const script = String.raw`
const chrome = Application("Google Chrome");
const windows = chrome.windows();
if (!windows.length) {
  JSON.stringify({ tabCount: 0, url: null, title: null });
} else {
  const window = windows[0];
  if (!window.tabs.length) {
    JSON.stringify({ tabCount: 0, url: null, title: null });
  } else {
  const tab = window.activeTab();
  JSON.stringify({
    tabCount: window.tabs.length,
    url: tab.url(),
    title: tab.title()
  });
  }
}
`
  const result = await runProcess(config.binaries.osascript, ['-l', 'JavaScript', '-e', script], {
    timeoutMs: config.timeoutMs,
  })
  if (result.exitCode !== 0)
    return null

  try {
    const parsed = JSON.parse(result.stdout) as Partial<ChromeTabContext>
    return {
      tabCount: typeof parsed.tabCount === 'number' ? parsed.tabCount : 0,
      url: typeof parsed.url === 'string' ? parsed.url : null,
      title: typeof parsed.title === 'string' ? parsed.title : null,
    }
  }
  catch {
    return null
  }
}

async function findVisibleChromeWindow(config: ComputerUseConfig): Promise<WindowDescriptor> {
  const window = await findVisibleChromeWindowOrNull(config)
  if (!window)
    throw new Error('No visible Google Chrome window found.')
  return window
}

async function findVisibleChromeWindowOrNull(config: ComputerUseConfig): Promise<WindowDescriptor | null> {
  const obs = await observeWindows(config, { limit: 120 })
  return obs.windows.find(w =>
    w.appName.toLowerCase().includes('chrome')
    && w.isOnScreen
    && w.bounds.width >= 480
    && w.bounds.height >= 300,
  ) ?? null
}

async function ensureChromeReadyAtTaskStart(config: ComputerUseConfig): Promise<Record<string, unknown>> {
  const before = await captureScreenshot(config, 'task_start_before_chrome_context')
  console.error(`[company-discovery] Initial desktop screenshot: ${before.path}`)

  const current = await observeWindows(config, { limit: 120 })
  const hasVisibleChrome = current.windows.some(window =>
    window.appName.toLowerCase().includes('chrome')
    && window.isOnScreen
    && window.bounds.width >= 480
    && window.bounds.height >= 300,
  )

  if (!hasVisibleChrome || !current.frontmostAppName?.toLowerCase().includes('chrome')) {
    await executeOpenApp(config, 'Google Chrome')
  }

  const startedAt = Date.now()
  while (Date.now() - startedAt < 8000) {
    await sleep(300)
    const next = await observeWindows(config, { limit: 120 })
    const hasChromeWindow = next.windows.some(window =>
      window.appName.toLowerCase().includes('chrome')
      && window.isOnScreen
      && window.bounds.width >= 480
      && window.bounds.height >= 300,
    )
    if (hasChromeWindow && next.frontmostAppName?.toLowerCase().includes('chrome')) {
      const after = await captureScreenshot(config, 'task_start_chrome_frontmost')
      console.error(`[company-discovery] Confirmed Chrome frontmost screenshot: ${after.path}`)
      return {
        beforeScreenshot: { path: before.path, width: before.width, height: before.height },
        afterScreenshot: { path: after.path, width: after.width, height: after.height },
      }
    }
  }

  throw new Error('Could not open or activate Google Chrome at task startup.')
}

function findAddressBarNode(node: AXNode): AXNode | null {
  const desc = `${node.description ?? ''} ${node.title ?? ''}`
  if (node.role === 'AXTextField' && node.bounds && node.bounds.width > 0
    && /address and search bar/i.test(desc)) {
    return node
  }
  for (const child of node.children) {
    const match = findAddressBarNode(child)
    if (match)
      return match
  }
  return null
}

async function getAddressBar(config: ComputerUseConfig, window: WindowDescriptor): Promise<{ node: AXNode, bounds: Bounds }> {
  const ax = await captureAXTree(config, { pid: window.ownerPid, maxDepth: 12, maxNodes: 3000 })
  const node = findAddressBarNode(ax.root)
  if (!node?.bounds)
    throw new Error('Could not find Chrome address bar in AX tree.')
  return { node, bounds: node.bounds }
}

function normalizeAddressValue(value: string): string {
  return value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
}

async function navigateToUrl(adapter: MacOSComputerUseAdapter, config: ComputerUseConfig, url: string): Promise<void> {
  const window = await findVisibleChromeWindow(config)
  const addressBar = await getAddressBar(config, window)

  await adapter.act({
    type: 'click',
    elementId: 'chrome-address-bar',
    point: {
      x: addressBar.bounds.x + addressBar.bounds.width / 2,
      y: addressBar.bounds.y + addressBar.bounds.height / 2,
    },
    target: {
      role: 'address_bar',
      text: 'Address and search bar',
      href: null,
      intent: null,
    },
  })
  await sleep(300)

  await adapter.act({ type: 'press', key: 'l', modifiers: ['command'] })
  await sleep(300)
  await adapter.act({ type: 'type', text: url })

  const expected = normalizeAddressValue(url)
  const startedAt = Date.now()
  let confirmed = false
  while (Date.now() - startedAt < 3000) {
    const ab = await getAddressBar(config, window)
    if (ab.node.focused && normalizeAddressValue(ab.node.value ?? '') === expected) {
      confirmed = true
      break
    }
    await sleep(150)
  }
  if (!confirmed)
    throw new Error('Address bar did not contain the requested URL.')

  await submitAddressBar(adapter, config, window, url)
  await sleep(3000)
}

async function submitAddressBar(
  adapter: MacOSComputerUseAdapter,
  config: ComputerUseConfig,
  window: WindowDescriptor,
  expectedUrl: string,
): Promise<void> {
  const expected = normalizeAddressValue(expectedUrl)
  for (let attempt = 0; attempt < 3; attempt++) {
    await adapter.act({ type: 'press', key: 'enter' })
    await sleep(700)

    const ab = await getAddressBar(config, window)
    const actual = normalizeAddressValue(ab.node.value ?? '')
    if (!ab.node.focused || actual !== expected)
      return
  }

  throw new Error('Navigation failed: Enter did not submit the observed address bar value.')
}

function assertUrlIsGoogle(url: unknown): void {
  if (typeof url !== 'string')
    throw new TypeError('Expected a URL string.')
  const parsed = new URL(url)
  if (!parsed.hostname.includes('google.'))
    throw new Error(`Expected google.com, got: ${url}`)
}

function assertUrlIsGoogleSearch(url: unknown): void {
  if (!isGoogleSearchUrl(url))
    throw new Error(`Expected Google Search URL, got: ${String(url)}`)
}

function isGooglePageUrl(url: unknown): boolean {
  if (typeof url !== 'string')
    return false
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes('google.')
  }
  catch {
    return false
  }
}

function isGoogleSearchUrl(url: unknown): boolean {
  if (typeof url !== 'string')
    return false
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes('google.') && parsed.pathname === '/search'
  }
  catch {
    return false
  }
}

function isObservationUrlUnreliable(url: unknown): boolean {
  return typeof url === 'string'
    && (url === 'about:statusindicator' || url.startsWith('about:statusindicator'))
}

function patchStateUrlFromTab(
  state: Record<string, unknown>,
  tab: ChromeTabContext | null,
): Record<string, unknown> {
  if (!tab?.url || isObservationUrlUnreliable(tab.url))
    return state

  if (!state.url || isObservationUrlUnreliable(state.url)) {
    return {
      ...state,
      url: tab.url,
      title: tab.title ?? state.title,
      chromeTabContextPatch: true,
    }
  }

  return state
}

function canCloseNewTabForReturn(currentTab: ChromeTabContext | null, expected: ChromeTabContext | null): boolean {
  return Boolean(
    currentTab
    && expected
    && currentTab.tabCount > 1
    && expected.tabCount >= 1
    && currentTab.tabCount > expected.tabCount
    && expected.url
    && isGoogleSearchUrl(expected.url)
    && currentTab.url
    && !isObservationUrlUnreliable(currentTab.url),
  )
}

function findGoogleSearchBox(elements: Array<Record<string, unknown>>): Record<string, unknown> | null {
  return elements.find(el =>
    (el.role === 'combobox' || el.role === 'searchbox' || el.role === 'textbox')
    && elementText(el).toLowerCase().includes('search'),
  ) ?? null
}

function findHideSponsoredResultsButton(state: Record<string, unknown>): Record<string, unknown> | null {
  if (!isGoogleSearchUrl(state.url))
    return null

  return elementsOf(state).find(el =>
    elementText(el).toLowerCase() === 'hide sponsored results'
    && String(el.role || '').toLowerCase().includes('button'),
  ) ?? null
}

async function collapseSponsoredResults(
  adapter: MacOSComputerUseAdapter,
  trace: TraceStep[],
  state: Record<string, unknown>,
  context: { phase: string, query?: string, rank?: number },
): Promise<Record<string, unknown>> {
  const button = findHideSponsoredResultsButton(state)
  if (!button)
    return state

  const startedAt = Date.now()
  const center = observedCenter(button)
  await adapter.act({
    type: 'click',
    elementId: String(button.id),
    point: center,
    target: {
      role: String(button.role || 'button'),
      text: elementText(button),
      href: null,
      intent: null,
    },
    reason: 'Collapse Google sponsored results before collecting organic company candidates.',
    expectedChange: 'The sponsored results block is collapsed and organic results move into view.',
  })
  await sleep(900)
  const after = patchStateUrlFromTab(
    await adapter.observe() as Record<string, unknown>,
    await readChromeTabContext(),
  )
  const endedAt = Date.now()

  recordStep(trace, {
    phase: 'sponsored_results_collapse',
    query: context.query,
    rank: context.rank,
    startedAt,
    endedAt,
    decision: 'Collapse the observed Google sponsored-results block before collecting company candidates.',
    action: {
      type: 'click',
      elementId: String(button.id),
      point: center,
      target: {
        role: String(button.role || 'button'),
        text: elementText(button),
      },
    },
    before: state,
    after,
    result: {
      contextPhase: context.phase,
      sponsoredRangeBefore: googleSponsoredResultRange(state),
      sponsoredRangeAfter: googleSponsoredResultRange(after),
    },
  })

  return after
}

async function searchGoogle(
  adapter: MacOSComputerUseAdapter,
  config: ComputerUseConfig,
  query: string,
  trace: TraceStep[],
): Promise<Record<string, unknown>> {
  const beforeNav = patchStateUrlFromTab(
    await adapter.observe() as Record<string, unknown>,
    await readChromeTabContext(),
  )
  let googleState = beforeNav
  const navStartedAt = Date.now()

  if (!isGooglePageUrl(googleState.url)) {
    await navigateToUrl(adapter, config, 'google.com')
    googleState = patchStateUrlFromTab(
      await adapter.observe() as Record<string, unknown>,
      await readChromeTabContext(),
    )
    const navEndedAt = Date.now()
    assertUrlIsGoogle(googleState.url)

    recordStep(trace, {
      phase: 'startup_google_navigation',
      query,
      startedAt: navStartedAt,
      endedAt: navEndedAt,
      decision: 'Use the observed Chrome address bar only when the current tab is not already a Google page.',
      action: { type: 'address_bar_navigation', target: { url: 'google.com' } },
      before: beforeNav,
      after: googleState,
      result: { url: googleState.url },
    })
  }
  else {
    const navEndedAt = Date.now()
    recordStep(trace, {
      phase: 'google_context_reuse',
      query,
      startedAt: navStartedAt,
      endedAt: navEndedAt,
      decision: 'Reuse the observed Google page and continue through the page search box instead of typing into the address bar.',
      action: { type: 'wait' },
      before: beforeNav,
      after: googleState,
      result: { url: googleState.url },
    })
  }

  googleState = await resolveBlockingPageState(adapter, trace, googleState, { phase: 'google_home', query })
  const searchBox = findGoogleSearchBox(elementsOf(googleState))
  if (!searchBox)
    throw new Error('Could not find Google search box on page.')

  const center = observedCenter(searchBox)
  const searchStartedAt = Date.now()
  await adapter.act({
    type: 'click',
    elementId: String(searchBox.id),
    point: center,
    target: { role: String(searchBox.role), text: String(searchBox.text || ''), href: null, intent: null },
  })
  await sleep(400)
  await adapter.act({ type: 'press', key: 'a', modifiers: ['command'] })
  await sleep(150)
  await adapter.act({ type: 'type', text: query })
  await sleep(200)
  await adapter.act({ type: 'press', key: 'enter' })
  await sleep(3500)

  let resultsState = await adapter.observe() as Record<string, unknown>
  resultsState = await resolveBlockingPageState(adapter, trace, resultsState, { phase: 'search_results', query })
  resultsState = await collapseSponsoredResults(adapter, trace, resultsState, { phase: 'search_results', query })
  const searchEndedAt = Date.now()
  assertUrlIsGoogleSearch(resultsState.url)

  recordStep(trace, {
    phase: 'google_search',
    query,
    startedAt: searchStartedAt,
    endedAt: searchEndedAt,
    decision: 'Click the observed Google search box, type the query, and submit with Enter.',
    action: {
      type: 'search_query',
      elementId: String(searchBox.id),
      point: center,
      textLength: query.length,
      target: { role: String(searchBox.role), text: String(searchBox.text || '') },
    },
    before: googleState,
    after: resultsState,
    result: { url: resultsState.url },
  })

  return resultsState
}

function observedCenter(el: Record<string, unknown>): Point {
  if (isPoint(el.center))
    return { x: el.center.x, y: el.center.y }

  if (el.box && typeof el.box === 'object') {
    const box = el.box as Record<string, unknown>
    const x = Number(box.x)
    const y = Number(box.y)
    const width = Number(box.width)
    const height = Number(box.height)
    if ([x, y, width, height].every(Number.isFinite)) {
      return {
        x: x + width / 2,
        y: y + height / 2,
      }
    }
  }

  throw new Error(`Observed element has no usable center: ${String(el.id ?? '')}`)
}

function elementY(el: Record<string, unknown>): number | null {
  if (isPoint(el.center))
    return el.center.y

  if (el.box && typeof el.box === 'object') {
    const box = el.box as Record<string, unknown>
    const y = Number(box.y)
    const height = Number(box.height)
    if (Number.isFinite(y) && Number.isFinite(height))
      return y + height / 2
  }

  return null
}

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object')
    return false
  const point = value as Record<string, unknown>
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function canonicalizeHref(rawHref: string): string | null {
  try {
    const raw = new URL(rawHref)
    const host = raw.hostname.toLowerCase()
    const candidate = host.includes('google.') && (raw.pathname === '/url' || raw.pathname === '/aclk')
      ? raw.searchParams.get('q') || raw.searchParams.get('url') || raw.searchParams.get('adurl')
      : rawHref
    if (!candidate?.startsWith('http')) {
      return null
    }

    const url = new URL(candidate)
    url.hash = ''
    const paramsToDelete: string[] = []
    for (const key of url.searchParams.keys()) {
      if (TRACKING_PARAM_NAMES.has(key) || TRACKING_PARAM_PREFIXES.some(prefix => key.startsWith(prefix))) {
        paramsToDelete.push(key)
      }
    }
    for (const key of paramsToDelete)
      url.searchParams.delete(key)
    return url.href
  }
  catch {
    return null
  }
}

function shouldKeepCandidateLink(rawHref: string, canonicalHref: string, text: string): boolean {
  try {
    const raw = new URL(rawHref)
    const canonical = new URL(canonicalHref)
    const host = canonical.hostname.toLowerCase().replace(/^www\./, '')
    const rawHost = raw.hostname.toLowerCase()
    const textLower = text.trim().toLowerCase()

    if (!canonical.protocol.startsWith('http'))
      return false
    if (host.includes('google.') || rawHost.includes('googleadservices'))
      return false
    if (BLOCKED_CANDIDATE_HOSTS.some(blocked => host === blocked || host.endsWith(`.${blocked}`)))
      return false
    if (NON_CANDIDATE_LINK_TEXTS.has(textLower))
      return false
    if (textLower.length < 2)
      return false
    return true
  }
  catch {
    return false
  }
}

function googleSponsoredResultRange(state: Record<string, unknown>): { startY: number, endY: number } | null {
  if (!isGoogleSearchUrl(state.url))
    return null

  let startY: number | null = null
  let endY: number | null = null
  for (const el of elementsOf(state)) {
    const text = elementText(el)
    const y = elementY(el)
    if (y === null)
      continue
    if (/^Sponsored results$/i.test(text))
      startY = startY === null ? y : Math.min(startY, y)
    if (/^Hide sponsored results$/i.test(text))
      endY = endY === null ? y : Math.max(endY, y)
  }

  if (startY === null || endY === null || endY <= startY)
    return null

  return { startY, endY }
}

function isGoogleSponsoredResultLink(state: Record<string, unknown>, el: Record<string, unknown>): boolean {
  const range = googleSponsoredResultRange(state)
  if (!range)
    return false

  const y = elementY(el)
  return y !== null && y >= range.startY && y <= range.endY
}

function candidateDomainKey(canonicalHref: string): string | null {
  try {
    const url = new URL(canonicalHref)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  }
  catch {
    return null
  }
}

function collectLinks(state: Record<string, unknown>): CollectedLink[] {
  const deduped = new Map<string, CollectedLink>()
  for (const el of elementsOf(state)) {
    const href = typeof el.href === 'string' ? el.href : ''
    if (!href.startsWith('http'))
      continue
    if (isGoogleSponsoredResultLink(state, el))
      continue

    const canonicalHref = canonicalizeHref(href)
    if (!canonicalHref)
      continue

    const text = elementText(el).slice(0, 220)
    if (!shouldKeepCandidateLink(href, canonicalHref, text))
      continue

    const link: CollectedLink = {
      elementId: String(el.id || ''),
      text,
      href,
      canonicalHref,
      center: observedCenter(el),
      role: String(el.role || 'link'),
    }

    const key = candidateDomainKey(link.canonicalHref) ?? link.canonicalHref
    if (!deduped.has(key))
      deduped.set(key, link)
  }
  return [...deduped.values()]
}

async function collectSearchResultsWithScroll(
  adapter: MacOSComputerUseAdapter,
  trace: TraceStep[],
  query: string,
): Promise<{ state: Record<string, unknown>, links: CollectedLink[] }> {
  let current = await adapter.observe() as Record<string, unknown>
  current = await resolveBlockingPageState(adapter, trace, current, { phase: 'search_results_scroll', query })
  current = await collapseSponsoredResults(adapter, trace, current, { phase: 'search_results_scroll', query })

  for (let scrollIndex = 0; scrollIndex <= MAX_RESULT_SCROLLS; scrollIndex++) {
    assertUrlIsGoogleSearch(current.url)
    const links = collectLinks(current)
    if (links.length >= COMPANIES_PER_QUERY || scrollIndex === MAX_RESULT_SCROLLS) {
      return { state: current, links }
    }

    const startedAt = Date.now()
    const before = current
    await adapter.act({ type: 'scroll', deltaY: -700 })
    await sleep(900)
    current = await adapter.observe() as Record<string, unknown>
    current = await resolveBlockingPageState(adapter, trace, current, { phase: 'search_results_scroll', query })
    current = await collapseSponsoredResults(adapter, trace, current, { phase: 'search_results_scroll', query })
    const endedAt = Date.now()

    recordStep(trace, {
      phase: 'search_results_scroll',
      query,
      startedAt,
      endedAt,
      decision: `Only ${links.length} candidate links are visible; scroll down to reveal more organic results.`,
      action: { type: 'scroll', deltaY: -700 },
      before,
      after: current,
      result: {
        previousLinkCount: links.length,
        nextLinkCount: collectLinks(current).length,
        scrollIndex: scrollIndex + 1,
      },
    })
  }

  return { state: current, links: collectLinks(current) }
}

function actionForLink(link: CollectedLink): TraceActionSummary {
  return {
    type: 'click',
    elementId: link.elementId,
    point: link.center,
    target: {
      role: link.role,
      text: link.text,
      href: link.href,
      canonicalHref: link.canonicalHref,
    },
  }
}

async function clickLink(adapter: MacOSComputerUseAdapter, link: CollectedLink): Promise<void> {
  await adapter.act({
    type: 'click',
    elementId: link.elementId,
    point: link.center,
    target: {
      role: link.role,
      text: link.text,
      href: link.href,
      intent: null,
    },
  })
  await sleep(3500)
}

async function focusOpenedBackgroundTab(
  adapter: MacOSComputerUseAdapter,
  expected: ChromeTabContext,
  current: ChromeTabContext,
): Promise<{ state: Record<string, unknown>, tab: ChromeTabContext | null }> {
  const attempts = Math.min(Math.max(current.tabCount - expected.tabCount, 1), 3)
  let state = await adapter.observe() as Record<string, unknown>
  let tab: ChromeTabContext | null = current

  for (let attempt = 0; attempt < attempts; attempt++) {
    await adapter.act({ type: 'press', key: 'right', modifiers: ['command', 'option'] })
    await sleep(900)
    state = await adapter.observe() as Record<string, unknown>
    tab = await readChromeTabContext()
    if (tab?.url && !isGoogleSearchUrl(tab.url))
      return { state, tab }
  }

  return { state, tab }
}

function findMatchingObservedLink(state: Record<string, unknown>, expected: CollectedLink): CollectedLink | null {
  const links = collectLinks(state)
  return links.find(link => link.canonicalHref === expected.canonicalHref)
    ?? links.find(link => link.text && expected.text && link.text === expected.text)
    ?? null
}

async function visitByClick(
  adapter: MacOSComputerUseAdapter,
  link: CollectedLink,
  trace: TraceStep[],
  query: string,
  rank: number,
): Promise<ClickVisitObservation> {
  const beforeState = await adapter.observe() as Record<string, unknown>
  const beforeTab = await readChromeTabContext()
  const currentLink = findMatchingObservedLink(beforeState, link)
  if (!currentLink) {
    throw new Error(`Could not find the planned result link in the current observation: ${link.canonicalHref}`)
  }

  await clickLink(adapter, currentLink)
  let afterState = await adapter.observe() as Record<string, unknown>
  let afterTab = await readChromeTabContext()
  afterState = patchStateUrlFromTab(afterState, afterTab)

  if (
    beforeTab
    && afterTab
    && afterTab.tabCount > beforeTab.tabCount
    && afterTab.url
    && isGoogleSearchUrl(afterTab.url)
  ) {
    const focused = await focusOpenedBackgroundTab(adapter, beforeTab, afterTab)
    afterTab = focused.tab
    afterState = patchStateUrlFromTab(focused.state, afterTab)
  }

  if (isGoogleSearchUrl(afterState.url)) {
    throw new Error(`Click did not open a visible result page: ${currentLink.canonicalHref}`)
  }
  afterState = await resolveBlockingPageState(adapter, trace, afterState, { phase: 'deep_dive_landing', query, rank })

  return {
    link: currentLink,
    beforeState,
    afterState,
    beforeTab,
    afterTab,
    observedUrl: afterState.url,
    title: afterState.title,
    visibleText: String(afterState.visibleText || '').slice(0, 2000),
    elementCount: elementsOf(afterState).length,
    links: collectLinks(afterState).slice(0, 10),
  }
}

async function returnToSearchResults(
  adapter: MacOSComputerUseAdapter,
  trace: TraceStep[],
  query: string,
  rank: number,
  expected: ChromeTabContext | null,
): Promise<Record<string, unknown>> {
  const beforeObserved = await adapter.observe() as Record<string, unknown>
  const startedAt = Date.now()
  const currentTab = await readChromeTabContext()
  const before = patchStateUrlFromTab(beforeObserved, currentTab)

  if (currentTab?.url && isGoogleSearchUrl(currentTab.url)) {
    const endedAt = Date.now()
    recordStep(trace, {
      phase: 'return_to_search_results',
      query,
      rank,
      startedAt,
      endedAt,
      decision: 'The active Chrome tab is already on Google Search; no return action is needed.',
      action: { type: 'wait' },
      before,
      after: before,
      result: {
        method: 'already_on_search_results',
        tabBeforeClick: expected,
        tabBeforeReturn: currentTab,
      },
    })
    return before
  }

  if (canCloseNewTabForReturn(currentTab, expected)) {
    await adapter.act({ type: 'press', key: 'w', modifiers: ['command'] })
    await sleep(1200)
    const afterTab = await readChromeTabContext()
    const after = patchStateUrlFromTab(await adapter.observe() as Record<string, unknown>, afterTab)
    try {
      assertUrlIsGoogleSearch(after.url)
      const endedAt = Date.now()
      recordStep(trace, {
        phase: 'return_to_search_results',
        query,
        rank,
        startedAt,
        endedAt,
        decision: 'The clicked result opened a new Chrome tab; close that tab with CGEvent Cmd+W to reveal the existing Google results tab.',
        action: { type: 'press', key: 'w', modifiers: ['command'] },
        before,
        after,
        result: {
          method: 'close_new_tab',
          tabBeforeClick: expected,
          tabBeforeReturn: currentTab,
          tabAfterReturn: afterTab,
        },
      })
      return after
    }
    catch {
      const endedAt = Date.now()
      recordStep(trace, {
        phase: 'return_to_search_results_error',
        query,
        rank,
        startedAt,
        endedAt,
        decision: 'Closed a newly opened tab but did not reveal the expected Google results page.',
        action: { type: 'press', key: 'w', modifiers: ['command'] },
        before,
        after,
        result: {
          method: 'close_new_tab',
          tabBeforeClick: expected,
          tabBeforeReturn: currentTab,
          tabAfterReturn: afterTab,
        },
        error: `Current URL after closing the new tab is not Google Search: ${String(after.url)}`,
      })
      throw new Error(`Could not return to Google Search after closing a new tab for rank ${rank}.`)
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    await adapter.act({ type: 'press', key: 'left', modifiers: ['command'] })
    await sleep(1200)
    const afterTab = await readChromeTabContext()
    const after = patchStateUrlFromTab(await adapter.observe() as Record<string, unknown>, afterTab)
    try {
      assertUrlIsGoogleSearch(after.url)
      const endedAt = Date.now()
      recordStep(trace, {
        phase: 'return_to_search_results',
        query,
        rank,
        startedAt,
        endedAt,
        decision: 'Return to the existing Google results page so the next deep dive can use fresh observed link coordinates.',
        action: { type: 'press', key: 'left', modifiers: ['command'] },
        before,
        after,
        result: { attempt: attempt + 1, url: after.url },
      })
      return after
    }
    catch {
      if (attempt === 2) {
        const endedAt = Date.now()
        recordStep(trace, {
          phase: 'return_to_search_results_error',
          query,
          rank,
          startedAt,
          endedAt,
          decision: 'Tried browser history back but did not return to Google Search.',
          action: { type: 'press', key: 'left', modifiers: ['command'] },
          before,
          after,
          error: `Current URL after browser back is not Google Search: ${String(after.url)}`,
        })
        throw new Error(`Could not return to Google Search after visiting rank ${rank}.`)
      }
    }
  }

  throw new Error('Unreachable return-to-search state.')
}

function selectCandidateForRank(
  currentLinks: CollectedLink[],
  plannedLinks: CollectedLink[],
  rank: number,
): CollectedLink | null {
  const planned = plannedLinks[rank - 1]
  if (!planned)
    return currentLinks[rank - 1] ?? null
  return currentLinks.find(link => link.canonicalHref === planned.canonicalHref)
    ?? currentLinks[rank - 1]
    ?? null
}

async function main() {
  const startedAt = new Date().toISOString()
  const ts = startedAt.replace(/[:.]/g, '-')
  const config = resolveComputerUseConfig()
  const sessionId = `company-discovery-${ts}`
  const traceDir = join(config.sessionRoot, 'traces', sessionId)
  await mkdir(traceDir, { recursive: true })
  const tracePath = join(traceDir, 'trace.json')

  const adapter = new MacOSComputerUseAdapter({
    sessionId,
    foregroundPolicy: 'auto_focus_chrome',
    config,
  })

  const trace: TraceStep[] = []
  let startup: Record<string, unknown> | null = null
  let status: 'running' | 'completed' | 'failed' | 'stopped' = 'running'
  let error: string | null = null

  try {
    startup = await ensureChromeReadyAtTaskStart(config)

    for (const query of SEARCH_QUERIES) {
      console.error(`\n=== Search: "${query}" ===`)
      await searchGoogle(adapter, config, query, trace)

      const initialResults = await collectSearchResultsWithScroll(adapter, trace, query)
      const plannedLinks = initialResults.links.slice(0, COMPANIES_PER_QUERY)

      recordStep(trace, {
        phase: 'search_results_capture',
        query,
        startedAt: Date.now(),
        endedAt: Date.now(),
        decision: 'Capture visible search results and plan deep dives from observed links.',
        action: { type: 'observe' },
        before: null,
        after: initialResults.state,
        result: {
          candidateCount: plannedLinks.length,
          candidates: plannedLinks.map((link, index) => ({
            rank: index + 1,
            text: link.text,
            href: link.href,
            canonicalHref: link.canonicalHref,
          })),
        },
      })

      for (let rank = 1; rank <= plannedLinks.length; rank++) {
        const refreshedResults = rank === 1
          ? initialResults
          : await collectSearchResultsWithScroll(adapter, trace, query)
        const link = selectCandidateForRank(refreshedResults.links, plannedLinks, rank)
        if (!link)
          break

        console.error(`  [deep-dive ${rank}/${plannedLinks.length}] Clicking: ${link.text.slice(0, 80)}`)

        const expectedTabContext = await readChromeTabContext()
        try {
          const siteStartedAt = Date.now()
          const siteObs = await visitByClick(adapter, link, trace, query, rank)
          const endedAt = Date.now()
          recordStep(trace, {
            phase: 'deep_dive_click',
            query,
            rank,
            startedAt: siteStartedAt,
            endedAt,
            decision: 'Follow the company candidate by clicking the observed search-result link, not by typing its URL.',
            action: actionForLink(siteObs.link),
            before: siteObs.beforeState,
            after: siteObs.afterState,
            result: {
              sourceHref: siteObs.link.href,
              canonicalHref: siteObs.link.canonicalHref,
              observedUrl: siteObs.observedUrl,
              title: siteObs.title,
              elementCount: siteObs.elementCount,
              tabBeforeClick: siteObs.beforeTab ?? expectedTabContext,
              tabAfterClick: siteObs.afterTab,
              visibleTextSnippet: siteObs.visibleText.slice(0, 500),
              links: siteObs.links.map(link => ({
                text: link.text,
                href: link.href,
                canonicalHref: link.canonicalHref,
              })),
            },
          })
        }
        catch (err) {
          const observed = await adapter.observe() as Record<string, unknown>
          const now = Date.now()
          recordStep(trace, {
            phase: 'deep_dive_error',
            query,
            rank,
            startedAt: now,
            endedAt: now,
            decision: 'Deep dive failed while trying to click an observed result link.',
            action: actionForLink(link),
            before: refreshedResults.state,
            after: observed,
            error: err instanceof Error ? err.message : String(err),
          })
        }

        if (rank < plannedLinks.length) {
          await returnToSearchResults(adapter, trace, query, rank, expectedTabContext)
        }
      }
    }
    status = 'completed'
  }
  catch (err) {
    if (err instanceof BlockingStopSignalError) {
      status = 'stopped'
      error = err.message
    }
    else {
      status = 'failed'
      error = err instanceof Error ? err.stack || err.message : String(err)
      throw err
    }
  }
  finally {
    await writeTraceFile(tracePath, {
      schemaVersion: 'computer-use-trace/v1',
      sessionId,
      task: 'company_discovery',
      status,
      error,
      startedAt,
      endedAt: new Date().toISOString(),
      startup,
      entries: trace,
    })
    console.error(`\n[trace] Full trace written to: ${tracePath}`)
    console.error(`        ${trace.length} trace entries across ${SEARCH_QUERIES.length} queries`)
  }
}

main().catch((error) => {
  console.error('[company-discovery] FAILED:', error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
