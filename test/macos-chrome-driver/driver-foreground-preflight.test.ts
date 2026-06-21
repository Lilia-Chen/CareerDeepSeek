import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowDescriptor, WindowObservation } from '../../src/computer-use/types.js'

const mocks = vi.hoisted(() => ({
  observeWindows: vi.fn(),
  executeOpenApp: vi.fn(),
  executePressKeys: vi.fn(),
  captureAXTree: vi.fn(),
  captureChromeDom: vi.fn(),
  raiseChromeWindow: vi.fn(),
  verifyChromeWindowForeground: vi.fn(),
}))

vi.mock('../../src/computer-use/window-observation.js', () => ({
  observeWindows: mocks.observeWindows,
}))

vi.mock('../../src/computer-use/macos-actions.js', () => ({
  executeOpenApp: mocks.executeOpenApp,
  executePressKeys: mocks.executePressKeys,
}))

vi.mock('../../src/computer-use/ax-tree.js', () => ({
  captureAXTree: mocks.captureAXTree,
}))

vi.mock('../../src/computer-use/chrome-dom.js', () => ({
  captureChromeDom: mocks.captureChromeDom,
}))

vi.mock('../../src/computer-use/macos-chrome-driver/chrome-window-foreground.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/computer-use/macos-chrome-driver/chrome-window-foreground.js')>(
    '../../src/computer-use/macos-chrome-driver/chrome-window-foreground.js',
  )
  return {
    ...actual,
    raiseChromeWindow: mocks.raiseChromeWindow,
    verifyChromeWindowForeground: mocks.verifyChromeWindowForeground,
  }
})

