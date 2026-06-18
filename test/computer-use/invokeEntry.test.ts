import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { createMacOSChromeInvokeEntry } from '../../src/computer-use/macos-chrome-driver/invoke-entry.js'
import type {
  CandidatePromotion,
  ChromeRecognitionTarget,
  ChromeWindowCapture,
  ObservationSnapshot,
  PromotedCandidate,
  RecognitionResult,
  SafetyCheckResult,
} from '../../src/computer-use/macos-chrome-driver/types.js'
import type { MacOSChromeInvokeDriver } from '../../src/computer-use/macos-chrome-driver/invoke-handlers.js'

describe('macOS Chrome programmatic invoke entry', () => {
  it('validates invalid requests and returns invalid_input without calling the driver', async () => {
    const driver = fakeDriver()
    const entry = createMacOSChromeInvokeEntry({ driver })

    const cases = [
      null,
      {},
      { commandId: '' },
      { commandId: 'chrome.observe', inputs: [] },
      { commandId: 'chrome.observe', target: null },
    ]

    for (const request of cases) {
      const result = await entry.invoke(request)
      assert.equal(result.status, 'failed')
      assert.equal(result.failure?.class, 'invalid_input')
      assert.deepEqual(result.artifacts, [])
    }
    assert.equal(driver.totalCalls(), 0)
  })

  it('passes unknown commands through runtime command resolution', async () => {
    const driver = fakeDriver()
    const entry = createMacOSChromeInvokeEntry({ driver })

    const result = await entry.invoke({ commandId: 'chrome.unknown' })

    assert.equal(result.commandId, 'chrome.unknown')
    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'command_resolution')
    assert.equal(result.failure?.code, 'unknown_command')
    assert.equal(driver.totalCalls(), 0)
  })

  it('runs an audited click sequence step by step through one entry instance', async () => {
    const recognition = fakeRecognitionResult()
    const candidate = fakeCandidate({ recognition })
    const driver = fakeDriver({
      recognizeResult: recognition,
      promoteResult: { status: 'promoted', candidate, residual_known_limits: [] },
    })
    const entry = createMacOSChromeInvokeEntry({ driver })

    const observeBefore = await entry.invoke({ commandId: 'chrome.observe' })
    const recognize = await entry.invoke({
      commandId: 'chrome.recognize',
      inputs: { target: { kind: 'visible_text', text: 'Open jobs' } },
    })
    const promote = await entry.invoke({
      commandId: 'chrome.promote',
      inputs: { recognitionId: recognition.recognition_id },
    })
    const click = await entry.invoke({
      commandId: 'chrome.clickCandidate',
      inputs: { candidateLocalId: candidate.candidate_local_id },
    })
    const observeAfter = await entry.invoke({ commandId: 'chrome.observe' })

    assert.deepEqual(
      [observeBefore, recognize, promote, click, observeAfter].map(result => result.commandId),
      ['chrome.observe', 'chrome.recognize', 'chrome.promote', 'chrome.clickCandidate', 'chrome.observe'],
    )
    assert.deepEqual(
      [observeBefore, recognize, promote, click, observeAfter].map(result => result.status),
      ['completed', 'completed', 'completed', 'completed', 'completed'],
    )
    assert.equal(driver.observeCalls, 2)
    assert.deepEqual(driver.clickCalls, [candidate])
    assert.equal((promote.output as { candidateLocalId?: string }).candidateLocalId, candidate.candidate_local_id)
  })

  it('enforces text-input keyboard focus provenance across entry calls', async () => {
    const recognition = fakeRecognitionResult()
    const candidate = fakeCandidate({ recognition })
    candidate.kind = 'ax_textfield'
    candidate.label = 'Search'
    candidate.target_spec.grounding = 'ax_node'
    candidate.target_spec.anchor_text = 'Search'
    candidate.liveness.preconditions.anchor_recheck!.text = 'Search'
    const driver = fakeDriver({
      recognizeResult: recognition,
      promoteResult: { status: 'promoted', candidate, residual_known_limits: [] },
    })
    const entry = createMacOSChromeInvokeEntry({ driver })

    const nakedType = await entry.invoke({
      commandId: 'chrome.typeText',
      inputs: { text: 'AI engineer', focusedCandidateLocalId: candidate.candidate_local_id },
    })
    await promoteCandidateThroughEntry(entry, recognition, { kind: 'text_input', name: 'Search' })
    await entry.invoke({
      commandId: 'chrome.focusTextInput',
      inputs: { candidateLocalId: candidate.candidate_local_id },
    })
    const typed = await entry.invoke({
      commandId: 'chrome.typeText',
      inputs: { text: 'AI engineer', focusedCandidateLocalId: candidate.candidate_local_id },
    })
    await entry.invoke({ commandId: 'chrome.observe' })
    const staleType = await entry.invoke({
      commandId: 'chrome.typeText',
      inputs: { text: 'again', focusedCandidateLocalId: candidate.candidate_local_id },
    })

    assert.equal(nakedType.status, 'refused')
    assert.equal(nakedType.failure?.class, 'candidate_provenance')
    assert.equal(nakedType.failure?.code, 'focused_candidate_not_in_sequence')
    assert.equal(typed.status, 'completed')
    assert.deepEqual(driver.typeTextCalls, ['AI engineer'])
    assert.equal(staleType.status, 'refused')
    assert.equal(staleType.failure?.code, 'focused_candidate_not_in_sequence')
  })

  it('refuses keyboard input after a visible-text click across entry calls', async () => {
    const recognition = fakeRecognitionResult()
    const candidate = fakeCandidate({ recognition })
    const driver = fakeDriver({
      recognizeResult: recognition,
      promoteResult: { status: 'promoted', candidate, residual_known_limits: [] },
    })
    const entry = createMacOSChromeInvokeEntry({ driver })

    await promoteCandidateThroughEntry(entry, recognition, { kind: 'visible_text', text: 'Open jobs' })
    const click = await entry.invoke({
      commandId: 'chrome.clickCandidate',
      inputs: { candidateLocalId: candidate.candidate_local_id },
    })
    const typed = await entry.invoke({
      commandId: 'chrome.typeText',
      inputs: { text: 'AI engineer', focusedCandidateLocalId: candidate.candidate_local_id },
    })
    const pressed = await entry.invoke({
      commandId: 'chrome.pressKey',
      inputs: { key: 'enter', focusedCandidateLocalId: candidate.candidate_local_id },
    })

    assert.equal(click.status, 'completed')
    assert.equal(typed.status, 'refused')
    assert.equal(typed.failure?.class, 'candidate_provenance')
    assert.equal(typed.failure?.code, 'focused_candidate_not_text_input')
    assert.equal(pressed.status, 'refused')
    assert.equal(pressed.failure?.class, 'candidate_provenance')
    assert.equal(pressed.failure?.code, 'focused_candidate_not_text_input')
    assert.deepEqual(driver.typeTextCalls, [])
    assert.deepEqual(driver.pressKeyCalls, [])
  })

  it('enforces promoted target provenance for scroll', async () => {
    const recognition = fakeRecognitionResult()
    const candidate = fakeCandidate({ recognition })
    const driver = fakeDriver({
      recognizeResult: recognition,
      promoteResult: { status: 'promoted', candidate, residual_known_limits: [] },
    })
    const entry = createMacOSChromeInvokeEntry({ driver })

    const nakedScroll = await entry.invoke({
      commandId: 'chrome.scroll',
      inputs: { candidateLocalId: candidate.candidate_local_id },
    })
    await promoteCandidateThroughEntry(entry, recognition)
    const scroll = await entry.invoke({
      commandId: 'chrome.scroll',
      inputs: { candidateLocalId: candidate.candidate_local_id, deltaY: 240 },
    })

    assert.equal(nakedScroll.status, 'refused')
    assert.equal(nakedScroll.failure?.class, 'candidate_provenance')
    assert.equal(nakedScroll.failure?.code, 'candidate_not_in_sequence')
    assert.equal(scroll.status, 'completed')
    assert.deepEqual(driver.scrollCalls, [{
      candidate,
      deltaY: 240,
      deltaX: 0,
      options: {},
    }])
  })

  it('keeps audited candidate state isolated per entry instance', async () => {
    const recognition = fakeRecognitionResult()
    const candidate = fakeCandidate({ recognition })
    const driver = fakeDriver({
      recognizeResult: recognition,
      promoteResult: { status: 'promoted', candidate, residual_known_limits: [] },
    })
    const entryA = createMacOSChromeInvokeEntry({ driver })
    const entryB = createMacOSChromeInvokeEntry({ driver })

    await promoteCandidateThroughEntry(entryA, recognition)
    const crossEntryClick = await entryB.invoke({
      commandId: 'chrome.clickCandidate',
      inputs: { candidateLocalId: candidate.candidate_local_id },
    })

    assert.equal(crossEntryClick.status, 'refused')
    assert.equal(crossEntryClick.failure?.class, 'candidate_provenance')
    assert.equal(crossEntryClick.failure?.code, 'candidate_not_in_sequence')
    assert.deepEqual(driver.clickCalls, [])
  })

  it('exports the entry API from the macOS Chrome index without exporting the command catalog', async () => {
    const module = await import('../../src/computer-use/macos-chrome-driver/index.js') as Record<string, unknown>

    assert.equal(typeof module.createMacOSChromeInvokeEntry, 'function')
    assert.equal(module.COMPUTER_USE_COMMAND_SPECS, undefined)
    assert.equal(module.resolveComputerUseCommandSpec, undefined)
    assert.equal(module.dryRunComputerUseCommand, undefined)
  })

  it('exports the P1.5 invoke API from the top-level computer-use entry without legacy harness values', async () => {
    const module = await import('../../src/computer-use/index.js') as Record<string, unknown>

    assert.equal(typeof module.createMacOSChromeInvokeEntry, 'function')
    assert.equal(module.MacOSChromeDriver, undefined)
    assert.equal(module.MacOSChromeAgentHarness, undefined)
  })
})

