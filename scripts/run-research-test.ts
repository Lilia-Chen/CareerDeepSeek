/**
 * Research Test — validates the two-path driver on a real company research task.
 *
 * Usage: pnpm exec tsx scripts/run-research-test.ts
 *
 * Orchestration & semantic layer: Claude (manual in this session)
 * Driver layer: MacOSChromeDriver (new two-path API)
 */

import { MacOSChromeDriver } from '../src/computer-use/macos-chrome-driver/index.js'
import type {
  ChromeWindowCapture,
  ObservationSnapshot,
  RecognitionResult,
  SurfaceNode,
} from '../src/computer-use/macos-chrome-driver/types.js'

const QUERY = 'AI agent infrastructure companies hiring 2026'
const SESSION_ID = `research-test-${Date.now()}`
const NAV_TIMEOUT_MS = 3000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

function summarizeObservation(snapshot: ObservationSnapshot): void {
  const ctx = snapshot.detail?.chrome_context as Record<string, unknown> | undefined
  const signals = snapshot.detail?.signals as string[] | undefined
  const url = ctx?.active_tab_url ?? 'unknown'
  const title = ctx?.active_tab_title ?? 'unknown'
  log(`  Page: ${title} | ${url}`)
  log(`  Nodes: ${snapshot.nodes.length} (source: ${snapshot.source})`)
  log(`  Signals: ${signals?.join(', ') ?? 'none'}`)

  const actionable = snapshot.nodes.filter(n =>
    n.kind.startsWith('dom_button') || n.kind.startsWith('dom_link') || n.recognition_source === 'ocr_text',
  )
  log(`  Actionable/text nodes: ${actionable.length}`)
  for (const node of actionable.slice(0, 10)) {
    const label = (node.label ?? '').slice(0, 80)
    const href = node.detail?.href ? ` → ${node.detail.href}` : ''
    log(`    [${node.kind}] "${label}"${href}`)
  }
  if (actionable.length > 10) {
    log(`    ... and ${actionable.length - 10} more`)
  }
}

function summarizeRecognition(result: RecognitionResult, targetDesc: string): void {
  if (result.found && result.best) {
    const b = result.best
    log(`  ✓ Found "${targetDesc}": [${b.kind}] "${b.text}" score=${b.provider_score}`)
  } else {
    log(`  ✗ Not found "${targetDesc}" — filtered=${result.filtered.length} all=${result.all.length}`)
    if (result.filtered.length > 0) {
      log('    Top filtered items:')
      for (const item of result.filtered.slice(0, 3)) {
        log(`      [${item.kind}] "${item.text}" score=${item.provider_score}`)
      }
    }
  }
}

async function clickCandidate(
  driver: MacOSChromeDriver,
  capture: ChromeWindowCapture,
  recognition: RecognitionResult,
  targetDesc: string,
): Promise<boolean> {
  const promotion = await driver.promoteCandidate(recognition, capture)
  if (promotion.status === 'refused') {
    log(`  ⛔ Promotion refused for "${targetDesc}": ${promotion.reasons.join(', ')}`)
    return false
  }

  log(`  ✓ Promoted → ${promotion.candidate.kind} "${promotion.candidate.label}"`)
  try {
    await driver.click(promotion.candidate)
    log(`  ✓ Clicked`)
    return true
  } catch (err) {
    log(`  ✗ Click failed: ${(err as Error).message}`)
    return false
  }
}

async function navigateToUrl(driver: MacOSChromeDriver, url: string): Promise<void> {
  log(`  Navigating to ${url}`)
  await driver.pressKey('l', ['command'])
  await sleep(500)
  await driver.typeText(url)
  await sleep(300)
  await driver.pressKey('enter')
  await sleep(NAV_TIMEOUT_MS)
}

