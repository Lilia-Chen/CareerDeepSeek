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

function cleanOcrDetail(captureArtifact: ArtifactRef, captureContractArtifact: ArtifactRef): Record<string, unknown> {
  return {
    bounds: {
      capture_pixel: { x: 100, y: 120, width: 240, height: 48 },
      source_global_logical: { x: 50, y: 78, width: 124, height: 38 },
    },
    source_artifacts: {
      capture_artifact: captureArtifact,
      capture_contract_artifact: captureContractArtifact,
    },
    known_limits: [],
  }
}

function cleanDomDetail(captureArtifact: ArtifactRef, captureContractArtifact: ArtifactRef): Record<string, unknown> {
  return {
    evidence_role: 'read_only_observation',
    dom_role: 'button',
    dom_name: 'Search',
    dom_text: 'Search',
    provider_actionable: true,
    bounds: {
      source_global_logical: { x: 52, y: 80, width: 120, height: 36 },
    },
    source_artifacts: {
      capture_artifact: captureArtifact,
      capture_contract_artifact: captureContractArtifact,
    },
    known_limits: [],
  }
}

function cleanAxDetail(captureArtifact: ArtifactRef, captureContractArtifact: ArtifactRef): Record<string, unknown> {
  return {
    evidence_role: 'read_only_observation',
    ax_role: 'AXButton',
    ax_title: 'Search',
    enabled: true,
    bounds: {
      source_global_logical: { x: 51, y: 79, width: 122, height: 37 },
    },
    source_artifacts: {
      capture_artifact: captureArtifact,
      capture_contract_artifact: captureContractArtifact,
    },
    known_limits: [],
  }
}

function evidenceRefs(): ArtifactRef[] {
  return [
    { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'observe_mco_1' },
    { run_id: 'run_1', artifact_id: 'capture_contract_mco_1', span_id: 'observe_mco_1' },
  ]
}

