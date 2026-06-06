import assert from 'node:assert/strict'
import { afterAll, beforeAll, it } from 'vitest'
import { chromium } from 'playwright'
import { createBrowserUseAdapter } from '../src/automation/browserUseAdapter.js'
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

it('observes only viewport-visible and interactable DOM candidates with screenshot metadata', async () => {
  await page.setContent(`
    <!doctype html>
    <html>
      <body style="font-family: sans-serif; margin: 0;">
        <main>
          <a id="visible-careers" href="https://example.com/careers" style="position:absolute; left:40px; top:40px; width:180px; height:32px;">
            AI Careers
          </a>
          <button id="disabled-button" disabled style="position:absolute; left:40px; top:90px; width:160px; height:32px;">
            Disabled action
          </button>
          <button id="hidden-button" style="display:none;">
            Hidden action
          </button>
          <button id="offscreen-button" style="position:absolute; left:40px; top:900px; width:180px; height:32px;">
            Offscreen action
          </button>
          <button id="covered-button" style="position:absolute; left:40px; top:140px; width:180px; height:36px; z-index: 1;">
            Covered action
          </button>
          <div id="cover" style="position:absolute; left:40px; top:140px; width:180px; height:36px; z-index: 2; background:white;">
            Cookie banner cover
          </div>
        </main>
      </body>
    </html>
  `)

  const adapter = createBrowserUseAdapter({
    page,
    sessionId: 'browser-use-observe-test',
    sourceType: 'company_site',
  })

  const state = await adapter.observe()
  const elementTexts = state.elements.map(element => element.text)

  assert.equal(state.sessionId, 'browser-use-observe-test')
  assert.equal(state.sourceType, 'company_site')
  assert.equal(state.screenshot.width, 800)
  assert.equal(state.screenshot.height, 600)
  assert.match(state.screenshot.id, /^browser-use-observe-test-shot-[a-f0-9]{12}$/)
  assert.deepEqual(elementTexts, ['AI Careers'])
  assert.equal(state.elements[0].role, 'link')
  assert.equal(state.elements[0].href, 'https://example.com/careers')
  assert.deepEqual(state.elements[0].center, { x: 130, y: 56 })
})

it('executes clicks and typing through browser mouse and keyboard input', async () => {
  await page.setContent(`
    <!doctype html>
    <html>
      <body style="font-family: sans-serif; margin: 0;">
        <button
          id="trusted-click"
          style="position:absolute; left:50px; top:50px; width:160px; height:40px;"
          onclick="document.querySelector('#click-status').textContent = event.isTrusted ? 'trusted-click' : 'synthetic-click'"
        >
          Open role
        </button>
        <input
          id="query"
          aria-label="Search roles"
          style="position:absolute; left:50px; top:110px; width:240px; height:32px;"
          oninput="document.querySelector('#input-status').textContent = event.isTrusted ? 'trusted-input' : 'synthetic-input'"
        />
        <p id="click-status">not-clicked</p>
        <p id="input-status">not-typed</p>
      </body>
    </html>
  `)

  const adapter = createBrowserUseAdapter({
    page,
    sessionId: 'browser-use-act-test',
    sourceType: 'company_site',
  })
  const initialState = await adapter.observe()
  const clickTarget = initialState.elements.find(element => element.text === 'Open role')
  const inputTarget = initialState.elements.find(element => element.text === 'Search roles')

  assert.ok(clickTarget)
  assert.ok(inputTarget)

  await adapter.act({
    type: 'click',
    elementId: clickTarget.id,
    point: clickTarget.center,
    target: {
      role: clickTarget.role,
      text: clickTarget.text,
      href: clickTarget.href,
      intent: clickTarget.intent,
    },
  })
  await adapter.act({
    type: 'click',
    elementId: inputTarget.id,
    point: inputTarget.center,
    target: {
      role: inputTarget.role,
      text: inputTarget.text,
      href: inputTarget.href,
      intent: inputTarget.intent,
    },
  })
  await adapter.act({
    type: 'type',
    text: 'agent runtime',
  })

  assert.equal(await page.locator('#click-status').textContent(), 'trusted-click')
  assert.equal(await page.locator('#input-status').textContent(), 'trusted-input')
  assert.equal(await page.locator('#query').inputValue(), 'agent runtime')
})

it('surfaces browser-use stop signals from visible page text', async () => {
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <h1>Verify you are human</h1>
        <p>Please sign in before continuing.</p>
        <p>Too many requests. Try again later.</p>
      </body>
    </html>
  `)

  const adapter = createBrowserUseAdapter({
    page,
    sessionId: 'browser-use-stop-signal-test',
    sourceType: 'public_careers',
  })

  const state = await adapter.observe()

  assert.deepEqual(state.signals, ['captcha', 'login_required', 'rate_limited'])
})

it('surfaces localized Google anti-automation challenge text as stop signals', async () => {
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <h1>关于此网页</h1>
        <p>我们的系统检测到您的计算机网络中存在异常流量。</p>
        <p>此网页用于确认这些请求是由您而不是自动程序发出的。</p>
      </body>
    </html>
  `)

  const adapter = createBrowserUseAdapter({
    page,
    sessionId: 'browser-use-localized-stop-signal-test',
    sourceType: 'search_engine',
  })

  const state = await adapter.observe()

  assert.deepEqual(state.signals, ['captcha', 'rate_limited'])
})
