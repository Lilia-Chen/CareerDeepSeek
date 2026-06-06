#!/usr/bin/env node
/**
 * Computer-use end-to-end smoke test.
 *
 * Steps:
 *   1. Capture the desktop, then open or activate Google Chrome
 *   2. Confirm Chrome is frontmost and capture another screenshot
 *   3. Find the Chrome address bar from AX bounds and click its observed center
 *   4. Navigate by typing the URL into the address bar
 *   5. Observe (screenshot + windows + AX + Chrome DOM)
 *   6. Print structured observation summary
 *
 * Usage:
 *   pnpm exec tsx scripts/run-computer-use-smoke.ts [url]
 *
 * Default URL: https://example.com
 */

import process from 'node:process'
import { captureAXTree, captureScreenshot, executeOpenApp, MacOSComputerUseAdapter, observeWindows, resolveComputerUseConfig } from '../src/computer-use/index.js'
import type { AXNode, Bounds, ComputerUseConfig, WindowDescriptor } from '../src/computer-use/index.js'

const targetUrl = process.argv[2] || 'https://example.com'

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function findVisibleChromeWindow(config: ComputerUseConfig): Promise<WindowDescriptor> {
  const window = await findVisibleChromeWindowOrNull(config)
  if (!window) {
    throw new Error('No visible Google Chrome window found after task startup.')
  }
  return window
}

async function findVisibleChromeWindowOrNull(config: ComputerUseConfig): Promise<WindowDescriptor | null> {
  const obs = await observeWindows(config, { limit: 120 })
  return obs.windows.find(window =>
    window.appName.toLowerCase().includes('chrome')
    && window.isOnScreen
    && window.bounds.width >= 480
    && window.bounds.height >= 300,
  ) ?? null
}

async function ensureChromeReadyAtTaskStart(config: ComputerUseConfig): Promise<void> {
  const initialScreenshot = await captureScreenshot(config, 'task_start_before_chrome_context')
  console.error(`[smoke] Initial desktop screenshot: ${initialScreenshot.path}`)

  const current = await observeWindows(config, { limit: 120 })
  const hasVisibleChrome = current.windows.some(window =>
    window.appName.toLowerCase().includes('chrome')
    && window.isOnScreen
    && window.bounds.width >= 480
    && window.bounds.height >= 300,
  )
  if (hasVisibleChrome && current.frontmostAppName?.toLowerCase().includes('chrome')) {
    const confirmedScreenshot = await captureScreenshot(config, 'task_start_chrome_frontmost')
    console.error(`[smoke] Confirmed Chrome frontmost screenshot: ${confirmedScreenshot.path}`)
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
      console.error(`[smoke] Confirmed Chrome frontmost screenshot: ${confirmedScreenshot.path}`)
      return
    }
  }

  throw new Error('Could not open or activate Google Chrome at task startup.')
}

async function focusChromeWindow(
  adapter: MacOSComputerUseAdapter,
  config: ComputerUseConfig,
): Promise<void> {
  const window = await findVisibleChromeWindow(config)
  const addressBar = await findChromeAddressBarBounds(config, window)
  await adapter.act({
    type: 'click',
    elementId: 'chrome-address-bar',
    point: {
      x: addressBar.x + addressBar.width / 2,
      y: addressBar.y + addressBar.height / 2,
    },
    target: {
      role: 'address_bar',
      text: 'Address and search bar',
      href: null,
      intent: null,
    },
  })
  await sleep(300)
}

async function findChromeAddressBarBounds(
  config: ComputerUseConfig,
  window: WindowDescriptor,
): Promise<Bounds> {
  const ax = await captureAXTree(config, { pid: window.ownerPid, maxDepth: 12, maxNodes: 3000 })
  const node = findAddressBarNode(ax.root)
  if (!node?.bounds) {
    throw new Error('Could not find Chrome address bar in AX tree.')
  }
  return node.bounds
}

function findAddressBarNode(node: AXNode): AXNode | null {
  const description = node.description ?? ''
  const title = node.title ?? ''
  if (
    node.role === 'AXTextField'
    && node.bounds
    && node.bounds.width > 0
    && node.bounds.height > 0
    && /address and search bar/i.test(`${description} ${title}`)
  ) {
    return node
  }

  for (const child of node.children) {
    const match = findAddressBarNode(child)
    if (match)
      return match
  }
  return null
}

