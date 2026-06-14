import { beforeEach, describe, it, vi } from 'vitest'
import assert from 'node:assert/strict'

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
  observeWindows: vi.fn(),
  recognizeTextInImage: vi.fn(),
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
      capturedAt: '2026-06-14T00:00:00.000Z',
    },
  }),
}))

vi.mock('../../src/computer-use/macos-actions.js', () => ({
  executeMoveAndClick: mocks.executeMoveAndClick,
  executeOpenApp: mocks.executeOpenApp,
}))

vi.mock('../../src/computer-use/window-observation.js', () => ({
  observeWindows: mocks.observeWindows,
}))

vi.mock('../../src/computer-use/macos-chrome-driver/ocr.js', () => ({
  recognizeTextInImage: mocks.recognizeTextInImage,
}))

const {
  MacOSChromeDriver,
  promoteChromeCandidate,
} = await import('../../src/computer-use/macos-chrome-driver/index.js')

const config: Partial<ComputerUseConfig> = {
  sessionRoot: './.computer-use',
  screenshotsDir: './.computer-use/screenshots',
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

describe('macOS Chrome driver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.captureAXTree.mockResolvedValue(axSnapshot())
    mocks.captureChromeDom.mockResolvedValue(chromeDomObservation())
    mocks.captureScreenshot.mockResolvedValue(screenshot())
    mocks.executeMoveAndClick.mockResolvedValue(undefined)
    mocks.executeOpenApp.mockResolvedValue(undefined)
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
  })

  it('observes Chrome through a driver snapshot without producing legacy target candidates', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    const snapshot = await driver.observeLegacy()

    assert.equal(snapshot.kind, 'macos_chrome_observation')
    assert.equal(snapshot.chromeContext.isFrontmost, true)
    assert.equal(snapshot.chromeContext.window.windowNumber, 42)
    assert.equal(snapshot.chromeContext.window.ownerBundleId, 'com.google.Chrome')
    assert.equal(snapshot.capture.contract.captureSource.kind, 'window')
    assert.equal(snapshot.capture.contract.captureSource.windowNumber, 42)
    assert.equal(snapshot.ocr.matches[0]?.text, 'Search')
    assert.equal('targetCandidates' in snapshot, false)
  })

  it('recognizes a requested target as a separate result with best, filtered, all, and evidence', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    const result = await driver.recognizeLegacy({
      kind: 'text_input',
      name: /search/i,
    })

    assert.equal(result.kind, 'macos_chrome_recognition')
    assert.equal(result.target.kind, 'text_input')
    assert.equal(result.found, true)
    assert.equal(result.best?.source, 'chrome_dom')
    assert.equal(result.best?.text, 'Search')
    assert.ok(result.filtered.length >= 1)
    assert.ok(result.all.length >= result.filtered.length)
    assert.ok(result.evidence.some(item => item.kind === 'screenshot'))
    assert.ok(result.evidence.some(item => item.kind === 'chrome_dom'))
    assert.ok(result.evidence.some(item => item.kind === 'ocr'))
  })

  it('promotes only a successful recognition result into a candidate ref', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })
    const result = await driver.recognizeLegacy({ kind: 'button', text: /accept all cookies/i })

    const candidate = promoteChromeCandidate(result)

    assert.equal(candidate.kind, 'macos_chrome_candidate')
    assert.equal(candidate.recognitionId, result.recognitionId)
    assert.equal(candidate.center.x, 660)
    assert.equal(candidate.center.y, 342)
    assert.equal(candidate.captureSnapshotId, result.observation.capture.snapshotId)
  })

  it('clicks a promoted candidate after rechecking Chrome foreground', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })
    const result = await driver.recognizeLegacy({ kind: 'button', text: /accept all cookies/i })
    const candidate = promoteChromeCandidate(result)

    await driver.clickLegacy(candidate)

    assert.equal(mocks.executeMoveAndClick.mock.calls.length, 1)
    const payload = mocks.executeMoveAndClick.mock.calls[0]?.[1]
    assert.equal(payload.pointerTrace.at(-1).x, 660)
    assert.equal(payload.pointerTrace.at(-1).y, 342)
  })
})

function screenshot(): ScreenshotArtifact {
  return {
    dataBase64: '',
    mimeType: 'image/png',
    path: '/tmp/chrome.png',
    width: 1000,
    height: 800,
    capturedAt: '2026-06-14T00:00:00.000Z',
  }
}

function chromeWindowObservation(): WindowObservation {
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
      },
    ],
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