interface InvokeEntryLike {
  invoke: (request: unknown) => Promise<{
    commandId: string
    status: string
    output?: unknown
    failure?: { class: string, code: string }
  }>
}

async function promoteCandidateThroughEntry(
  entry: InvokeEntryLike,
  recognition: RecognitionResult,
  target: ChromeRecognitionTarget = { kind: 'visible_text', text: 'Open jobs' },
): Promise<void> {
  await entry.invoke({ commandId: 'chrome.observe' })
  await entry.invoke({
    commandId: 'chrome.recognize',
    inputs: { target },
  })
  await entry.invoke({
    commandId: 'chrome.promote',
    inputs: { recognitionId: recognition.recognition_id },
  })
}

interface FakeInvokeDriver extends MacOSChromeInvokeDriver {
  lastCaptureValue?: ChromeWindowCapture
  observeCalls: number
  recognizeCalls: Array<{ capture: ChromeWindowCapture, target: ChromeRecognitionTarget }>
  promoteCalls: Array<{ recognition: RecognitionResult, capture: ChromeWindowCapture }>
  clickCalls: PromotedCandidate[]
  focusTextInputCalls: PromotedCandidate[]
  typeTextCalls: string[]
  pressKeyCalls: Array<{ key: string, modifiers: string[] }>
  scrollCalls: Array<{
    candidate: PromotedCandidate
    deltaY: number
    deltaX: number
    options: { settleMs?: number }
  }>
  totalCalls: () => number
}

