import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveMacOSChromeAtomicCommands } from '../../src/computer-use/macos-chrome-driver/atomic-commands.js'
import type { ComputerUseConfig } from '../../src/computer-use/config.js'
import type { ChromeContextSnapshot, ChromeWindowCapture, OcrTextSnapshot } from '../../src/computer-use/macos-chrome-driver/types.js'

const mocks = vi.hoisted(() => ({
  captureChromeWindow: vi.fn(),
  captureAXTree: vi.fn(),
  executeMoveAndClick: vi.fn(),
  produceOcrRows: vi.fn(),
  recognizeTextInImage: vi.fn(),
  unlink: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  unlink: mocks.unlink,
}))

vi.mock('../../src/computer-use/macos-chrome-driver/capture.js', () => ({
  captureChromeWindow: mocks.captureChromeWindow,
}))

vi.mock('../../src/computer-use/macos-chrome-driver/ocr.js', () => ({
  recognizeTextInImage: mocks.recognizeTextInImage,
  produceOcrRows: mocks.produceOcrRows,
}))

vi.mock('../../src/computer-use/ax-tree.js', () => ({
  captureAXTree: mocks.captureAXTree,
}))

vi.mock('../../src/computer-use/macos-actions.js', () => ({
  executeMoveAndClick: mocks.executeMoveAndClick,
  executePressKeys: vi.fn(),
  executeScroll: vi.fn(),
  executeTypeText: vi.fn(),
}))

const config: ComputerUseConfig = {
  sessionRoot: '/tmp/cds-test',
  screenshotsDir: '/tmp/cds-test/screenshots',
  timeoutMs: 1000,
  binaries: {
    swift: 'swift',
    osascript: 'osascript',
    screencapture: 'screencapture',
    open: 'open',
  },
  denyApps: [],
  openableApps: [],
}

const context: ChromeContextSnapshot = {
  running: true,
  isFrontmost: true,
  activeTabUrl: 'https://example.test',
  activeTabTitle: 'Example',
  profile: { status: 'verified', reason: 'test' },
  window: {
    id: 'window-1',
    windowNumber: 42,
    appName: 'Google Chrome',
    ownerPid: 123,
    title: 'Example',
    bounds: { x: 100, y: 200, width: 800, height: 600 },
    layer: 0,
  },
}

function capture(snapshotId: string): ChromeWindowCapture {
  return {
    snapshotId,
    screenshot: {
      path: `/tmp/cds-test/${snapshotId}.png`,
      dataBase64: '',
      mimeType: 'image/png',
      width: 1600,
      height: 1200,
      capturedAt: '2026-06-20T00:00:00.000Z',
    },
    contract: {
      coordinateContractVersion: 1,
      captureSource: { kind: 'window', windowNumber: 42, ownerPid: 123 },
      sourceGlobalLogicalBounds: context.window.bounds,
      screenshotPixelSize: { width: 1600, height: 1200 },
      pixelToLogicalScale: { x: 0.5, y: 0.5 },
      logicalToPixelScale: { x: 2, y: 2 },
      capturedAt: '2026-06-20T00:00:00.000Z',
    },
  }
}

function ocr(matches: OcrTextSnapshot['matches']): OcrTextSnapshot {
  return {
    recognizedAt: '2026-06-20T00:00:00.000Z',
    imagePath: '/tmp/cds-test/image.png',
    imageWidth: 1600,
    imageHeight: 1200,
    query: 'Results',
    exact: false,
    caseSensitive: false,
    normalizedQuery: 'results',
    ocrScaleFactor: 1,
    matches,
    rawMatchCount: matches.length,
    filteredMatchCount: matches.length,
    knownLimits: ['vision_ocr_test'],
  }
}

function commandsWithTrace(): LiveMacOSChromeAtomicCommands {
  return new LiveMacOSChromeAtomicCommands({
    config,
    sessionId: 'test',
    runId: 'run_test',
    resolveChromeContext: async () => context,
    traceSink: {
      startSpan: () => {},
      endSpan: () => {},
      recordArtifact: () => {},
      writeJsonArtifact: artifact => ({ artifact_id: artifact.artifact_id, span_id: artifact.span_id }),
    },
  })
}