async function main(): Promise<void> {
  log(`Starting research test — session: ${SESSION_ID}`)
  log(`Query: "${QUERY}"`)

  const driver = new MacOSChromeDriver({
    sessionId: SESSION_ID,
    foregroundPolicy: 'auto_focus_chrome',
  })

  try {
    // ── Phase 1: Search Google ──
    log('\n── Phase 1: Search Google ──')

    log('Observing Chrome state...')
    await driver.observe()

    log('Navigating to google.com...')
    await navigateToUrl(driver, 'google.com')

    log('Observing Google home...')
    await driver.observe()

    log('Recognizing search box...')
    const googleHomeCapture = driver.lastCapture!
    const searchBoxRecognition = await driver.recognizeFromCapture(googleHomeCapture, {
      kind: 'text_input',
      name: /search/i,
    })
    summarizeRecognition(searchBoxRecognition, 'search box')

    if (searchBoxRecognition.found) {
      await clickCandidate(driver, googleHomeCapture, searchBoxRecognition, 'search box')
      await sleep(500)
    }

    log(`Typing query: "${QUERY}"`)
    await driver.typeText(QUERY)
    await sleep(300)
    await driver.pressKey('enter')
    await sleep(NAV_TIMEOUT_MS)

    log('Observing search results...')
    const searchSnapshot = await driver.observe()
    summarizeObservation(searchSnapshot)

    // ── Phase 2: Extract and score links ──
    log('\n── Phase 2: Extract search result links ──')

    const links = searchSnapshot.nodes.filter(n =>
      n.kind === 'dom_link' || (n.recognition_source === 'ocr_text' && n.label && n.label.length > 15),
    )
    log(`Found ${links.length} potential links`)

    const candidateLinks: Array<{ node: SurfaceNode; score: number }> = []
    for (const node of links) {
      const label = node.label ?? ''
      let score = 0
      if (/agent|infrastructure|platform/i.test(label)) score += 3
      if (/hiring|career|job/i.test(label)) score += 2
      if (/2026|top|best/i.test(label)) score += 1
      if (/sponsored|ad|google/i.test(label)) score -= 5
      if (label.length < 10) score -= 3
      if (score > 0) candidateLinks.push({ node, score })
    }
    candidateLinks.sort((a, b) => b.score - a.score)

    log('Top candidate links:')
    for (const { node, score } of candidateLinks.slice(0, 8)) {
      const href = node.detail?.href ? ` → ${node.detail.href}` : ''
      log(`  [score=${score}] "${(node.label ?? '').slice(0, 100)}"${href}`)
    }

    // ── Phase 3: Deep-dive top companies ──
    log('\n── Phase 3: Company deep-dives ──')

    const companyFindings: Array<Record<string, unknown>> = []
    const targets = candidateLinks.slice(0, 3)

    for (let i = 0; i < targets.length; i++) {
      const { node, score } = targets[i]!
      const label = (node.label ?? '').slice(0, 80)
      log(`\n--- Company ${i + 1}: "${label}" [score=${score}] ---`)

      // Re-observe search page for fresh capture (avoids stale_capture)
      log('  Re-observing search page for fresh capture...')
      const freshSearchObs = await driver.observe()
      const freshCapture = driver.lastCapture!
      log(`  Fresh capture: ${freshSearchObs.nodes.length} nodes`)

      // Try clicking the link text
      const linkRecognition = await driver.recognizeFromCapture(
        freshCapture,
        { kind: 'visible_text', text: label.slice(0, 40) },
      )
      summarizeRecognition(linkRecognition, label)

      if (linkRecognition.found) {
        const clicked = await clickCandidate(driver, freshCapture, linkRecognition, label)
        if (clicked) {
          await sleep(NAV_TIMEOUT_MS)

          // Observe company page
          log('  Observing company page...')
          const companyPage = await driver.observe()
          summarizeObservation(companyPage)

          // Scroll for more content
          log('  Scrolling...')
          await driver.scroll(600)
          await sleep(1000)
          const pageAfterScroll = await driver.observe()
          log('  After scroll:')
          summarizeObservation(pageAfterScroll)

          // Collect career-related nodes
          const careersNodes = pageAfterScroll.nodes.filter(n => {
            const text = (n.label ?? '').toLowerCase()
            return /career|job|hiring|team|about|work/i.test(text)
          })

          companyFindings.push({
            label,
            score,
            url: (pageAfterScroll.detail?.chrome_context as Record<string, unknown>)?.active_tab_url ?? 'unknown',
            totalNodes: pageAfterScroll.nodes.length,
            source: pageAfterScroll.source,
            careersNodes: careersNodes.slice(0, 8).map(n => ({
              kind: n.kind,
              label: n.label,
              href: n.detail?.href ?? null,
            })),
          })

          // Go back
          log('  Going back...')
          await driver.pressKey('[', ['command'])
          await sleep(1500)
        } else {
          companyFindings.push({ label, score, status: 'click_failed' })
        }
      } else {
        companyFindings.push({ label, score, status: 'recognition_failed' })
      }
    }

    // ── Phase 4: Research Report ──
    log('\n')
    log('='.repeat(60))
    log('         COMPANY RESEARCH REPORT')
    log('='.repeat(60))
    log(`Query: "${QUERY}"`)
    log(`Date: ${new Date().toISOString()}`)
    log(`Companies researched: ${companyFindings.length}`)
    log('='.repeat(60))

    for (let i = 0; i < companyFindings.length; i++) {
      const f = companyFindings[i]!
      log(`\n## Company ${i + 1}: ${f.label}`)
      log(`   Relevance score: ${f.score}`)
      log(`   URL: ${f.url ?? 'N/A'}`)
      log(`   Status: ${f.status ?? 'visited'}`)

      if (f.totalNodes !== undefined) {
        log(`   Page nodes: ${f.totalNodes} (source: ${f.source})`)
      }

      const careersNodes = f.careersNodes as Array<Record<string, unknown>> | undefined
      if (careersNodes && careersNodes.length > 0) {
        log('   Career-related elements found:')
        for (const cn of careersNodes) {
          log(`     - [${cn.kind}] "${cn.label}"`)
          if (cn.href) log(`       → ${cn.href}`)
        }
      }

      if (f.status === 'visited' && (!careersNodes || careersNodes.length === 0)) {
        log('   ⚠ No career-related elements on visible page')
      }
    }

    log('\n── Recommendations ──')
    const succeeded = companyFindings.filter(f => f.status === 'visited' || !f.status)
    if (succeeded.length >= 2) {
      log('✅ TEST PASSED: Successfully researched 2+ companies')
    } else {
      log('⚠ TEST PARTIAL: Fewer than 2 companies fully researched')
    }

    log(`\nTrace files: .computer-use/traces/${SESSION_ID}/`)

  } catch (err) {
    log(`FATAL: ${(err as Error).message}`)
    console.error(err)
  }
}

main()
