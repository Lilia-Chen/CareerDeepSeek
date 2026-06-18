import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { detectBlockingStopSignal } from '../../src/computer-use/overlay-resolver.js'
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

describe('detectBlockingStopSignal', () => {
  it('treats quick real-person checks as hard stops before any overlay dismissal concern', () => {
    const visualState = state({
      visibleText: 'Quick Check Needed. Please confirm you are a real person before continuing. We use cookies.',
      elements: [
        element({ id: 'accept', text: 'Accept all cookies' }),
        element({ id: 'checkbox', text: 'Check the box below', role: 'checkbox' }),
      ],
    })

    assert.equal(detectBlockingStopSignal(visualState), 'captcha')
  })

  it('detects high-risk blocking states so the workflow can mark and stop', () => {
    assert.equal(detectBlockingStopSignal(state({ visibleText: 'Please log in to continue' })), 'login_required')
    assert.equal(detectBlockingStopSignal(state({ visibleText: 'Verify you are human before continuing' })), 'captcha')
    assert.equal(detectBlockingStopSignal(state({ visibleText: 'Quick Check Needed: confirm you are a real person' })), 'captcha')
    assert.equal(detectBlockingStopSignal(state({ visibleText: 'Check the box below to continue' })), 'captcha')
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
