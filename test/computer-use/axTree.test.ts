import { beforeEach, describe, it, vi } from 'vitest'
import assert from 'node:assert/strict'

import type { ComputerUseConfig } from '../../src/computer-use/config.js'

const mocks = vi.hoisted(() => ({
  runSwiftScript: vi.fn(),
}))

vi.mock('../../src/computer-use/swift-runner.js', () => ({
  runSwiftScript: mocks.runSwiftScript,
}))

const { captureAXTree } = await import('../../src/computer-use/ax-tree.js')

const config: ComputerUseConfig = {
  sessionRoot: '.computer-use/ax-tree-test',
  screenshotsDir: '.computer-use/ax-tree-test/screenshots',
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

describe('ax tree capture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves legacy string value and typed scroll evidence from the Swift bridge', async () => {
    mocks.runSwiftScript.mockResolvedValue({
      stdout: JSON.stringify({
        pid: 123,
        appName: 'Google Chrome',
        truncated: false,
        root: {
          role: 'AXApplication',
          children: [
            {
              role: 'AXScrollBar',
              value: '50',
              bounds: { x: 984, y: 120, width: 12, height: 620 },
              scroll: {
                role: 'AXScrollBar',
                orientation: 'vertical',
                value: 50,
                min_value: 0,
                max_value: 100,
                bounds: { x: 984, y: 120, width: 12, height: 620 },
                known_limits: [],
              },
              children: [],
            },
          ],
        },
      }),
      stderr: '',
    })

    const snapshot = await captureAXTree(config, { pid: 123 })

    const swiftSource = mocks.runSwiftScript.mock.calls[0]?.[0]?.source as string
    assert.match(swiftSource, /kAXMinValueAttribute/)
    assert.match(swiftSource, /kAXMaxValueAttribute/)
    assert.match(swiftSource, /kAXOrientationAttribute/)
    assert.doesNotMatch(swiftSource, /\bas\?\s+AXValue\b/)
    assert.match(swiftSource, /let axValue = value as! AXValue/)

    const scrollNode = snapshot.root.children[0]
    assert.ok(scrollNode)
    assert.equal(scrollNode.value, '50')
    assert.deepEqual(scrollNode.scroll, {
      role: 'AXScrollBar',
      orientation: 'vertical',
      value: 50,
      min_value: 0,
      max_value: 100,
      bounds: { x: 984, y: 120, width: 12, height: 620 },
      known_limits: [],
    })
  })
})
