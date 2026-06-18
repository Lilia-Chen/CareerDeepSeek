import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { MacOSChromeAgentHarness } from '../../src/computer-use/macos-chrome-driver/agent-harness.js'
import type {
  CandidatePromotion,
  ChromeRecognitionTarget,
  ChromeWindowCapture,
  ObservationSnapshot,
  PromotedCandidate,
  RecognitionResult,
  SurfaceNode,
} from '../../src/computer-use/macos-chrome-driver/types.js'

describe('macOS Chrome legacy agent harness adapter', () => {
  it('clicks an observed button through observe, recognize, promote, click, observe', async () => {
    const driver = new FakeHarnessDriver([
      observation('before', [
        node('button-1', 'ocr_text', 'Hide sponsored result', box(35, 376, 652, 56)),
      ]),
      observation('after', [
        node('result-1', 'dom_link', 'Top 120 Agentic AI Companies', box(35, 420, 500, 40)),
      ]),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.clickObservedButton(/hide sponsored result/i, {
      reason: 'Collapse sponsored Google result before evaluating organic sources.',
    })

    assert.equal(driver.calls[0]?.name, 'observe')
    assert.deepEqual(driver.calls[1], {
      name: 'recognize',
      target: { kind: 'ocr_text', text: /hide sponsored result/i },
    })
    assert.equal(driver.calls[2]?.name, 'promote')
    assert.equal(driver.calls[3]?.name, 'click')
    assert.equal(driver.calls[4]?.name, 'observe')
    assert.equal(result.action, 'click')
    assert.equal(result.before.snapshot_id, 'before')
    assert.equal(result.after.snapshot_id, 'after')
  })

  it('throws a useful error when promotion refuses the candidate', async () => {
    const driver = new FakeHarnessDriver([
      observation('before', [
        node('button-1', 'ocr_text', 'Danger', box(10, 10, 60, 30)),
      ]),
    ])
    driver.nextPromotion = { status: 'refused', reasons: ['hard_stop_signal'], residual_known_limits: [] }
    const harness = new MacOSChromeAgentHarness(driver)

    await assert.rejects(
      () => harness.clickObservedButton(/danger/i, { reason: 'test refusal' }),
      /Promotion refused: hard_stop_signal/,
    )

    assert.equal(driver.calls.some(call => call.name === 'click'), false)
  })

  it('uses OCR-compatible recognition targets for semantic click helpers', async () => {
    const driver = new FakeHarnessDriver([
      observation('button-before', [
        node('hide-sponsored', 'ocr_text', 'Hide sponsored result', box(35, 376, 652, 56)),
      ]),
      observation('button-after', []),
      observation('link-before', [
        node('company-link', 'ocr_row', 'Synthetic Agent Lab Careers', box(40, 180, 420, 44)),
      ]),
      observation('link-after', []),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    await harness.clickObservedButton(/hide sponsored result/i, { reason: 'Collapse sponsored result.' })
    await harness.clickObservedLink(/synthetic agent lab careers/i, { reason: 'Open company result.' })

    const recognizeCalls = driver.calls.filter(call => call.name === 'recognize')
    assert.deepEqual(recognizeCalls.map(call => call.target), [
      { kind: 'ocr_text', text: /hide sponsored result/i },
      { kind: 'ocr_text', text: /synthetic agent lab careers/i },
    ])
  })

  it('focuses a promoted ax_node text input before typing without clickCandidate', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-type', [
        node('search-input', 'ax_textfield', 'Search', box(90, 76, 124, 38)),
      ]),
      observation('after-type', []),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    await harness.typeIntoObservedInput(/^search$/i, 'agent infrastructure', {
      reason: 'Focus search field and type query.',
    })

    assert.deepEqual(driver.calls[1], {
      name: 'recognize',
      target: { kind: 'text_input', name: /^search$/i },
    })
    assert.equal(driver.calls[2]?.name, 'promote')
    assert.equal(driver.calls[3]?.name, 'focusTextInput')
    assert.deepEqual(driver.calls[4], {
      name: 'typeText',
      text: 'agent infrastructure',
    })
    assert.equal(driver.calls.some(call => call.name === 'click'), false)
  })

  it('does not fall back to OCR click when text input recognition fails before typing', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-type', [
        node('search-input-label', 'ocr_text', 'Search', box(90, 76, 124, 38)),
      ]),
    ])
    driver.failTextInputRecognition = true
    const harness = new MacOSChromeAgentHarness(driver)

    await assert.rejects(
      () => harness.typeIntoObservedInput(/^search$/i, 'agent infrastructure', {
        reason: 'Focus search field and type query.',
      }),
      /text_input recognition failed/i,
    )

    assert.deepEqual(driver.calls[1], {
      name: 'recognize',
      target: { kind: 'text_input', name: /^search$/i },
    })
    assert.equal(driver.calls.some(call => call.name === 'click'), false)
    assert.equal(driver.calls.some(call => call.name === 'focusTextInput'), false)
    assert.equal(driver.calls.some(call => call.name === 'typeText'), false)
  })

  it('refuses legacy pressEnter without explicit focus provenance', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-press', []),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    await assert.rejects(
      () => harness.pressEnter({ reason: 'Submit typed search query.' }),
      /focusTextInput provenance/i,
    )

    assert.equal(driver.calls.some(call => call.name === 'pressKey'), false)
  })

  it('does not expose targetless scroll or overlay dismissal helpers under P1.5', () => {
    const prototype = MacOSChromeAgentHarness.prototype as unknown as Record<string, unknown>

    assert.equal('scrollDown' in prototype, false)
    assert.equal('scrollUp' in prototype, false)
    assert.equal('dismissKnownOverlay' in prototype, false)
  })

  it('rejects goBack recovery in P1.5 without recognizing or clicking Chrome Back', async () => {
    const driver = new FakeHarnessDriver([
      observation('wrong-page', [
        node('back', 'ocr_text', 'Back', box(6, 79, 34, 34)),
      ]),
      observation('previous-page', []),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    await assert.rejects(
      () => harness.goBack({ reason: 'Recover from wrong navigation.' }),
      /browser recovery\/back\/close requires P2 transition contract/i,
    )

    assert.equal(driver.calls.some(call => call.name === 'recognize'), false)
    assert.equal(driver.calls.some(call => call.name === 'click'), false)
  })
})

