import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import type {
  ArtifactRef,
  ChromeRecognitionTarget,
  ChromeWindowCapture,
  ObservationSnapshot,
  RecognitionResult,
  SafetyCheckResult,
} from '../../src/computer-use/macos-chrome-driver/types.js'
import { invoke } from '../../src/computer-use/macos-chrome-driver/invoke-runtime.js'
import { createMacOSChromeInvokeHandlers } from '../../src/computer-use/macos-chrome-driver/invoke-handlers.js'
import type { MacOSChromeInvokeDriver } from '../../src/computer-use/macos-chrome-driver/invoke-handlers.js'

describe('read-only Chrome invoke commands', () => {
  it('invokes chrome.observe and returns the observation snapshot with artifact refs', async () => {
    const snapshot = fakeObservationSnapshot()
    const driver = fakeDriver({ observeResult: snapshot })

    const result = await invoke(
      { commandId: 'chrome.observe' },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.commandId, 'chrome.observe')
    assert.equal(result.status, 'completed')
    assert.deepEqual(result.output, snapshot)
    assert.ok(result.signals.includes('observe_completed'))
    assert.deepEqual(result.artifacts[0], {
      run_id: snapshot.run_id,
      artifact_id: `observation_${snapshot.snapshot_id}`,
      span_id: snapshot.span_id,
    })
    assert.ok(result.artifacts.some(ref => ref.artifact_id === 'screenshot_mco_1'))
    assert.ok(result.knownLimits.includes('read_only_observation_only'))
  })

  it('fails chrome.observe with observe failure when the driver read fails', async () => {
    const driver = fakeDriver({
      observeError: new Error('window capture unavailable'),
    })

    const result = await invoke(
      { commandId: 'chrome.observe' },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'observe')
    assert.equal(result.failure?.code, 'observe_failed')
    assert.match(result.failure?.message ?? '', /window capture unavailable/)
    assert.deepEqual(result.artifacts, [])
    assert.ok(result.signals.includes('observe_failed'))
  })

  it('invokes chrome.recognize from the last capture and returns recognition artifact refs', async () => {
    const capture = fakeCapture()
    const recognition = fakeRecognitionResult()
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: 'Open jobs' }
    const calls: Array<{ capture: ChromeWindowCapture, target: ChromeRecognitionTarget }> = []
    const driver = fakeDriver({
      lastCapture: capture,
      recognizeResult: recognition,
      onRecognize: (actualCapture, actualTarget) => calls.push({ capture: actualCapture, target: actualTarget }),
    })

    const result = await invoke(
      { commandId: 'chrome.recognize', inputs: { target } },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.status, 'completed')
    assert.equal(result.commandId, 'chrome.recognize')
    assert.deepEqual(result.output, recognition)
    assert.deepEqual(calls, [{ capture, target }])
    assert.deepEqual(result.artifacts[0], {
      run_id: recognition.evidence[0]!.run_id,
      artifact_id: `recognition_${recognition.recognition_id}`,
      span_id: recognition.evidence[0]!.span_id,
    })
    assert.ok(result.artifacts.some(ref => ref.artifact_id === 'screenshot_mco_1'))
    assert.ok(result.signals.includes('recognition_found'))
    assert.ok(result.knownLimits.includes('read_only_recognition_only'))
  })

  it('fails chrome.recognize with invalid_input when target is missing or malformed', async () => {
    const driver = fakeDriver({ lastCapture: fakeCapture(), recognizeResult: fakeRecognitionResult() })

    const result = await invoke(
      { commandId: 'chrome.recognize', inputs: { target: { kind: 'visible_text' } } },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'invalid_input')
    assert.equal(result.failure?.code, 'invalid_recognition_target')
    assert.deepEqual(result.artifacts, [])
  })

  it('fails chrome.recognize with recognition failure when no last capture exists', async () => {
    const driver = fakeDriver({ recognizeResult: fakeRecognitionResult() })

    const result = await invoke(
      { commandId: 'chrome.recognize', inputs: { target: { kind: 'button', text: 'Apply' } } },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'recognition')
    assert.equal(result.failure?.code, 'last_capture_missing')
    assert.ok(result.signals.includes('last_capture_missing'))
  })

  it('fails chrome.recognize with recognition_not_found when the target is absent', async () => {
    const capture = fakeCapture()
    const recognition = fakeRecognitionResult({ found: false })
    const driver = fakeDriver({
      lastCapture: capture,
      recognizeResult: recognition,
    })

    const result = await invoke(
      { commandId: 'chrome.recognize', inputs: { target: { kind: 'button', text: 'Missing' } } },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'recognition')
    assert.equal(result.failure?.code, 'recognition_not_found')
    assert.deepEqual(result.output, recognition)
    assert.ok(result.artifacts.some(ref => ref.artifact_id === `recognition_${recognition.recognition_id}`))
    assert.ok(result.signals.includes('recognition_not_found'))
  })

  it('fails chrome.recognize with recognition failure when the driver read fails', async () => {
    const driver = fakeDriver({
      lastCapture: fakeCapture(),
      recognizeError: new Error('ocr unavailable'),
    })

    const result = await invoke(
      { commandId: 'chrome.recognize', inputs: { target: { kind: 'visible_text', text: 'Open jobs' } } },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'recognition')
    assert.equal(result.failure?.code, 'recognition_failed')
    assert.match(result.failure?.message ?? '', /ocr unavailable/)
    assert.deepEqual(result.artifacts, [])
    assert.ok(result.signals.includes('recognition_failed'))
  })

  it('invokes chrome.checkSafetyGate and returns a completed result when safety passes', async () => {
    const safety: SafetyCheckResult = {
      passed: true,
      checks: {
        profile_verified: true,
        chrome_foreground: true,
        no_hard_stop_signal: true,
      },
      failures: [],
    }
    const driver = fakeDriver({ safetyResult: safety })

    const result = await invoke(
      { commandId: 'chrome.checkSafetyGate' },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.status, 'completed')
    assert.deepEqual(result.output, safety)
    assert.ok(result.signals.includes('safety_gate_passed'))
    assert.ok(result.knownLimits.includes('read_only_safety_check_only'))
  })

  it('invokes chrome.checkSafetyGate and exposes hard-stop refusal signals', async () => {
    const safety: SafetyCheckResult = {
      passed: false,
      checks: {
        profile_verified: true,
        chrome_foreground: true,
        no_hard_stop_signal: false,
      },
      failures: [{
        code: 'hard_stop_signal',
        detail: 'Signals detected: captcha',
        observed: ['captcha'],
      }],
    }
    const driver = fakeDriver({ safetyResult: safety })

    const result = await invoke(
      { commandId: 'chrome.checkSafetyGate' },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.commandId, 'chrome.checkSafetyGate')
    assert.equal(result.status, 'refused')
    assert.deepEqual(result.output, safety)
    assert.equal(result.failure?.class, 'hard_stop')
    assert.equal(result.failure?.code, 'hard_stop_signal')
    assert.ok(result.signals.includes('safety_gate_failed'))
    assert.ok(result.signals.includes('hard_stop_signal'))
    assert.ok(result.knownLimits.includes('hard_stop_exposed_without_overlay_dismissal'))
  })

  it('fails chrome.checkSafetyGate when the driver safety read fails', async () => {
    const driver = fakeDriver({
      safetyError: new Error('lease missing'),
    })

    const result = await invoke(
      { commandId: 'chrome.checkSafetyGate' },
      { handlers: createMacOSChromeInvokeHandlers(driver) },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'safety_gate')
    assert.equal(result.failure?.code, 'check_safety_gate_failed')
    assert.match(result.failure?.message ?? '', /lease missing/)
    assert.deepEqual(result.artifacts, [])
    assert.ok(result.signals.includes('safety_gate_check_failed'))
  })
})

