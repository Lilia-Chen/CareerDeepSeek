import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ComputerUseConfig } from '../../src/computer-use/config.js'
import type {
  AXSnapshot,
  ChromeDomObservation,
  ScreenshotArtifact,
  WindowObservation,
} from '../../src/computer-use/types.js'

const mocks = vi.hoisted(() => ({
  captureAXTree: vi.fn(),
  captureChromeDom: vi.fn(),
  captureScreenshot: vi.fn(),
  executeMoveAndClick: vi.fn(),
  executeOpenApp: vi.fn(),
  executePressKeys: vi.fn(),
  executeScroll: vi.fn(),
  executeTypeText: vi.fn(),
  executeWindowTargetedScroll: vi.fn(),
  loadProfileConfig: vi.fn(),
  observeWindows: vi.fn(),
  recognizeTextInImage: vi.fn(),
  detectHardStopSignals: vi.fn(),
  checkSafetyGate: vi.fn(),
}))

vi.mock('../../src/computer-use/ax-tree.js', () => ({
  captureAXTree: mocks.captureAXTree,
}))

vi.mock('../../src/computer-use/chrome-dom.js', () => ({
  captureChromeDom: mocks.captureChromeDom,
}))

vi.mock('../../src/computer-use/screenshot.js', () => ({
  captureScreenshot: mocks.captureScreenshot,
}))

vi.mock('../../src/computer-use/macos-chrome-driver/capture.js', () => ({
  captureChromeWindow: async (input: {
    config: ComputerUseConfig
    sessionId: string
    snapshotId: string
    window: {
      windowNumber: number
      ownerPid: number
      ownerBundleId?: string
      bounds: { x: number, y: number, width: number, height: number }
      title: string | null
    }
  }) => ({
    snapshotId: input.snapshotId,
    screenshot: screenshot(),
    contract: {
      coordinateContractVersion: 1,
      captureSource: {
        kind: 'window',
        windowNumber: input.window.windowNumber,
        ownerPid: input.window.ownerPid,
        ownerBundleId: input.window.ownerBundleId,
      },
      sourceGlobalLogicalBounds: input.window.bounds,
      screenshotPixelSize: { width: 1000, height: 800 },
      pixelToLogicalScale: { x: 1, y: 1 },
      logicalToPixelScale: { x: 1, y: 1 },
      capturedAt: new Date().toISOString(),
    },
  }),
}))

vi.mock('../../src/computer-use/macos-actions.js', () => ({
  executeMoveAndClick: mocks.executeMoveAndClick,
  executeOpenApp: mocks.executeOpenApp,
  executePressKeys: mocks.executePressKeys,
  executeScroll: mocks.executeScroll,
  executeTypeText: mocks.executeTypeText,
  executeWindowTargetedScroll: mocks.executeWindowTargetedScroll,
}))

vi.mock('../../src/computer-use/window-observation.js', () => ({
  observeWindows: mocks.observeWindows,
}))

vi.mock('../../src/computer-use/macos-chrome-driver/ocr.js', () => ({
  recognizeTextInImage: mocks.recognizeTextInImage,
}))

vi.mock('../../src/computer-use/macos-chrome-driver/safety-gate.js', () => ({
  checkSafetyGate: mocks.checkSafetyGate,
  detectHardStopSignals: mocks.detectHardStopSignals,
  loadProfileConfig: mocks.loadProfileConfig,
}))

const driverModule = await import('../../src/computer-use/macos-chrome-driver/index.js')
const {
  MacOSChromeDriver,
} = driverModule

const testRoot = join('.computer-use', `macos-chrome-driver-test-${process.pid}`)
const traceDir = join(testRoot, 'traces', 'driver-test')
const screenshotPath = join(testRoot, 'test-chrome.png')

const config: Partial<ComputerUseConfig> = {
  sessionRoot: testRoot,
  screenshotsDir: join(testRoot, 'screenshots'),
  timeoutMs: 15_000,
  binaries: {
    swift: 'swift',
    osascript: 'osascript',
    screencapture: 'screencapture',
    open: 'open',
  },
  denyApps: [],
  openableApps: ['Google Chrome'],
}