function crossSourceAudit(result: ReturnType<typeof recognizeFromCapture>): Record<string, unknown> {
  const audit = result.detail.cross_source_audit
  assert.equal(typeof audit, 'object')
  assert.notEqual(audit, null)
  return audit as Record<string, unknown>
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

  it('records agreement audit when OCR, DOM, AX, and capture evidence support the same visible target', () => {
    const evidence = evidenceRefs()
    const [captureArtifact, captureContractArtifact] = evidence
    const items = [
      makeItem({
        item_id: 'ocr_0',
        kind: 'ocr_text',
        text: 'Search',
        detail: cleanOcrDetail(captureArtifact!, captureContractArtifact!),
      }),
      makeItem({
        item_id: 'dom_0',
        kind: 'dom_button',
        text: 'Search',
        provider_score: 0.82,
        detail: cleanDomDetail(captureArtifact!, captureContractArtifact!),
      }),
      makeItem({
        item_id: 'ax_0',
        kind: 'ax_evidence',
        text: 'Search',
        provider_score: 0.75,
        detail: cleanAxDetail(captureArtifact!, captureContractArtifact!),
      }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'button', text: /search/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath, 'run_1', 'span_1', evidence)
    const audit = crossSourceAudit(result)
    const parsedAudit = JSON.parse(JSON.stringify(audit)) as Record<string, unknown>

    const captureVisibilitySource = (parsedAudit.sources as Array<Record<string, unknown>>).find(source => source.source === 'capture_visibility')!

    assert.equal(parsedAudit.status, 'unknown')
    assert.deepEqual(parsedAudit.source_groups, ['ocr_text', 'chrome_dom', 'ax', 'capture_visibility'])
    assert.deepEqual((parsedAudit.items as Array<Record<string, unknown>>).map(item => item.item_id), ['dom_0'])
    assert.deepEqual((parsedAudit.items as Array<Record<string, unknown>>)[0]!.compared_item_ids, ['ocr_0', 'ax_0'])
    assert.equal((parsedAudit.items as Array<Record<string, unknown>>).every(item => item.status === 'agreement'), true)
    assert.equal(captureVisibilitySource.status, 'unknown')
    assert.ok((captureVisibilitySource.known_limits as string[]).includes('recognition audit: capture visibility is reference evidence only; independent visibility verification unavailable'))
  })

  it('records conflict audit when the best DOM candidate overlaps disagreeing OCR evidence', () => {
    const evidence = evidenceRefs()
    const [captureArtifact, captureContractArtifact] = evidence
    const items = [
      makeItem({
        item_id: 'dom_submit',
        kind: 'dom_button',
        text: 'Submit',
        provider_score: 0.82,
        detail: cleanDomDetail(captureArtifact!, captureContractArtifact!),
      }),
      makeItem({
        item_id: 'ocr_cancel',
        kind: 'ocr_text',
        text: 'Cancel',
        provider_score: 0.96,
        detail: cleanOcrDetail(captureArtifact!, captureContractArtifact!),
      }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'button', text: /submit/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath, 'run_1', 'span_1', evidence)
    const audit = crossSourceAudit(result)
    const auditedItems = audit.items as Array<Record<string, unknown>>
    const domAudit = auditedItems.find(item => item.item_id === 'dom_submit')!
    const sourceStatuses = new Map((audit.sources as Array<Record<string, unknown>>).map(source => [source.source, source.status]))

    assert.equal(result.best?.item_id, 'dom_submit')
    assert.deepEqual(result.filtered.map(item => item.item_id), ['dom_submit'])
    assert.equal(result.all.some(item => item.item_id === 'ocr_cancel'), true)
    assert.equal(audit.status, 'conflict')
    assert.equal(domAudit.status, 'conflict')
    assert.deepEqual(domAudit.compared_item_ids, ['ocr_cancel'])
    assert.equal(sourceStatuses.get('chrome_dom'), 'conflict')
    assert.equal(sourceStatuses.get('ocr_text'), 'conflict')
    assert.ok(result.known_limits.some(limit => limit.includes('conflicting cross-source evidence')))
  })

  it('records unknown audit when clean OCR has no comparable DOM or AX source', () => {
    const evidence = evidenceRefs()
    const [captureArtifact, captureContractArtifact] = evidence
    const items = [
      makeItem({
        item_id: 'ocr_0',
        kind: 'ocr_text',
        text: 'Search',
        detail: cleanOcrDetail(captureArtifact!, captureContractArtifact!),
      }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath, 'run_1', 'span_1', evidence)
    const audit = crossSourceAudit(result)
    const auditedItems = audit.items as Array<Record<string, unknown>>

    assert.equal(audit.status, 'unknown')
    assert.equal(auditedItems[0]!.status, 'unknown')
    assert.deepEqual(auditedItems[0]!.compared_item_ids, [])
    assert.ok((auditedItems[0]!.known_limits as string[]).some(limit => limit.includes('no comparable cross-source evidence')))
  })

  it('records unknown audit when capture and capture-contract artifacts are missing', () => {
    const items = [
      makeItem({
        item_id: 'ocr_0',
        kind: 'ocr_text',
        text: 'Search',
        detail: {
          bounds: {
            capture_pixel: { x: 100, y: 120, width: 240, height: 48 },
            source_global_logical: { x: 50, y: 78, width: 124, height: 38 },
          },
          known_limits: [],
        },
      }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath, 'run_1', 'span_1', [])
    const audit = crossSourceAudit(result)
    const sourceStatuses = new Map((audit.sources as Array<Record<string, unknown>>).map(source => [source.source, source.status]))

    assert.equal(audit.status, 'unknown')
    assert.equal(sourceStatuses.get('capture_visibility'), 'unknown')
    assert.ok((audit.known_limits as string[]).some(limit => limit.includes('missing capture artifact ref')))
    assert.ok((audit.known_limits as string[]).some(limit => limit.includes('missing capture contract artifact ref')))
    assert.ok(result.known_limits.some(limit => limit.includes('missing capture artifact ref')))
    assert.ok(result.known_limits.some(limit => limit.includes('missing capture contract artifact ref')))
  })

  it('records unknown audit and propagates DOM and AX uncertainty known limits', () => {
    const evidence = evidenceRefs()
    const [captureArtifact, captureContractArtifact] = evidence
    const items = [
      makeItem({
        item_id: 'ocr_0',
        kind: 'ocr_text',
        text: 'Search',
        detail: cleanOcrDetail(captureArtifact!, captureContractArtifact!),
      }),
      makeItem({
        item_id: 'dom_uncertain',
        kind: 'dom_evidence',
        text: 'Search',
        provider_score: 0.82,
        detail: {
          ...cleanDomDetail(captureArtifact!, captureContractArtifact!),
          known_limits: ['DOM provider actionability unavailable/uncertain'],
        },
      }),
      makeItem({
        item_id: 'ax_uncertain',
        kind: 'ax_evidence',
        text: 'Search',
        provider_score: 0.75,
        detail: {
          ...cleanAxDetail(captureArtifact!, captureContractArtifact!),
          known_limits: ['AX provider enabled unavailable/uncertain'],
        },
      }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath, 'run_1', 'span_1', evidence)
    const audit = crossSourceAudit(result)
    const sourceStatuses = new Map((audit.sources as Array<Record<string, unknown>>).map(source => [source.source, source.status]))

    assert.equal(audit.status, 'unknown')
    assert.equal(sourceStatuses.get('chrome_dom'), 'unknown')
    assert.equal(sourceStatuses.get('ax'), 'unknown')
    assert.ok((audit.known_limits as string[]).includes('DOM provider actionability unavailable/uncertain'))
    assert.ok((audit.known_limits as string[]).includes('AX provider enabled unavailable/uncertain'))
    assert.ok(result.known_limits.includes('DOM provider actionability unavailable/uncertain'))
    assert.ok(result.known_limits.includes('AX provider enabled unavailable/uncertain'))
  })

  it('marks present source groups unknown when they do not participate in audited comparison', () => {
    const evidence = evidenceRefs()
    const [captureArtifact, captureContractArtifact] = evidence
    const items = [
      makeItem({
        item_id: 'dom_0',
        kind: 'dom_button',
        text: 'Search',
        provider_score: 0.82,
        detail: cleanDomDetail(captureArtifact!, captureContractArtifact!),
      }),
      makeItem({
        item_id: 'ocr_far',
        kind: 'ocr_text',
        text: 'Search',
        box: { x: 500, y: 500, width: 120, height: 36 },
        detail: cleanOcrDetail(captureArtifact!, captureContractArtifact!),
      }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'button', text: /search/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath, 'run_1', 'span_1', evidence)
    const audit = crossSourceAudit(result)
    const ocrSource = (audit.sources as Array<Record<string, unknown>>).find(source => source.source === 'ocr_text')!

    assert.equal(audit.status, 'unknown')
    assert.equal(ocrSource.status, 'unknown')
    assert.ok((ocrSource.known_limits as string[]).some(limit => limit.includes('not comparable to filtered candidates')))
  })

  it('treats substring text matches as conflict unless normalized text is exactly equal', () => {
    const evidence = evidenceRefs()
    const [captureArtifact, captureContractArtifact] = evidence
    const items = [
      makeItem({
        item_id: 'dom_research',
        kind: 'dom_button',
        text: 'Research',
        provider_score: 0.82,
        detail: cleanDomDetail(captureArtifact!, captureContractArtifact!),
      }),
      makeItem({
        item_id: 'ocr_search',
        kind: 'ocr_text',
        text: 'Search',
        provider_score: 0.96,
        detail: cleanOcrDetail(captureArtifact!, captureContractArtifact!),
      }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'button', text: /research/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath, 'run_1', 'span_1', evidence)
    const audit = crossSourceAudit(result)
    const domAudit = (audit.items as Array<Record<string, unknown>>).find(item => item.item_id === 'dom_research')!

    assert.equal(audit.status, 'conflict')
    assert.equal(domAudit.status, 'conflict')
    assert.deepEqual(domAudit.compared_item_ids, ['ocr_search'])
    assert.ok(result.known_limits.some(limit => limit.includes('text conflicts')))
  })

  it('propagates multiple filtered candidate ambiguity into audit known limits', () => {
    const evidence = evidenceRefs()
    const [captureArtifact, captureContractArtifact] = evidence
    const items = [
      makeItem({
        item_id: 'ocr_0',
        kind: 'ocr_text',
        text: 'Search',
        detail: cleanOcrDetail(captureArtifact!, captureContractArtifact!),
      }),
      makeItem({
        item_id: 'dom_0',
        kind: 'dom_button',
        text: 'Search',
        provider_score: 0.82,
        detail: cleanDomDetail(captureArtifact!, captureContractArtifact!),
      }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }

    const result = recognizeFromCapture(items, target, contract, screenshotPath, 'run_1', 'span_1', evidence)
    const audit = crossSourceAudit(result)

    assert.equal(result.filtered.length, 2)
    assert.equal(audit.status, 'unknown')
    assert.ok((audit.known_limits as string[]).some(limit => limit.includes('multiple filtered candidates')))
  })
})
