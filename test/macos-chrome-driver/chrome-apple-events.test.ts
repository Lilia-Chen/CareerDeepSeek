import { describe, expect, it, vi } from 'vitest'
import { runChromeAppleEventsTabCommand } from '../../src/computer-use/macos-chrome-driver/chrome-apple-events.js'
import type { ComputerUseConfig } from '../../src/computer-use/config.js'

const mocks = vi.hoisted(() => ({
  runProcess: vi.fn(),
}))

vi.mock('../../src/computer-use/process.js', () => ({
  runProcess: mocks.runProcess,
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

const targetWindow = {
  id: 'window-1',
  windowNumber: 42,
  appName: 'Google Chrome',
  ownerPid: 123,
  title: 'Example',
  bounds: { x: 100, y: 200, width: 800, height: 600 },
  layer: 0,
}

describe('chrome Apple Events helper', () => {
  it('returns selected-window and tab metadata from a successful command', async () => {
    mocks.runProcess.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({
        ok: true,
        command: 'reload',
        deliveryPath: 'apple_events',
        candidateCount: 1,
        matchingCandidateCount: 1,
        candidates: [],
        selectedWindow: { index: 1, matchReasons: ['bounds_match'] },
        before: { url: 'https://example.test', title: 'Example' },
        after: { url: 'https://example.test', title: 'Example' },
      }),
      stderr: '',
    })

    const result = await runChromeAppleEventsTabCommand({ config, targetWindow, command: 'reload' })

    expect(result).toMatchObject({
      ok: true,
      command: 'reload',
      matchingCandidateCount: 1,
      selectedWindow: { index: 1 },
    })
    expect(mocks.runProcess).toHaveBeenCalledWith('osascript', expect.arrayContaining(['-l', 'JavaScript']), expect.any(Object))
  })

  it('surfaces ambiguous binding as an explicit non-delivery result', async () => {
    mocks.runProcess.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({
        ok: false,
        command: 'back',
        deliveryPath: 'apple_events',
        reason: 'target_window_ambiguous',
        candidateCount: 2,
        matchingCandidateCount: 2,
        candidates: [{ index: 1, matchReasons: ['title_match'] }, { index: 2, matchReasons: ['title_match'] }],
      }),
      stderr: '',
    })

    const result = await runChromeAppleEventsTabCommand({ config, targetWindow, command: 'back' })

    expect(result).toMatchObject({
      ok: false,
      reason: 'target_window_ambiguous',
      candidateCount: 2,
      matchingCandidateCount: 2,
    })
  })

  it('requires bounds_match rather than title-only matching for command binding', async () => {
    mocks.runProcess.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({
        ok: false,
        command: 'back',
        deliveryPath: 'apple_events',
        reason: 'target_window_not_found',
        candidateCount: 1,
        matchingCandidateCount: 0,
        candidates: [{ index: 1, matchReasons: ['title_match'] }],
      }),
      stderr: '',
    })

    const result = await runChromeAppleEventsTabCommand({ config, targetWindow, command: 'back' })
    const script = mocks.runProcess.mock.calls.at(-1)?.[1]?.at(-1) as string

    expect(script).toContain('matchReasons.indexOf(\'bounds_match\') !== -1')
    expect(script).not.toContain('matchReasons.length > 0')
    expect(result).toMatchObject({
      ok: false,
      matchingCandidateCount: 0,
      candidates: [{ matchReasons: ['title_match'] }],
    })
  })
})
