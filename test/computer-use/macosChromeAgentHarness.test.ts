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
        node('button-1', 'dom_button', 'Hide sponsored result', box(35, 376, 652, 56)),
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
      target: { kind: 'button', text: /hide sponsored result/i },
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
        node('button-1', 'dom_button', 'Danger', box(10, 10, 60, 30)),
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
      target: { kind: 'button', text: /^Yes, I agree$/i },
    })
    assert.equal(driver.calls[3]?.name, 'click')
  })

  it('uses the observed Chrome Back button for recovery instead of typing URLs', async () => {
    const driver = new FakeHarnessDriver([
      observation('wrong-page', [
        node('back', 'ax_button', 'Back', box(6, 79, 34, 34)),
      ]),
      observation('previous-page', []),
    ])
    const harness = new MacOSChromeAgentHarness(driver)

    await harness.goBack({ reason: 'Recover from wrong navigation.' })

    assert.deepEqual(driver.calls[1], {
      name: 'recognize',
      target: { kind: 'button', text: /^Back$/i },
    })
    assert.equal(driver.calls.some(call => call.name === 'typeText'), false)
  })
})

class FakeHarnessDriver {
  readonly calls: Array<Record<string, unknown>> = []
  nextPromotion?: CandidatePromotion
  lastCapture?: ChromeWindowCapture

  readonly #observations: ObservationSnapshot[]

  constructor(observations: ObservationSnapshot[]) {
    this.#observations = [...observations]
  }

  async observe(): Promise<ObservationSnapshot> {
    this.calls.push({ name: 'observe' })
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
    const text = 'text' in target ? target.text : target.name
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
  }
}

function observation(snapshotId: string, nodes: SurfaceNode[]): ObservationSnapshot {
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
    },
    known_limits: [],
  }
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
    kind: 'dom_button',
    text: label,
    box: box(10, 10, 100, 40),
    provider_score: 0.9,
    detail: { actionable: true },
  }
}

function candidate(): PromotedCandidate {
  return {
    candidate_local_id: 'candidate',
    kind: 'dom_button',
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
