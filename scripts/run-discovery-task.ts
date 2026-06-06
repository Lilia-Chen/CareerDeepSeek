#!/usr/bin/env node
/**
 * Computer-use discovery task — perform a real Google search and observe results.
 *
 * Steps:
 *   1. Capture the desktop, then open or activate Google Chrome
 *   2. Confirm Chrome is frontmost and capture another screenshot
 *   3. Navigate to google.com via the observed Chrome address bar
 *   4. Find the observed Google search box, click it, type the query, Enter
 *   5. Observe search results page
 *
 * Usage:
 *   pnpm exec tsx scripts/run-discovery-task.ts "AI agent infrastructure hiring 2026"
 */

import process from 'node:process'
import { captureAXTree, captureScreenshot, executeOpenApp, MacOSComputerUseAdapter, observeWindows, resolveComputerUseConfig } from '../src/computer-use/index.js'
import type { AXNode, Bounds, ComputerUseConfig, WindowDescriptor } from '../src/computer-use/index.js'

const query = process.argv[2] || 'AI agent infrastructure companies hiring 2026'

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Chrome window & AX helpers
// ---------------------------------------------------------------------------

async function findVisibleChromeWindow(config: ComputerUseConfig): Promise<WindowDescriptor> {
  const window = await findVisibleChromeWindowOrNull(config)
  if (!window) {
    throw new Error('No visible Google Chrome window found after task startup.')
  }
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

async function ensureChromeReadyAtTaskStart(config: ComputerUseConfig): Promise<void> {
  const initialScreenshot = await captureScreenshot(config, 'task_start_before_chrome_context')
  console.error(`[discovery] Initial desktop screenshot: ${initialScreenshot.path}`)

  const current = await observeWindows(config, { limit: 120 })
  const hasVisibleChrome = current.windows.some(window =>
    window.appName.toLowerCase().includes('chrome')
    && window.isOnScreen
    && window.bounds.width >= 480
    && window.bounds.height >= 300,
  )
  if (hasVisibleChrome && current.frontmostAppName?.toLowerCase().includes('chrome')) {
    const confirmedScreenshot = await captureScreenshot(config, 'task_start_chrome_frontmost')
    console.error(`[discovery] Confirmed Chrome frontmost screenshot: ${confirmedScreenshot.path}`)
    return
  }

  await executeOpenApp(config, 'Google Chrome')

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
      const confirmedScreenshot = await captureScreenshot(config, 'task_start_chrome_frontmost')
      console.error(`[discovery] Confirmed Chrome frontmost screenshot: ${confirmedScreenshot.path}`)
      return
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

// ---------------------------------------------------------------------------
// Navigation: address bar
// ---------------------------------------------------------------------------

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

  // Wait for the address bar value to match
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
    if (!ab.node.focused || actual !== expected) {
      return
    }
  }

  throw new Error('Navigation failed: Enter did not submit the observed address bar value.')
}

// ---------------------------------------------------------------------------
// Google search box interaction
// ---------------------------------------------------------------------------

function findGoogleSearchBox(elements: Array<Record<string, unknown>>): Record<string, unknown> | null {
  return elements.find(el =>
    (el.role === 'combobox' || el.role === 'searchbox' || el.role === 'textbox')
    && String(el.text || '').toLowerCase().includes('search'),
  ) ?? null
}

async function searchGoogle(
  adapter: MacOSComputerUseAdapter,
  state: Record<string, unknown>,
): Promise<void> {
  const elements = (state.elements || []) as Array<Record<string, unknown>>
  const searchBox = findGoogleSearchBox(elements)
  if (!searchBox)
    throw new Error('Could not find Google search box on page.')

  console.error(`      Search box: ${searchBox.role} "${String(searchBox.text || '').slice(0, 60)}"`)
  const center = (searchBox.center || searchBox.box) as { x: number, y: number }

  await adapter.act({
    type: 'click',
    elementId: String(searchBox.id),
    point: { x: center.x, y: center.y },
    target: { role: String(searchBox.role), text: String(searchBox.text || ''), href: null, intent: null },
  })
  await sleep(400)

  await adapter.act({ type: 'type', text: query })
  await sleep(200)
  await adapter.act({ type: 'press', key: 'enter' })
  await sleep(3500)
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function assertUrlIsGoogleSearch(url: unknown): void {
  if (typeof url !== 'string')
    throw new TypeError('Expected a URL string.')
  const u = new URL(url)
  if (!u.hostname.startsWith('www.google.') || u.pathname !== '/search') {
    throw new Error(`Expected Google Search URL, got: ${url}`)
  }
}

function assertUrlIsGoogle(url: unknown): void {
  if (typeof url !== 'string')
    throw new TypeError('Expected a URL string.')
  const u = new URL(url)
  if (!u.hostname.includes('google.')) {
    throw new Error(`Expected google.com, got: ${url}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sessionId = `discovery-${Date.now()}`
  console.error(`[discovery] Session: ${sessionId}`)
  console.error(`[discovery] Query: "${query}"`)
  console.error('')

  const config = resolveComputerUseConfig()
  const adapter = new MacOSComputerUseAdapter({
    sessionId,
    config,
    foregroundPolicy: 'auto_focus_chrome',
  })

  console.error('[0/4] Ensuring Google Chrome is open and frontmost...')
  await ensureChromeReadyAtTaskStart(config)

  // Step 1: Navigate to google.com (short URL, reliable)
  console.error('[1/4] Navigating to google.com...')
  await navigateToUrl(adapter, config, 'google.com')

  // Step 2: Observe Google homepage, verify, find search box
  console.error('[2/4] Observing Google homepage...')
  const googleState = await adapter.observe() as Record<string, unknown>
  assertUrlIsGoogle(googleState.url)
  console.error(`      Page: ${googleState.title} | ${(googleState.elements as Array<unknown>).length} elements`)

  // Step 3: Click search box, type query, Enter
  console.error('[3/4] Searching Google...')
  await searchGoogle(adapter, googleState)

  // Step 4: Observe search results
  console.error('[4/4] Observing search results...')
  const resultsState = await adapter.observe() as Record<string, unknown>
  assertUrlIsGoogleSearch(resultsState.url)

  const resultsElements = (resultsState.elements || []) as Array<Record<string, unknown>>
  const visibleText = String(resultsState.visibleText || '')

  const links = resultsElements.filter(el =>
    el.role === 'link' && el.href && String(el.href).startsWith('http'),
  )
  const organicLinks = links.filter((el) => {
    const href = String(el.href || '')
    return !href.includes('google.com') && !href.includes('googleadservices')
  })

  console.error(`      Page: ${resultsState.title}`)
  console.error(`      Found ${resultsElements.length} elements, ${links.length} links, ${organicLinks.length} organic`)
  console.error('')

  console.info(JSON.stringify({
    ok: true,
    session: sessionId,
    query,
    page: { url: resultsState.url, title: resultsState.title },
    resultCount: organicLinks.length,
    results: organicLinks.slice(0, 15).map((el, i) => ({
      rank: i + 1,
      text: String(el.text || '').slice(0, 120),
      href: el.href,
    })),
    visibleTextPreview: visibleText.slice(0, 500),
    signals: resultsState.signals,
    screenshot: resultsState.screenshot
      ? { id: (resultsState.screenshot as { id: string }).id, width: (resultsState.screenshot as { width: number }).width, height: (resultsState.screenshot as { height: number }).height }
      : null,
  }, null, 2))
}

main().catch((error) => {
  console.error('[discovery] FAILED:', error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
