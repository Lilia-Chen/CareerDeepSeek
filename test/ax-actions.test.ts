import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputerUseConfig } from '../src/computer-use/config.js'

const runSwiftScriptMock = vi.hoisted(() => vi.fn())

vi.mock('../src/computer-use/swift-runner.js', () => ({
  runSwiftScript: runSwiftScriptMock,
}))

describe('ax query actions', () => {
  beforeEach(() => {
    runSwiftScriptMock.mockReset()
  })

  it('passes resolved window bounds to the Swift AX matcher', async () => {
    const { executeAXQueryAction } = await import('../src/computer-use/ax-actions.js')
    const config: ComputerUseConfig = {
      sessionRoot: '.computer-use',
      screenshotsDir: '.computer-use/screenshots',
      timeoutMs: 15000,
      binaries: {
        swift: 'swift',
        osascript: 'osascript',
        screencapture: 'screencapture',
        open: 'open',
      },
      denyApps: [],
      openableApps: [],
    }

    runSwiftScriptMock.mockResolvedValue({
      stdout: JSON.stringify({
        role: 'AXButton',
        text: 'Save',
        bounds: { x: 120, y: 220, width: 80, height: 20 },
        focusedBefore: false,
        action: 'press',
      }),
      stderr: '',
    })

    await executeAXQueryAction(config, {
      pid: 123,
      query: 'Save',
      roles: ['AXButton'],
      action: 'press',
      windowBounds: { x: 100, y: 200, width: 500, height: 300 },
    })

    expect(runSwiftScriptMock).toHaveBeenCalledTimes(1)
    expect(runSwiftScriptMock).toHaveBeenCalledWith(expect.objectContaining({
      swiftBinary: 'swift',
      timeoutMs: 15000,
      stdinPayload: expect.objectContaining({
        pid: 123,
        query: 'Save',
        roles: ['AXButton'],
        action: 'press',
        windowBounds: { x: 100, y: 200, width: 500, height: 300 },
      }),
    }))
    const call = runSwiftScriptMock.mock.calls[0]?.[0]
    expect(call.source).toContain('pointInside(bounds, windowBounds)')
    expect(call.source).toContain('guard let bounds = boundsAttr(element), pointInside(bounds, windowBounds) else { return false }')
  })
})
