import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { detectBlockingStopSignal, planOverlayDismissal } from '../../src/computer-use/overlay-resolver.js'
import type { VisualElement, VisualState } from '../../src/types.js'

function element(input: Partial<VisualElement> & { id: string, text: string }): VisualElement {
  return {
    id: input.id,
    role: input.role ?? 'button',
    text: input.text,
    href: input.href ?? null,
    intent: input.intent ?? null,
    source: input.source ?? 'chrome_dom',
    box: input.box ?? { x: 10, y: 10, width: 100, height: 40 },
    center: input.center ?? { x: 60, y: 30 },
  }
}

function state(input: Partial<VisualState>): VisualState {
  return {
    sessionId: 'test-session',
    step: 1,
    url: 'https://example.com',
    title: 'Example',
    sourceType: 'company_site',
    observedAt: '2026-06-06T00:00:00.000Z',
    screenshot: { id: 'shot-1', width: 1440, height: 900 },
    visibleText: '',
    elements: [],
    signals: [],
    evidence: [],
    extracted: {},
    ...input,
  }
}

describe('planOverlayDismissal', () => {
  it('prefers accepting a cookie prompt when both accept and reject options are visible', () => {
    const decision = planOverlayDismissal(state({
      visibleText: 'This website stores cookies on your device. Cookies settings Yes, I agree Reject additional',
      elements: [
        element({ id: 'accept', text: 'Yes, I agree', box: { x: 700, y: 760, width: 180, height: 50 } }),
        element({ id: 'reject', text: 'Reject additional', box: { x: 900, y: 760, width: 220, height: 50 } }),
        element({ id: 'settings', text: 'Cookies settings', role: 'link', box: { x: 540, y: 760, width: 160, height: 50 } }),
      ],
    }))

    assert.ok(decision)
    assert.equal(decision.kind, 'cookie_consent')
    assert.equal(decision.action.elementId, 'accept')
    assert.equal(decision.action.target.text, 'Yes, I agree')
    assert.equal(decision.action.point.x, 790)
    assert.equal(decision.action.point.y, 785)
  })

  it('dismisses marketing modals through the observed close control instead of the CTA', () => {
    const decision = planOverlayDismissal(state({
      visibleText: 'Named a Leader in The Forrester Wave 2026 Read the report',
      elements: [
        element({ id: 'report', text: 'Read the report', role: 'link', box: { x: 760, y: 280, width: 260, height: 60 } }),
        element({ id: 'close', text: 'Close', box: { x: 1030, y: 210, width: 48, height: 48 } }),
      ],
    }))

    assert.ok(decision)
    assert.equal(decision.kind, 'marketing_modal')
    assert.equal(decision.action.elementId, 'close')
    assert.equal(decision.action.target.text, 'Close')
  })

  it('does not click Chrome tab-strip close controls as page overlay dismissals', () => {
    const decision = planOverlayDismissal(state({
      visibleText: 'Search Results Download the report Watch the Demo Contact us today',
      elements: [
        element({
          id: 'tab-close',
          source: 'ax',
          text: 'Close',
          role: 'AXButton',
          box: { x: 318, y: 34, width: 48, height: 38 },
          center: { x: 342, y: 53 },
        }),
        element({ id: 'demo', text: 'Watch the Demo', role: 'link', box: { x: 320, y: 400, width: 160, height: 40 } }),
      ],
    }))

    assert.equal(decision, null)
  })

  it('does not treat Google search-result snippets as marketing modals', () => {
    const decision = planOverlayDismissal(state({
      url: 'https://www.google.com/search?q=AI+agent+infrastructure+startups+2026',
      title: 'AI agent infrastructure startups 2026 - Google Search',
      visibleText: [
        'Skip to main content',
        'Search Results',
        'Sponsored results',
        'AI Agents Built for CX',
        'Download the report',
        'Watch the Demo',
        'Contact us today',
      ].join('\n'),
      elements: [
        element({ id: 'skip', text: 'Skip to main content', role: 'link', box: { x: 20, y: 220, width: 140, height: 40 } }),
        element({ id: 'demo', text: 'Watch the Demo', role: 'link', box: { x: 320, y: 400, width: 160, height: 40 } }),
      ],
    }))

    assert.equal(decision, null)
  })

  it('does not open cookie consent managers as a dismissal action', () => {
    const decision = planOverlayDismissal(state({
      visibleText: 'We use cookies. To change your cookie settings and preferences, click Cookie Consent Manager.',
      elements: [
        element({ id: 'manager', text: 'Cookie Consent Manager' }),
      ],
    }))

    assert.equal(decision, null)
  })

  it('does not auto-dismiss high-risk blocking states', () => {
    for (const signals of [['captcha'], ['login_required'], ['payment_required']]) {
      const decision = planOverlayDismissal(state({
        visibleText: 'Please continue',
        signals,
        elements: [element({ id: 'continue', text: 'Continue' })],
      }))

      assert.equal(decision, null)
    }
  })

  it('detects high-risk blocking states so the workflow can mark and stop', () => {
    assert.equal(detectBlockingStopSignal(state({ visibleText: 'Please log in to continue' })), 'login_required')
    assert.equal(detectBlockingStopSignal(state({ visibleText: 'Verify you are human before continuing' })), 'captcha')
    assert.equal(detectBlockingStopSignal(state({ visibleText: 'Enter payment details to continue' })), 'payment_required')
  })

  it('allows reading a job description page while still stopping on application submission flow', () => {
    assert.equal(detectBlockingStopSignal(state({
      visibleText: 'Back to jobs AI Infrastructure Engineer London Apply Fin is the AI Customer Agent company.',
      elements: [
        element({ id: 'apply', text: 'Apply', role: 'link' }),
        element({ id: 'form', text: 'Submit application Upload resume required before continuing', role: 'form' }),
      ],
    })), null)

    assert.equal(detectBlockingStopSignal(state({
      visibleText: 'Submit application Upload resume required before continuing',
      elements: [
        element({ id: 'submit', text: 'Submit application', role: 'button' }),
      ],
    })), 'apply_or_send_required')
  })

  it('does not treat passive header links or article text as blocking states', () => {
    assert.equal(detectBlockingStopSignal(state({
      visibleText: 'Company home page. Sign in Start for free Products Pricing',
    })), null)
    assert.equal(detectBlockingStopSignal(state({
      visibleText: 'This article describes how payment infrastructure companies use AI agents in production.',
    })), null)
  })
})
