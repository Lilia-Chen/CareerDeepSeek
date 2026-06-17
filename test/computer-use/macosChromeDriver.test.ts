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
import type { ChromeRecognitionTarget } from '../../src/computer-use/macos-chrome-driver/types.js'

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
  produceOcrRows: vi.fn(),
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
  produceOcrRows: mocks.produceOcrRows,
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
    mocks.recognizeTextInImage.mockResolvedValue(ocrSnapshot([
      {
        matchIndex: 0,
        text: 'Search',
        confidence: 0.97,
        bounds: { x: 92, y: 78, width: 120, height: 34 },
      },
    ]))
    mocks.produceOcrRows.mockImplementation(async ({ textSnapshot }) => ({
      strategy: 'ocr-text',
      imagePath: textSnapshot.imagePath,
      imageWidth: textSnapshot.imageWidth,
      imageHeight: textSnapshot.imageHeight,
      rawMatchCount: textSnapshot.rawMatchCount,
      filteredMatchCount: textSnapshot.filteredMatchCount,
      rowCount: textSnapshot.matches.length > 0 ? 1 : 0,
      rows: textSnapshot.matches.length > 0
        ? [{
            rowIndex: 0,
            source: 'ocr_row',
            bounds: { x: 80, y: 70, width: 180, height: 56 },
            textFragments: textSnapshot.matches.map((match: {
              matchIndex: number
              text: string
              confidence: number
              bounds: { x: number, y: number, width: number, height: number }
            }) => ({
              matchIndex: match.matchIndex,
              text: match.text,
              confidence: match.confidence,
              bounds: match.bounds,
            })),
            knownLimits: ['row grouping is heuristic within current capture'],
          }]
        : [],
      providerDetail: {
        provider: 'careerdeepseek.macos_chrome_driver.ocr_rows',
        originalStrategy: 'ocr-text',
      },
      knownLimits: ['row grouping is heuristic within current capture'],
    }))
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
    assert.ok(snapshot.evidence.some(item => item.artifact_id === 'capture_contract_mco_1'))
    assert.ok(snapshot.nodes.some(node => node.label === 'Search'))
    const ocrNode = snapshot.nodes.find(node => node.kind === 'ocr_text')
    assert.ok(ocrNode)
    assert.deepEqual(ocrNode.source_artifacts, ['screenshot_mco_1', 'capture_contract_mco_1'])
    assert.deepEqual(ocrNode.detail.source_artifacts, {
      capture_artifact: { run_id: snapshot.run_id, artifact_id: 'screenshot_mco_1', span_id: snapshot.span_id },
      capture_contract_artifact: { run_id: snapshot.run_id, artifact_id: 'capture_contract_mco_1', span_id: snapshot.span_id },
    })
    const rowNode = snapshot.nodes.find(node => node.kind === 'ocr_row')
    assert.ok(rowNode)
    assert.deepEqual(rowNode.source_artifacts, ['screenshot_mco_1', 'capture_contract_mco_1'])
    assert.equal(rowNode.label, 'Search')
    assert.deepEqual(snapshot.detail.ocr_rows, {
      strategy: 'ocr-text',
      row_count: 1,
      raw_match_count: 1,
      filtered_match_count: 1,
      known_limits: ['row grouping is heuristic within current capture'],
    })
    assert.equal(mocks.produceOcrRows.mock.calls.length, 1)
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
    const rowReport = records.find(record => record.role === 'ocr-row-report')

    assert.ok(screenshot)
    assert.equal(existsSync(screenshot.path), true)
    assert.equal(readFileSync(screenshot.path).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.ok(contract)
    assert.ok(observation)
    assert.ok(rowReport)
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
    assert.ok(observationPayload.evidence.some((ref: { artifact_id: string }) => ref.artifact_id === contract.artifact_id))
    assert.ok(observationPayload.evidence.some((ref: { artifact_id: string }) => ref.artifact_id === rowReport.artifact_id))

    const rowReportPayload = JSON.parse(readFileSync(rowReport.path, 'utf-8'))
    assert.equal(rowReportPayload.strategy, 'ocr-text')
    assert.equal(rowReportPayload.rowCount, 1)
    assert.equal(rowReportPayload.rawMatchCount, 1)
    assert.equal(rowReportPayload.filteredMatchCount, 1)
    assert.equal(Array.isArray(rowReportPayload.rows), true)
  })

  it('does not decode screenshot pixels or pass visualImage for P1-1 OCR row evidence', async () => {
    mocks.captureAXTree.mockResolvedValue(emptyAxSnapshot())
    mocks.captureChromeDom.mockResolvedValue(emptyChromeDomObservation())
    mocks.recognizeTextInImage.mockResolvedValue(ocrSnapshot([
      {
        matchIndex: 0,
        text: 'Runtime OCR row',
        confidence: 0.91,
        bounds: { x: 52, y: 130, width: 210, height: 22 },
      },
    ]))
    mocks.produceOcrRows.mockImplementationOnce(async (input) => {
      assert.equal('visualImage' in input, false)
      assert.equal('visualRows' in input, false)
      assert.equal('visualOptions' in input, false)
      const textSnapshot = input.textSnapshot
      return {
        strategy: 'ocr-text',
        imagePath: textSnapshot.imagePath,
        imageWidth: textSnapshot.imageWidth,
        imageHeight: textSnapshot.imageHeight,
        rawMatchCount: textSnapshot.rawMatchCount,
        filteredMatchCount: textSnapshot.filteredMatchCount,
        rowCount: 1,
        rows: [{
          rowIndex: 0,
          source: 'ocr_row' as const,
          bounds: { x: 40, y: 120, width: 420, height: 48 },
          textFragments: [
            {
              matchIndex: 0,
              text: 'Runtime OCR row',
              confidence: 0.84,
              bounds: { x: 52, y: 130, width: 210, height: 22 },
            },
          ],
          confidence: 0.82,
          knownLimits: ['row grouping is heuristic within current capture'],
        }],
        providerDetail: {
          provider: 'careerdeepseek.macos_chrome_driver.ocr_rows',
          originalStrategy: 'ocr-text',
        },
        knownLimits: ['row grouping is heuristic within current capture'],
      }
    })
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    const snapshot = await driver.observe()

    const rowNode = snapshot.nodes.find(node => node.kind === 'ocr_row')
    assert.ok(rowNode)
    assert.equal(rowNode.label, 'Runtime OCR row')
    assert.deepEqual(rowNode.source_artifacts, ['screenshot_mco_1', 'capture_contract_mco_1'])
    assert.equal(rowNode.detail.source, 'ocr_row')
    assert.deepEqual(rowNode.detail.row_bounds, {
      capture_pixel: { x: 40, y: 120, width: 420, height: 48 },
      source_global_logical: { x: 40, y: 160, width: 420, height: 48 },
    })
    assert.ok((rowNode.detail.known_limits as string[]).some(limit => limit.includes('row grouping')))
    assert.deepEqual(snapshot.detail.ocr_rows, {
      strategy: 'ocr-text',
      row_count: 1,
      raw_match_count: 1,
      filtered_match_count: 1,
      known_limits: ['row grouping is heuristic within current capture'],
    })

    const rowReportPayload = readLastJsonArtifactByRole('ocr-row-report')
    assert.equal(rowReportPayload.strategy, 'ocr-text')
    assert.equal(rowReportPayload.rowCount, 1)
    assert.equal(rowReportPayload.rows[0].source, 'ocr_row')
    assert.equal(rowReportPayload.rows[0].textFragments[0].text, 'Runtime OCR row')
  })

  it('recognizes OCR runtime items with projection detail and capture refs from the normalizer path', async () => {
    mocks.captureAXTree.mockResolvedValue(emptyAxSnapshot())
    mocks.captureChromeDom.mockResolvedValue(emptyChromeDomObservation())
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await driver.observe()
    const result = await driver.recognizeFromCapture(driver.lastCapture!, { kind: 'visible_text', text: /search/i })

    assert.equal(result.found, true)
    assert.equal(result.best?.kind, 'ocr_text')
    assert.deepEqual(result.best?.detail.source_artifacts, {
      capture_artifact: { run_id: result.scope.capture_artifact?.run_id, artifact_id: 'screenshot_mco_1', span_id: 'observe_mco_1' },
      capture_contract_artifact: { run_id: result.scope.capture_contract_artifact?.run_id, artifact_id: 'capture_contract_mco_1', span_id: 'observe_mco_1' },
    })
    assert.deepEqual(result.best?.detail.bounds, {
      capture_pixel: { x: 92, y: 78, width: 120, height: 34 },
      source_global_logical: { x: 92, y: 118, width: 120, height: 34 },
    })
    assert.equal(result.known_limits.some(limit => limit.includes('invalid bounds or projection detail')), false)
  })

  it('writes recognition-result artifact with parseable cross-source audit and no audit role', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await driver.observe()
    const result = await driver.recognizeFromCapture(driver.lastCapture!, { kind: 'visible_text', text: /search/i })
    const payload = readLastJsonArtifactByRole('recognition-result')
    const audit = payload.detail.cross_source_audit as Record<string, unknown>
    const records = readArtifactRecords()

    assert.equal(payload.recognition_id, result.recognition_id)
    assert.equal(typeof audit, 'object')
    assert.notEqual(audit, null)
    assert.deepEqual((audit.artifact_refs as Record<string, unknown>).capture_artifact, {
      run_id: result.scope.capture_artifact?.run_id,
      artifact_id: 'screenshot_mco_1',
      span_id: 'observe_mco_1',
    })
    assert.deepEqual((audit.artifact_refs as Record<string, unknown>).capture_contract_artifact, {
      run_id: result.scope.capture_contract_artifact?.run_id,
      artifact_id: 'capture_contract_mco_1',
      span_id: 'observe_mco_1',
    })
    assert.ok(Array.isArray(audit.sources))
    assert.ok(Array.isArray(audit.items))
    assert.equal(records.some(record => record.role === 'recognition-audit'), false)
    assert.equal(records.some(record => record.role === 'audit'), false)
  })

  it('recognizes visible text from OCR row evidence emitted by the runtime producer', async () => {
    mocks.captureAXTree.mockResolvedValue(emptyAxSnapshot())
    mocks.captureChromeDom.mockResolvedValue(emptyChromeDomObservation())
    mocks.recognizeTextInImage.mockResolvedValue(ocrSnapshot([
      {
        matchIndex: 0,
        text: 'Acme',
        confidence: 0.91,
        bounds: { x: 100, y: 200, width: 80, height: 28 },
      },
      {
        matchIndex: 1,
        text: 'AI Engineer',
        confidence: 0.89,
        bounds: { x: 220, y: 202, width: 220, height: 30 },
      },
    ]))
    mocks.produceOcrRows.mockResolvedValue({
      strategy: 'ocr-text',
      imagePath: '/tmp/chrome.png',
      imageWidth: 1000,
      imageHeight: 800,
      rawMatchCount: 2,
      filteredMatchCount: 2,
      rowCount: 1,
      rows: [{
        rowIndex: 0,
        source: 'ocr_row',
        bounds: { x: 100, y: 190, width: 360, height: 60 },
        textFragments: [
          { matchIndex: 0, text: 'Acme', confidence: 0.91, bounds: { x: 100, y: 200, width: 80, height: 28 } },
          { matchIndex: 1, text: 'AI Engineer', confidence: 0.89, bounds: { x: 220, y: 202, width: 220, height: 30 } },
        ],
        knownLimits: ['row grouping is heuristic within current capture'],
      }],
      providerDetail: {
        provider: 'careerdeepseek.macos_chrome_driver.ocr_rows',
        originalStrategy: 'ocr-text',
      },
      knownLimits: ['row grouping is heuristic within current capture'],
    })
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await driver.observe()
    const result = await driver.recognizeFromCapture(driver.lastCapture!, { kind: 'visible_text', text: /Acme AI Engineer/i })

    assert.equal(result.found, true)
    assert.equal(result.best?.kind, 'ocr_row')
    assert.equal(result.best?.text, 'Acme AI Engineer')
    assert.deepEqual(result.best?.detail.row_bounds, {
      capture_pixel: { x: 100, y: 190, width: 360, height: 60 },
      source_global_logical: { x: 100, y: 230, width: 360, height: 60 },
    })
    assert.equal(result.known_limits.some(limit => limit.includes('invalid bounds or projection detail')), false)
  })

  it('propagates raw OCR failure limits through observe even when row production returns empty rows', async () => {
    mocks.recognizeTextInImage.mockRejectedValueOnce(new Error('vision provider unavailable'))
    mocks.produceOcrRows.mockResolvedValueOnce({
      strategy: 'ocr-text',
      imagePath: screenshotPath,
      imageWidth: 1000,
      imageHeight: 800,
      rawMatchCount: 0,
      filteredMatchCount: 0,
      rowCount: 0,
      rows: [],
      providerDetail: {
        provider: 'careerdeepseek.macos_chrome_driver.ocr_rows',
        originalStrategy: 'ocr-text',
      },
      knownLimits: [],
    })
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    const snapshot = await driver.observe()

    assert.ok(snapshot.known_limits.some(limit => limit.includes('raw OCR failed')))
    assert.ok(snapshot.known_limits.some(limit => limit.includes('vision provider unavailable')))
    assert.ok((snapshot.detail.ocr_known_limits as string[]).some(limit => limit.includes('raw OCR failed')))
  })

  it('propagates OCR and row-production failure limits through recognizeFromCapture', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await driver.observe()
    mocks.captureAXTree.mockResolvedValue(emptyAxSnapshot())
    mocks.captureChromeDom.mockResolvedValue(emptyChromeDomObservation())
    mocks.recognizeTextInImage.mockRejectedValueOnce(new Error('vision provider unavailable'))
    mocks.produceOcrRows.mockRejectedValueOnce(new Error('row producer unavailable'))

    const result = await driver.recognizeFromCapture(driver.lastCapture!, { kind: 'visible_text', text: /missing/i })

    assert.equal(result.found, false)
    assert.ok(result.known_limits.some(limit => limit.includes('raw OCR failed')))
    assert.ok(result.known_limits.some(limit => limit.includes('vision provider unavailable')))
    assert.ok(result.known_limits.some(limit => limit.includes('ocr row production failed')))
    assert.ok(result.known_limits.some(limit => limit.includes('row producer unavailable')))
    assert.ok((result.detail.ocr_known_limits as string[]).some(limit => limit.includes('raw OCR failed')))
    assert.ok((result.detail.ocr_row_known_limits as string[]).some(limit => limit.includes('ocr row production failed')))

    const payload = readLastJsonArtifactByRole('recognition-result')
    const audit = payload.detail.cross_source_audit as Record<string, unknown>
    const auditKnownLimits = audit.known_limits as string[]
    assert.equal(audit.status, 'unknown')
    assert.ok(payload.known_limits.some((limit: string) => limit.includes('raw OCR failed')))
    assert.ok(payload.known_limits.some((limit: string) => limit.includes('ocr row production failed')))
    assert.ok(auditKnownLimits.some(limit => limit.includes('raw OCR failed')))
    assert.ok(auditKnownLimits.some(limit => limit.includes('vision provider unavailable')))
    assert.ok(auditKnownLimits.some(limit => limit.includes('ocr row production failed')))
    assert.ok(auditKnownLimits.some(limit => limit.includes('row producer unavailable')))
  })

  it('preserves conflict audit status when driver-level OCR and row limits are appended', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await driver.observe()
    mocks.recognizeTextInImage.mockResolvedValueOnce({
      ...ocrSnapshot([
        {
          matchIndex: 0,
          text: 'Reject all cookies',
          confidence: 0.93,
          bounds: { x: 520, y: 280, width: 280, height: 44 },
        },
      ]),
      knownLimits: ['raw OCR provider degraded'],
    })
    mocks.produceOcrRows.mockResolvedValueOnce({
      strategy: 'ocr-text',
      imagePath: screenshotPath,
      imageWidth: 1000,
      imageHeight: 800,
      rawMatchCount: 1,
      filteredMatchCount: 1,
      rowCount: 0,
      rows: [],
      providerDetail: {
        provider: 'careerdeepseek.macos_chrome_driver.ocr_rows',
        originalStrategy: 'ocr-text',
      },
      knownLimits: ['row producer degraded'],
    })

    await driver.recognizeFromCapture(driver.lastCapture!, { kind: 'button', text: /accept all cookies/i })

    const payload = readLastJsonArtifactByRole('recognition-result')
    const audit = payload.detail.cross_source_audit as Record<string, unknown>
    const auditKnownLimits = audit.known_limits as string[]

    assert.equal(audit.status, 'conflict')
    assert.ok(auditKnownLimits.some(limit => limit.includes('raw OCR provider degraded')))
    assert.ok(auditKnownLimits.some(limit => limit.includes('row producer degraded')))
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

  it('writes promoted-candidate only when promotion succeeds', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await driver.observe()
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocrSnapshot([
      {
        matchIndex: 0,
        text: 'Reject all cookies',
        confidence: 0.94,
        bounds: { x: 520, y: 280, width: 280, height: 44 },
      },
    ]))
    mocks.produceOcrRows.mockResolvedValueOnce({
      strategy: 'ocr-text',
      imagePath: screenshotPath,
      imageWidth: 1000,
      imageHeight: 800,
      rawMatchCount: 1,
      filteredMatchCount: 1,
      rowCount: 0,
      rows: [],
      providerDetail: {
        provider: 'careerdeepseek.macos_chrome_driver.ocr_rows',
        originalStrategy: 'ocr-text',
      },
      knownLimits: [],
    })
    const result = await driver.recognizeFromCapture(driver.lastCapture!, {
      kind: 'button',
      text: /accept all cookies/i,
    })
    const audit = result.detail.cross_source_audit as { status?: string }
    const recognitionPayload = readLastJsonArtifactByRole('recognition-result')

    assert.equal(audit.status, 'conflict')
    assert.equal((recognitionPayload.detail.cross_source_audit as { status?: string }).status, 'conflict')

    const promotion = await driver.promoteCandidate(result, driver.lastCapture!)

    assert.equal(promotion.status, 'refused')
    const records = readArtifactRecords()
    assert.equal(records.some(record => record.role === 'promoted-candidate'), false)
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

  it('reobserves and clicks the fresh matched box center for a promoted candidate', async () => {
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
    assert.deepEqual(promotion.candidate.target_spec.box, { x: 520, y: 320, width: 280, height: 44 })

    mocks.captureChromeDom.mockResolvedValue(chromeDomObservation({
      elements: [
        searchElement(),
        acceptCookiesElement({ bounds: { x: 550, y: 310, width: 280, height: 44 } }),
      ],
    }))

    await driver.click(promotion.candidate)

    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 1)
    const payload = mocks.executeMoveAndClick.mock.calls[0]?.[1]
    assert.equal(payload.pointerTrace.at(-1).x, 690)
    assert.equal(payload.pointerTrace.at(-1).y, 372)
    const actionPayload = readLastJsonArtifactByRole('action-execution')
    assert.equal(actionPayload.executed, true)
    assert.equal(actionPayload.refused, false)
    assert.equal(actionPayload.liveness_recheck.status, 'passed')
    assert.equal(actionPayload.liveness_recheck.original_candidate_ref.artifact_id, actionPayload.candidate_ref.artifact_id)
    assert.deepEqual(actionPayload.liveness_recheck.fresh_selected_item.box, { x: 550, y: 350, width: 280, height: 44 })
  })

  it('refuses a mutated promoted candidate returned to the caller', async () => {
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

    promotion.candidate.kind = 'ocr_row'
    promotion.candidate.target_spec.box = { x: 1, y: 1, width: 2, height: 2 }
    promotion.candidate.target_spec.anchor_text = 'Search'
    promotion.candidate.liveness.preconditions.anchor_recheck!.text = 'Search'

    await assert.rejects(
      () => driver.click(promotion.candidate),
      /promoted_candidate_artifact_mismatch/i,
    )

    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 0)
    const actionPayload = readLastJsonArtifactByRole('action-execution')
    assert.equal(actionPayload.executed, false)
    assert.equal(actionPayload.refused, true)
    assert.ok(actionPayload.refusal_reasons.includes('promoted_candidate_artifact_mismatch'))
  })

  it('reruns the safety gate after fresh observe and refuses hard-stop signals before click dispatch', async () => {
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

    mocks.captureChromeDom.mockResolvedValue(chromeDomObservation({
      elements: [
        searchElement(),
        acceptCookiesElement(),
        textElement('captcha payment login', { x: 120, y: 520, width: 260, height: 32 }),
      ],
    }))
    mocks.detectHardStopSignals.mockImplementation((text: string) =>
      text.includes('captcha') ? ['captcha', 'payment', 'login'] : [],
    )
    mocks.checkSafetyGate.mockImplementation((_context, visibleText: string) => {
      if (visibleText.includes('captcha')) {
        return {
          passed: false,
          checks: { profile_verified: true, chrome_foreground: true, no_hard_stop_signal: false },
          failures: [{ code: 'hard_stop_signal', detail: 'Signals detected: captcha, payment, login', observed: ['captcha', 'payment', 'login'] }],
        }
      }
      return {
        passed: true,
        checks: { profile_verified: true, chrome_foreground: true, no_hard_stop_signal: true },
        failures: [],
      }
    })

    await assert.rejects(
      () => driver.click(promotion.candidate),
      /hard_stop_signal/i,
    )

    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 0)
    const actionPayload = readLastJsonArtifactByRole('action-execution')
    assert.equal(actionPayload.executed, false)
    assert.equal(actionPayload.refused, true)
    assert.deepEqual(actionPayload.refusal_reasons, ['hard_stop_signal'])
    assert.equal(actionPayload.liveness_recheck.status, 'refused')
    assert.equal(actionPayload.liveness_recheck.refusal_reason, 'hard_stop_signal')
    assert.equal(actionPayload.liveness_recheck.fresh_safety_result.passed, false)
  })

  it('refuses a promoted candidate when the current anchor match is ambiguous', async () => {
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

    mocks.captureChromeDom.mockResolvedValue(chromeDomObservation({
      elements: [
        searchElement(),
        acceptCookiesElement(),
        acceptCookiesElement({ id: 'accept-secondary', bounds: { x: 548, y: 282, width: 280, height: 44 } }),
      ],
    }))

    await assert.rejects(
      () => driver.click(promotion.candidate),
      /anchor_recheck_ambiguous/i,
    )

    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 0)
    const actionPayload = readLastJsonArtifactByRole('action-execution')
    assert.equal(actionPayload.executed, false)
    assert.equal(actionPayload.refused, true)
    assert.ok(actionPayload.refusal_reasons.includes('anchor_recheck_ambiguous'))
    assert.equal(actionPayload.liveness_recheck.status, 'refused')
    assert.equal(actionPayload.liveness_recheck.refusal_reason, 'anchor_recheck_ambiguous')
    assert.equal(actionPayload.liveness_recheck.fresh_filtered_count, 2)
  })

  it('refuses a fresh current match without trustworthy projection evidence', async () => {
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

    mocks.captureAXTree.mockResolvedValue(axSnapshotWithAcceptCookies())
    mocks.captureChromeDom.mockResolvedValue(chromeDomObservation({
      elements: [searchElement()],
    }))

    await assert.rejects(
      () => driver.click(promotion.candidate),
      /anchor_recheck_projection_unavailable/i,
    )

    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 0)
    const actionPayload = readLastJsonArtifactByRole('action-execution')
    assert.equal(actionPayload.executed, false)
    assert.equal(actionPayload.refused, true)
    assert.ok(actionPayload.refusal_reasons.includes('anchor_recheck_projection_unavailable'))
    assert.equal(actionPayload.liveness_recheck.status, 'refused')
    assert.equal(actionPayload.liveness_recheck.refusal_reason, 'anchor_recheck_projection_unavailable')
  })

  it('refuses an OCR text candidate when fresh OCR is missing and only DOM evidence matches', async () => {
    mocks.captureAXTree.mockResolvedValue(emptyAxSnapshot())
    mocks.captureChromeDom.mockResolvedValue(emptyChromeDomObservation())
    let currentOcrMatches: Array<{
      matchIndex: number
      text: string
      confidence: number
      bounds: { x: number, y: number, width: number, height: number }
    }> = [
      {
        matchIndex: 0,
        text: 'Manual review required',
        confidence: 0.94,
        bounds: { x: 120, y: 160, width: 260, height: 32 },
      },
    ]
    mocks.recognizeTextInImage.mockImplementation(async () => ocrSnapshot(currentOcrMatches))
    mocks.produceOcrRows.mockImplementation(async ({ textSnapshot }) => ({
      strategy: 'ocr-text',
      imagePath: textSnapshot.imagePath,
      imageWidth: textSnapshot.imageWidth,
      imageHeight: textSnapshot.imageHeight,
      rawMatchCount: textSnapshot.rawMatchCount,
      filteredMatchCount: textSnapshot.filteredMatchCount,
      rowCount: 0,
      rows: [],
      providerDetail: {
        provider: 'careerdeepseek.macos_chrome_driver.ocr_rows',
        originalStrategy: 'ocr-text',
      },
      knownLimits: [],
    }))
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })
    await driver.observe()
    const result = await driver.recognizeFromCapture(driver.lastCapture!, {
      kind: 'visible_text',
      text: /manual review required/i,
    })
    assert.equal(result.best?.kind, 'ocr_text')
    const promotion = await driver.promoteCandidate(result, driver.lastCapture!)
    assert.equal(promotion.status, 'promoted')
    if (promotion.status !== 'promoted')
      return

    currentOcrMatches = []
    mocks.captureChromeDom.mockResolvedValue(chromeDomObservation({
      elements: [
        textElement('Manual review required', { x: 120, y: 160, width: 260, height: 32 }, {
          id: 'manual-review-hidden-dom',
          states: { hidden: true, offscreen: true },
        }),
      ],
    }))

    await assert.rejects(
      () => driver.click(promotion.candidate),
      /anchor_recheck_incompatible_source|anchor_recheck_projection_unavailable/i,
    )

    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 0)
    const actionPayload = readLastJsonArtifactByRole('action-execution')
    assert.equal(actionPayload.executed, false)
    assert.equal(actionPayload.refused, true)
    assert.equal(actionPayload.liveness_recheck.status, 'refused')
    assert.notEqual(actionPayload.refusal_reasons.includes('action_execution_error'), true)
    assert.equal(actionPayload.liveness_recheck.fresh_selected_item.kind, 'dom_evidence')
  })

  it('records a liveness refusal when the leased Chrome window changes during fresh observe', async () => {
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
    mocks.observeWindows
      .mockResolvedValueOnce(chromeWindowObservation())
      .mockResolvedValueOnce(chromeWindowObservation({ windowNumber: 43, id: '43' }))

    await assert.rejects(
      () => driver.click(promotion.candidate),
      /fresh_window_mismatch|fresh_observe_failed/i,
    )

    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 0)
    const actionPayload = readLastJsonArtifactByRole('action-execution')
    assert.equal(actionPayload.executed, false)
    assert.equal(actionPayload.refused, true)
    assert.notDeepEqual(actionPayload.refusal_reasons, ['action_execution_error'])
    assert.equal(actionPayload.liveness_recheck.status, 'refused')
    assert.ok(['fresh_window_mismatch', 'fresh_observe_failed'].includes(actionPayload.liveness_recheck.refusal_reason))
  })

  it('records liveness details when macOS click dispatch fails after liveness passes', async () => {
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
    mocks.executeMoveAndClick.mockRejectedValueOnce(new Error('CGEvent tap denied'))

    await assert.rejects(
      () => driver.click(promotion.candidate),
      /CGEvent tap denied/,
    )

    const actionPayload = readLastJsonArtifactByRole('action-execution')
    assert.equal(actionPayload.executed, false)
    assert.equal(actionPayload.refused, true)
    assert.deepEqual(actionPayload.refusal_reasons, ['action_execution_error'])
    assert.equal(actionPayload.liveness_recheck.status, 'passed')
    assert.equal(actionPayload.liveness_recheck.fresh_selected_item.text, 'Accept all cookies')
  })

  it('refuses a promoted candidate when the current anchor is missing before click', async () => {
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

    mocks.captureChromeDom.mockResolvedValue(chromeDomObservation({
      elements: [searchElement()],
      visibleText: 'LinkedIn Search',
    }))

    await assert.rejects(
      () => driver.click(promotion.candidate),
      /anchor_recheck_missing/i,
    )

    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 0)
    const actionPayload = readLastJsonArtifactByRole('action-execution')
    assert.equal(actionPayload.executed, false)
    assert.equal(actionPayload.refused, true)
    assert.ok(actionPayload.refusal_reasons.includes('anchor_recheck_missing'))
    assert.equal(actionPayload.liveness_recheck.status, 'refused')
    assert.equal(actionPayload.liveness_recheck.refusal_reason, 'anchor_recheck_missing')
    assert.equal(actionPayload.liveness_recheck.fresh_selected_item, null)
  })

  it('refuses a promoted candidate when the current anchor moved beyond max_pixel_distance', async () => {
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

    mocks.captureChromeDom.mockResolvedValue(chromeDomObservation({
      elements: [
        searchElement(),
        acceptCookiesElement({ bounds: { x: 760, y: 520, width: 280, height: 44 } }),
      ],
    }))

    await assert.rejects(
      () => driver.click(promotion.candidate),
      /anchor_recheck_moved/i,
    )

    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 0)
    const actionPayload = readLastJsonArtifactByRole('action-execution')
    assert.equal(actionPayload.executed, false)
    assert.equal(actionPayload.refused, true)
    assert.ok(actionPayload.refusal_reasons.includes('anchor_recheck_moved'))
    assert.equal(actionPayload.liveness_recheck.status, 'refused')
    assert.equal(actionPayload.liveness_recheck.refusal_reason, 'anchor_recheck_moved')
    assert.ok(actionPayload.liveness_recheck.pixel_distance > 50)
  })

  it('does not use row_index as cross-observation identity for OCR row candidate click', async () => {
    mocks.captureAXTree.mockResolvedValue(emptyAxSnapshot())
    mocks.captureChromeDom.mockResolvedValue(emptyChromeDomObservation())
    let currentRowText = 'Acme AI Engineer'
    mocks.recognizeTextInImage.mockImplementation(async () => ocrSnapshot([
      {
        matchIndex: 0,
        text: currentRowText,
        confidence: 0.91,
        bounds: { x: 100, y: 200, width: 360, height: 32 },
      },
    ]))
    mocks.produceOcrRows.mockImplementation(async ({ textSnapshot }) => ocrRowsSnapshot({
      textSnapshot,
      rowIndex: 0,
      bounds: { x: 100, y: 190, width: 360, height: 60 },
      knownLimits: ['row grouping is heuristic within current capture'],
    }))
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })
    await driver.observe()
    const ocrRowTarget: ChromeRecognitionTarget = { kind: 'ocr_row', text: /Acme AI Engineer/i }
    const result = await driver.recognizeFromCapture(driver.lastCapture!, ocrRowTarget)
    const promotion = await driver.promoteCandidate(result, driver.lastCapture!)
    assert.equal(promotion.status, 'promoted')
    if (promotion.status !== 'promoted')
      return
    assert.equal(promotion.candidate.kind, 'ocr_row')

    currentRowText = 'Different role at same row index'

    await assert.rejects(
      () => driver.click(promotion.candidate),
      /anchor_recheck_missing/i,
    )

    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 0)
    const actionPayload = readLastJsonArtifactByRole('action-execution')
    assert.equal(actionPayload.liveness_recheck.status, 'refused')
    assert.equal(actionPayload.liveness_recheck.refusal_reason, 'anchor_recheck_missing')
    assert.equal(actionPayload.liveness_recheck.fresh_selected_item, null)
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