class FakeHarnessDriver {
  readonly calls: Array<Record<string, unknown>> = []
  readonly observeErrorsByCall = new Map<number, Error>()
  nextPromotion?: CandidatePromotion
  failTextInputRecognition = false
  lastCapture?: ChromeWindowCapture

  readonly #observations: ObservationSnapshot[]

  constructor(observations: ObservationSnapshot[]) {
    this.#observations = [...observations]
  }

  async observe(): Promise<ObservationSnapshot> {
    const observeCallNumber = this.calls.filter(call => call.name === 'observe').length + 1
    this.calls.push({ name: 'observe' })
    const error = this.observeErrorsByCall.get(observeCallNumber)
    if (error)
      throw error
    const next = this.#observations.shift()
    if (!next)
      throw new Error('No fake observation available.')
    this.lastCapture = capture(next.snapshot_id)
    return next
  }

  async recognizeFromCapture(
    captureInput: ChromeWindowCapture,
    target: ChromeRecognitionTarget,
  ): Promise<RecognitionResult> {
    this.calls.push({ name: 'recognize', target })
    if (target.kind === 'text_input' && this.failTextInputRecognition)
      throw new Error('No text input candidate found.')
    const itemKind = target.kind === 'text_input' ? 'ax_textfield' : 'ocr_text'
    const itemLabel = target.kind === 'text_input'
      ? String(target.name)
      : 'recognized target'
    const recognized = item(itemKind, itemLabel)
    return {
      found: true,
      recognition_id: `rec_${captureInput.snapshotId}`,
      source: 'ocr_text',
      scope: {
        surface: 'window',
        window_number: 42,
        capture_artifact: { run_id: 'run', artifact_id: `shot_${captureInput.snapshotId}`, span_id: 'span' },
      },
      best: recognized,
      filtered: [recognized],
      all: [recognized],
      detail: {
        candidate_count: 1,
        source_counts: { ocr: 1, ax: 0, dom: 0 },
        cross_source_audit: { status: 'unknown', matched_sources: ['ocr'], missing_sources: [], notes: [] },
      },
      evidence: [{ run_id: 'run', artifact_id: `recognition_${captureInput.snapshotId}`, span_id: 'span' }],
      known_limits: [],
    }
  }

  async promoteCandidate(
    recognition: RecognitionResult,
    _capture: ChromeWindowCapture,
  ): Promise<CandidatePromotion> {
    this.calls.push({ name: 'promote' })
    if (this.nextPromotion)
      return this.nextPromotion
    return { status: 'promoted', candidate: candidate(recognition), residual_known_limits: [] }
  }