const png1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabdf0000000049454e44ae426082',
  'hex',
)

describe('macOS Chrome driver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rmSync(traceDir, { recursive: true, force: true })
    mkdirSync(testRoot, { recursive: true })
    writeFileSync(screenshotPath, png1x1)
    mocks.captureAXTree.mockResolvedValue(axSnapshot())
    mocks.captureChromeDom.mockResolvedValue(chromeDomObservation())
    mocks.captureScreenshot.mockResolvedValue(screenshot())
    mocks.executeMoveAndClick.mockResolvedValue(undefined)
    mocks.executeOpenApp.mockResolvedValue(undefined)
    mocks.executePressKeys.mockResolvedValue(undefined)
    mocks.executeScroll.mockResolvedValue(undefined)
    mocks.executeTypeText.mockResolvedValue(undefined)
    mocks.executeWindowTargetedScroll.mockResolvedValue(undefined)
    mocks.loadProfileConfig.mockResolvedValue({
      profile_path: 'Profile 4',
      profile_name: 'CareerDeepSeek',
      verified_at: '2026-06-14T00:00:00.000Z',
    })
    mocks.observeWindows.mockResolvedValue(chromeWindowObservation())
    mocks.recognizeTextInImage.mockResolvedValue({
      recognizedAt: '2026-06-14T00:00:00.000Z',
      imagePath: '/tmp/chrome.png',
      imageWidth: 1000,
      imageHeight: 800,
      matches: [
        {
          matchIndex: 0,
          text: 'Search',
          confidence: 0.97,
          bounds: { x: 92, y: 78, width: 120, height: 34 },
        },
      ],
    })
    mocks.detectHardStopSignals.mockReturnValue([])
    mocks.checkSafetyGate.mockReturnValue({
      passed: true,
      checks: { profile_verified: true, chrome_foreground: true, no_hard_stop_signal: true },
      failures: [],
    })
  })

  afterEach(() => {
    rmSync(traceDir, { recursive: true, force: true })
    rmSync(screenshotPath, { force: true })
  })

  it('does not expose deprecated legacy driver APIs', () => {
    assert.equal('promoteChromeCandidate' in driverModule, false)
    assert.equal('observeLegacy' in MacOSChromeDriver.prototype, false)
    assert.equal('recognizeLegacy' in MacOSChromeDriver.prototype, false)
    assert.equal('clickLegacy' in MacOSChromeDriver.prototype, false)
  })

  it('keeps the macOS Chrome driver barrel limited to driver and harness runtime values', () => {
    assert.equal('MacOSChromeDriver' in driverModule, true)
    assert.equal('MacOSChromeAgentHarness' in driverModule, true)

    const forbiddenRuntimeExports = [
      'captureChromeWindow',
      'recognizeTextInImage',
      'normalizeToSurfaceNodes',
      'inferObservationSource',
      'recognizeFromCapture',
      'promoteCandidate',
      'detectHardStopSignals',
      'checkSafetyGate',
      'loadProfileConfig',
      'TraceStore',
      'ARTIFACT_API_VERSION',
      'EVENT_API_VERSION',
      'RUN_API_VERSION',
      'SPAN_API_VERSION',
    ]

    for (const exportName of forbiddenRuntimeExports) {
      assert.equal(exportName in driverModule, false, `${exportName} must not be exported from the driver barrel`)
    }
  })

  it('observes Chrome through the AUV-aligned observation snapshot contract', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    const snapshot = await driver.observe()

    assert.equal(snapshot.api_version, 'careerdeepseek.observation_snapshot.v1alpha1')
    assert.equal(snapshot.scope.window_number, 42)
    assert.equal(snapshot.scope.app_bundle_id, 'com.google.Chrome')
    assert.equal(snapshot.capture_contract_ref?.artifact_id, 'capture_contract_mco_1')
    assert.ok(snapshot.evidence.some(item => item.artifact_id === 'screenshot_mco_1'))
    assert.ok(snapshot.nodes.some(node => node.label === 'Search'))
    assert.equal('targetCandidates' in snapshot, false)
  })

  it('records observe artifacts with kebab-case roles and parseable JSON payloads', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await driver.observe()

    const records = readArtifactRecords()
    const screenshot = records.find(record => record.role === 'screenshot')
    const contract = records.find(record => record.role === 'capture-contract')
    const observation = records.find(record => record.role === 'observation-snapshot')

    assert.ok(screenshot)
    assert.equal(existsSync(screenshot.path), true)
    assert.equal(readFileSync(screenshot.path).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.ok(contract)
    assert.ok(observation)
    assert.equal(records.some(record => record.role === 'capture_contract'), false)
    assert.equal(records.some(record => record.role === 'observation_snapshot'), false)

    const contractPayload = JSON.parse(readFileSync(contract.path, 'utf-8'))
    assert.equal(contractPayload.coordinateContractVersion, 1)
    assert.equal(contractPayload.captureSource.kind, 'window')
    assert.equal(contractPayload.captureSource.windowNumber, 42)
    assert.equal(contractPayload.captureSource.ownerPid, 123)
    assert.equal(contractPayload.captureSource.ownerBundleId, 'com.google.Chrome')
    assert.deepEqual(contractPayload.sourceGlobalLogicalBounds, { x: 0, y: 40, width: 1000, height: 800 })
    assert.deepEqual(contractPayload.screenshotPixelSize, { width: 1000, height: 800 })
    assert.deepEqual(contractPayload.pixelToLogicalScale, { x: 1, y: 1 })
    assert.ok(typeof contractPayload.capturedAt === 'string')

    const observationPayload = JSON.parse(readFileSync(observation.path, 'utf-8'))
    assert.equal(observationPayload.api_version, 'careerdeepseek.observation_snapshot.v1alpha1')
    assert.equal(observationPayload.capture_contract_ref.artifact_id, contract.artifact_id)
    assert.ok(observationPayload.evidence.some((ref: { artifact_id: string }) => ref.artifact_id === screenshot.artifact_id))
  })

  it('recognizes a target from capture and promotes it into a click candidate', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await driver.observe()
    const result = await driver.recognizeFromCapture(driver.lastCapture!, {
      kind: 'button',
      text: /accept all cookies/i,
    })
    const promotion = await driver.promoteCandidate(result, driver.lastCapture!)

    assert.equal(result.found, true)
    assert.equal(result.best?.kind, 'dom_button')
    assert.equal(result.best?.text, 'Accept all cookies')
    assert.ok(result.filtered.length >= 1)
    assert.ok(result.all.length >= result.filtered.length)
    assert.equal(result.evidence.some(ref => ref.artifact_id.startsWith('screenshot_run_')), false)
    assert.equal(promotion.status, 'promoted')
    if (promotion.status === 'promoted') {
      assert.equal(promotion.candidate.kind, 'dom_button')
      assert.equal(promotion.candidate.label, 'Accept all cookies')
      assert.equal(promotion.candidate.liveness.preconditions.window_ref.window_number, 42)
      assert.equal(promotion.candidate.evidence.capture_artifact.artifact_id, 'screenshot_mco_1')
      assert.ok(promotion.candidate.evidence.recognition_artifact.artifact_id.startsWith('recognition_'))
      assert.equal(promotion.candidate.evidence.capture_artifact.artifact_id.startsWith('capture_'), false)
    }

    const records = readArtifactRecords()
    assert.ok(records.some(record => record.role === 'recognition-result'))
    assert.ok(records.some(record => record.role === 'promoted-candidate'))
  })

  it('clicks a promoted candidate after rechecking Chrome foreground', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })
    await driver.observe()
    const result = await driver.recognizeFromCapture(driver.lastCapture!, { kind: 'button', text: /accept all cookies/i })
    const promotion = await driver.promoteCandidate(result, driver.lastCapture!)

    assert.equal(promotion.status, 'promoted')
    if (promotion.status !== 'promoted')
      return

    await driver.click(promotion.candidate)

    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 1)
    const payload = mocks.executeMoveAndClick.mock.calls[0]?.[1]
    assert.equal(payload.pointerTrace.at(-1).x, 660)
    assert.equal(payload.pointerTrace.at(-1).y, 342)

    const actionPayload = readLastJsonArtifactByRole('action-execution')
    assert.equal(actionPayload.action_type, 'click')
    assert.equal(actionPayload.executed, true)
    assert.equal(actionPayload.refused, false)
    assert.equal(actionPayload.precondition_result.passed, true)
    const candidateRecord = readArtifactRecordById(actionPayload.candidate_ref.artifact_id)
    assert.equal(candidateRecord.role, 'promoted-candidate')
    const candidatePayload = JSON.parse(readFileSync(candidateRecord.path, 'utf-8'))
    assert.equal(candidatePayload.candidate_local_id, promotion.candidate.candidate_local_id)
  })

  it('refuses a forged promoted candidate that was not written by driver promotion', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })
    await driver.observe()
    const candidate = promotedCandidate({ windowNumber: 42 })

    await assert.rejects(
      () => driver.click(candidate),
      /missing_promoted_candidate_artifact/i,
    )

    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 0)
    const records = readArtifactRecords()
    assert.equal(records.some(record => record.role === 'promoted-candidate'), false)
    const actionPayload = readLastJsonArtifactByRole('action-execution')
    assert.equal(actionPayload.action_type, 'click')
    assert.equal(actionPayload.executed, false)
    assert.equal(actionPayload.refused, true)
    assert.ok(actionPayload.refusal_reasons.includes('missing_promoted_candidate_artifact'))
    assert.equal(actionPayload.candidate_ref === null || actionPayload.candidate_ref === undefined, true)
  })

  it('records action-execution payload when the unified safety gate refuses a click', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })
    await driver.observe()
    const result = await driver.recognizeFromCapture(driver.lastCapture!, { kind: 'button', text: /accept all cookies/i })
    const promotion = await driver.promoteCandidate(result, driver.lastCapture!)
    assert.equal(promotion.status, 'promoted')
    if (promotion.status !== 'promoted')
      return
    mocks.checkSafetyGate.mockReturnValueOnce({
      passed: false,
      checks: { profile_verified: true, chrome_foreground: true, no_hard_stop_signal: false },
      failures: [{ code: 'hard_stop_signal', detail: 'Signals detected: captcha', observed: ['captcha'] }],
    })

    await assert.rejects(
      () => driver.click(promotion.candidate),
      /hard_stop_signal/i,
    )

    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 0)
    const actionPayload = readLastJsonArtifactByRole('action-execution')
    assert.equal(actionPayload.action_type, 'click')
    assert.equal(actionPayload.executed, false)
    assert.equal(actionPayload.refused, true)
    assert.deepEqual(actionPayload.refusal_reasons, ['hard_stop_signal'])
    assert.equal(actionPayload.precondition_result.passed, false)
  })

  it('scrolls through the AUV-style window-targeted executor with Chrome window routing fields', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await driver.observe()
    await driver.scroll(240, -12, { windowLocalPoint: { x: 320, y: 180 }, settleMs: 25 })

    assert.equal(mocks.executeWindowTargetedScroll.mock.calls.length, 1)
    assert.equal(mocks.executeScroll.mock.calls.length, 0)
    const payload = mocks.executeWindowTargetedScroll.mock.calls[0]?.[1]
    assert.deepEqual(payload, {
      pid: 123,
      windowNumber: 42,
      screenPoint: { x: 320, y: 220 },
      windowLocalPoint: { x: 320, y: 180 },
      deltaX: -12,
      deltaY: 240,
      settleMs: 25,
    })
  })

  it('rejects caller-supplied screenPoint and derives screen coordinates from the leased window', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await driver.observe()

    await assert.rejects(
      () => driver.scroll(240, 0, {
        screenPoint: { x: 9999, y: 9999 },
      } as never),
      /screenPoint/i,
    )
    assert.equal(mocks.executeWindowTargetedScroll.mock.calls.length, 0)
    assert.equal(mocks.executeScroll.mock.calls.length, 0)

    await driver.scroll(240, 0, { windowLocalPoint: { x: 320, y: 180 } })

    const payload = mocks.executeWindowTargetedScroll.mock.calls[0]?.[1]
    assert.equal(payload.screenPoint.x, 320)
    assert.equal(payload.screenPoint.y, 220)
    assert.deepEqual(payload.windowLocalPoint, { x: 320, y: 180 })
  })

  it('establishes a managed Chrome context lease on first observe without probing chrome://version', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    const snapshot = await driver.observe()

    assert.equal(mocks.loadProfileConfig.mock.calls.length, 1)
    assert.deepEqual(mocks.executeOpenApp.mock.calls[0]?.slice(1), [
      'Google Chrome',
      { args: ['--profile-directory=Profile 4'] },
    ])
    const chromeContext = snapshot.detail.chrome_context as {
      lease?: {
        profileMode: string
        profilePath: string
        ownerPid: number
        windowNumber: number
        ownerBundleId?: string
      }
    }
    assert.equal(chromeContext.lease?.profileMode, 'managed')
    assert.equal(chromeContext.lease?.profilePath, 'Profile 4')
    assert.equal(chromeContext.lease?.ownerPid, 123)
    assert.equal(chromeContext.lease?.windowNumber, 42)
    assert.equal(chromeContext.lease?.ownerBundleId, 'com.google.Chrome')
  })

  it('rejects actions before a managed Chrome context lease is established', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })
    const candidate = promotedCandidate({ windowNumber: 42 })

    await assert.rejects(
      () => driver.click(candidate),
      /Chrome context lease has not been established/i,
    )
    await assert.rejects(
      () => driver.typeText('hello'),
      /Chrome context lease has not been established/i,
    )
    await assert.rejects(
      () => driver.pressKey('Enter'),
      /Chrome context lease has not been established/i,
    )
    await assert.rejects(
      () => driver.scroll(240),
      /Chrome context lease has not been established/i,
    )
    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 0)
    assert.equal(mocks.executeTypeText.mock.calls.length, 0)
    assert.equal(mocks.executePressKeys.mock.calls.length, 0)
    assert.equal(mocks.executeWindowTargetedScroll.mock.calls.length, 0)
    assert.equal(mocks.executeScroll.mock.calls.length, 0)

    const actionPayloads = readJsonArtifactsByRole('action-execution')
    assert.equal(actionPayloads.length, 4)
    assert.deepEqual(actionPayloads.map(payload => payload.action_type), ['click', 'typeText', 'pressKey', 'scroll'])
    for (const actionPayload of actionPayloads) {
      assert.equal(actionPayload.executed, false)
      assert.equal(actionPayload.refused, true)
      assert.ok(actionPayload.refusal_reasons.includes('chrome_context_lease_missing'))
    }
  })

  it('keeps actions bound to the leased Chrome window and rejects replacement windows', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await driver.observe()
    mocks.observeWindows.mockResolvedValue(chromeWindowObservation({
      windowNumber: 43,
      id: '43',
      ownerPid: 123,
    }))

    await assert.rejects(
      () => driver.typeText('hello'),
      /Chrome context lease is no longer valid/i,
    )
    assert.equal(mocks.executeTypeText.mock.calls.length, 0)
  })

  it('refuses scroll before a managed Chrome context lease establishes the action context', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await assert.rejects(
      () => driver.scroll(240),
      /Chrome context lease has not been established/i,
    )
    assert.equal(mocks.executeWindowTargetedScroll.mock.calls.length, 0)
    assert.equal(mocks.executeScroll.mock.calls.length, 0)
  })

  it('falls back to foreground HID scroll when window-targeted delivery is unavailable', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })
    mocks.executeWindowTargetedScroll.mockRejectedValueOnce(new Error('CGEventSetWindowLocation unavailable'))

    await driver.observe()
    await driver.scroll(240, 0, { windowLocalPoint: { x: 300, y: 200 } })

    assert.equal(mocks.executeWindowTargetedScroll.mock.calls.length, 1)
    assert.equal(mocks.executeScroll.mock.calls.length, 1)
    const payload = mocks.executeScroll.mock.calls[0]?.[1]
    assert.equal(payload.pointerTrace.at(-1).x, 300)
    assert.equal(payload.pointerTrace.at(-1).y, 240)
  })
})

