import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { recognizeFromCapture } from '../../src/computer-use/macos-chrome-driver/recognition.js'
import type { ArtifactRef, ChromeCaptureContract, ChromeRecognitionTarget, RecognizedItem } from '../../src/computer-use/macos-chrome-driver/types.js'

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
    assert.equal(result.source, 'ocr_text')
  })

  it('infers text-only OCR items as ocr_text instead of ocr_row', () => {
    const items = [
      makeItem({ item_id: '0', kind: 'ocr_text', text: 'Search' }),
      makeItem({ item_id: '1', kind: 'ocr_text', text: 'Open search' }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath)

    assert.equal(result.source, 'ocr_text')
  })

  it('infers OCR row item sources as ocr_row', () => {
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /engineer/i }

    const ocrRow = recognizeFromCapture([
      makeItem({ item_id: 'row_0', kind: 'ocr_row', text: 'AI Engineer' }),
    ], target, contract, screenshotPath)

    assert.equal(ocrRow.source, 'ocr_row')
  })

  it('infers source from the matched best item, not the first input item', () => {
    const items = [
      makeItem({ item_id: 'text_0', kind: 'ocr_text', text: 'Home' }),
      makeItem({ item_id: 'row_0', kind: 'ocr_row', text: 'AI Engineer' }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /engineer/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath)

    assert.equal(result.best!.item_id, 'row_0')
    assert.equal(result.source, 'ocr_row')
    assert.equal(result.detail.source, 'ocr_row')
  })

  it('does not infer unknown or explicit non-OCR sources as ocr_row', () => {
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /target/i }

    const segmented = recognizeFromCapture([
      makeItem({ item_id: 'region_0', kind: 'segmented_region', text: 'Target region' }),
    ], target, contract, screenshotPath)
    const icon = recognizeFromCapture([
      makeItem({ item_id: 'icon_0', kind: 'icon_match', text: 'Target icon' }),
    ], target, contract, screenshotPath)
    const custom = recognizeFromCapture([
      makeItem({ item_id: 'custom_0', kind: 'custom_widget', text: 'Target custom' }),
    ], target, contract, screenshotPath)

    assert.equal(segmented.source, 'segmented_region')
    assert.equal(icon.source, 'icon_match')
    assert.equal(custom.source, 'custom')
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

  it('does not invent screenshot artifact refs when no evidence refs are supplied', () => {
    const items = [makeItem({ item_id: '0' })]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath, 'run_1', 'span_1')
    assert.equal(result.evidence.some(ref => ref.artifact_id === 'screenshot_run_1'), false)
    assert.equal(result.evidence.length, 0)
  })

  it('uses caller-supplied evidence artifact refs', () => {
    const items = [makeItem({ item_id: '0' })]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }
    const evidence: ArtifactRef[] = [
      { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'observe_mco_1' },
      { run_id: 'run_1', artifact_id: 'capture_contract_mco_1', span_id: 'observe_mco_1' },
    ]
    const result = recognizeFromCapture(items, target, contract, screenshotPath, 'run_1', 'span_1', evidence)
    assert.deepEqual(result.evidence, evidence)
    assert.equal(result.scope.capture_artifact?.artifact_id, 'screenshot_mco_1')
    assert.equal(result.scope.capture_contract_artifact?.artifact_id, 'capture_contract_mco_1')
  })

  it('preserves provider counts screenshot path and caller-supplied capture refs in result detail', () => {
    const items = [makeItem({ item_id: '0', text: 'Search' }), makeItem({ item_id: '1', text: 'Home' })]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }
    const evidence: ArtifactRef[] = [
      { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'observe_mco_1' },
      { run_id: 'run_1', artifact_id: 'capture_contract_mco_1', span_id: 'observe_mco_1' },
    ]

    const result = recognizeFromCapture(items, target, contract, screenshotPath, 'run_1', 'span_1', evidence)

    assert.equal(result.detail.provider, 'careerdeepseek.macos_chrome_driver')
    assert.equal(result.detail.source, 'ocr_text')
    assert.equal(result.detail.total_input_items, 2)
    assert.equal(result.detail.filtered_count, 1)
    assert.equal(result.detail.screenshot_path, screenshotPath)
    assert.deepEqual(result.detail.screenshot_pixel_size, { width: 2000, height: 1600 })
    assert.deepEqual(result.detail.capture_artifact, evidence[0])
    assert.deepEqual(result.detail.capture_contract_artifact, evidence[1])
    assert.deepEqual(result.scope.capture_artifact, evidence[0])
    assert.deepEqual(result.scope.capture_contract_artifact, evidence[1])
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

  it('does not invent missing artifact refs and records missing-ref known limits', () => {
    const items = [makeItem({ item_id: '0' })]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath, 'run_1', 'span_1', [])

    assert.equal(result.scope.capture_artifact, undefined)
    assert.equal(result.scope.capture_contract_artifact, undefined)
    assert.equal(result.evidence.length, 0)
    assert.ok(result.known_limits.some(limit => limit.includes('missing capture artifact ref')))
    assert.ok(result.known_limits.some(limit => limit.includes('missing capture contract artifact ref')))
  })

  it('records ambiguity when multiple filtered matches remain', () => {
    const items = [
      makeItem({ item_id: '0', text: 'Search', provider_score: 0.91 }),
      makeItem({ item_id: '1', text: 'Search jobs', provider_score: 0.9 }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath)

    assert.equal(result.filtered.length, 2)
    assert.ok(result.known_limits.some(limit => limit.includes('multiple filtered candidates')))
  })

  it('aggregates item-level known_limits and invalid confidence or projection limits', () => {
    const items = [
      makeItem({
        item_id: '0',
        text: 'Search',
        provider_score: Number.NaN,
        box: { x: Number.NaN, y: 78, width: 124, height: 38 },
        detail: { known_limits: ['ocr provider reported partial text'] },
      }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath)

    assert.ok(result.known_limits.includes('ocr provider reported partial text'))
    assert.ok(result.known_limits.some(limit => limit.includes('invalid or missing confidence')))
    assert.ok(result.known_limits.some(limit => limit.includes('invalid bounds or projection')))
  })

  it('records row confidence as unavailable instead of invalid when provider omits row score', () => {
    const items = [
      makeItem({
        item_id: 'row_0',
        kind: 'ocr_row',
        text: 'AI Engineer',
        provider_score: undefined,
        detail: {
          row_bounds: {
            capture_pixel: { x: 100, y: 120, width: 400, height: 80 },
            source_global_logical: { x: 50, y: 100, width: 200, height: 40 },
          },
          projection: { contract_version: 1 },
          text_fragments: ['AI Engineer'],
        },
      }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /engineer/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath)

    assert.ok(result.known_limits.includes('item row_0: row confidence unavailable from provider'))
    assert.equal(result.known_limits.includes('item row_0: invalid or missing confidence'), false)
    assert.equal(result.known_limits.includes('item row_0: invalid bounds or projection detail'), false)
  })

  it('requires projected logical evidence, not raw pixel bounds alone', () => {
    const items = [
      makeItem({
        item_id: '0',
        text: 'Search',
        detail: {
          raw_pixel_bounds: { x: 100, y: 76, width: 248, height: 76 },
          projection: { contract_version: 1 },
        },
      }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath)

    assert.ok(result.known_limits.includes('item 0: invalid bounds or projection detail'))
  })
})