  async click(_candidate: PromotedCandidate): Promise<void> {
    this.calls.push({ name: 'click' })
  }

  async focusTextInput(_candidate: PromotedCandidate): Promise<void> {
    this.calls.push({ name: 'focusTextInput' })
  }

  async typeText(text: string): Promise<void> {
    this.calls.push({ name: 'typeText', text })
  }

  async pressKey(key: string, modifiers: string[] = []): Promise<void> {
    this.calls.push({ name: 'pressKey', key, modifiers })
  }
}

function observation(
  snapshotId: string,
  nodes: SurfaceNode[],
  detail: Record<string, unknown> = {},
): ObservationSnapshot {
  return {
    api_version: 'careerdeepseek.observation_snapshot.v1alpha1',
    snapshot_id: snapshotId,
    run_id: 'run',
    span_id: 'span',
    captured_at_millis: Date.now(),
    source: 'merged',
    scope: {
      surface: 'window',
      window_number: 42,
      app_bundle_id: 'com.google.Chrome',
      window_title: 'Chrome',
      capture_artifact: { run_id: 'run', artifact_id: `shot_${snapshotId}`, span_id: 'span' },
    },
    capture_contract_ref: { run_id: 'run', artifact_id: `contract_${snapshotId}`, span_id: 'span' },
    evidence: [{ run_id: 'run', artifact_id: `shot_${snapshotId}`, span_id: 'span' }],
    nodes,
    detail,
    known_limits: [],
  }
}

function capture(snapshotId: string): ChromeWindowCapture {
  return {
    snapshotId,
    screenshot: {
      dataBase64: '',
      mimeType: 'image/png',
      path: `/tmp/${snapshotId}.png`,
      width: 1000,
      height: 800,
      capturedAt: new Date().toISOString(),
    },
    contract: {
      coordinateContractVersion: 1,
      captureSource: {
        kind: 'window',
        windowNumber: 42,
        ownerPid: 123,
        ownerBundleId: 'com.google.Chrome',
      },
      sourceGlobalLogicalBounds: { x: 0, y: 0, width: 1000, height: 800 },
      screenshotPixelSize: { width: 1000, height: 800 },
      pixelToLogicalScale: { x: 1, y: 1 },
      logicalToPixelScale: { x: 1, y: 1 },
      capturedAt: new Date().toISOString(),
    },
  }
}

function candidate(recognition: RecognitionResult): PromotedCandidate {
  const best = recognition.best ?? item('ocr_text', 'recognized target')
  const grounding = best.kind === 'ax_textfield' ? 'ax_node' : 'ocr_anchor'
  const label = best.text ?? 'recognized target'
  return {
    candidate_local_id: 'candidate_1',
    label,
    kind: best.kind,
    target_spec: {
      box: best.box,
      anchor_text: label,
      grounding,
    },
    evidence: {
      capture_artifact: { run_id: 'run', artifact_id: 'shot', span_id: 'span' },
      recognition_artifact: { run_id: 'run', artifact_id: 'recognition', span_id: 'span' },
      observation_blob: best as unknown as Record<string, unknown>,
    },
    liveness: {
      preconditions: {
        window_ref: { app_bundle_id: 'com.google.Chrome', window_number: 42 },
        anchor_recheck: {
          text: label,
          expected_min_confidence: 0.3,
          max_pixel_distance: 50,
        },
      },
    },
    control: { requires_app_frontmost: true, requires_window_focus: true },
    source_run_id: 'run',
    source_span_id: 'span',
    source_operation_id: recognition.recognition_id,
    source_artifact_id: 'recognition',
    known_limits: [],
  }
}

function item(kind: string, label: string): RecognitionResult['all'][number] {
  return {
    item_id: 'item_1',
    kind,
    text: label,
    box: box(40, 20, 60, 24),
    provider_score: 0.9,
    detail: {},
  }
}

function node(id: string, kind: string, label: string, nodeBox: ReturnType<typeof box>): SurfaceNode {
  return {
    node_ref: {
      run_id: 'run',
      span_id: 'span',
      node_id: id,
    },
    kind,
    label,
    box: nodeBox,
    source_artifacts: [],
    detail: {},
  }
}

function box(x: number, y: number, width: number, height: number) {
  return { x, y, width, height }
}