function screenshot(): ScreenshotArtifact {
  return {
    dataBase64: '',
    mimeType: 'image/png',
    path: screenshotPath,
    width: 1000,
    height: 800,
    capturedAt: '2026-06-14T00:00:00.000Z',
  }
}

function readArtifactRecords(): Array<{
  artifact_id: string
  span_id: string
  role: string
  mime_type: string
  path: string
}> {
  return readFileSync(join(traceDir, 'artifacts.jsonl'), 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

function readLastJsonArtifactByRole(role: string): Record<string, any> {
  const record = readArtifactRecords().filter(item => item.role === role).at(-1)
  assert.ok(record)
  return JSON.parse(readFileSync(record.path, 'utf-8'))
}

function readJsonArtifactsByRole(role: string): Array<Record<string, any>> {
  return readArtifactRecords()
    .filter(item => item.role === role)
    .map(item => JSON.parse(readFileSync(item.path, 'utf-8')))
}

function readArtifactRecordById(artifactId: string): {
  artifact_id: string
  span_id: string
  role: string
  mime_type: string
  path: string
} {
  const record = readArtifactRecords().find(item => item.artifact_id === artifactId)
  assert.ok(record)
  return record
}

function chromeWindowObservation(overrides: Partial<WindowObservation['windows'][number]> = {}): WindowObservation {
  return {
    frontmostAppName: 'Google Chrome',
    frontmostWindowTitle: 'LinkedIn',
    observedAt: '2026-06-14T00:00:00.000Z',
    windows: [
      {
        id: '42',
        windowNumber: 42,
        ownerBundleId: 'com.google.Chrome',
        appName: 'Google Chrome',
        title: 'LinkedIn',
        bounds: { x: 0, y: 40, width: 1000, height: 800 },
        ownerPid: 123,
        layer: 0,
        isOnScreen: true,
        ...overrides,
      },
    ],
  }
}

function promotedCandidate(overrides: { windowNumber?: number } = {}) {
  return {
    candidate_local_id: 'candidate-1',
    kind: 'dom_button',
    label: 'Accept all cookies',
    target_spec: {
      grounding: 'coordinate' as const,
      box: { x: 520, y: 280, width: 280, height: 44 },
      anchor_text: 'Accept all cookies',
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
          window_number: overrides.windowNumber,
        },
      },
    },
    control: { requires_app_frontmost: true, requires_window_focus: true },
    source_run_id: 'run',
    source_span_id: 'span',
    source_operation_id: 'recognition',
    source_artifact_id: 'recognition',
    known_limits: [],
  }
}

