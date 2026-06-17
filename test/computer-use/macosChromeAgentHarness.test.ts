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

describe('macOS Chrome agent harness', () => {
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

  it('uses visible text as the OCR-backed focus target before typing', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-type', [
        node('search-input-label', 'ocr_text', 'Search', box(90, 76, 124, 38)),
      ]),
      observation('after-type', []),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    await harness.typeIntoObservedInput(/^search$/i, 'agent infrastructure', {
      reason: 'Focus search field and type query.',
    })

    assert.deepEqual(driver.calls[1], {
      name: 'recognize',
      target: { kind: 'ocr_text', text: /^search$/i },
    })
    assert.deepEqual(driver.calls[4], {
      name: 'typeText',
      text: 'agent infrastructure',
    })
  })

  it('maps semantic scroll direction to macOS Chrome wheel deltas', async () => {
    const driver = new FakeHarnessDriver([
      observation('top', []),
      observation('middle', []),
      observation('middle-before-up', []),
      observation('top-again', []),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    await harness.scrollDown({ amount: 700, reason: 'Need more visible results.' })
    await harness.scrollUp({ amount: 300, reason: 'Recover previous visible results.' })

    const scrollCalls = driver.calls.filter(call => call.name === 'scroll')
    assert.deepEqual(scrollCalls[0], {
      name: 'scroll',
      deltaY: -700,
      deltaX: 0,
      options: { settleMs: undefined, windowLocalPoint: undefined },
    })
    assert.deepEqual(scrollCalls[1], {
      name: 'scroll',
      deltaY: 300,
      deltaX: 0,
      options: { settleMs: undefined, windowLocalPoint: undefined },
    })
  })

  it('records changed scroll effect when the immediately observed OCR surface changes and marks bottom incomplete', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-scroll', [
        node('result-1', 'ocr_text', 'First visible result', box(40, 180, 400, 40)),
      ]),
      observation('after-scroll', [
        node('result-2', 'ocr_text', 'Second visible result', box(40, 180, 400, 40)),
      ]),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.scrollDown({ amount: 500, reason: 'Inspect more visible results.' })

    assert.equal(result.action, 'scroll')
    assert.equal(result.scroll_effect, 'changed')
    assert.equal(result.before.snapshot_id, 'before-scroll')
    assert.ok(result.after)
    assert.equal(result.after.snapshot_id, 'after-scroll')
    const bottom = scrollBoundary(result.after).vertical.bottom
    assert.equal(bottom.state, 'not_at_boundary')
    assert.equal(bottom.confidence, 'heuristic')
    assert.ok(bottom.basis.includes('single_step_changed'))
    assert.equal(bottom.evidence[0].source, 'single_step_scroll_effect')
    assert.equal(bottom.evidence[0].scroll_effect.direction, 'down')
    assert.equal(bottom.evidence[0].scroll_effect.effect, 'changed')
    assert.notEqual(bottom.state, 'at_boundary')
    assert.notEqual(bottom.confidence, 'corroborated')
  })

  it('records no_visible_change scroll effect as boundary evidence for the scroll direction', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-scroll', [
        node('result-1', 'ocr_text', 'Same visible result', box(40, 180, 400, 40)),
      ]),
      observation('after-scroll', [
        node('result-1', 'ocr_text', 'Same visible result', box(40, 180, 400, 40)),
      ]),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.scrollDown({ amount: 500, reason: 'Try one scroll step.' })

    assert.equal(result.scroll_effect, 'no_visible_change')
    assert.ok(result.after)
    assert.equal(scrollBoundary(result.after).vertical.bottom.state, 'at_boundary')
    assert.equal('reached_bottom' in result, false)
    assert.equal('reached_top' in result, false)
    assert.equal('scroll_scan' in result, false)
  })

  it('clones the after snapshot and adds weak bottom boundary evidence for down no_visible_change', async () => {
    const beforeNode = node('result-1', 'ocr_text', 'Same visible result', box(40, 180, 400, 40))
    const afterNode = node('result-1', 'ocr_text', 'Same visible result', box(40, 180, 400, 40))
    const afterSnapshot = observation('after-scroll', [afterNode], {
      scroll_boundary: unknownScrollBoundary(),
    })
    const driver = new FakeHarnessDriver([
      observation('before-scroll', [beforeNode], {
        scroll_boundary: unknownScrollBoundary(),
      }),
      afterSnapshot,
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.scrollDown({ amount: 500, reason: 'Try one scroll step.' })

    assert.equal(result.scroll_effect, 'no_visible_change')
    assert.ok(result.after)
    assert.notEqual(result.after, afterSnapshot)
    assert.notEqual(result.after.detail, afterSnapshot.detail)
    assert.equal(scrollBoundary(afterSnapshot).vertical.bottom.state, 'unknown')
    const boundary = scrollBoundary(result.after)
    assert.equal(boundary.vertical.bottom.state, 'at_boundary')
    assert.equal(boundary.vertical.bottom.confidence, 'heuristic')
    assert.ok(boundary.vertical.bottom.basis.includes('single_step_no_visible_change'))
    assert.equal(boundary.vertical.bottom.evidence[0].source, 'single_step_scroll_effect')
    assert.equal(boundary.vertical.bottom.evidence[0].scroll_effect.direction, 'down')
    assert.equal(boundary.vertical.bottom.evidence[0].scroll_effect.effect, 'no_visible_change')
    assert.equal(boundary.vertical.top.state, 'not_at_boundary')
    assert.ok(boundary.vertical.top.basis.includes('ordinary_observe_default'))
  })

  it('adds weak top boundary evidence for up no_visible_change', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-scroll', [
        node('result-1', 'ocr_text', 'Same visible result', box(40, 180, 400, 40)),
      ], {
        scroll_boundary: unknownScrollBoundary(),
      }),
      observation('after-scroll', [
        node('result-1', 'ocr_text', 'Same visible result', box(40, 180, 400, 40)),
      ], {
        scroll_boundary: unknownScrollBoundary(),
      }),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.scrollUp({ amount: 500, reason: 'Try one scroll step up.' })

    assert.equal(result.scroll_effect, 'no_visible_change')
    assert.ok(result.after)
    const boundary = scrollBoundary(result.after)
    assert.equal(boundary.vertical.top.state, 'at_boundary')
    assert.equal(boundary.vertical.top.confidence, 'heuristic')
    assert.ok(boundary.vertical.top.basis.includes('single_step_no_visible_change'))
    assert.equal(boundary.vertical.top.evidence[0].scroll_effect.direction, 'up')
    assert.equal(boundary.vertical.bottom.state, 'not_at_boundary')
    assert.ok(boundary.vertical.bottom.basis.includes('ordinary_observe_default'))
  })

  it('uses OCR single-step no_visible_change over an existing AX numeric boundary claim', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-scroll', [
        node('result-1', 'ocr_text', 'Same visible result', box(40, 180, 400, 40)),
      ], {
        scroll_boundary: unknownScrollBoundary(),
      }),
      observation('after-scroll', [
        node('result-1', 'ocr_text', 'Same visible result', box(40, 180, 400, 40)),
      ], {
        scroll_boundary: bottomAtBoundary(),
      }),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.scrollDown({ amount: 500, reason: 'Try one scroll step.' })

    assert.equal(result.scroll_effect, 'no_visible_change')
    assert.ok(result.after)
    const bottom = scrollBoundary(result.after).vertical.bottom
    assert.equal(bottom.state, 'at_boundary')
    assert.equal(bottom.confidence, 'heuristic')
    assert.ok(bottom.basis.includes('single_step_no_visible_change'))
    assert.equal(bottom.basis.includes('ax_scrollbar_value'), false)
    assert.equal(bottom.evidence[0].source, 'single_step_scroll_effect')
  })

  it('does not preserve existing AX numeric claims on the non-target side after a scroll step', async () => {
    const afterBoundary = bottomAtBoundary()
    afterBoundary.vertical.top = {
      state: 'at_boundary',
      confidence: 'corroborated',
      basis: ['ax_scrollbar_value'],
      evidence: [{
        source: 'ax_tree',
        basis: 'ax_scrollbar_value',
        axis: 'vertical',
        side: 'top',
        node_ref: {
          snapshot_id: 'ax-scroll',
          node_uid: 'scroll-top',
          role: 'AXScrollBar',
        },
        ax: {
          role: 'AXScrollBar',
          orientation: 'vertical',
          value: 0,
          min_value: 0,
          max_value: 100,
          bounds: { x: 984, y: 120, width: 12, height: 620 },
        },
      }],
      known_limits: [],
    }
    const driver = new FakeHarnessDriver([
      observation('before-scroll', [
        node('result-1', 'ocr_text', 'Same visible result', box(40, 180, 400, 40)),
      ], {
        scroll_boundary: unknownScrollBoundary(),
      }),
      observation('after-scroll', [
        node('result-1', 'ocr_text', 'Same visible result', box(40, 180, 400, 40)),
      ], {
        scroll_boundary: afterBoundary,
      }),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.scrollDown({ amount: 500, reason: 'Try one scroll step.' })

    assert.equal(result.scroll_effect, 'no_visible_change')
    assert.ok(result.after)
    const boundary = scrollBoundary(result.after)
    assert.equal(boundary.vertical.bottom.state, 'at_boundary')
    assert.equal(boundary.vertical.bottom.confidence, 'heuristic')
    assert.equal(boundary.vertical.top.state, 'not_at_boundary')
    assert.equal(boundary.vertical.top.confidence, 'heuristic')
    assert.ok(boundary.vertical.top.basis.includes('ordinary_observe_default'))
    assert.equal(boundary.vertical.top.basis.includes('ax_scrollbar_value'), false)
  })

  it('records no_visible_change when comparable visible nodes are reordered by providers', async () => {
    const first = node('result-1', 'ocr_text', 'First visible result', box(40, 180, 400, 40))
    const second = node('result-2', 'ocr_text', 'Second visible result', box(40, 240, 400, 40))
    const driver = new FakeHarnessDriver([
      observation('before-scroll', [first, second]),
      observation('after-scroll', [second, first]),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.scrollDown({ amount: 500, reason: 'Try one scroll step.' })

    assert.equal(result.scroll_effect, 'no_visible_change')
  })

  it('records unknown scroll effect when before and after evidence is insufficient to compare', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-scroll', []),
      observation('after-scroll', []),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.scrollDown({ amount: 500, reason: 'Try one scroll step.' })

    assert.equal(result.scroll_effect, 'unknown')
  })

  it('adds weak top not-at-boundary evidence for up changed', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-scroll', [
        node('result-2', 'ocr_text', 'Second visible result', box(40, 180, 400, 40)),
      ], {
        scroll_boundary: unknownScrollBoundary(),
      }),
      observation('after-scroll', [
        node('result-1', 'ocr_text', 'First visible result', box(40, 180, 400, 40)),
      ], {
        scroll_boundary: unknownScrollBoundary(),
      }),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.scrollUp({ amount: 500, reason: 'Recover previous visible results.' })

    assert.equal(result.scroll_effect, 'changed')
    assert.ok(result.after)
    const boundary = scrollBoundary(result.after)
    assert.equal(boundary.vertical.top.state, 'not_at_boundary')
    assert.equal(boundary.vertical.top.confidence, 'heuristic')
    assert.ok(boundary.vertical.top.basis.includes('single_step_changed'))
    assert.equal(boundary.vertical.top.evidence[0].scroll_effect.direction, 'up')
    assert.equal(boundary.vertical.top.evidence[0].scroll_effect.effect, 'changed')
    assert.equal(boundary.vertical.bottom.state, 'not_at_boundary')
    assert.ok(boundary.vertical.bottom.basis.includes('ordinary_observe_default'))
  })

  it('defaults to not-at-boundary and records weak bottom evidence for unknown scroll effect', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-scroll', [], {
        scroll_boundary: unknownScrollBoundary(),
      }),
      observation('after-scroll', [], {
        scroll_boundary: unknownScrollBoundary(),
      }),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.scrollDown({ amount: 500, reason: 'Try one scroll step.' })

    assert.equal(result.scroll_effect, 'unknown')
    assert.ok(result.after)
    const boundary = scrollBoundary(result.after)
    assert.equal(boundary.vertical.top.state, 'not_at_boundary')
    assert.ok(boundary.vertical.top.basis.includes('ordinary_observe_default'))
    assert.equal(boundary.vertical.bottom.state, 'not_at_boundary')
    assert.equal(boundary.vertical.bottom.confidence, 'heuristic')
    assert.ok(boundary.vertical.bottom.basis.includes('single_step_unknown'))
    assert.equal(boundary.vertical.bottom.evidence[0].source, 'single_step_scroll_effect')
    assert.equal(boundary.vertical.bottom.evidence[0].scroll_effect.effect, 'unknown')
  })

  it('does not infer changed scroll effect from DOM-only visible changes', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-scroll', [
        node('dom-result-1', 'dom_link', 'First DOM-only result', box(40, 180, 400, 40)),
      ], {
        scroll_boundary: unknownScrollBoundary(),
      }),
      observation('after-scroll', [
        node('dom-result-2', 'dom_link', 'Second DOM-only result', box(40, 180, 400, 40)),
      ], {
        scroll_boundary: unknownScrollBoundary(),
      }),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.scrollDown({ amount: 500, reason: 'Try one scroll step.' })

    assert.equal(result.scroll_effect, 'unknown')
    assert.ok(result.after)
    const bottom = scrollBoundary(result.after).vertical.bottom
    assert.equal(bottom.state, 'not_at_boundary')
    assert.ok(bottom.basis.includes('single_step_unknown'))
  })

  it('records unknown scroll effect when after-observation fails after scroll succeeds', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-scroll', [
        node('result-1', 'dom_link', 'First visible result', box(40, 180, 400, 40)),
      ]),
    ])
    driver.observeErrorsByCall.set(2, new Error('after observation unavailable'))
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.scrollDown({ amount: 500, reason: 'Try one scroll step.' })

    assert.equal(result.action, 'scroll')
    assert.equal(result.after, null)
    assert.equal(result.scroll_effect, 'unknown')
    assert.equal(result.scroll_effect_reason, 'after_observe_failed')
    assert.match(result.after_observe_error ?? '', /after observation unavailable/)
    assert.equal(driver.calls.filter(call => call.name === 'scroll').length, 1)
  })

  it('propagates scroll action failure instead of converting it to unknown effect', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-scroll', [
        node('result-1', 'dom_link', 'First visible result', box(40, 180, 400, 40)),
      ]),
    ])
    driver.scrollError = new Error('scroll refused')
    const harness = new MacOSChromeAgentHarness(driver)

    await assert.rejects(
      () => harness.scrollDown({ amount: 500, reason: 'Try one scroll step.' }),
      /scroll refused/,
    )
  })

  it('does not infer changed scroll effect from hidden or uncertain evidence', async () => {
    const driver = new FakeHarnessDriver([
      observation('before-scroll', [
        uncertainNode('hidden-before', 'dom_evidence', 'Hidden first result', box(40, 180, 400, 40)),
      ]),
      observation('after-scroll', [
        uncertainNode('hidden-after', 'dom_evidence', 'Hidden second result', box(40, 180, 400, 40)),
      ]),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.scrollDown({ amount: 500, reason: 'Try one scroll step.' })

    assert.equal(result.scroll_effect, 'unknown')
  })

  it('dismisses a cookie overlay through the observed agreement button', async () => {
    const driver = new FakeHarnessDriver([
      observation('overlay', [
        node('text-1', 'dom_text', 'This website stores cookies on your device.', box(100, 500, 600, 50)),
        node('accept', 'dom_button', 'Yes, I agree', box(700, 760, 180, 50)),
        node('reject', 'dom_button', 'Reject additional', box(900, 760, 220, 50)),
      ]),
      observation('content', [
        node('heading', 'dom_heading', 'Company homepage content', box(100, 220, 500, 80)),
      ]),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    const result = await harness.dismissKnownOverlay()

    assert.equal(result.dismissed, true)
    assert.equal(result.kind, 'cookie_consent')
    assert.deepEqual(driver.calls[1], {
      name: 'recognize',
      target: { kind: 'ocr_text', text: /^Yes, I agree$/i },
    })
    assert.equal(driver.calls[3]?.name, 'click')
  })

  it('uses the observed Chrome Back button for recovery instead of typing URLs', async () => {
    const driver = new FakeHarnessDriver([
      observation('wrong-page', [
        node('back', 'ocr_text', 'Back', box(6, 79, 34, 34)),
      ]),
      observation('previous-page', []),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    await harness.goBack({ reason: 'Recover from wrong navigation.' })

    assert.deepEqual(driver.calls[1], {
      name: 'recognize',
      target: { kind: 'ocr_text', text: /^Back$/i },
    })
    assert.equal(driver.calls.some(call => call.name === 'typeText'), false)
  })
})

class FakeHarnessDriver {
  readonly calls: Array<Record<string, unknown>> = []
  readonly observeErrorsByCall = new Map<number, Error>()
  nextPromotion?: CandidatePromotion
  scrollError?: Error
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
    _capture: ChromeWindowCapture,
    target: ChromeRecognitionTarget,
  ): Promise<RecognitionResult> {
    this.calls.push({ name: 'recognize', target })
    if (target.kind !== 'ocr_text' && target.kind !== 'ocr_row') {
      throw new Error(`FakeHarnessDriver refuses non-OCR promotable target: ${target.kind}`)
    }
    const text = target.text
    const best = recognizedItem(text)
    return {
      found: true,
      recognition_id: `rec_${this.calls.length}`,
      source: 'custom',
      scope: { surface: 'window', window_number: 42, app_bundle_id: 'com.google.Chrome' },
      best,
      filtered: [best],
      all: [best],
      detail: {},
      evidence: [{ run_id: 'run', artifact_id: 'screenshot', span_id: 'span' }],
      known_limits: [],
    }
  }

  async promoteCandidate(
    _recognition: RecognitionResult,
    _capture: ChromeWindowCapture,
  ): Promise<CandidatePromotion> {
    this.calls.push({ name: 'promote' })
    return this.nextPromotion ?? { status: 'promoted', candidate: candidate(), residual_known_limits: [] }
  }

  async click(_candidate: PromotedCandidate): Promise<void> {
    this.calls.push({ name: 'click' })
  }

  async typeText(text: string): Promise<void> {
    this.calls.push({ name: 'typeText', text })
  }

  async pressKey(key: string, modifiers: string[] = []): Promise<void> {
    this.calls.push({ name: 'pressKey', key, modifiers })
  }

  async scroll(
    deltaY = 0,
    deltaX = 0,
    options: { windowLocalPoint?: { x: number, y: number }, settleMs?: number } = {},
  ): Promise<void> {
    this.calls.push({
      name: 'scroll',
      deltaY,
      deltaX,
      options: {
        settleMs: options.settleMs,
        windowLocalPoint: options.windowLocalPoint,
      },
    })
    if (this.scrollError)
      throw this.scrollError
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
    detail: {
      chrome_context: {
        active_tab_url: 'https://www.google.com/search?q=test',
        active_tab_title: 'test - Google Search',
      },
      signals: [],
      ...detail,
    },
    known_limits: [],
  }
}

function unknownScrollBoundary(): any {
  return {
    api_version: 'careerdeepseek.scroll_boundary.v1alpha1',
    axis: 'vertical',
    vertical: {
      top: {
        state: 'unknown',
        confidence: 'unknown',
        basis: ['ax_scroll_evidence_unavailable'],
        evidence: [],
        known_limits: ['no reliable top boundary evidence was observed'],
      },
      bottom: {
        state: 'unknown',
        confidence: 'unknown',
        basis: ['ax_scroll_evidence_unavailable'],
        evidence: [],
        known_limits: ['no reliable bottom boundary evidence was observed'],
      },
    },
    generated_at_millis: 0,
    source_artifacts: [],
    known_limits: [],
  }
}

function bottomAtBoundary(): any {
  const boundary = unknownScrollBoundary()
  boundary.vertical.bottom = {
    state: 'at_boundary',
    confidence: 'corroborated',
    basis: ['ax_scrollbar_value'],
    evidence: [{
      source: 'ax_tree',
      basis: 'ax_scrollbar_value',
      axis: 'vertical',
      side: 'bottom',
      node_ref: {
        snapshot_id: 'ax-scroll',
        node_uid: 'scroll-bottom',
        role: 'AXScrollBar',
      },
      ax: {
        role: 'AXScrollBar',
        orientation: 'vertical',
        value: 100,
        min_value: 0,
        max_value: 100,
        bounds: { x: 984, y: 120, width: 12, height: 620 },
      },
    }],
    known_limits: [],
  }
  return boundary
}

function scrollBoundary(snapshot: ObservationSnapshot): any {
  const boundary = snapshot.detail.scroll_boundary
  assert.ok(boundary && typeof boundary === 'object' && !Array.isArray(boundary))
  return boundary as any
}

function node(id: string, kind: string, label: string, nodeBox: ReturnType<typeof box>): SurfaceNode {
  return {
    node_ref: { run_id: 'run', span_id: 'span', node_id: id },
    kind,
    label,
    box: nodeBox,
    source_artifacts: [],
    provider_score: 0.9,
    detail: { href: null, actionable: kind.includes('button') || kind.includes('link') },
    center: {
      x: nodeBox.x + nodeBox.width / 2,
      y: nodeBox.y + nodeBox.height / 2,
    },
  }
}

function uncertainNode(id: string, kind: string, label: string, nodeBox: ReturnType<typeof box>): SurfaceNode {
  return {
    ...node(id, kind, label, nodeBox),
    detail: {
      known_limits: ['DOM provider state indicates hidden evidence'],
    },
  }
}

function box(x: number, y: number, width: number, height: number) {
  return { x, y, width, height }
}

function capture(snapshotId: string): ChromeWindowCapture {
  return {
    snapshotId,
    screenshot: {
      dataBase64: 'fake',
      mimeType: 'image/png',
      path: `.computer-use/screenshots/${snapshotId}.png`,
      width: 1200,
      height: 800,
      capturedAt: new Date().toISOString(),
    },
    contract: {
      coordinateContractVersion: 1,
      captureSource: {
        kind: 'window',
        windowNumber: 42,
        ownerPid: 100,
        ownerBundleId: 'com.google.Chrome',
      },
      sourceGlobalLogicalBounds: box(0, 0, 1200, 800),
      screenshotPixelSize: { width: 1200, height: 800 },
      pixelToLogicalScale: { x: 1, y: 1 },
      logicalToPixelScale: { x: 1, y: 1 },
      capturedAt: new Date().toISOString(),
    },
  }
}

function recognizedItem(text: string | RegExp) {
  const label = typeof text === 'string' ? text : regexSourceToLabel(text)
  return {
    item_id: 'item',
    kind: 'ocr_text',
    text: label,
    box: box(10, 10, 100, 40),
    provider_score: 0.9,
    detail: { actionable: true },
  }
}

function candidate(): PromotedCandidate {
  return {
    candidate_local_id: 'candidate',
    kind: 'ocr_text',
    label: 'candidate',
    target_spec: {
      grounding: 'coordinate',
      box: box(10, 10, 100, 40),
      anchor_text: 'candidate',
    },
    evidence: {
      capture_artifact: { run_id: 'run', artifact_id: 'capture', span_id: 'span' },
      recognition_artifact: { run_id: 'run', artifact_id: 'recognition', span_id: 'span' },
      observation_blob: {},
    },
    liveness: {
      preconditions: {
        window_ref: {
          app_bundle_id: 'com.google.Chrome',
          window_number: 42,
        },
      },
      ttl_hint_ms: 15_000,
    },
    control: {
      requires_app_frontmost: true,
      requires_window_focus: true,
    },
    source_run_id: 'run',
    source_span_id: 'span',
    source_operation_id: 'op',
    source_artifact_id: 'artifact',
    known_limits: [],
  }
}

function regexSourceToLabel(pattern: RegExp): string {
  return pattern.source
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\\ /g, ' ')
    .replace(/\\/g, '')
}
