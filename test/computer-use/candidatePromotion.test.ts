import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { promoteCandidate } from '../../src/computer-use/macos-chrome-driver/candidate-promotion.js'
import type { ChromeCaptureContract, ChromeWindowRef, RecognitionResult, RecognizedItem } from '../../src/computer-use/macos-chrome-driver/types.js'

function makeRecognition(overrides: Partial<RecognitionResult> & { best: RecognizedItem | null; all: RecognizedItem[]; filtered: RecognizedItem[] }): RecognitionResult {
  return {
    recognition_id: 'mcr_1',
    source: 'ocr_row',
    scope: { surface: 'window', window_number: 42, app_bundle_id: 'com.google.Chrome' },
    detail: {},
    evidence: [{ run_id: 'r1', artifact_id: 'a1', span_id: 's1' }],
    known_limits: [],
    found: false,
    ...overrides,
  }
}

function makeItem(overrides: Partial<RecognizedItem> & { item_id: string }): RecognizedItem {
  return {
    kind: 'dom_button',
    text: 'Accept',
    box: { x: 100, y: 200, width: 120, height: 40 },
    provider_score: 0.9,
    detail: { actionable: true },
    ...overrides,
  }
}

const capture: ChromeCaptureContract = {
  coordinateContractVersion: 1,
  captureSource: { kind: 'window', windowNumber: 42, ownerPid: 123, ownerBundleId: 'com.google.Chrome' },
  sourceGlobalLogicalBounds: { x: 0, y: 40, width: 1000, height: 800 },
  screenshotPixelSize: { width: 2000, height: 1600 },
  pixelToLogicalScale: { x: 0.5, y: 0.5 },
  logicalToPixelScale: { x: 2, y: 2 },
  capturedAt: new Date().toISOString(),
}

const window: ChromeWindowRef = {
  id: '42', windowNumber: 42, appName: 'Google Chrome', ownerPid: 123,
  ownerBundleId: 'com.google.Chrome', title: 'Test', bounds: { x: 0, y: 40, width: 1000, height: 800 }, layer: 0,
}

describe('promoteCandidate', () => {
  it('promotes when all conditions met', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true, chrome_foreground: true, hard_stop_signals: [], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    assert.equal(result.status, 'promoted')
    if (result.status === 'promoted') {
      assert.equal(result.candidate.kind, 'dom_button')
      assert.ok(result.candidate.candidate_local_id.includes('mcr_1'))
      assert.equal(result.candidate.source_run_id, 'r1')
    }
  })

  it('refuses with empty_recognition when all is empty', () => {
    const recognition = makeRecognition({ best: null, all: [], filtered: [], found: false })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true, chrome_foreground: true, hard_stop_signals: [], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    assert.equal(result.status, 'refused')
    if (result.status === 'refused') assert.ok(result.reasons.includes('empty_recognition'))
  })

  it('refuses with profile_mismatch', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: false, chrome_foreground: true, hard_stop_signals: [], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    if (result.status === 'refused') assert.ok(result.reasons.includes('profile_mismatch'))
  })

  it('refuses with chrome_not_foreground', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true, chrome_foreground: false, hard_stop_signals: [], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    if (result.status === 'refused') assert.ok(result.reasons.includes('chrome_not_foreground'))
  })

  it('refuses with hard_stop_signal', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true, chrome_foreground: true, hard_stop_signals: ['captcha'], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    if (result.status === 'refused') assert.ok(result.reasons.includes('hard_stop_signal'))
  })

  it('refuses with item_outside_viewport', () => {
    const best = makeItem({ item_id: '0', box: { x: 2000, y: 2000, width: 100, height: 40 } })
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true, chrome_foreground: true, hard_stop_signals: [], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    if (result.status === 'refused') assert.ok(result.reasons.includes('item_outside_viewport'))
  })

  it('refuses with stale_capture', () => {
    const best = makeItem({ item_id: '0' })
    const staleCapture = { ...capture, capturedAt: new Date(Date.now() - 6000).toISOString() }
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
    const result = promoteCandidate(recognition, staleCapture, window, {
      profile_verified: true, chrome_foreground: true, hard_stop_signals: [], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    if (result.status === 'refused') assert.ok(result.reasons.includes('stale_capture'))
  })

  it('accumulates multiple refusal reasons', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: false, chrome_foreground: false, hard_stop_signals: [], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    if (result.status === 'refused') {
      assert.ok(result.reasons.length >= 2)
      assert.ok(result.reasons.includes('profile_mismatch'))
      assert.ok(result.reasons.includes('chrome_not_foreground'))
    }
  })
})
