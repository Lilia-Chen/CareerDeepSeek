import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputerUseConfig } from '../../src/computer-use/config.js'
import type { WindowDescriptor, WindowObservation } from '../../src/computer-use/types.js'

const runProcessMock = vi.hoisted(() => vi.fn())
const runSwiftScriptMock = vi.hoisted(() => vi.fn())

vi.mock('../../src/computer-use/process.js', () => ({
  runProcess: runProcessMock,
}))

vi.mock('../../src/computer-use/swift-runner.js', () => ({
  runSwiftScript: runSwiftScriptMock,
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

const targetWindow: WindowDescriptor = {
  id: '42',
  windowNumber: 42,
  appName: 'Google Chrome',
  ownerBundleId: 'com.google.Chrome',
  ownerPid: 123,
  title: 'Managed Tab',
  bounds: { x: 100, y: 80, width: 900, height: 700 },
  layer: 0,
  isOnScreen: true,
}

function observation(frontmostWindowNumber: number): WindowObservation {
  return {
    frontmostAppName: 'Google Chrome',
    frontmostAppBundleId: 'com.google.Chrome',
    frontmostWindowTitle: frontmostWindowNumber === 42 ? 'Managed Tab' : 'Other Tab',
    frontmostWindowNumber,
    frontmostWindowOwnerPid: 123,
    frontmostWindowBounds: frontmostWindowNumber === 42
      ? targetWindow.bounds
      : { x: 1050, y: 80, width: 900, height: 700 },
    windows: [
      targetWindow,
      {
        ...targetWindow,
        id: '77',
        windowNumber: 77,
        title: 'Other Tab',
        bounds: { x: 1050, y: 80, width: 900, height: 700 },
      },
    ],
    observedAt: '2026-06-20T00:00:00.000Z',
  }
}

function observationWithOverlayForeground(): WindowObservation {
  return {
    ...observation(42),
    frontmostWindowTitle: '',
    frontmostWindowNumber: 99,
    frontmostWindowOwnerPid: 123,
    frontmostWindowBounds: { x: 120, y: 105, width: 650, height: 240 },
    windows: [
      {
        ...targetWindow,
        id: '99',
        windowNumber: 99,
        title: '',
        bounds: { x: 120, y: 105, width: 650, height: 240 },
      },
      targetWindow,
      {
        ...targetWindow,
        id: '77',
        windowNumber: 77,
        title: 'Other Tab',
        bounds: { x: 1050, y: 80, width: 900, height: 700 },
      },
    ],
  }
}

describe('chrome window foreground helpers', () => {
  beforeEach(() => {
    runProcessMock.mockReset()
    runSwiftScriptMock.mockReset()
  })

  it('detects the leased Chrome window, not just the Chrome app, as foreground', async () => {
    const { isChromeWindowForeground } = await import('../../src/computer-use/macos-chrome-driver/chrome-window-foreground.js')

    expect(isChromeWindowForeground(observation(42), targetWindow)).toBe(true)
    expect(isChromeWindowForeground(observation(77), targetWindow)).toBe(false)
  })

  it('raises the matching Chrome window with native AppleScript', async () => {
    runProcessMock.mockResolvedValue({ stdout: 'raised', stderr: '', exitCode: 0 })
    const { raiseChromeWindow } = await import('../../src/computer-use/macos-chrome-driver/chrome-window-foreground.js')

    await raiseChromeWindow(config, targetWindow)

    expect(runProcessMock).toHaveBeenCalledTimes(1)
    expect(runProcessMock).toHaveBeenCalledWith('osascript', expect.arrayContaining(['-e', expect.any(String)]), {
      timeoutMs: 1000,
    })
    const script = runProcessMock.mock.calls[0]?.[1][1] as string
    expect(script).toContain('tell application "Google Chrome"')
    expect(script).toContain('activate')
    expect(script).toContain('set index of candidateWindow to 1')
    expect(script).toContain('targetLeft')
    expect(script).not.toContain('JavaScript')
    expect(script).not.toContain('Application(')
  })

  it('uses AX focused/main window to verify a target behind a Chrome overlay', async () => {
    runSwiftScriptMock.mockResolvedValue({
      stdout: JSON.stringify({
        pid: 123,
        focusedWindow: {
          title: 'Managed Tab - Google Chrome - CareerDeepSeek',
          bounds: targetWindow.bounds,
          main: true,
        },
        mainWindow: {
          title: 'Managed Tab - Google Chrome - CareerDeepSeek',
          bounds: targetWindow.bounds,
          main: true,
        },
      }),
      stderr: '',
    })
    const { verifyChromeWindowForeground } = await import('../../src/computer-use/macos-chrome-driver/chrome-window-foreground.js')

    const result = await verifyChromeWindowForeground(config, observationWithOverlayForeground(), targetWindow)

    expect(result.verified).toBe(true)
    expect(result.method).toBe('ax_focused_window')
    expect(result.auxiliaryWindow?.windowNumber).toBe(99)
    expect(runSwiftScriptMock).toHaveBeenCalledTimes(1)
  })
})
