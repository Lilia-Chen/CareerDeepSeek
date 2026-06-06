import assert from 'node:assert/strict'

import { chromium } from 'playwright'
import { afterAll, beforeAll, it } from 'vitest'

import { captureDomSemanticObservation } from '../src/observation/domSemanticObserver.js'
import { normalizeDomSemanticObservation } from '../src/observation/browserObservation.js'
import type { Browser, Page } from 'playwright'

let browser: Browser
let page: Page

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({
    viewport: {
      width: 800,
      height: 600,
    },
  })
})

afterAll(async () => {
  await browser?.close()
})

it('captures DOM-visible ARIA-derived semantic elements without using native AX tree', async () => {
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <title>Observation fixture</title>
      </head>
      <body style="font-family: sans-serif; margin: 0;">
        <main aria-labelledby="title" style="padding: 40px;">
          <h1 id="title">Agent Runtime Careers</h1>
          <a id="careers" href="https://example.com/careers">Careers</a>
          <button id="search" aria-label="Search jobs">🔎</button>
          <label for="query">Keyword</label>
          <input id="query" placeholder="agent infrastructure" />
          <button id="hidden" style="display:none">Hidden action</button>
          <button id="offscreen" style="position:absolute; left:40px; top:900px;">Offscreen action</button>
          <button id="covered" style="position:absolute; left:40px; top:220px; width:180px; height:36px;">Covered action</button>
          <div style="position:absolute; left:40px; top:220px; width:180px; height:36px; background:white;">Cookie cover</div>
        </main>
      </body>
    </html>
  `)

  const observation = normalizeDomSemanticObservation(await page.evaluate(captureDomSemanticObservation, {
    maxElements: 40,
    maxVisibleTextLength: 2000,
  }))
  const byId = new Map(observation.elements.map(element => [element.id, element]))

  assert.equal(observation.source, 'dom_aria_approx')
  assert.equal(observation.title, 'Observation fixture')
  assert.equal(byId.get('search')?.role, 'button')
  assert.equal(byId.get('search')?.name, 'Search jobs')
  assert.equal(byId.get('query')?.role, 'textbox')
  assert.equal(byId.get('query')?.name, 'Keyword')
  assert.equal(byId.get('careers')?.role, 'link')
  assert.equal(byId.has('hidden'), false)
  assert.equal(byId.has('offscreen'), false)
  assert.equal(byId.has('covered'), false)
  assert.ok(observation.notes.some(note => note.includes('not native browser AX tree')))
})
