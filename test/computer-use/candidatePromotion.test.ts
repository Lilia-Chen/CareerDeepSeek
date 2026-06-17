import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { promoteCandidate } from '../../src/computer-use/macos-chrome-driver/candidate-promotion.js'
import { recognizeFromCapture } from '../../src/computer-use/macos-chrome-driver/recognition.js'
import type { ArtifactRef, CandidatePromotion, ChromeCaptureContract, ChromeRecognitionTarget, ChromeWindowRef, RecognitionResult, RecognizedItem } from '../../src/computer-use/macos-chrome-driver/types.js'

const captureArtifact: ArtifactRef = { run_id: 'r1', artifact_id: 'screenshot_mco_1', span_id: 'observe_mco_1' }
const captureContractArtifact: ArtifactRef = { run_id: 'r1', artifact_id: 'capture_contract_mco_1', span_id: 'observe_mco_1' }
const recognitionArtifact: ArtifactRef = { run_id: 'r1', artifact_id: 'recognition_mcr_1', span_id: 'recognize_1' }

// @ts-expect-error refused CandidatePromotion requires residual_known_limits.
const refusedPromotionWithoutResidualKnownLimits: CandidatePromotion = { status: 'refused', reasons: ['hard_stop_signal'] }
void refusedPromotionWithoutResidualKnownLimits

function makeRecognition(overrides: Partial<RecognitionResult> & { best: RecognizedItem | null, all: RecognizedItem[], filtered: RecognizedItem[] }): RecognitionResult {
  const scope = {
    surface: 'window' as const,
    window_number: 42,
    app_bundle_id: 'com.google.Chrome',
    capture_artifact: captureArtifact,
    capture_contract_artifact: captureContractArtifact,
    ...overrides.scope,
  }
  const detail = overrides.detail ?? {
    cross_source_audit: overrides.best
      ? auditFor(overrides.best)
      : {
          status: 'unknown',
          artifact_refs: {
            capture_artifact: captureArtifact,
            capture_contract_artifact: captureContractArtifact,
          },
          items: [],
          known_limits: ['recognition audit: no filtered candidate to compare'],
        },
  }

  return {
    recognition_id: overrides.recognition_id ?? 'mcr_1',
    source: overrides.source ?? 'ocr_row',
    scope,
    detail,
    evidence: overrides.evidence ?? [captureArtifact, captureContractArtifact],
    known_limits: overrides.known_limits ?? [],
    found: overrides.found ?? false,
    best: overrides.best,
    all: overrides.all,
    filtered: overrides.filtered,
  }
}

function makeItem(overrides: Partial<RecognizedItem> & { item_id: string }): RecognizedItem {
  const box = overrides.box ?? { x: 100, y: 200, width: 120, height: 40 }
  const detail = {
    actionable: true,
    bounds: {
      source_global_logical: box,
    },
    source_artifacts: {
      capture_artifact: captureArtifact,
      capture_contract_artifact: captureContractArtifact,
    },
    known_limits: [],
    ...overrides.detail,
  }

  return {
    item_id: overrides.item_id,
    kind: overrides.kind ?? 'dom_button',
    text: overrides.text ?? 'Accept',
    box,
    provider_score: overrides.provider_score ?? 0.9,
    detail,
  }
}

function makeOcrItem(overrides: Partial<RecognizedItem> & { item_id: string }): RecognizedItem {
  const box = overrides.box ?? { x: 100, y: 200, width: 120, height: 40 }
  return makeItem({
    kind: 'ocr_text',
    ...overrides,
    detail: {
      actionable: true,
      bounds: {
        capture_pixel: { x: box.x, y: box.y - 40, width: box.width, height: box.height },
        source_global_logical: box,
      },
      source_artifacts: {
        capture_artifact: captureArtifact,
        capture_contract_artifact: captureContractArtifact,
      },
      known_limits: [],
      ...overrides.detail,
    },
  })
}