function ocrSnapshot(matches: Array<{
  matchIndex: number
  text: string
  confidence: number
  bounds: { x: number, y: number, width: number, height: number }
}>) {
  return {
    recognizedAt: '2026-06-14T00:00:00.000Z',
    imagePath: '/tmp/chrome.png',
    imageWidth: 1000,
    imageHeight: 800,
    query: '',
    exact: false,
    caseSensitive: false,
    normalizedQuery: '',
    ocrScaleFactor: 1,
    matches,
    rawMatchCount: matches.length,
    filteredMatchCount: matches.length,
  }
}

function ocrRowsSnapshot(input: {
  textSnapshot: ReturnType<typeof ocrSnapshot>
  rowIndex: number
  bounds: { x: number, y: number, width: number, height: number }
  knownLimits?: string[]
}) {
  return {
    strategy: 'ocr-text',
    imagePath: input.textSnapshot.imagePath,
    imageWidth: input.textSnapshot.imageWidth,
    imageHeight: input.textSnapshot.imageHeight,
    rawMatchCount: input.textSnapshot.rawMatchCount,
    filteredMatchCount: input.textSnapshot.filteredMatchCount,
    rowCount: 1,
    rows: [{
      rowIndex: input.rowIndex,
      source: 'ocr_row' as const,
      bounds: input.bounds,
      textFragments: input.textSnapshot.matches.map(match => ({
        matchIndex: match.matchIndex,
        text: match.text,
        confidence: match.confidence,
        bounds: match.bounds,
      })),
      confidence: 0.82,
      knownLimits: input.knownLimits ?? [],
    }],
    providerDetail: {
      provider: 'careerdeepseek.macos_chrome_driver.ocr_rows',
      originalStrategy: 'ocr-text',
    },
    knownLimits: input.knownLimits ?? [],
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

function emptyAxSnapshot(): AXSnapshot {
  return {
    snapshotId: 'ax-empty',
    pid: 123,
    appName: 'Google Chrome',
    capturedAt: '2026-06-14T00:00:00.000Z',
    maxDepth: 15,
    truncated: false,
    root: {
      uid: 'root',
      role: 'AXApplication',
      children: [],
    },
  }
}

function axSnapshotWithAcceptCookies(): AXSnapshot {
  return {
    snapshotId: 'ax-accept',
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
          uid: 'accept-ax',
          role: 'AXButton',
          title: 'Accept all cookies',
          enabled: true,
          bounds: { x: 520, y: 320, width: 280, height: 44 },
          children: [],
        },
      ],
    },
  }
}

