import { beforeEach, describe, it, vi } from 'vitest'
import assert from 'node:assert/strict'

import type { ComputerUseConfig } from '../../src/computer-use/config.js'
import type { DesktopGroundingSnapshot } from '../../src/computer-use/types.js'

const mocks = vi.hoisted(() => ({
  captureDesktopGrounding: vi.fn(),
  executeOpenApp: vi.fn(),
  executeMoveAndClick: vi.fn(),
  executePressKeys: vi.fn(),
  executeScroll: vi.fn(),
  executeTypeText: vi.fn(),
  observeWindows: vi.fn(),
}))

vi.mock('../../src/computer-use/macos-actions.js', () => ({
  executeMoveAndClick: mocks.executeMoveAndClick,
  executeOpenApp: mocks.executeOpenApp,
  executePressKeys: mocks.executePressKeys,
  executeScroll: mocks.executeScroll,
  executeTypeText: mocks.executeTypeText,
}))

vi.mock('../../src/computer-use/window-observation.js', () => ({
  observeWindows: mocks.observeWindows,
}))

vi.mock('../../src/computer-use/desktop-grounding.js', () => ({
  captureDesktopGrounding: mocks.captureDesktopGrounding,
}))

const { MacOSComputerUseAdapter } = await import('../../src/computer-use/macos-adapter.js')

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

describe('macOS computer-use adapter foreground guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.captureDesktopGrounding.mockResolvedValue(groundingSnapshot())
    mocks.executeMoveAndClick.mockResolvedValue(undefined)
    mocks.executeOpenApp.mockResolvedValue(undefined)
    mocks.executePressKeys.mockResolvedValue(undefined)
    mocks.executeScroll.mockResolvedValue(undefined)
    mocks.executeTypeText.mockResolvedValue(undefined)
  })

  it('rejects keyboard actions when Chrome is not the frontmost app', async () => {
    mocks.observeWindows.mockResolvedValue({
      frontmostAppName: 'Visual Studio Code',
      frontmostWindowTitle: 'browser-use-policy.md',
      windows: [],
      observedAt: new Date().toISOString(),
    })
    const adapter = new MacOSComputerUseAdapter({ sessionId: 'guard-test', config })

    await assert.rejects(
      () => adapter.act({ type: 'press', key: 'l', modifiers: ['command'] }),
      /foreground app must be Google Chrome/i,
    )
    assert.equal(mocks.executePressKeys.mock.calls.length, 0)
  })

  it('can explicitly focus Chrome before a CGEvent action', async () => {
    mocks.observeWindows
      .mockResolvedValueOnce({
        frontmostAppName: 'Visual Studio Code',
        frontmostWindowTitle: 'browser-use-policy.md',
        windows: [],
        observedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        frontmostAppName: 'Google Chrome',
        frontmostWindowTitle: 'Example Domain',
        windows: [],
        observedAt: new Date().toISOString(),
      })
    const adapter = new MacOSComputerUseAdapter({
      sessionId: 'guard-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await adapter.act({ type: 'press', key: 'l', modifiers: ['command'] })

    assert.equal(mocks.executeOpenApp.mock.calls.length, 1)
    assert.equal(mocks.executeOpenApp.mock.calls[0]?.[1], 'Google Chrome')
    assert.equal(mocks.executePressKeys.mock.calls.length, 1)
  })

  it('focuses Chrome before observation in auto-focus mode', async () => {
    mocks.observeWindows
      .mockResolvedValueOnce({
        frontmostAppName: 'Codex',
        frontmostWindowTitle: 'Codex',
        windows: [],
        observedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        frontmostAppName: 'Google Chrome',
        frontmostWindowTitle: 'Feed | LinkedIn',
        windows: [],
        observedAt: new Date().toISOString(),
      })
    const adapter = new MacOSComputerUseAdapter({
      sessionId: 'observe-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await adapter.observe()

    assert.equal(mocks.executeOpenApp.mock.calls.length, 1)
    assert.equal(mocks.captureDesktopGrounding.mock.calls.length, 1)
  })

  it('rejects observation in require-Chrome mode when Chrome is not frontmost', async () => {
    mocks.observeWindows.mockResolvedValue({
      frontmostAppName: 'Codex',
      frontmostWindowTitle: 'Codex',
      windows: [],
      observedAt: new Date().toISOString(),
    })
    const adapter = new MacOSComputerUseAdapter({ sessionId: 'observe-test', config })

    await assert.rejects(
      () => adapter.observe(),
      /foreground app must be Google Chrome/i,
    )
    assert.equal(mocks.captureDesktopGrounding.mock.calls.length, 0)
  })

  it('rejects CGEvent actions when explicit Chrome focus does not make Chrome frontmost', async () => {
    mocks.observeWindows
      .mockResolvedValueOnce({
        frontmostAppName: 'Visual Studio Code',
        frontmostWindowTitle: 'browser-use-policy.md',
        windows: [],
        observedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        frontmostAppName: 'Visual Studio Code',
        frontmostWindowTitle: 'browser-use-policy.md',
        windows: [],
        observedAt: new Date().toISOString(),
      })
    const adapter = new MacOSComputerUseAdapter({
      sessionId: 'guard-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    await assert.rejects(
      () => adapter.act({ type: 'press', key: 'l', modifiers: ['command'] }),
      /foreground app must be Google Chrome/i,
    )
    assert.equal(mocks.executeOpenApp.mock.calls.length, 1)
    assert.equal(mocks.executePressKeys.mock.calls.length, 0)
  })

  it('allows CGEvent actions when Chrome is the frontmost app', async () => {
    mocks.observeWindows.mockResolvedValue({
      frontmostAppName: 'Google Chrome',
      frontmostWindowTitle: 'Example Domain',
      windows: [],
      observedAt: new Date().toISOString(),
    })
    const adapter = new MacOSComputerUseAdapter({ sessionId: 'guard-test', config })

    await adapter.act({ type: 'press', key: 'l', modifiers: ['command'] })

    assert.equal(mocks.executePressKeys.mock.calls.length, 1)
  })
})

function groundingSnapshot(): DesktopGroundingSnapshot {
  return {
    snapshotId: 'dg-test',
    capturedAt: new Date().toISOString(),
    foregroundApp: 'Google Chrome',
    windows: [],
    screenshot: {
      dataBase64: '',
      mimeType: 'image/png',
      path: '',
      width: 100,
      height: 100,
      capturedAt: new Date().toISOString(),
    },
    chromeContext: {
      running: true,
      isFrontmost: true,
      visibleWindowCount: 1,
      activeTabUrl: 'https://www.linkedin.com/feed/',
      activeTabTitle: 'Feed | LinkedIn',
      domAvailable: true,
      domElementCount: 0,
      domVisibleTextLength: 0,
    },
    pageContext: {
      className: 'linkedin_feed',
      url: 'https://www.linkedin.com/feed/',
      title: 'Feed | LinkedIn',
      host: 'www.linkedin.com',
      source: 'chrome_dom',
      domAvailable: true,
      signals: [],
    },
    targetCandidates: [],
    staleFlags: {
      screenshot: false,
      ax: false,
      chromeSemantic: false,
      windows: false,
    },
  }
}