function makeOcrRowItem(overrides: Partial<RecognizedItem> & { item_id: string }): RecognizedItem {
  const box = overrides.box ?? { x: 100, y: 200, width: 120, height: 40 }
  return makeItem({
    kind: 'ocr_row',
    ...overrides,
    detail: {
      actionable: true,
      row_bounds: {
        capture_pixel: { x: box.x, y: box.y - 40, width: box.width, height: box.height },
        source_global_logical: box,
      },
      source_artifacts: {
        capture_artifact: captureArtifact,
        capture_contract_artifact: captureContractArtifact,
      },
      known_limits: [],
      ...overrides.detail,
    },
  })
}

function auditFor(
  item: RecognizedItem,
  options: {
    status?: 'agreement' | 'conflict' | 'unknown'
    itemStatus?: 'agreement' | 'conflict' | 'unknown'
    itemId?: string
    comparedItemIds?: string[]
    reasons?: string[]
    knownLimits?: string[]
    itemKnownLimits?: string[]
  } = {},
): Record<string, unknown> {
  const sourceGroup = sourceGroupForKind(item.kind)
  const status = options.status ?? 'agreement'
  const itemStatus = options.itemStatus ?? status
  const knownLimits = options.knownLimits ?? []
  const itemKnownLimits = options.itemKnownLimits ?? []

  return {
    status,
    source_groups: [sourceGroup, 'capture_visibility'],
    sources: [
      {
        source: sourceGroup,
        status: itemStatus,
        item_ids: [item.item_id],
        artifact_ids: [captureArtifact.artifact_id, captureContractArtifact.artifact_id],
        known_limits: itemKnownLimits,
      },
      {
        source: 'capture_visibility',
        status: 'unknown',
        item_ids: [],
        artifact_ids: [captureArtifact.artifact_id, captureContractArtifact.artifact_id],
        known_limits: ['recognition audit: capture visibility is reference evidence only; independent visibility verification unavailable'],
      },
    ],
    artifact_refs: {
      capture_artifact: captureArtifact,
      capture_contract_artifact: captureContractArtifact,
    },
    items: [
      {
        item_id: options.itemId ?? item.item_id,
        kind: item.kind,
        source_group: sourceGroup,
        status: itemStatus,
        compared_item_ids: options.comparedItemIds ?? ['ocr_0'],
        compared_items: [],
        reasons: options.reasons ?? ['text and bounds agree in current capture'],
        artifact_refs: {
          capture_artifact: captureArtifact,
          capture_contract_artifact: captureContractArtifact,
        },
        known_limits: itemKnownLimits,
      },
    ],
    known_limits: knownLimits,
  }
}

function sourceGroupForKind(kind: string): string {
  if (kind === 'ocr_text')
    return 'ocr_text'
  if (kind === 'ocr_row')
    return 'ocr_row'
  if (kind.startsWith('dom_'))
    return 'chrome_dom'
  if (kind.startsWith('ax_'))
    return 'ax'
  return 'custom'
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
  id: '42',
  windowNumber: 42,
  appName: 'Google Chrome',
  ownerPid: 123,
  ownerBundleId: 'com.google.Chrome',
  title: 'Test',
  bounds: { x: 0, y: 40, width: 1000, height: 800 },
  layer: 0,
}