const correctWindow: WindowDescriptor = {
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

const otherWindow: WindowDescriptor = {
  ...correctWindow,
  id: '77',
  windowNumber: 77,
  title: 'Other Tab',
  bounds: { x: 1050, y: 80, width: 900, height: 700 },
}

function chromeObservation(frontmost: 'correct' | 'other'): WindowObservation {
  const frontmostWindow = frontmost === 'correct' ? correctWindow : otherWindow
  return {
    frontmostAppName: 'Google Chrome',
    frontmostAppBundleId: 'com.google.Chrome',
    frontmostWindowTitle: frontmostWindow.title,
    frontmostWindowNumber: frontmostWindow.windowNumber,
    frontmostWindowOwnerPid: frontmostWindow.ownerPid,
    frontmostWindowBounds: frontmostWindow.bounds,
    windows: [frontmostWindow, frontmost === 'correct' ? otherWindow : correctWindow],
    observedAt: '2026-06-20T00:00:00.000Z',
  }
}

function chromeObservationWithOverlay(): WindowObservation {
  return {
    ...chromeObservation('correct'),
    frontmostWindowTitle: '',
    frontmostWindowNumber: 99,
    frontmostWindowOwnerPid: 123,
    frontmostWindowBounds: { x: 120, y: 105, width: 650, height: 240 },
    windows: [
      {
        ...correctWindow,
        id: '99',
        windowNumber: 99,
        title: '',
        bounds: { x: 120, y: 105, width: 650, height: 240 },
      },
      correctWindow,
      otherWindow,
    ],
  }
}

function writeProfileConfig(sessionRoot: string): void {
  writeFileSync(join(sessionRoot, 'profile.json'), JSON.stringify({
    profile_path: '/Users/test/Library/Application Support/Google/Chrome/Profile 1',
    profile_name: 'CareerDeepSeek',
  }))
}

function writeLocalState(path: string): void {
  writeFileSync(path, JSON.stringify({
    profile: {
      info_cache: {
        'Profile 1': {
          name: 'CareerDeepSeek',
          user_name: 'lilia@example.test',
        },
      },
    },
  }))
}

describe('macOS Chrome driver foreground preflight', () => {
  const previousLocalState = process.env.COMPUTER_USE_CHROME_LOCAL_STATE_PATH

  beforeEach(() => {
    mocks.observeWindows.mockReset()
    mocks.executeOpenApp.mockReset()
    mocks.executeOpenApp.mockResolvedValue(undefined)
    mocks.executePressKeys.mockReset()
    mocks.executePressKeys.mockResolvedValue(undefined)
    mocks.captureChromeDom.mockReset()
    mocks.captureChromeDom.mockResolvedValue({
      url: 'https://example.test',
      title: 'Managed Tab',
      observedAt: '2026-06-20T00:00:00.000Z',
      visibleText: '',
      elements: [],
      signals: [],
    })
    mocks.captureAXTree.mockReset()
    mocks.captureAXTree.mockResolvedValue({
      snapshotId: 'ax_1',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 8,
      truncated: false,
      root: {
        uid: 'root',
        role: 'AXApplication',
        children: [{
          uid: 'managed-window',
          role: 'AXWindow',
          title: 'Managed Tab - Google Chrome - CareerDeepSeek',
          bounds: correctWindow.bounds,
          children: [],
        }],
      },
    })
    mocks.raiseChromeWindow.mockReset()
    mocks.raiseChromeWindow.mockResolvedValue(undefined)
    mocks.verifyChromeWindowForeground.mockReset()
    mocks.verifyChromeWindowForeground.mockImplementation(async (_config, observation, window) => ({
      verified: observation.frontmostWindowNumber === window.windowNumber
        && observation.frontmostWindowOwnerPid === window.ownerPid,
      method: observation.frontmostWindowNumber === window.windowNumber ? 'windowserver_direct' : 'not_foreground',
    }))
  })

  afterEach(() => {
    if (previousLocalState === undefined)
      delete process.env.COMPUTER_USE_CHROME_LOCAL_STATE_PATH
    else
      process.env.COMPUTER_USE_CHROME_LOCAL_STATE_PATH = previousLocalState
    vi.restoreAllMocks()
  })

  it('raises and verifies the leased window before active-app key delivery', async () => {
    const sessionRoot = mkdtempSync(join(tmpdir(), 'cds-foreground-'))
    const localStatePath = join(sessionRoot, 'Local State')
    writeProfileConfig(sessionRoot)
    writeLocalState(localStatePath)
    process.env.COMPUTER_USE_CHROME_LOCAL_STATE_PATH = localStatePath
    mocks.observeWindows
      .mockResolvedValueOnce(chromeObservation('correct'))
      .mockResolvedValueOnce(chromeObservation('other'))
      .mockResolvedValueOnce(chromeObservation('correct'))

    const { MacOSChromeDriver } = await import('../../src/computer-use/macos-chrome-driver/driver.js')
    const driver = new MacOSChromeDriver({
      sessionId: 'foreground-preflight-test',
      config: { sessionRoot, timeoutMs: 1 },
      foregroundPolicy: 'require_chrome',
    })

    await driver.invokeOperation({
      commandId: 'chrome.key',
      operation: 'key',
      inputs: { key: 'l', modifiers: ['command'] },
    })

    expect(mocks.raiseChromeWindow).toHaveBeenCalledWith(expect.any(Object), correctWindow)
    expect(mocks.executePressKeys).toHaveBeenCalledTimes(1)
    expect(mocks.raiseChromeWindow.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.executePressKeys.mock.invocationCallOrder[0],
    )

    const events = readTraceEvents(sessionRoot, 'foreground-preflight-test')
    const raiseRequestedIndex = events.findIndex(event =>
      event.name === 'chrome_target_window_raise_requested'
      && event.attributes.verified === false
      && event.attributes.target_window?.window_number === 42,
    )
    const raiseCompletedIndex = events.findIndex(event =>
      event.name === 'chrome_target_window_raise_completed'
      && event.attributes.raise_requested === true
      && event.attributes.target_window?.window_number === 42,
    )
    const leasedVerifiedIndex = events.findIndex(event =>
      event.name === 'chrome_foreground_preflight_verified'
      && event.attributes.raise_requested === true
      && event.attributes.lease_id?.startsWith('lease_run_foreground-preflight-test_') === true
      && event.attributes.lease_id.endsWith('_42'),
    )

    expect(raiseRequestedIndex).toBeGreaterThanOrEqual(0)
    expect(raiseCompletedIndex).toBeGreaterThan(raiseRequestedIndex)
    expect(leasedVerifiedIndex).toBeGreaterThan(raiseCompletedIndex)
    expect(events[leasedVerifiedIndex]?.attributes)
      .toEqual(expect.objectContaining({
        verified: true,
        raise_requested: true,
        lease_id: expect.stringMatching(/^lease_run_foreground-preflight-test_.*_42$/),
        target_window: expect.objectContaining({
          window_number: 42,
          owner_pid: 123,
        }),
      }))
    const artifacts = readTraceArtifacts(sessionRoot, 'foreground-preflight-test')
    const actionArtifact = artifacts.find(artifact => artifact.role === 'action-result')
    expect(actionArtifact?.artifact_id).toBe('action_key_atomic_1_key')
  })

  it('runs the same leased-window preflight for checkSafetyGate', async () => {
    const sessionRoot = mkdtempSync(join(tmpdir(), 'cds-foreground-gate-'))
    const localStatePath = join(sessionRoot, 'Local State')
    writeProfileConfig(sessionRoot)
    writeLocalState(localStatePath)
    process.env.COMPUTER_USE_CHROME_LOCAL_STATE_PATH = localStatePath
    mocks.observeWindows
      .mockResolvedValueOnce(chromeObservation('correct'))
      .mockResolvedValueOnce(chromeObservation('other'))
      .mockResolvedValueOnce(chromeObservation('correct'))

    const { MacOSChromeDriver } = await import('../../src/computer-use/macos-chrome-driver/driver.js')
    const driver = new MacOSChromeDriver({
      sessionId: 'foreground-gate-test',
      config: { sessionRoot, timeoutMs: 1 },
      foregroundPolicy: 'require_chrome',
    })

    const result = await driver.checkSafetyGate()

    expect(result.checks.leased_window_foreground).toBe(true)
    expect(mocks.raiseChromeWindow).toHaveBeenCalledWith(expect.any(Object), correctWindow)

    const events = readTraceEvents(sessionRoot, 'foreground-gate-test')
    expect(events.some(event =>
      event.name === 'chrome_foreground_preflight_verified'
      && event.attributes.raise_requested === true
      && event.attributes.lease_id?.startsWith('lease_run_foreground-gate-test_') === true
      && event.attributes.lease_id.endsWith('_42'),
    )).toBe(true)
  })

  it('accepts a Chrome overlay when AX resolves the leased main window', async () => {
    const sessionRoot = mkdtempSync(join(tmpdir(), 'cds-foreground-overlay-'))
    const localStatePath = join(sessionRoot, 'Local State')
    writeProfileConfig(sessionRoot)
    writeLocalState(localStatePath)
    process.env.COMPUTER_USE_CHROME_LOCAL_STATE_PATH = localStatePath
    mocks.observeWindows
      .mockResolvedValueOnce(chromeObservation('correct'))
      .mockResolvedValueOnce(chromeObservationWithOverlay())
    mocks.verifyChromeWindowForeground.mockImplementation(async (_config, observation, window) => {
      if (observation.frontmostWindowNumber === 99) {
        return {
          verified: true,
          method: 'ax_focused_window',
          auxiliaryWindow: {
            windowNumber: 99,
            ownerPid: 123,
            title: '',
            bounds: { x: 120, y: 105, width: 650, height: 240 },
          },
          axWindow: {
            title: 'Managed Tab - Google Chrome - CareerDeepSeek',
            bounds: correctWindow.bounds,
            main: true,
          },
        }
      }
      return {
        verified: observation.frontmostWindowNumber === window.windowNumber,
        method: 'windowserver_direct',
      }
    })

    const { MacOSChromeDriver } = await import('../../src/computer-use/macos-chrome-driver/driver.js')
    const driver = new MacOSChromeDriver({
      sessionId: 'foreground-overlay-test',
      config: { sessionRoot, timeoutMs: 1 },
      foregroundPolicy: 'require_chrome',
    })

    const result = await driver.checkSafetyGate()

    expect(result.passed).toBe(true)
    expect(result.checks.leased_window_foreground).toBe(true)
    expect(mocks.raiseChromeWindow).not.toHaveBeenCalled()
    const events = readTraceEvents(sessionRoot, 'foreground-overlay-test')
    expect(events.some(event =>
      event.name === 'chrome_foreground_preflight_verified'
      && event.attributes.foreground_verification_method === 'ax_focused_window',
    )).toBe(true)
  })
})

interface TraceEventForTest {
  name: string
  attributes: {
    verified?: boolean
    raise_requested?: boolean
    lease_id?: string
    target_window?: {
      window_number?: number
      owner_pid?: number
    }
    foreground_verification_method?: string
  }
}

function readTraceEvents(sessionRoot: string, sessionId: string): TraceEventForTest[] {
  const traceDir = join(sessionRoot, 'traces', sessionId)
  return readFileSync(join(traceDir, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as TraceEventForTest)
}

interface TraceArtifactForTest {
  artifact_id: string
  role: string
}

function readTraceArtifacts(sessionRoot: string, sessionId: string): TraceArtifactForTest[] {
  const traceDir = join(sessionRoot, 'traces', sessionId)
  return readFileSync(join(traceDir, 'artifacts.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as TraceArtifactForTest)
}
