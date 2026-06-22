import { describe, expect, it, vi } from 'vitest'
import { executePressKeys } from '../src/computer-use/macos-actions.js'
import type { ComputerUseConfig } from '../src/computer-use/config.js'

const mocks = vi.hoisted(() => ({
  runSwiftScript: vi.fn(),
}))

vi.mock('../src/computer-use/swift-runner.js', () => ({
  runSwiftScript: mocks.runSwiftScript,
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

describe('macOS key actions', () => {
  it('maps bracket keys for Chrome back and forward shortcuts', async () => {
    mocks.runSwiftScript.mockResolvedValueOnce(undefined)

    await executePressKeys(config, { keys: ['[', ']'], modifiers: ['command'] })

    expect(mocks.runSwiftScript).toHaveBeenCalledWith(expect.objectContaining({
      stdinPayload: { keys: ['[', ']'], modifiers: ['command'] },
      source: expect.stringContaining('"[": 33, "]": 30'),
    }))
  })
})
