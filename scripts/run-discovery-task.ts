#!/usr/bin/env node

import process from 'node:process'

import {
  MacOSChromeDriver,
  promoteChromeCandidate,
  resolveComputerUseConfig,
} from '../src/computer-use/index.js'
import type { MacOSChromeObservationSnapshot } from '../src/computer-use/index.js'

const query = process.argv.slice(2).join(' ').trim()
  || 'AI agent infrastructure companies hiring 2026'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
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
  await sleep(3000)
}

async function searchGoogle(driver: MacOSChromeDriver, text: string): Promise<void> {
  const searchBox = await driver.recognizeLegacy({
    kind: 'text_input',
    name: /^search$/i,
  })
  await driver.clickLegacy(promoteChromeCandidate(searchBox))
  await sleep(300)
  await driver.typeText(text)
  await driver.pressKey('enter')
  await sleep(3500)
}

function assertGoogleSearch(snapshot: MacOSChromeObservationSnapshot): void {
  const url = snapshot.chromeContext.activeTabUrl
  if (!url)
    throw new Error('Expected Chrome active tab URL after Google search.')
  const parsed = new URL(url)
  if (!parsed.hostname.includes('google.') || parsed.pathname !== '/search') {
    throw new Error(`Expected Google Search URL, got: ${url}`)
  }
}

function organicLinks(snapshot: MacOSChromeObservationSnapshot): Array<{
  rank: number
  text: string
  href: string
}> {
  const links = snapshot.chromeDomObservation?.elements.filter((element) => {
    if (element.role !== 'link' || !element.href)
      return false
    const href = element.href
    return href.startsWith('http')
      && !href.includes('google.com')
      && !href.includes('googleadservices')
  }) ?? []

  return links.slice(0, 15).map((element, index) => ({
    rank: index + 1,
    text: (element.name || element.text || '').slice(0, 160),
    href: element.href!,
  }))
}

async function main(): Promise<void> {
  const sessionId = `discovery-${Date.now()}`
  const config = resolveComputerUseConfig()
  const driver = new MacOSChromeDriver({
    sessionId,
    config,
    foregroundPolicy: 'auto_focus_chrome',
  })

  console.error(`[discovery] Session: ${sessionId}`)
  console.error(`[discovery] Query: "${query}"`)
  console.error('[discovery] Navigating to Google through observed address bar...')
  await navigateViaObservedAddressBar(driver, 'google.com')

  console.error('[discovery] Recognizing Google search box and submitting query...')
  await searchGoogle(driver, query)

  console.error('[discovery] Observing results...')
  const results = await driver.observeLegacy()
  assertGoogleSearch(results)
  const links = organicLinks(results)

  console.info(JSON.stringify({
    ok: true,
    session: sessionId,
    query,
    page: {
      url: results.chromeContext.activeTabUrl,
      title: results.chromeContext.activeTabTitle,
    },
    resultCount: links.length,
    results: links,
    visibleTextPreview: results.visibleText.slice(0, 500),
    signals: results.signals,
    screenshot: {
      path: results.capture.screenshot.path,
      width: results.capture.screenshot.width,
      height: results.capture.screenshot.height,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error('[discovery] FAILED:', error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