function fakeDriver(options: {
  recognizeResult?: RecognitionResult
  promoteResult?: CandidatePromotion
} = {}): FakeInvokeDriver {
  const driver: FakeInvokeDriver = {
    lastCaptureValue: undefined,
    observeCalls: 0,
    recognizeCalls: [],
    promoteCalls: [],
    clickCalls: [],
    focusTextInputCalls: [],
    typeTextCalls: [],
    pressKeyCalls: [],
    scrollCalls: [],
    get lastCapture() {
      return driver.lastCaptureValue
    },
    observe: async () => {
      driver.observeCalls += 1
      driver.lastCaptureValue = fakeCapture()
      return fakeObservationSnapshot()
    },
    recognizeFromCapture: async (capture, target) => {
      driver.recognizeCalls.push({ capture, target })
      return options.recognizeResult ?? fakeRecognitionResult()
    },
    checkSafetyGate: async () => fakeSafetyCheckResult(),
    promoteCandidate: async (recognition, capture) => {
      driver.promoteCalls.push({ recognition, capture })
      return options.promoteResult ?? {
        status: 'promoted',
        candidate: fakeCandidate({ recognition }),
        residual_known_limits: [],
      }
    },
    click: async (candidate) => {
      driver.clickCalls.push(candidate)
    },
    focusTextInput: async (candidate) => {
      driver.focusTextInputCalls.push(candidate)
    },
    typeText: async (text) => {
      driver.typeTextCalls.push(text)
    },
    pressKey: async (key, modifiers = []) => {
      driver.pressKeyCalls.push({ key, modifiers })
    },
    scroll: async (candidate, deltaY = 600, deltaX = 0, options = {}) => {
      driver.scrollCalls.push({ candidate, deltaY, deltaX, options })
    },
    totalCalls: () =>
      driver.observeCalls
      + driver.recognizeCalls.length
      + driver.promoteCalls.length
      + driver.clickCalls.length
      + driver.focusTextInputCalls.length
      + driver.typeTextCalls.length
      + driver.pressKeyCalls.length
      + driver.scrollCalls.length,
  }
  return driver
}