async function navigateAddressBar(
  adapter: MacOSComputerUseAdapter,
  config: ComputerUseConfig,
  url: string,
): Promise<void> {
  const window = await findVisibleChromeWindow(config)
  await adapter.act({ type: 'press', key: 'l', modifiers: ['command'] })
  await sleep(250)
  await adapter.act({ type: 'type', text: url })
  await waitForAddressBarValue(config, window, url)
  await submitAddressBar(adapter, config, window, url)
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

    const ax = await captureAXTree(config, { pid: window.ownerPid, maxDepth: 12, maxNodes: 3000 })
    const node = findAddressBarNode(ax.root)
    const actual = normalizeAddressValue(node?.value ?? '')
    if (!node?.focused || actual !== expected) {
      return
    }
  }
  throw new Error('Navigation failed: Enter did not submit the observed address bar value.')
}

async function waitForAddressBarValue(
  config: ComputerUseConfig,
  window: WindowDescriptor,
  expectedUrl: string,
): Promise<void> {
  const expected = normalizeAddressValue(expectedUrl)
  const startedAt = Date.now()
  while (Date.now() - startedAt < 3000) {
    const ax = await captureAXTree(config, { pid: window.ownerPid, maxDepth: 12, maxNodes: 3000 })
    const node = findAddressBarNode(ax.root)
    const actual = normalizeAddressValue(node?.value ?? '')
    if (node?.focused && actual === expected) {
      return
    }
    await sleep(150)
  }
  throw new Error('Navigation failed: address bar did not contain the requested URL before Enter.')
}

function normalizeAddressValue(value: string): string {
  return value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
}

function assertObservedUrlMatchesTarget(observedUrl: unknown, targetUrl: string): void {
  if (typeof observedUrl !== 'string') {
    throw new TypeError('Navigation failed: observed state did not include a URL.')
  }

  const observed = new URL(observedUrl)
  const target = new URL(targetUrl)
  if (observed.origin !== target.origin) {
    throw new Error(`Navigation failed: expected origin ${target.origin}, observed ${observed.origin}.`)
  }
}

async function main() {
  const sessionId = `smoke-${Date.now()}`
  console.error(`[smoke] Session: ${sessionId}`)
  console.error(`[smoke] Target: ${targetUrl}`)

  const config = resolveComputerUseConfig()
  const adapter = new MacOSComputerUseAdapter({
    sessionId,
    config,
    foregroundPolicy: 'auto_focus_chrome',
  })

  console.error('[smoke] Ensuring Google Chrome is open and frontmost...')
  await ensureChromeReadyAtTaskStart(config)
  console.error('[smoke] Focusing visible Chrome window...')
  await focusChromeWindow(adapter, config)
  console.error('[smoke] Navigating through address bar with keyboard input...')
  await navigateAddressBar(adapter, config, targetUrl)
  console.error('[smoke] Waiting 3s for page load...')
  await sleep(3000)

  // Step 2: Observe
  console.error('[smoke] Capturing observation...')
  const rawState = await adapter.observe()
  const state = rawState as Record<string, unknown>
  assertObservedUrlMatchesTarget(state.url, targetUrl)

  const screenshot = state.screenshot as { id: string, width: number, height: number } | undefined
  const elements = state.elements as Array<Record<string, unknown>> | undefined

  console.info(JSON.stringify({
    ok: true,
    sessionId,
    targetUrl,
    observed: {
      url: state.url,
      title: state.title,
      sourceType: state.sourceType,
      observedAt: state.observedAt,
      screenshot: screenshot ? { id: screenshot.id, width: screenshot.width, height: screenshot.height } : null,
      elementCount: elements?.length ?? 0,
      elements: elements?.slice(0, 20).map(el => ({
        id: el.id,
        role: el.role,
        text: typeof el.text === 'string' ? el.text.slice(0, 80) : '',
        bounds: el.box,
      })),
      visibleTextPreview: typeof state.visibleText === 'string'
        ? state.visibleText.slice(0, 300)
        : '',
      signals: state.signals,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error('[smoke] FAILED:', error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
