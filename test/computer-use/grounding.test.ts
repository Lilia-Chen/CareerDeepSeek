import { beforeEach, describe, it, vi } from 'vitest'
import assert from 'node:assert/strict'

import type { AXSnapshot, ChromeDomObservation, ScreenshotArtifact, WindowObservation } from '../../src/computer-use/types.js'
import type { ComputerUseConfig } from '../../src/computer-use/config.js'

const mocks = vi.hoisted(() => ({
  captureAXTree: vi.fn(),
  captureChromeDom: vi.fn(),
  captureScreenshot: vi.fn(),
  observeWindows: vi.fn(),
}))

vi.mock('../../src/computer-use/screenshot.js', () => ({
  captureScreenshot: mocks.captureScreenshot,
}))

vi.mock('../../src/computer-use/window-observation.js', () => ({
  observeWindows: mocks.observeWindows,
}))

vi.mock('../../src/computer-use/ax-tree.js', () => ({
  captureAXTree: mocks.captureAXTree,
}))

vi.mock('../../src/computer-use/chrome-dom.js', () => ({
  captureChromeDom: mocks.captureChromeDom,
}))

const { captureDesktopGrounding } = await import('../../src/computer-use/desktop-grounding.js')

const config: ComputerUseConfig = {
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

function screenshot(): ScreenshotArtifact {
  return {
    dataBase64: '',
    mimeType: 'image/png',
    path: '',
    width: 100,
    height: 100,
    capturedAt: new Date().toISOString(),
  }
}

function windows(): WindowObservation {
  return {
    frontmostAppName: 'Google Chrome',
    frontmostWindowTitle: 'Google',
    observedAt: new Date().toISOString(),
    windows: [
      {
        id: 'chrome',
        appName: 'Google Chrome',
        title: 'Google',
        bounds: { x: 0, y: 35, width: 970, height: 858 },
        ownerPid: 1,
        layer: 0,
        isOnScreen: true,
      },
    ],
  }
}

function emptyChromeDom(): ChromeDomObservation {
  return {
    url: 'https://www.google.com/',
    title: 'Google',
    observedAt: new Date().toISOString(),
    visibleText: '',
    elements: [],
    signals: [],
  }
}

describe('captureDesktopGrounding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.captureScreenshot.mockResolvedValue(screenshot())
    mocks.observeWindows.mockResolvedValue(windows())
    mocks.captureChromeDom.mockResolvedValue(emptyChromeDom())
    mocks.captureAXTree.mockResolvedValue({
      snapshotId: 'ax',
      pid: 1,
      appName: 'Google Chrome',
      capturedAt: new Date().toISOString(),
      maxDepth: 15,
      truncated: false,
      root: { uid: 'root', role: 'AXApplication', children: [] },
    } satisfies AXSnapshot)
  })

  it('requests enough windows to include ordinary app windows behind system status UI', async () => {
    await captureDesktopGrounding(config)

    const input = mocks.observeWindows.mock.calls[0]?.[1]
    assert.ok(input?.limit >= 80, `expected window limit >= 80, got ${input?.limit}`)
  })

  it('drops AX candidates with zero-area bounds', async () => {
    mocks.captureChromeDom.mockResolvedValue(null)
    mocks.captureAXTree.mockResolvedValue({
      snapshotId: 'ax',
      pid: 1,
      appName: 'Google Chrome',
      capturedAt: new Date().toISOString(),
      maxDepth: 15,
      truncated: false,
      root: {
        uid: 'root',
        role: 'AXApplication',
        children: [
          {
            uid: 'zero',
            role: 'AXMenuItem',
            title: 'Invisible menu item',
            enabled: true,
            bounds: { x: 0, y: 956, width: 0, height: 0 },
            children: [],
          },
          {
            uid: 'visible',
            role: 'AXButton',
            title: 'Visible button',
            enabled: true,
            bounds: { x: 10, y: 20, width: 30, height: 40 },
            children: [],
          },
        ],
      },
    } satisfies AXSnapshot)

    const grounding = await captureDesktopGrounding(config)
    const labels = grounding.targetCandidates.map(candidate => candidate.label)

    assert.deepEqual(labels, ['Visible button'])
    assert.ok(
      grounding.targetCandidates.every(candidate =>
        candidate.bounds.width > 0 && candidate.bounds.height > 0,
      ),
    )
  })

  it('preserves href values from Chrome DOM candidates', async () => {
    mocks.captureChromeDom.mockResolvedValue({
      url: 'https://www.google.com/search?q=test',
      title: 'test - Google Search',
      observedAt: new Date().toISOString(),
      visibleText: 'Example result',
      signals: [],
      elements: [
        {
          id: 'result-link',
          tagName: 'a',
          role: 'link',
          name: 'Example careers',
          text: 'Example careers',
          href: 'https://example.com/careers',
          bounds: { x: 100, y: 200, width: 240, height: 40 },
          center: { x: 220, y: 220 },
          confidence: 0.85,
          actionable: true,
          states: {},
        },
      ],
    } satisfies ChromeDomObservation)

    const grounding = await captureDesktopGrounding(config)

    assert.equal(grounding.targetCandidates[0]?.source, 'chrome_dom')
    assert.equal(grounding.targetCandidates[0]?.href, 'https://example.com/careers')
  })

  it('offsets Chrome DOM candidates from the AX web area viewport when available', async () => {
    mocks.captureAXTree.mockResolvedValue({
      snapshotId: 'ax',
      pid: 1,
      appName: 'Google Chrome',
      capturedAt: new Date().toISOString(),
      maxDepth: 15,
      truncated: false,
      root: {
        uid: 'root',
        role: 'AXApplication',
        children: [
          {
            uid: 'web',
            role: 'AXWebArea',
            title: 'Google',
            bounds: { x: 0, y: 154, width: 972, height: 739 },
            children: [],
          },
        ],
      },
    } satisfies AXSnapshot)
    mocks.captureChromeDom.mockResolvedValue({
      url: 'https://www.google.com/',
      title: 'Google',
      observedAt: new Date().toISOString(),
      visibleText: '',
      signals: [],
      elements: [
        {
          id: 'search-box',
          tagName: 'textarea',
          role: 'combobox',
          name: 'Search',
          text: 'Search',
          href: null,
          bounds: { x: 190, y: 266, width: 446, height: 50 },
          center: { x: 413, y: 291 },
          confidence: 0.9,
          actionable: true,
          states: {},
        },
      ],
    } satisfies ChromeDomObservation)

    const grounding = await captureDesktopGrounding(config)

    assert.equal(grounding.targetCandidates[0]?.bounds.y, 420)
    assert.equal(grounding.targetCandidates[0]?.center.y, 445)
  })

  it('uses the normal Chrome content window instead of small Chrome overlay windows', async () => {
    mocks.observeWindows.mockResolvedValue({
      frontmostAppName: 'Google Chrome',
      frontmostWindowTitle: '',
      observedAt: new Date().toISOString(),
      windows: [
        {
          id: 'chrome-overlay',
          appName: 'Google Chrome',
          title: '',
          bounds: { x: 135, y: 58, width: 414, height: 176 },
          ownerPid: 1,
          layer: 0,
          isOnScreen: true,
        },
        {
          id: 'chrome-content',
          appName: 'Google Chrome',
          title: 'Google Search',
          bounds: { x: 0, y: 33, width: 972, height: 860 },
          ownerPid: 1,
          layer: 0,
          isOnScreen: true,
        },
      ],
    } satisfies WindowObservation)
    mocks.captureChromeDom.mockResolvedValue({
      url: 'https://www.google.com/search?q=test',
      title: 'test - Google Search',
      observedAt: new Date().toISOString(),
      visibleText: 'Example result',
      signals: [],
      elements: [
        {
          id: 'result-link',
          tagName: 'a',
          role: 'link',
          name: 'Example careers',
          text: 'Example careers',
          href: 'https://example.com/careers',
          bounds: { x: 48, y: 234, width: 240, height: 40 },
          center: { x: 168, y: 254 },
          confidence: 0.85,
          actionable: true,
          states: {},
        },
      ],
    } satisfies ChromeDomObservation)

    const grounding = await captureDesktopGrounding(config)

    assert.equal(grounding.targetCandidates[0]?.bounds.x, 48)
    assert.equal(grounding.targetCandidates[0]?.bounds.y, 267)
  })

  it('preserves read-only Chrome DOM context when Chrome is not foreground without exposing DOM click targets', async () => {
    mocks.observeWindows.mockResolvedValue({
      frontmostAppName: 'loginwindow',
      frontmostWindowTitle: null,
      observedAt: new Date().toISOString(),
      windows: [
        {
          id: 'chrome-content',
          appName: 'Google Chrome',
          title: 'Google Search',
          bounds: { x: 0, y: 33, width: 972, height: 860 },
          ownerPid: 1,
          layer: 0,
          isOnScreen: true,
        },
      ],
    } satisfies WindowObservation)
    mocks.captureChromeDom.mockResolvedValue({
      url: 'https://www.google.com/search?q=test',
      title: 'test - Google Search',
      observedAt: new Date().toISOString(),
      visibleText: 'This should not be treated as visible text.',
      signals: [],
      elements: [],
    } satisfies ChromeDomObservation)

    const grounding = await captureDesktopGrounding(config)

    assert.equal(grounding.foregroundApp, 'loginwindow')
    assert.equal(grounding.chromeDomObservation?.url, 'https://www.google.com/search?q=test')
    assert.equal(grounding.chromeContext.isFrontmost, false)
    assert.equal(grounding.chromeContext.activeTabUrl, 'https://www.google.com/search?q=test')
    assert.equal(grounding.pageContext.className, 'google_results')
    assert.equal(grounding.targetCandidates.some(candidate => candidate.source === 'chrome_dom'), false)
    assert.equal(grounding.staleFlags.chromeSemantic, false)
  })

  it('keeps Chrome active-tab context but exposes no page candidates when Chrome is not frontmost', async () => {
    mocks.observeWindows.mockResolvedValue({
      frontmostAppName: 'Codex',
      frontmostWindowTitle: 'Codex',
      observedAt: new Date().toISOString(),
      windows: [
        {
          id: 'codex-cover',
          appName: 'Codex',
          title: 'Codex',
          bounds: { x: 0, y: 40, width: 1000, height: 760 },
          ownerPid: 2,
          layer: 0,
          isOnScreen: true,
        },
        {
          id: 'chrome-content',
          appName: 'Google Chrome',
          title: 'Feed | LinkedIn',
          bounds: { x: 0, y: 40, width: 1000, height: 760 },
          ownerPid: 1,
          layer: 0,
          isOnScreen: true,
        },
      ],
    } satisfies WindowObservation)
    mocks.captureChromeDom.mockResolvedValue({
      url: 'https://www.linkedin.com/feed/',
      title: 'Feed | LinkedIn',
      observedAt: new Date().toISOString(),
      visibleText: 'LinkedIn Search',
      signals: [],
      elements: [
        {
          id: 'linkedin-search',
          tagName: 'input',
          role: 'textbox',
          name: 'Search',
          text: 'Search',
          href: null,
          bounds: { x: 58, y: 9, width: 280, height: 34 },
          center: { x: 198, y: 26 },
          confidence: 0.9,
          actionable: true,
          states: {},
        },
      ],
    } satisfies ChromeDomObservation)

    const grounding = await captureDesktopGrounding(config)

    assert.equal(grounding.chromeDomObservation?.url, 'https://www.linkedin.com/feed/')
    assert.equal(grounding.pageContext.className, 'linkedin_feed')
    assert.equal(grounding.chromeContext.isFrontmost, false)
    assert.equal(grounding.targetCandidates.some(candidate => candidate.source === 'chrome_dom'), false)
  })
})