describe('atomic waitForText', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    mocks.captureChromeWindow.mockReset()
    mocks.captureChromeWindow.mockImplementation(({ snapshotId }) => capture(snapshotId))
    mocks.executeMoveAndClick.mockReset()
    mocks.executeMoveAndClick.mockResolvedValue(undefined)
    mocks.produceOcrRows.mockReset()
    mocks.recognizeTextInImage.mockReset()
    mocks.captureAXTree.mockReset()
    mocks.unlink.mockReset()
    mocks.unlink.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns found on the first fresh capture and OCR pass', async () => {
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([
      {
        matchIndex: 0,
        text: 'Results',
        confidence: 0.93,
        bounds: { x: 20, y: 40, width: 100, height: 30 },
      },
    ]))

    const result = await commandsWithTrace().waitForText({
      query: 'Results',
      timeoutMs: 3000,
      pollIntervalMs: 250,
    })

    expect(result).toMatchObject({
      found: true,
      query: 'Results',
      pollCount: 1,
      best: {
        text: 'Results',
        logicalPoint: { x: 135, y: 227.5 },
      },
    })
    expect(mocks.captureChromeWindow).toHaveBeenCalledTimes(1)
    expect(mocks.recognizeTextInImage).toHaveBeenCalledWith(config, expect.objectContaining({ query: 'Results' }))
  })

  it('returns completed timeout data with no best match', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1001)
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([]))

    const result = await commandsWithTrace().waitForText({
      query: 'Results',
      timeoutMs: 1,
      pollIntervalMs: 250,
    })

    expect(result).toMatchObject({
      found: false,
      query: 'Results',
      elapsedMs: 1,
      pollCount: 1,
      matches: [],
      knownLimits: ['vision_ocr_test'],
    })
    expect(result.best).toBeUndefined()
    expect(mocks.captureChromeWindow).toHaveBeenCalledTimes(1)
    expect(mocks.recognizeTextInImage).toHaveBeenCalledTimes(1)
  })

  it('polls with fresh captures until text appears and removes intermediate screenshots only', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1001)
      .mockReturnValueOnce(1251)
    mocks.recognizeTextInImage
      .mockResolvedValueOnce(ocr([]))
      .mockResolvedValueOnce(ocr([
        {
          matchIndex: 0,
          text: 'Results',
          confidence: 0.93,
          bounds: { x: 20, y: 40, width: 100, height: 30 },
        },
      ]))

    const result = await commandsWithTrace().waitForText({
      query: 'Results',
      timeoutMs: 3000,
      pollIntervalMs: 250,
    })

    expect(result.found).toBe(true)
    expect(result.pollCount).toBe(2)
    expect(result.evidence.map(ref => ref.artifact_id)).toContain('screenshot_atomic_2_wait-text-2_capture')
    expect(mocks.captureChromeWindow).toHaveBeenCalledTimes(2)
    expect(mocks.recognizeTextInImage).toHaveBeenCalledTimes(2)
    expect(mocks.unlink).toHaveBeenCalledWith('/tmp/cds-test/atomic_1_wait-text-1_capture.png')
    expect(mocks.unlink).not.toHaveBeenCalledWith('/tmp/cds-test/atomic_2_wait-text-2_capture.png')
  })

  it('returns same-command action-result evidence for clickText', async () => {
    const writtenRoles: string[] = []
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([
      {
        matchIndex: 0,
        text: 'Results',
        confidence: 0.93,
        bounds: { x: 20, y: 40, width: 100, height: 30 },
      },
    ]))
    const command = new LiveMacOSChromeAtomicCommands({
      config,
      sessionId: 'test',
      runId: 'run_test',
      resolveChromeContext: async () => context,
      traceSink: {
        startSpan: () => {},
        endSpan: () => {},
        recordArtifact: artifact => writtenRoles.push(artifact.role),
        writeJsonArtifact: (artifact) => {
          writtenRoles.push(artifact.role)
          return { artifact_id: artifact.artifact_id, span_id: artifact.span_id }
        },
      },
    })

    const result = await command.clickText({ query: 'Results' })

    expect(writtenRoles).toContain('action-result')
    expect(result.evidence.map(ref => ref.artifact_id)).toContain('action_click_text_atomic_1_click-text')
  })

  it('attaches same-command OCR evidence to clickText recognition failures', async () => {
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([
      {
        matchIndex: 0,
        text: 'Results',
        confidence: 0.93,
        bounds: { x: 20, y: 40, width: 100, height: 30 },
      },
    ]))
    const command = new LiveMacOSChromeAtomicCommands({
      config,
      sessionId: 'test',
      runId: 'run_test',
      resolveChromeContext: async () => context,
      traceSink: {
        startSpan: () => {},
        endSpan: () => {},
        recordArtifact: () => {},
        writeJsonArtifact: artifact => ({ artifact_id: artifact.artifact_id, span_id: artifact.span_id }),
      },
    })

    await expect(command.clickText({ query: 'Results', matchIndex: 2 })).rejects.toMatchObject({
      code: 'recognition_not_found',
      evidence: expect.arrayContaining([
        expect.objectContaining({ artifact_id: 'ocr_text_atomic_1_click-text_capture' }),
      ]),
    })
  })

  it('attaches same-command OCR evidence to clickText delivery failures', async () => {
    mocks.executeMoveAndClick.mockRejectedValueOnce(new Error('CGEvent click failed'))
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([
      {
        matchIndex: 0,
        text: 'Results',
        confidence: 0.93,
        bounds: { x: 20, y: 40, width: 100, height: 30 },
      },
    ]))

    await expect(commandsWithTrace().clickText({ query: 'Results' })).rejects.toMatchObject({
      code: 'click_delivery_failed',
      message: 'CGEvent click failed',
      evidence: expect.arrayContaining([
        expect.objectContaining({ artifact_id: 'screenshot_atomic_1_click-text_capture' }),
        expect.objectContaining({ artifact_id: 'ocr_text_atomic_1_click-text_capture' }),
      ]),
    })
  })

  it('attaches same-command row evidence to clickRow delivery failures', async () => {
    mocks.executeMoveAndClick.mockRejectedValueOnce(new Error('CGEvent click failed'))
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([]))
    mocks.produceOcrRows.mockResolvedValueOnce({
      strategy: 'ocr-text',
      imagePath: '/tmp/cds-test/image.png',
      imageWidth: 1600,
      imageHeight: 1200,
      rawMatchCount: 1,
      filteredMatchCount: 1,
      rowCount: 1,
      rows: [{
        rowIndex: 0,
        source: 'ocr_row',
        bounds: { x: 20, y: 40, width: 100, height: 30 },
        textFragments: [{ text: 'Results' }],
        confidence: 0.93,
      }],
      providerDetail: {},
      knownLimits: ['row_test'],
    })

    await expect(commandsWithTrace().clickRow({ rowIndex: 1 })).rejects.toMatchObject({
      code: 'click_delivery_failed',
      message: 'CGEvent click failed',
      evidence: expect.arrayContaining([
        expect.objectContaining({ artifact_id: 'screenshot_atomic_1_click-row_capture' }),
        expect.objectContaining({ artifact_id: 'ocr_rows_atomic_1_click-row_capture' }),
      ]),
    })
  })

  it('attaches same-command AX evidence to pointer AX delivery failures', async () => {
    mocks.executeMoveAndClick.mockRejectedValueOnce(new Error('CGEvent click failed'))
    mocks.captureAXTree.mockResolvedValueOnce({
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: {
        uid: 'root',
        role: 'AXWindow',
        children: [{
          uid: 'button-1',
          role: 'AXButton',
          title: 'Submit',
          bounds: { x: 140, y: 240, width: 80, height: 30 },
          children: [],
        }],
      },
    })

    await expect(commandsWithTrace().pressButton({ query: 'Submit' })).rejects.toMatchObject({
      code: 'click_delivery_failed',
      message: 'CGEvent click failed',
      evidence: expect.arrayContaining([
        expect.objectContaining({ artifact_id: 'ax_tree_atomic_1_press-button' }),
      ]),
    })
  })
})
