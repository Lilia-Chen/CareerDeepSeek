#!/usr/bin/env node

import process from 'node:process'

import {
  MacOSChromeDriver,
  promoteChromeCandidate,
  resolveComputerUseConfig,
} from '../src/computer-use/index.js'

const targetUrl = process.argv[2] || 'https://example.com'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeOrigin(value: string): string {
  return new URL(value).origin
}

async function navigateViaObservedAddressBar(
  driver: MacOSChromeDriver,
  url: string,
): Promise<void> {
  const addressBar = await driver.recognizeLegacy({
    kind: 'text_input',
    name: /address and search bar/i,
  })
  await driver.clickLegacy(promoteChromeCandidate(addressBar))
  await sleep(250)
  await driver.pressKey('l', ['command'])
  await sleep(250)
  await driver.typeText(url)
  await driver.pressKey('enter')
}

async function main(): Promise<void> {
  const sessionId = `smoke-${Date.now()}`
  const config = resolveComputerUseConfig()
  const driver = new MacOSChromeDriver({
    sessionId,
    config,
    foregroundPolicy: 'auto_focus_chrome',
  })

  console.error(`[smoke] Session: ${sessionId}`)
  console.error(`[smoke] Target: ${targetUrl}`)
  console.error('[smoke] Observing Chrome...')
  const before = await driver.observeLegacy()
  console.error(`[smoke] Initial screenshot: ${before.capture.screenshot.path}`)

  console.error('[smoke] Navigating through recognized address bar...')
  await navigateViaObservedAddressBar(driver, targetUrl)
  await sleep(3000)

  console.error('[smoke] Capturing final observation...')
  const after = await driver.observeLegacy()
  const observedUrl = after.chromeContext.activeTabUrl
  if (!observedUrl) {
    throw new Error('Navigation failed: Chrome active tab URL is unavailable.')
  }
  if (normalizeOrigin(observedUrl) !== normalizeOrigin(targetUrl)) {
    throw new Error(`Navigation failed: expected ${targetUrl}, observed ${observedUrl}.`)
  }

  console.info(JSON.stringify({
    ok: true,
    sessionId,
    targetUrl,
    observed: {
      url: observedUrl,
      title: after.chromeContext.activeTabTitle,
      screenshot: {
        path: after.capture.screenshot.path,
        width: after.capture.screenshot.width,
        height: after.capture.screenshot.height,
      },
      chromeWindow: after.chromeContext.window,
      ocrTextCount: after.ocr.matches.length,
      domElementCount: after.chromeDomObservation?.elements.length ?? 0,
      visibleTextPreview: after.visibleText.slice(0, 300),
      signals: after.signals,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error('[smoke] FAILED:', error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