describe('promoteCandidate', () => {
  it('promotes when all conditions met', () => {
    const best = makeOcrItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })
    assert.equal(result.status, 'promoted')
    if (result.status === 'promoted') {
      assert.equal(result.candidate.kind, 'ocr_text')
      assert.ok(result.candidate.candidate_local_id.includes('mcr_1'))
      assert.equal(result.candidate.source_run_id, 'r1')
      assert.deepEqual(result.candidate.evidence.capture_artifact, captureArtifact)
      assert.deepEqual(result.candidate.evidence.recognition_artifact, recognitionArtifact)
      assert.equal(result.candidate.source_artifact_id, recognitionArtifact.artifact_id)
      assert.equal(result.candidate.evidence.capture_artifact.artifact_id.startsWith('capture_'), false)
    }
  })

  it('refuses DOM and AX actionable evidence as promoted click candidates', () => {
    const unsupportedKinds = [
      'dom_button',
      'dom_link',
      'dom_textbox',
      'dom_searchbox',
      'dom_combobox',
      'ax_button',
      'ax_link',
      'ax_textfield',
      'ax_textarea',
      'ax_combobox',
      'ax_menu_item',
      'ax_tab',
    ]

    for (const kind of unsupportedKinds) {
      const best = makeItem({ item_id: kind, kind })
      const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
      const result = promoteCandidate(recognition, capture, window, {
        profile_verified: true,
        chrome_foreground: true,
        hard_stop_signals: [],
        ttl_ms: 5000,
        run_id: 'r1',
        span_id: 's1',
        capture_artifact: captureArtifact,
        recognition_artifact: recognitionArtifact,
      })

      assert.equal(result.status, 'refused', `${kind} must remain read-only evidence`)
      if (result.status === 'refused')
        assert.ok(result.reasons.includes('item_not_actionable'), `${kind} should report item_not_actionable`)
    }
  })

  it('promotes OCR text and OCR row click candidates when all conditions pass', () => {
    const cases = [
      makeOcrItem({ item_id: 'ocr-text' }),
      makeOcrRowItem({ item_id: 'ocr-row' }),
    ]

    for (const best of cases) {
      const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
      const result = promoteCandidate(recognition, capture, window, {
        profile_verified: true,
        chrome_foreground: true,
        hard_stop_signals: [],
        ttl_ms: 5000,
        run_id: 'r1',
        span_id: 's1',
        capture_artifact: captureArtifact,
        recognition_artifact: recognitionArtifact,
      })

      assert.equal(result.status, 'promoted')
      if (result.status === 'promoted')
        assert.equal(result.candidate.kind, best.kind)
    }
  })

  it('refuses promotion instead of inventing missing capture or recognition artifact refs', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({
      best,
      all: [best],
      filtered: [best],
      found: true,
      evidence: [],
      scope: {
        surface: 'window',
        window_number: 42,
        app_bundle_id: 'com.google.Chrome',
        capture_artifact: undefined,
        capture_contract_artifact: undefined,
      },
    })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
    })
    assert.equal(result.status, 'refused')
    if (result.status === 'refused') {
      assert.ok(result.reasons.includes('missing_capture_artifact'))
      assert.ok(result.reasons.includes('no_runtime_evidence'))
    }
  })

  it('refuses when cross-source audit reports conflict', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({
      best,
      all: [best],
      filtered: [best],
      found: true,
      detail: {
        cross_source_audit: auditFor(best, {
          status: 'conflict',
          itemStatus: 'agreement',
          knownLimits: ['recognition audit: item 0 has conflicting cross-source evidence'],
        }),
      },
      known_limits: ['recognition audit: item 0 has conflicting cross-source evidence'],
    })

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'refused')
    if (result.status === 'refused') {
      assert.ok(result.reasons.includes('cross_source_conflict'))
      assert.ok(Array.isArray(result.residual_known_limits))
      assert.ok(result.residual_known_limits.some(limit => limit.includes('conflicting cross-source evidence')))
    }
  })

  it('promotes unknown audit caused only by no comparable source evidence and carries known limits', () => {
    const best = makeItem({
      item_id: '0',
      kind: 'ocr_text',
      detail: {
        actionable: true,
        bounds: {
          capture_pixel: { x: 100, y: 160, width: 120, height: 40 },
          source_global_logical: { x: 100, y: 200, width: 120, height: 40 },
        },
        source_artifacts: {
          capture_artifact: captureArtifact,
          capture_contract_artifact: captureContractArtifact,
        },
        known_limits: [],
      },
    })
    const limit = 'recognition audit: item 0 has no comparable cross-source evidence'
    const recognition = makeRecognition({
      best,
      all: [best],
      filtered: [best],
      found: true,
      detail: {
        cross_source_audit: auditFor(best, {
          status: 'unknown',
          itemStatus: 'unknown',
          comparedItemIds: [],
          reasons: ['no comparable evidence from another source'],
          knownLimits: [limit],
          itemKnownLimits: [limit],
        }),
      },
      known_limits: [limit],
    })

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'promoted')
    if (result.status === 'promoted') {
      assert.ok(result.residual_known_limits.includes(limit))
      assert.ok(result.candidate.known_limits.includes(limit))
    }
  })

  it('promotes OCR candidate when AX semantic evidence only differs by OCR confusable text', () => {
    const box = { x: 100, y: 200, width: 240, height: 40 }
    const best = makeOcrItem({
      item_id: 'ocr_typo',
      text: 'Al agent infrastructure',
      box,
    })
    const axEvidence = makeItem({
      item_id: 'ax_semantic',
      kind: 'ax_evidence',
      text: 'AI agent infrastructure',
      box,
      detail: {
        bounds: {
          source_global_logical: box,
        },
        source_artifacts: {
          capture_artifact: captureArtifact,
          capture_contract_artifact: captureContractArtifact,
        },
        known_limits: [],
      },
    })
    const target: ChromeRecognitionTarget = { kind: 'ocr_text', text: /AI agent infrastructure/i }
    const recognition = recognizeFromCapture(
      [best, axEvidence],
      target,
      capture,
      '/tmp/test-chrome.png',
      'r1',
      's1',
      [captureArtifact, captureContractArtifact],
    )

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'promoted')
    if (result.status === 'promoted') {
      assert.equal(result.candidate.label, 'AI agent infrastructure')
      assert.equal(result.candidate.target_spec.anchor_text, 'AI agent infrastructure')
      assert.equal(result.candidate.liveness.preconditions.anchor_recheck?.text, 'Al agent infrastructure')
      assert.deepEqual(result.candidate.evidence.observation_blob.text_resolution, {
        canonical_text: 'AI agent infrastructure',
        canonical_source: 'ax',
        ocr_raw_text: 'Al agent infrastructure',
        correction_reason: 'OCR confusable text corrected from semantic source ax',
      })
      assert.ok(result.residual_known_limits.some(limit => limit.includes('OCR raw text differs from semantic source ax')))
    }
  })

  it('refuses OCR candidate when cross-source evidence names a different target', () => {
    const box = { x: 100, y: 200, width: 120, height: 40 }
    const best = makeOcrItem({
      item_id: 'ocr_cancel',
      text: 'Cancel',
      box,
    })
    const domEvidence = makeItem({
      item_id: 'dom_submit',
      kind: 'dom_evidence',
      text: 'Submit',
      box,
      detail: {
        bounds: {
          source_global_logical: box,
        },
        source_artifacts: {
          capture_artifact: captureArtifact,
          capture_contract_artifact: captureContractArtifact,
        },
        known_limits: [],
      },
    })
    const target: ChromeRecognitionTarget = { kind: 'ocr_text', text: /cancel/i }
    const recognition = recognizeFromCapture(
      [best, domEvidence],
      target,
      capture,
      '/tmp/test-chrome.png',
      'r1',
      's1',
      [captureArtifact, captureContractArtifact],
    )

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'refused')
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('cross_source_conflict'))
  })

  it('promotes OCR candidate when semantic evidence is a coarser nested button label', () => {
    const ocrBox = { x: 292.5, y: 379.5, width: 170, height: 16 }
    const best = makeOcrItem({
      item_id: 'ocr_hide_sponsored',
      text: 'Hide sponsored result ^',
      box: ocrBox,
    })
    const domButton = makeItem({
      item_id: 'dom_hide_sponsored',
      kind: 'dom_button',
      text: 'Hide sponsored result',
      box: { x: 53, y: 366, width: 652, height: 56 },
      detail: {
        bounds: {
          source_global_logical: { x: 53, y: 366, width: 652, height: 56 },
        },
        source_artifacts: {
          capture_artifact: captureArtifact,
          capture_contract_artifact: captureContractArtifact,
        },
        known_limits: [],
      },
    })
    const target: ChromeRecognitionTarget = { kind: 'ocr_text', text: /Hide sponsored result/i }
    const recognition = recognizeFromCapture(
      [best, domButton],
      target,
      capture,
      '/tmp/test-chrome.png',
      'r1',
      's1',
      [captureArtifact, captureContractArtifact],
    )

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'promoted')
    if (result.status === 'promoted') {
      assert.equal(result.candidate.label, 'Hide sponsored result ^')
      assert.equal(result.candidate.liveness.preconditions.anchor_recheck?.text, 'Hide sponsored result ^')
      assert.ok(result.residual_known_limits.some(limit => limit.includes('text is nested')))
    }
  })

  it('refuses when cross-source audit is missing or malformed', () => {
    const best = makeItem({ item_id: '0' })
    const cases: RecognitionResult[] = [
      makeRecognition({ best, all: [best], filtered: [best], found: true, detail: {} }),
      makeRecognition({ best, all: [best], filtered: [best], found: true, detail: { cross_source_audit: 'not-an-audit' } }),
    ]

    for (const recognition of cases) {
      const result = promoteCandidate(recognition, capture, window, {
        profile_verified: true,
        chrome_foreground: true,
        hard_stop_signals: [],
        ttl_ms: 5000,
        run_id: 'r1',
        span_id: 's1',
        capture_artifact: captureArtifact,
        recognition_artifact: recognitionArtifact,
      })

      assert.equal(result.status, 'refused')
      if (result.status === 'refused')
        assert.ok(result.reasons.includes('audit_unavailable'))
    }
  })

  it('refuses when audit known_limits arrays contain non-strings', () => {
    const best = makeItem({ item_id: '0' })
    const topLevelMalformed = auditFor(best)
    topLevelMalformed.known_limits = ['ok', 1]
    const sourceMalformed = auditFor(best)
    const malformedSources = sourceMalformed.sources as Array<Record<string, unknown>>
    malformedSources[0]!.known_limits = ['ok', false]
    const itemMalformed = auditFor(best)
    const malformedItems = itemMalformed.items as Array<Record<string, unknown>>
    malformedItems[0]!.known_limits = ['ok', { invalid: true }]
    const cases = [topLevelMalformed, sourceMalformed, itemMalformed]

    for (const cross_source_audit of cases) {
      const recognition = makeRecognition({
        best,
        all: [best],
        filtered: [best],
        found: true,
        detail: { cross_source_audit },
      })

      const result = promoteCandidate(recognition, capture, window, {
        profile_verified: true,
        chrome_foreground: true,
        hard_stop_signals: [],
        ttl_ms: 5000,
        run_id: 'r1',
        span_id: 's1',
        capture_artifact: captureArtifact,
        recognition_artifact: recognitionArtifact,
      })

      assert.equal(result.status, 'refused')
      if (result.status === 'refused')
        assert.ok(result.reasons.includes('audit_unavailable'))
    }
  })

  it('refuses incomplete audit shapes missing sources, source groups, or item reasons', () => {
    const best = makeItem({ item_id: '0' })
    const missingSourceGroups = auditFor(best)
    delete missingSourceGroups.source_groups
    const missingSources = auditFor(best)
    delete missingSources.sources
    const missingReasons = auditFor(best)
    delete (missingReasons.items as Array<Record<string, unknown>>)[0]!.reasons
    const cases = [missingSourceGroups, missingSources, missingReasons]

    for (const cross_source_audit of cases) {
      const recognition = makeRecognition({
        best,
        all: [best],
        filtered: [best],
        found: true,
        detail: { cross_source_audit },
      })

      const result = promoteCandidate(recognition, capture, window, {
        profile_verified: true,
        chrome_foreground: true,
        hard_stop_signals: [],
        ttl_ms: 5000,
        run_id: 'r1',
        span_id: 's1',
        capture_artifact: captureArtifact,
        recognition_artifact: recognitionArtifact,
      })

      assert.equal(result.status, 'refused')
      if (result.status === 'refused')
        assert.ok(result.reasons.includes('audit_unavailable'))
    }
  })

  it('refuses when source conflict is hidden behind agreement rollup', () => {
    const best = makeItem({ item_id: '0' })
    const audit = auditFor(best, { status: 'agreement', itemStatus: 'agreement' })
    const sources = audit.sources as Array<Record<string, unknown>>
    sources[0]!.status = 'conflict'
    const recognition = makeRecognition({
      best,
      all: [best],
      filtered: [best],
      found: true,
      detail: { cross_source_audit: audit },
    })

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'refused')
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('cross_source_conflict'))
  })

  it('refuses when compared item conflict is hidden behind agreement rollup', () => {
    const best = makeItem({ item_id: '0' })
    const audit = auditFor(best, {
      status: 'agreement',
      itemStatus: 'agreement',
      comparedItemIds: ['ocr_conflict'],
    })
    const item = (audit.items as Array<Record<string, unknown>>)[0]!
    item.compared_items = [
      {
        item_id: 'ocr_conflict',
        kind: 'ocr_text',
        source_group: 'ocr_text',
        status: 'conflict',
        reasons: ['overlapping bounds but text differs'],
        known_limits: ['recognition audit: text conflicts'],
      },
    ]
    audit.source_groups = ['chrome_dom', 'ocr_text', 'capture_visibility']
    const sources = audit.sources as Array<Record<string, unknown>>
    sources.push({
      source: 'ocr_text',
      status: 'agreement',
      item_ids: ['ocr_conflict'],
      artifact_ids: [captureArtifact.artifact_id, captureContractArtifact.artifact_id],
      known_limits: [],
    })
    const recognition = makeRecognition({
      best,
      all: [best],
      filtered: [best],
      found: true,
      detail: { cross_source_audit: audit },
    })

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'refused')
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('cross_source_conflict'))
  })

  it('refuses when compared item ids do not match compared item payloads', () => {
    const best = makeItem({ item_id: '0' })
    const audit = auditFor(best, { comparedItemIds: ['ocr_expected'] })
    const item = (audit.items as Array<Record<string, unknown>>)[0]!
    item.compared_items = [
      {
        item_id: 'ocr_actual',
        kind: 'ocr_text',
        source_group: 'ocr_text',
        status: 'agreement',
        reasons: ['text and bounds agree in current capture'],
        known_limits: [],
      },
    ]
    audit.source_groups = ['chrome_dom', 'ocr_text', 'capture_visibility']
    const sources = audit.sources as Array<Record<string, unknown>>
    sources.push({
      source: 'ocr_text',
      status: 'agreement',
      item_ids: ['ocr_actual'],
      artifact_ids: [captureArtifact.artifact_id, captureContractArtifact.artifact_id],
      known_limits: [],
    })
    const recognition = makeRecognition({
      best,
      all: [best],
      filtered: [best],
      found: true,
      detail: { cross_source_audit: audit },
    })

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'refused')
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('audit_unavailable'))
  })

  it('refuses when selected item source group is missing from audit sources', () => {
    const best = makeItem({ item_id: '0' })
    const audit = auditFor(best)
    audit.sources = (audit.sources as Array<Record<string, unknown>>)
      .filter(source => source.source !== 'chrome_dom')
    const recognition = makeRecognition({
      best,
      all: [best],
      filtered: [best],
      found: true,
      detail: { cross_source_audit: audit },
    })

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'refused')
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('audit_unavailable'))
  })

  it('promotes valid summary audit without compared item payloads', () => {
    const best = makeOcrItem({ item_id: '0' })
    const audit = auditFor(best, { comparedItemIds: ['ocr_0'] })
    delete (audit.items as Array<Record<string, unknown>>)[0]!.compared_items
    const recognition = makeRecognition({
      best,
      all: [best],
      filtered: [best],
      found: true,
      detail: { cross_source_audit: audit },
    })

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'promoted')
  })

  it('refuses when the best item has no matching audit item', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({
      best,
      all: [best],
      filtered: [best],
      found: true,
      detail: { cross_source_audit: auditFor(best, { itemId: 'other-item' }) },
    })

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'refused')
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('audit_unavailable'))
  })

  it('refuses when multiple filtered candidates remain', () => {
    const best = makeItem({ item_id: '0' })
    const other = makeItem({ item_id: '1', text: 'Accept cookies' })
    const recognition = makeRecognition({
      best,
      all: [best, other],
      filtered: [best, other],
      found: true,
      known_limits: ['recognition: multiple filtered candidates (2) remain ambiguous'],
    })

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'refused')
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('ambiguous_recognition'))
  })

  it('refuses visual_row as non-actionable promotion input', () => {
    const best = makeItem({ item_id: '0', kind: 'visual_row' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'refused')
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('item_not_actionable'))
  })

  it('refuses invalid or unprojected coordinate boxes before promotion', () => {
    const invalidBox = makeItem({ item_id: '0', box: { x: 100, y: 200, width: 0, height: 40 } })
    const unprojected = makeItem({
      item_id: '1',
      kind: 'ocr_text',
      detail: {
        actionable: true,
        raw_pixel_bounds: { x: 100, y: 200, width: 120, height: 40 },
        source_artifacts: {
          capture_artifact: captureArtifact,
          capture_contract_artifact: captureContractArtifact,
        },
      },
    })
    const cases = [invalidBox, unprojected]

    for (const best of cases) {
      const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
      const result = promoteCandidate(recognition, capture, window, {
        profile_verified: true,
        chrome_foreground: true,
        hard_stop_signals: [],
        ttl_ms: 5000,
        run_id: 'r1',
        span_id: 's1',
        capture_artifact: captureArtifact,
        recognition_artifact: recognitionArtifact,
      })

      assert.equal(result.status, 'refused')
      if (result.status === 'refused')
        assert.ok(result.reasons.includes('projection_unavailable'))
    }
  })

  it('refuses when projected logical bounds disagree with the selected box', () => {
    const best = makeItem({
      item_id: '0',
      box: { x: 100, y: 200, width: 120, height: 40 },
      detail: {
        actionable: true,
        bounds: {
          source_global_logical: { x: 140, y: 200, width: 120, height: 40 },
        },
        source_artifacts: {
          capture_artifact: captureArtifact,
          capture_contract_artifact: captureContractArtifact,
        },
      },
    })
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'refused')
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('projection_unavailable'))
  })

  it('includes residual known limits on refused results', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({
      best,
      all: [best],
      filtered: [best],
      found: true,
      known_limits: ['recognition audit: provider degraded'],
    })

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: false,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'refused')
    if (result.status === 'refused')
      assert.deepEqual(result.residual_known_limits, ['recognition audit: provider degraded'])
  })

  it('stores selected item, audit detail, refs, and known limits in observation blob', () => {
    const best = makeOcrItem({ item_id: '0' })
    const limit = 'recognition audit: capture visibility is reference evidence only'
    const audit = auditFor(best, { status: 'unknown', itemStatus: 'agreement', knownLimits: [limit] })
    const recognition = makeRecognition({
      best,
      all: [best],
      filtered: [best],
      found: true,
      detail: { cross_source_audit: audit },
      known_limits: [limit],
    })

    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })

    assert.equal(result.status, 'promoted')
    if (result.status === 'promoted') {
      const blob = result.candidate.evidence.observation_blob
      assert.deepEqual(blob.best_item, best)
      assert.deepEqual(blob.filtered_item_ids, ['0'])
      assert.deepEqual(blob.audit_rollup, { status: 'unknown', known_limits: [limit] })
      assert.deepEqual(blob.selected_audit_item, (audit.items as Array<Record<string, unknown>>)[0])
      assert.deepEqual(blob.evidence_refs, {
        capture_artifact: captureArtifact,
        capture_contract_artifact: captureContractArtifact,
        recognition_artifact: recognitionArtifact,
      })
      assert.deepEqual(blob.known_limits, [limit])
    }
  })

  it('refuses with empty_recognition when all is empty', () => {
    const recognition = makeRecognition({ best: null, all: [], filtered: [], found: false })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })
    assert.equal(result.status, 'refused')
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('empty_recognition'))
  })

  it('refuses with profile_mismatch', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: false,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('profile_mismatch'))
  })

  it('refuses with chrome_not_foreground', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: false,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('chrome_not_foreground'))
  })

  it('refuses with hard_stop_signal', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: ['captcha'],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('hard_stop_signal'))
  })

  it('refuses with item_outside_viewport', () => {
    const best = makeItem({ item_id: '0', box: { x: 2000, y: 2000, width: 100, height: 40 } })
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('item_outside_viewport'))
  })

  it('refuses with stale_capture', () => {
    const best = makeItem({ item_id: '0' })
    const staleCapture = { ...capture, capturedAt: new Date(Date.now() - 6000).toISOString() }
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
    const result = promoteCandidate(recognition, staleCapture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })
    if (result.status === 'refused')
      assert.ok(result.reasons.includes('stale_capture'))
  })

  it('accumulates multiple refusal reasons', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best], found: true })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: false,
      chrome_foreground: false,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
      capture_artifact: captureArtifact,
      recognition_artifact: recognitionArtifact,
    })
    if (result.status === 'refused') {
      assert.ok(result.reasons.length >= 2)
      assert.ok(result.reasons.includes('profile_mismatch'))
      assert.ok(result.reasons.includes('chrome_not_foreground'))
    }
  })
})