function chromeDomObservation(overrides: {
  elements?: ChromeDomObservation['elements']
  visibleText?: string
} = {}): ChromeDomObservation {
  const elements = overrides.elements ?? [
    searchElement(),
    acceptCookiesElement(),
  ]
  return {
    url: 'https://www.linkedin.com/feed/',
    title: 'Feed | LinkedIn',
    observedAt: '2026-06-14T00:00:00.000Z',
    visibleText: overrides.visibleText ?? ['LinkedIn', ...elements.map(element => element.name || element.text || element.role).filter(Boolean)].join(' '),
    signals: [],
    elements,
  }
}

function searchElement(bounds: { x: number, y: number, width: number, height: number } = { x: 90, y: 76, width: 124, height: 38 }): ChromeDomObservation['elements'][number] {
  return {
    id: 'search',
    tagName: 'input',
    role: 'textbox',
    name: 'Search',
    text: 'Search',
    href: null,
    bounds,
    center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    confidence: 0.9,
    actionable: true,
    states: {},
  }
}

function textElement(
  text: string,
  bounds: { x: number, y: number, width: number, height: number },
  options: { id?: string, states?: Record<string, unknown> } = {},
): ChromeDomObservation['elements'][number] {
  return {
    id: options.id ?? `text-${text.replace(/\W+/g, '-').toLowerCase()}`,
    tagName: 'div',
    role: 'text',
    name: text,
    text,
    href: null,
    bounds,
    center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    confidence: 0.8,
    actionable: false,
    states: options.states ?? {},
  }
}

function acceptCookiesElement(options: {
  id?: string
  bounds?: { x: number, y: number, width: number, height: number }
} = {}): ChromeDomObservation['elements'][number] {
  const bounds = options.bounds ?? { x: 520, y: 280, width: 280, height: 44 }
  return {
    id: options.id ?? 'accept',
    tagName: 'button',
    role: 'button',
    name: 'Accept all cookies',
    text: 'Accept all cookies',
    href: null,
    bounds,
    center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    confidence: 0.95,
    actionable: true,
    states: {},
  }
}

function emptyChromeDomObservation(): ChromeDomObservation {
  return {
    url: 'https://www.linkedin.com/feed/',
    title: 'Feed | LinkedIn',
    observedAt: '2026-06-14T00:00:00.000Z',
    visibleText: '',
    signals: [],
    elements: [],
  }
}
