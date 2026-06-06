import { createHash } from 'node:crypto'
import process from 'node:process'

import { chromium } from 'playwright'

import { captureCdpDebugObservation } from '../src/observation/cdpDebugObserver.js'
import { captureDomSemanticObservation } from '../src/observation/domSemanticObserver.js'
import { normalizeDomSemanticObservation } from '../src/observation/browserObservation.js'

const headless = process.env.CAREERDEEPSEEK_OBSERVER_HEADLESS === 'true'

const html = `<!doctype html>
<html>
  <head>
    <title>CareerDeepSeek Browser Observation Experiment</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; }
      main { padding: 32px; }
      .covered { position: absolute; left: 32px; top: 260px; width: 180px; height: 40px; }
      .cover { position: absolute; left: 32px; top: 260px; width: 180px; height: 40px; background: white; z-index: 2; }
    </style>
  </head>
  <body>
    <main aria-labelledby="page-title">
      <h1 id="page-title">Agent Runtime Careers</h1>
      <p>Hiring engineers for memory, browser observation, and evaluation infrastructure.</p>
      <a id="careers-link" href="https://example.test/careers">Open careers</a>
      <button id="search" aria-label="Search jobs">🔎</button>
      <label for="query">Keyword</label>
      <input id="query" name="query" placeholder="agent infrastructure">
      <button id="hidden" style="display: none;">Hidden action</button>
      <button id="offscreen" style="position:absolute; top: 1200px;">Offscreen action</button>
      <button id="covered" class="covered">Covered action</button>
      <div class="cover">Cookie banner cover</div>
    </main>
  </body>
</html>`

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless })
  const page = await browser.newPage({
    viewport: {
      width: 900,
      height: 700,
    },
  })

  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' })

    const [domObservationRaw, screenshotBuffer] = await Promise.all([
      page.evaluate(captureDomSemanticObservation, {
        maxElements: 80,
        maxVisibleTextLength: 4000,
      }),
      page.screenshot({ type: 'png' }),
    ])
    const domObservation = normalizeDomSemanticObservation(domObservationRaw)
    const cdpSession = await page.context().newCDPSession(page)
    const cdpObservation = await captureCdpDebugObservation({
      session: {
        send: async (method, params) => await cdpSession.send(method as never, params as never),
      },
      maxAxDepth: 5,
      maxAxNodes: 120,
      includeDomSnapshot: true,
      includeScreenshot: true,
    })

    await cdpSession.detach()

    const summary = {
      ok: true,
      browser: {
        engine: 'chromium',
        headless,
      },
      defaultObservation: {
        source: domObservation.source,
        elementCount: domObservation.elements.length,
        roles: unique(domObservation.elements.map(element => element.role)),
        names: domObservation.elements.map(element => element.name).filter(Boolean),
        screenshot: {
          source: 'playwright_page_screenshot',
          format: 'png',
          byteLength: screenshotBuffer.byteLength,
          sha256: createHash('sha256').update(screenshotBuffer).digest('hex').slice(0, 16),
        },
        excludedAsExpected: {
          hiddenButton: !domObservation.elements.some(element => element.id === 'hidden'),
          offscreenButton: !domObservation.elements.some(element => element.id === 'offscreen'),
          coveredButton: !domObservation.elements.some(element => element.id === 'covered'),
        },
      },
      cdpDebugObservation: {
        source: cdpObservation.source,
        commands: cdpObservation.commands,
        axNodeCount: cdpObservation.axTree.nodeCount,
        axSample: cdpObservation.axTree.nodes
          .filter(node => node.role || node.name)
          .slice(0, 12)
          .map(node => ({
            role: node.role,
            name: node.name,
            ignored: node.ignored,
          })),
        domSnapshot: cdpObservation.domSnapshot,
        screenshot: cdpObservation.screenshot,
      },
      boundary: {
        defaultLayer: 'DOM-visible tree + ARIA/HTML semantic approximation + screenshot metadata.',
        debugLayer: 'CDP native AX + DOMSnapshot + screenshot metadata through read-only allowlisted commands.',
      },
    }

    console.info(JSON.stringify(summary, null, 2))
  }
  finally {
    await browser.close()
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

await main()
