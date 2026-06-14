import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import type { VisualState } from '../../src/types.js'

import { decideNextLinkedInSearchAction } from '../../src/workflows/linkedin-search-workflow.js'

function linkedInFeedState(overrides: Partial<VisualState> = {}): VisualState {
  return {
    sessionId: 'linkedin-test',
    step: 0,
    url: 'https://www.linkedin.com/feed/',
    title: 'Feed | LinkedIn',
    sourceType: 'company_site',
    observedAt: new Date().toISOString(),
    screenshot: { id: 'shot', width: 1000, height: 800 },
    visibleText: 'LinkedIn Search Start a post LinkedIn News',
    signals: [],
    evidence: [],
    extracted: {},
    elements: [
      {
        id: 'chrome-address-bar',
        role: 'AXTextField',
        text: 'Address and search bar',
        href: null,
        intent: null,
        box: { x: 200, y: 80, width: 450, height: 40 },
        center: { x: 425, y: 100 },
      },
      {
        id: 'linkedin-search',
        role: 'textbox',
        text: 'Search',
        href: null,
        intent: null,
        box: { x: 58, y: 150, width: 280, height: 34 },
        center: { x: 198, y: 167 },
      },
    ],
    ...overrides,
  }
}

describe('linkedin search workflow controller', () => {
  it('continues from an already-open LinkedIn feed by clicking the observed LinkedIn search box', () => {
    const decision = decideNextLinkedInSearchAction(
      {
        state: linkedInFeedState({
          chrome: {
            isFrontmost: true,
            activeTabUrl: 'https://www.linkedin.com/feed/',
            domAvailable: true,
          },
          page: { className: 'linkedin_feed' },
        } as Partial<VisualState>),
        query: 'AI agent infrastructure companies hiring',
      },
    )

    assert.equal(decision.kind, 'action')
    assert.equal(decision.action.type, 'click')
    assert.equal(decision.action.elementId, 'linkedin-search')
    assert.equal(decision.action.point.x, 198)
  })

  it('does not perform page actions when adapter observation reports Chrome is not frontmost', () => {
    const decision = decideNextLinkedInSearchAction(
      {
        state: linkedInFeedState({
          chrome: {
            isFrontmost: false,
            activeTabUrl: 'https://www.linkedin.com/feed/',
            domAvailable: true,
          },
          page: { className: 'linkedin_feed' },
          elements: [],
        } as Partial<VisualState>),
        query: 'AI agent infrastructure companies hiring',
      },
    )

    assert.equal(decision.kind, 'stop')
    assert.match(decision.reason, /invariant/i)
  })

  it('hard-stops instead of continuing through login, CAPTCHA, payment, apply, or send-message states', () => {
    const decision = decideNextLinkedInSearchAction(
      {
        state: linkedInFeedState({
          signals: ['payment_required'],
          page: { className: 'linkedin_feed' },
        } as Partial<VisualState>),
        query: 'AI agent infrastructure companies hiring',
      },
    )

    assert.equal(decision.kind, 'stop')
    assert.match(decision.reason, /payment_required/)
  })

  it('uses a fileURLToPath ESM main guard so paths with spaces still execute', async () => {
    const source = await readFile(new URL('../../src/workflows/linkedin-search-workflow.ts', import.meta.url), 'utf8')

    assert.match(source, /fileURLToPath\(import\.meta\.url\)/)
    assert.doesNotMatch(source, /import\.meta\.url === `file:\/\//)
  })
})