function axSnapshot(): AXSnapshot {
  return {
    snapshotId: 'ax-1',
    pid: 123,
    appName: 'Google Chrome',
    capturedAt: '2026-06-14T00:00:00.000Z',
    maxDepth: 15,
    truncated: false,
    root: {
      uid: 'root',
      role: 'AXApplication',
      children: [
        {
          uid: 'search-ax',
          role: 'AXTextField',
          description: 'Search',
          bounds: { x: 90, y: 76, width: 124, height: 38 },
          children: [],
        },
      ],
    },
  }
}

function chromeDomObservation(): ChromeDomObservation {
  return {
    url: 'https://www.linkedin.com/feed/',
    title: 'Feed | LinkedIn',
    observedAt: '2026-06-14T00:00:00.000Z',
    visibleText: 'LinkedIn Search Accept all cookies',
    signals: [],
    elements: [
      {
        id: 'search',
        tagName: 'input',
        role: 'textbox',
        name: 'Search',
        text: 'Search',
        href: null,
        bounds: { x: 90, y: 76, width: 124, height: 38 },
        center: { x: 152, y: 95 },
        confidence: 0.9,
        actionable: true,
        states: {},
      },
      {
        id: 'accept',
        tagName: 'button',
        role: 'button',
        name: 'Accept all cookies',
        text: 'Accept all cookies',
        href: null,
        bounds: { x: 520, y: 280, width: 280, height: 44 },
        center: { x: 660, y: 302 },
        confidence: 0.95,
        actionable: true,
        states: {},
      },
    ],
  }
}
