import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveMacOSChromeAtomicCommands } from '../../src/computer-use/macos-chrome-driver/chrome-command-sub-workflow.js'
import type { ComputerUseConfig } from '../../src/computer-use/config.js'
import type { ChromeContextSnapshot, ChromeWindowCapture, OcrTextSnapshot } from '../../src/computer-use/macos-chrome-driver/types.js'
import type { AXNode } from '../../src/computer-use/types.js'

const mocks = vi.hoisted(() => ({
  captureChromeWindow: vi.fn(),
  captureAXTree: vi.fn(),
  captureChromeDom: vi.fn(),
  executeMoveAndClick: vi.fn(),
  executePressKeys: vi.fn(),
  executeScroll: vi.fn(),
  executeTypeText: vi.fn(),
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
}))

vi.mock('../../src/computer-use/ax-tree.js', () => ({
  captureAXTree: mocks.captureAXTree,
}))

vi.mock('../../src/computer-use/chrome-dom.js', () => ({
  captureChromeDom: mocks.captureChromeDom,
}))

vi.mock('../../src/computer-use/macos-actions.js', () => ({
  executeMoveAndClick: mocks.executeMoveAndClick,
  executePressKeys: mocks.executePressKeys,
  executeScroll: mocks.executeScroll,
  executeTypeText: mocks.executeTypeText,
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

function axWindow(children: AXNode[]): AXNode {
  return {
    uid: 'root',
    role: 'AXWindow',
    bounds: context.window.bounds,
    children: [
      {
        uid: 'web-area',
        role: 'AXWebArea',
        bounds: { x: 100, y: 220, width: 800, height: 580 },
        children: [],
      },
      ...children,
    ],
  }
}

describe('atomic waitForText', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    mocks.captureChromeWindow.mockReset()
    mocks.captureChromeWindow.mockImplementation(({ snapshotId }) => capture(snapshotId))
    mocks.executeMoveAndClick.mockReset()
    mocks.executeMoveAndClick.mockResolvedValue(undefined)
    mocks.executePressKeys.mockReset()
    mocks.executePressKeys.mockResolvedValue(undefined)
    mocks.executeScroll.mockReset()
    mocks.executeScroll.mockResolvedValue(undefined)
    mocks.executeTypeText.mockReset()
    mocks.executeTypeText.mockResolvedValue(undefined)
    mocks.recognizeTextInImage.mockReset()
    mocks.captureAXTree.mockReset()
    mocks.captureAXTree.mockResolvedValue({
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: axWindow([]),
    })
    mocks.captureChromeDom.mockReset()
    mocks.captureChromeDom.mockResolvedValue({
      url: 'https://example.test',
      title: 'Example',
      observedAt: '2026-06-20T00:00:00.000Z',
      viewport: {
        width: 800,
        height: 580,
        scrollX: 0,
        scrollY: 0,
        scrollWidth: 800,
        scrollHeight: 1200,
        clientWidth: 800,
        clientHeight: 580,
      },
      visibleText: '',
      elements: [],
      signals: [],
    })
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
    expect(mocks.captureAXTree).toHaveBeenCalledTimes(1)
    expect(mocks.captureChromeDom).toHaveBeenCalledTimes(1)
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
    })
    expect(result.knownLimits).toEqual(expect.arrayContaining(['vision_ocr_test', 'wait_for_text_final_enrichment_only']))
    expect(result.best).toBeUndefined()
    expect(mocks.captureChromeWindow).toHaveBeenCalledTimes(1)
    expect(mocks.recognizeTextInImage).toHaveBeenCalledTimes(1)
    expect(mocks.captureAXTree).toHaveBeenCalledTimes(1)
    expect(mocks.captureChromeDom).toHaveBeenCalledTimes(1)
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
    expect(mocks.captureAXTree).toHaveBeenCalledTimes(1)
    expect(mocks.captureChromeDom).toHaveBeenCalledTimes(1)
    expect(mocks.unlink).toHaveBeenCalledWith('/tmp/cds-test/atomic_1_wait-text-1_capture.png')
    expect(mocks.unlink).not.toHaveBeenCalledWith('/tmp/cds-test/atomic_2_wait-text-2_capture.png')
  })

  it('clickTarget kind=any prefers a unique interactive AX candidate over OCR-only text', async () => {
    const writtenRoles: string[] = []
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([
      {
        matchIndex: 0,
        text: 'Submit',
        confidence: 0.93,
        bounds: { x: 20, y: 40, width: 100, height: 30 },
      },
    ]))
    mocks.captureAXTree.mockResolvedValueOnce({
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: axWindow([{
        uid: 'button-1',
        role: 'AXButton',
        title: 'Submit',
        bounds: { x: 110, y: 220, width: 80, height: 30 },
        enabled: true,
        children: [],
      }]),
    })
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

    const result = await command.clickTarget({ query: 'Submit', kind: 'any' })

    expect(writtenRoles).toContain('action-result')
    expect(result.clicked.kind).toBe('ax_button')
    expect(result.evidence.map(ref => ref.artifact_id)).toContain('action_click_target_atomic_1_click-target')
  })

  it('clickTarget kind=any excludes candidate groups that contain input controls', async () => {
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([
      {
        matchIndex: 0,
        text: 'Search',
        confidence: 0.93,
        bounds: { x: 80, y: 80, width: 240, height: 40 },
      },
    ]))
    mocks.captureAXTree.mockResolvedValueOnce({
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: axWindow([{
        uid: 'search-1',
        role: 'AXTextField',
        title: 'Search',
        bounds: { x: 140, y: 240, width: 180, height: 30 },
        enabled: true,
        children: [],
      }]),
    })

    await expect(commandsWithTrace().clickTarget({ query: 'Search', kind: 'any' })).rejects.toMatchObject({
      code: 'ambiguous_target',
    })
    expect(mocks.executeMoveAndClick).not.toHaveBeenCalled()
  })

  it('clickTarget returns ambiguous_target when same-tier candidates remain', async () => {
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([
      {
        matchIndex: 0,
        text: 'Submit',
        confidence: 0.93,
        bounds: { x: 20, y: 40, width: 100, height: 30 },
      },
      {
        matchIndex: 1,
        text: 'Submit',
        confidence: 0.91,
        bounds: { x: 20, y: 140, width: 100, height: 30 },
      },
    ]))

    await expect(commandsWithTrace().clickTarget({ query: 'Submit', kind: 'text' })).rejects.toMatchObject({
      code: 'ambiguous_target',
    })
  })

  it('clickTarget returns ambiguous_target for non-any kind when multiple candidates remain', async () => {
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([]))
    mocks.captureAXTree.mockResolvedValueOnce({
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: axWindow([{
        uid: 'button-1',
        role: 'AXButton',
        title: 'Submit',
        bounds: { x: 140, y: 240, width: 100, height: 30 },
        enabled: true,
        children: [],
      }]),
    })
    mocks.captureChromeDom.mockResolvedValueOnce({
      url: 'https://example.test',
      title: 'Example',
      observedAt: '2026-06-20T00:00:00.000Z',
      visibleText: '',
      elements: [{
        id: 'dom-submit',
        role: 'button',
        tagName: 'button',
        name: 'Submit',
        text: 'Submit',
        href: null,
        bounds: { x: 320, y: 80, width: 100, height: 30 },
        center: { x: 370, y: 95 },
        confidence: 0.8,
        actionable: true,
        states: {},
      }],
      signals: [],
    })

    await expect(commandsWithTrace().clickTarget({ query: 'Submit', kind: 'button' })).rejects.toMatchObject({
      code: 'ambiguous_target',
    })
    expect(mocks.executeMoveAndClick).not.toHaveBeenCalled()
  })

  it('findText returns normalized AX/DOM surface matches when OCR has no match', async () => {
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([]))
    mocks.captureAXTree.mockResolvedValueOnce({
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: axWindow([{
        uid: 'group-1',
        role: 'AXGroup',
        title: 'Loaded Results - Example - Google Chrome',
        bounds: { x: 100, y: 200, width: 800, height: 600 },
        enabled: true,
        children: [],
      }, {
        uid: 'label-1',
        role: 'AXStaticText',
        title: 'Loaded Results',
        bounds: { x: 180, y: 260, width: 160, height: 30 },
        enabled: true,
        children: [],
      }]),
    })

    const result = await commandsWithTrace().findText({ query: 'Loaded' })

    expect(result.found).toBe(true)
    expect(result.best).toMatchObject({
      kind: 'ax_static_text',
      text: 'Loaded Results',
      normalizedBox: {
        left: 0.1,
        top: 0.06896551724137931,
        right: 0.3,
        bottom: 0.1206896551724138,
      },
    })
    expect(result.nodes?.some(node => node.kind === 'ax_static_text')).toBe(true)
  })

  it('findText does not return browser chrome text outside the page viewport', async () => {
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([
      {
        matchIndex: 0,
        text: 'Back',
        confidence: 0.93,
        bounds: { x: 20, y: 0, width: 80, height: 30 },
      },
    ]))
    mocks.captureAXTree.mockResolvedValueOnce({
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: axWindow([{
        uid: 'back-1',
        role: 'AXButton',
        title: 'Back',
        bounds: { x: 120, y: 205, width: 60, height: 25 },
        enabled: true,
        children: [],
      }]),
    })

    const result = await commandsWithTrace().findText({ query: 'Back' })

    expect(result.found).toBe(false)
    expect(result.matches).toEqual([])
    expect(result.nodes?.every(node => node.region === 'page_viewport')).toBe(true)
  })

  it('findText miss reports current viewport absence when page can scroll further', async () => {
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([]))
    mocks.captureAXTree.mockResolvedValueOnce({
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: axWindow([]),
    })
    mocks.captureChromeDom.mockResolvedValueOnce({
      url: 'https://example.test',
      title: 'Example',
      observedAt: '2026-06-20T00:00:00.000Z',
      viewport: {
        width: 800,
        height: 580,
        scrollX: 0,
        scrollY: 100,
        scrollWidth: 800,
        scrollHeight: 1500,
        clientWidth: 800,
        clientHeight: 580,
      },
      visibleText: '',
      elements: [],
      signals: [],
    })

    const result = await commandsWithTrace().findText({ query: 'Missing Target' })

    expect(result.found).toBe(false)
    expect(result.knownLimits).toEqual(expect.arrayContaining([
      'text_not_found_in_current_viewport',
      'text_may_be_below_viewport',
    ]))
    expect(result.scrollBoundary).toMatchObject({
      canScrollDown: true,
      atBottom: false,
    })
  })

  it('clickTarget kind=any does not treat structural AX containers as targets', async () => {
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([]))
    mocks.captureAXTree.mockResolvedValueOnce({
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: axWindow([{
        uid: 'group-1',
        role: 'AXGroup',
        title: 'Loaded Results - Example - Google Chrome',
        bounds: { x: 100, y: 200, width: 800, height: 600 },
        enabled: true,
        children: [],
      }]),
    })

    await expect(commandsWithTrace().clickTarget({ query: 'Loaded Results', kind: 'any' })).rejects.toMatchObject({
      code: 'ambiguous_target',
    })
    expect(mocks.executeMoveAndClick).not.toHaveBeenCalled()
  })

  it('clickTarget kind=any uses a targetable child instead of a grouped structural container', async () => {
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([]))
    mocks.captureAXTree.mockResolvedValueOnce({
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: axWindow([{
        uid: 'group-1',
        role: 'AXGroup',
        title: 'Loaded Results',
        bounds: { x: 100, y: 200, width: 800, height: 600 },
        enabled: true,
        children: [],
      }, {
        uid: 'label-1',
        role: 'AXStaticText',
        title: 'Loaded Results',
        bounds: { x: 180, y: 260, width: 160, height: 30 },
        enabled: true,
        children: [],
      }]),
    })

    const result = await commandsWithTrace().clickTarget({ query: 'Loaded Results', kind: 'any' })

    expect(result.clicked).toMatchObject({
      kind: 'ax_static_text',
      logicalPoint: { x: 260, y: 275 },
    })
    expect(mocks.executeMoveAndClick).toHaveBeenCalledWith(config, expect.objectContaining({
      pointerTrace: [expect.objectContaining({ x: 260, y: 275 })],
    }))
  })

  it('clickTarget kind=menuitem can target AXMenuItem inside the page viewport', async () => {
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([]))
    mocks.captureAXTree.mockResolvedValueOnce({
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: axWindow([{
        uid: 'menu-item-1',
        role: 'AXMenuItem',
        title: 'Archive',
        bounds: { x: 180, y: 300, width: 120, height: 30 },
        enabled: true,
        children: [],
      }]),
    })

    const result = await commandsWithTrace().clickTarget({ query: 'Archive', kind: 'menuitem' })

    expect(result.clicked).toMatchObject({
      kind: 'ax_menu_item',
      logicalPoint: { x: 240, y: 315 },
    })
    expect(mocks.executeMoveAndClick).toHaveBeenCalledWith(config, expect.objectContaining({
      pointerTrace: [expect.objectContaining({ x: 240, y: 315 })],
    }))
  })

  it('typeInput focuses an input with foreground pointer and types text', async () => {
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([]))
    mocks.captureAXTree.mockResolvedValueOnce({
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: axWindow([{
        uid: 'search-1',
        role: 'AXTextField',
        title: 'Search',
        bounds: { x: 140, y: 240, width: 180, height: 30 },
        enabled: true,
        children: [],
      }]),
    })

    const result = await commandsWithTrace().typeInput({ query: 'Search', text: 'AI agent', submitKey: 'return' })

    expect(result.typed).toMatchObject({ textLength: 8, submitKey: 'return', inputMode: 'replace' })
    expect(mocks.executeMoveAndClick).toHaveBeenCalledTimes(1)
    expect(mocks.executeTypeText).toHaveBeenCalledWith(config, expect.objectContaining({ text: 'AI agent' }))
    expect(mocks.executePressKeys).toHaveBeenNthCalledWith(1, config, { keys: ['a'], modifiers: ['command'] })
    expect(mocks.executePressKeys).toHaveBeenNthCalledWith(2, config, { keys: ['return'], modifiers: [] })
  })

  it('typeInput replaces existing input text even without submit key', async () => {
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([]))
    mocks.captureAXTree.mockResolvedValueOnce({
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: axWindow([{
        uid: 'search-1',
        role: 'AXTextField',
        title: 'Search',
        value: 'Old query',
        bounds: { x: 140, y: 240, width: 180, height: 30 },
        enabled: true,
        children: [],
      }]),
    })

    const result = await commandsWithTrace().typeInput({ query: 'Search', text: 'AI agent' })

    expect(result.typed).toMatchObject({ textLength: 8, submitKey: null, inputMode: 'replace' })
    expect(mocks.executeMoveAndClick).toHaveBeenCalledTimes(1)
    expect(mocks.executePressKeys).toHaveBeenCalledTimes(1)
    expect(mocks.executePressKeys).toHaveBeenCalledWith(config, { keys: ['a'], modifiers: ['command'] })
    expect(mocks.executeTypeText).toHaveBeenCalledWith(config, expect.objectContaining({ text: 'AI agent' }))
  })

  it('clickTarget attaches same-command OCR evidence to delivery failures', async () => {
    mocks.executeMoveAndClick.mockRejectedValueOnce(new Error('CGEvent click failed'))
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([
      {
        matchIndex: 0,
        text: 'Results',
        confidence: 0.93,
        bounds: { x: 20, y: 40, width: 100, height: 30 },
      },
    ]))

    await expect(commandsWithTrace().clickTarget({ query: 'Results', kind: 'text' })).rejects.toMatchObject({
      code: 'click_delivery_failed',
      message: 'CGEvent click failed',
      evidence: expect.arrayContaining([
        expect.objectContaining({ artifact_id: 'screenshot_atomic_1_click-target_capture' }),
        expect.objectContaining({ artifact_id: 'ocr_text_atomic_1_click-target_capture' }),
      ]),
    })
  })

  it('clickTarget attaches same-command evidence to target resolution failures', async () => {
    mocks.recognizeTextInImage.mockResolvedValueOnce(ocr([]))

    await expect(commandsWithTrace().clickTarget({ query: 'Missing Target', kind: 'any' })).rejects.toMatchObject({
      code: 'ambiguous_target',
      message: 'No matching target candidate found.',
      evidence: expect.arrayContaining([
        expect.objectContaining({ artifact_id: 'screenshot_atomic_1_click-target_capture' }),
        expect.objectContaining({ artifact_id: 'ocr_text_atomic_1_click-target_capture' }),
        expect.objectContaining({ artifact_id: 'ax_tree_atomic_1_click-target' }),
        expect.objectContaining({ artifact_id: 'chrome_dom_atomic_1_click-target' }),
      ]),
    })
  })

  it('scrollRegion computes the delivery point from page viewport ratios', async () => {
    const result = await commandsWithTrace().scrollRegion({
      direction: 'down',
      amount: 2,
      region: { left: 0, top: 0, right: 1, bottom: 1 },
    })

    expect(result.scrolled.logicalPoint).toEqual({ x: 500, y: 510 })
    expect(mocks.executeScroll).toHaveBeenCalledWith(config, expect.objectContaining({
      pointerTrace: [{ x: 500, y: 510, delayMs: 0 }],
    }))
    expect(mocks.executeMoveAndClick).not.toHaveBeenCalled()
  })

  it('scrollRegion observes after delivery and reports before/after scroll boundary', async () => {
    mocks.captureChromeDom
      .mockResolvedValueOnce({
        url: 'https://example.test',
        title: 'Example',
        observedAt: '2026-06-20T00:00:00.000Z',
        viewport: {
          width: 800,
          height: 580,
          scrollX: 0,
          scrollY: 0,
          scrollWidth: 800,
          scrollHeight: 1400,
          clientWidth: 800,
          clientHeight: 580,
        },
        visibleText: 'Top content',
        elements: [],
        signals: [],
      })
      .mockResolvedValueOnce({
        url: 'https://example.test',
        title: 'Example',
        observedAt: '2026-06-20T00:00:01.000Z',
        viewport: {
          width: 800,
          height: 580,
          scrollX: 0,
          scrollY: 300,
          scrollWidth: 800,
          scrollHeight: 1400,
          clientWidth: 800,
          clientHeight: 580,
        },
        visibleText: 'Lower content',
        elements: [],
        signals: [],
      })

    const result = await commandsWithTrace().scrollRegion({
      direction: 'down',
      amount: 2,
      region: { left: 0, top: 0, right: 1, bottom: 1 },
    })

    expect(result.scrollBoundaryBefore).toMatchObject({ scrollTop: 0, canScrollDown: true })
    expect(result.scrollBoundaryAfter).toMatchObject({ scrollTop: 300, canScrollDown: true })
    expect(result.scrollProgress).toMatchObject({ changed: true, boundaryReached: false })
    expect(result.postObservation).toMatchObject({
      detail: expect.objectContaining({
        scroll_boundary: expect.objectContaining({ scrollTop: 300 }),
      }),
    })
    expect(mocks.captureChromeDom).toHaveBeenCalledTimes(2)
  })
})