function fakeDriver(options: {
  observeResult?: ObservationSnapshot
  observeError?: Error
  lastCapture?: ChromeWindowCapture
  recognizeResult?: RecognitionResult
  recognizeError?: Error
  safetyResult?: SafetyCheckResult
  safetyError?: Error
  onRecognize?: (capture: ChromeWindowCapture, target: ChromeRecognitionTarget) => void
}): MacOSChromeInvokeDriver {
  return {
    get lastCapture() {
      return options.lastCapture
    },
    observe: async () => {
      if (options.observeError)
        throw options.observeError
      return options.observeResult ?? fakeObservationSnapshot()
    },
    recognizeFromCapture: async (capture, target) => {
      if (options.recognizeError)
        throw options.recognizeError
      options.onRecognize?.(capture, target)
      return options.recognizeResult ?? fakeRecognitionResult()
    },
    checkSafetyGate: async () => {
      if (options.safetyError)
        throw options.safetyError
      return options.safetyResult ?? {
        passed: true,
        checks: {
          profile_verified: true,
          chrome_foreground: true,
          no_hard_stop_signal: true,
        },
        failures: [],
      }
    },
    promoteCandidate: async () => ({
      status: 'refused',
      reasons: ['empty_recognition'],
      residual_known_limits: ['read_only_test_driver_no_promotion'],
    }),
    click: async () => {},
    focusTextInput: async () => {},
    typeText: async () => {},
    pressKey: async () => {},
    scroll: async () => {},
  }
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
    capture_contract_ref: { run_id: 'run_1', artifact_id: 'capture_contract_mco_1', span_id: 'observe_mco_1' },
    evidence: [
      { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'observe_mco_1' },
      { run_id: 'run_1', artifact_id: 'capture_contract_mco_1', span_id: 'observe_mco_1' },
    ],
    nodes: [],
    detail: { signals: [] },
    known_limits: ['managed Chrome context lease established'],
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

function fakeRecognitionResult(options: {
  found?: boolean
} = {}): RecognitionResult {
  const evidence: ArtifactRef[] = [
    { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'recognize_1' },
    { run_id: 'run_1', artifact_id: 'capture_contract_mco_1', span_id: 'recognize_1' },
  ]
  const found = options.found ?? true
  const recognizedItem = {
    item_id: 'item_1',
    kind: 'ocr_text',
    box: { x: 10, y: 20, width: 100, height: 24 },
    text: 'Open jobs',
    detail: {},
  }
  return {
    found,
    recognition_id: 'mcr_1',
    source: 'ocr_text',
    scope: {
      surface: 'window',
      window_number: 42,
      capture_artifact: evidence[0],
      capture_contract_artifact: evidence[1],
    },
    best: found ? recognizedItem : null,
    filtered: found ? [recognizedItem] : [],
    all: found ? [recognizedItem] : [],
    detail: {},
    evidence,
    known_limits: ['recognition audit: capture visibility is reference evidence only'],
  }
}
