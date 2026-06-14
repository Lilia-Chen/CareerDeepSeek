import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { recognizeFromCapture } from '../../src/computer-use/macos-chrome-driver/recognition.js'
import type { ChromeCaptureContract, ChromeRecognitionTarget, RecognizedItem } from '../../src/computer-use/macos-chrome-driver/types.js'

const screenshotPath = '/tmp/test-chrome.png'

const contract: ChromeCaptureContract = {
  coordinateContractVersion: 1,
  captureSource: { kind: 'window', windowNumber: 42, ownerPid: 123 },
  sourceGlobalLogicalBounds: { x: 0, y: 40, width: 1000, height: 800 },
  screenshotPixelSize: { width: 2000, height: 1600 },
  pixelToLogicalScale: { x: 0.5, y: 0.5 },
  logicalToPixelScale: { x: 2, y: 2 },
  capturedAt: '2026-06-14T00:00:00.000Z',
}

function makeItem(overrides: Partial<RecognizedItem> & { item_id: string }): RecognizedItem {
  return {
    kind: 'ocr_text',
    text: 'Search',
    box: { x: 50, y: 78, width: 124, height: 38 },
    provider_score: 0.9,
    detail: {},
    ...overrides,
  }
}

describe('recognizeFromCapture', () => {
  it('returns best item when a single unique target matches', () => {
    const items = [makeItem({ item_id: '0', text: 'Search' })]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath)
    assert.equal(result.found, true)
    assert.equal(result.best!.item_id, '0')
    assert.equal(result.filtered.length, 1)
    assert.equal(result.all.length, 1)
    assert.equal(result.source, 'ocr_row')
  })

  it('returns best=null when no items match target', () => {
    const items = [makeItem({ item_id: '0', text: 'Home' })]
    const target: ChromeRecognitionTarget = { kind: 'text_input', name: /search/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath)
    assert.equal(result.found, false)
    assert.equal(result.best, null)
    assert.equal(result.filtered.length, 0)
    assert.equal(result.all.length, 1)
  })

  it('filters by target kind: button matches button roles only', () => {
    const items = [
      makeItem({ item_id: '0', text: 'Accept', kind: 'dom_button' }),
      makeItem({ item_id: '1', text: 'Accept', kind: 'ocr_text' }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'button', text: /accept/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath)
    assert.equal(result.filtered.length, 1)
    assert.equal(result.filtered[0]!.item_id, '0')
  })

  it('sorts filtered: actionable first, then provider_score descending', () => {
    const items = [
      makeItem({ item_id: 'low', text: 'Search', provider_score: 0.5, detail: { actionable: false } }),
      makeItem({ item_id: 'high', text: 'Search', provider_score: 0.9, kind: 'dom_button' }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath)
    assert.equal(result.filtered[0]!.item_id, 'high')
    assert.equal(result.filtered[1]!.item_id, 'low')
  })

  it('all contains all items regardless of filter match', () => {
    const items = [makeItem({ item_id: '0', text: 'Search' }), makeItem({ item_id: '1', text: 'Home' })]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath)
    assert.equal(result.all.length, 2)
    assert.equal(result.filtered.length, 1)
  })

  it('includes evidence artifact refs', () => {
    const items = [makeItem({ item_id: '0' })]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath)
    assert.ok(result.evidence.length >= 1)
  })

  it('links scope to window metadata', () => {
    const items = [makeItem({ item_id: '0' })]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath)
    assert.ok(result.recognition_id.startsWith('mcr_'))
    assert.equal(result.scope.surface, 'window')
    assert.equal(result.scope.window_number, 42)
  })

  it('sets known_limits when items are empty', () => {
    const target: ChromeRecognitionTarget = { kind: 'text_input', name: /search/i }
    const result = recognizeFromCapture([], target, contract, screenshotPath)
    assert.equal(result.found, false)
    assert.ok(result.known_limits.some(l => l.includes('empty')))
  })
})