function fakeObservationSnapshot(): ObservationSnapshot {
  return {
    api_version: 'careerdeepseek.observation_snapshot.v1alpha1',
    snapshot_id: 'mco_1',
    run_id: 'run_1',
    span_id: 'observe_mco_1',
    captured_at_millis: 1,
    source: 'merged',
    scope: {
      surface: 'window',
      window_number: 42,
      app_bundle_id: 'com.google.Chrome',
      capture_artifact: { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'observe_mco_1' },
    },
    evidence: [
      { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'observe_mco_1' },
    ],
    nodes: [],
    detail: { signals: [] },
    known_limits: [],
  }
}

function fakeCapture(): ChromeWindowCapture {
  return {
    snapshotId: 'mco_1',
    screenshot: {
      dataBase64: '',
      mimeType: 'image/png',
      path: '/tmp/fake.png',
      width: 1200,
      height: 800,
      capturedAt: '2026-06-18T00:00:00.000Z',
    },
    contract: {
      coordinateContractVersion: 1,
      captureSource: {
        kind: 'window',
        windowNumber: 42,
        ownerPid: 100,
        ownerBundleId: 'com.google.Chrome',
      },
      sourceGlobalLogicalBounds: { x: 0, y: 0, width: 1200, height: 800 },
      screenshotPixelSize: { width: 1200, height: 800 },
      pixelToLogicalScale: { x: 1, y: 1 },
      logicalToPixelScale: { x: 1, y: 1 },
      capturedAt: '2026-06-18T00:00:00.000Z',
    },
  }
}

function fakeRecognitionResult(): RecognitionResult {
  const captureRef = { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'recognize_1' }
  const recognitionRef = { run_id: 'run_1', artifact_id: 'recognition_mcr_unsafe_1', span_id: 'recognize_1' }
  const recognizedItem = {
    item_id: 'item_1',
    kind: 'ocr_text',
    box: { x: 20, y: 20, width: 100, height: 24 },
    text: 'Open jobs',
    detail: {},
  }
  return {
    found: true,
    recognition_id: 'mcr:unsafe/1',
    source: 'ocr_text',
    scope: {
      surface: 'window',
      window_number: 42,
      capture_artifact: captureRef,
      capture_contract_artifact: { run_id: 'run_1', artifact_id: 'capture_contract_mco_1', span_id: 'recognize_1' },
    },
    best: recognizedItem,
    filtered: [recognizedItem],
    all: [recognizedItem],
    detail: {},
    evidence: [captureRef, recognitionRef],
    known_limits: [],
  }
}

function fakeCandidate(options: { recognition?: RecognitionResult } = {}): PromotedCandidate {
  const recognition = options.recognition ?? fakeRecognitionResult()
  return {
    candidate_local_id: `${recognition.recognition_id}:item_1`,
    kind: 'ocr_text',
    label: 'Open jobs',
    target_spec: {
      grounding: 'ocr_anchor',
      box: { x: 20, y: 20, width: 100, height: 24 },
      anchor_text: 'Open jobs',
    },
    evidence: {
      capture_artifact: { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'recognize_1' },
      recognition_artifact: { run_id: 'run_1', artifact_id: 'recognition_mcr_unsafe_1', span_id: 'recognize_1' },
      observation_blob: {},
    },
    liveness: {
      preconditions: {
        window_ref: {
          app_bundle_id: 'com.google.Chrome',
          window_number: 42,
        },
        anchor_recheck: {
          text: 'Open jobs',
          expected_min_confidence: 0.3,
          max_pixel_distance: 50,
        },
      },
      ttl_hint_ms: 15000,
    },
    control: {
      requires_app_frontmost: true,
      requires_window_focus: true,
    },
    source_run_id: 'run_1',
    source_span_id: 'session',
    source_operation_id: recognition.recognition_id,
    source_artifact_id: 'recognition_mcr_unsafe_1',
    known_limits: [],
  }
}

function fakeSafetyCheckResult(): SafetyCheckResult {
  return {
    passed: true,
    checks: {
      profile_verified: true,
      chrome_foreground: true,
      no_hard_stop_signal: true,
    },
    failures: [],
  }
}
