import { describe, expect, it } from 'vitest'
import { buildChromeScrollBoundary } from '../../src/computer-use/macos-chrome-driver/scroll-boundary.js'
import type { AXSnapshot } from '../../src/computer-use/types.js'

function axSnapshot(rootRole: string, scroll: AXSnapshot['root']['scroll']): AXSnapshot {
  return {
    snapshotId: 'ax_scroll_test',
    pid: 123,
    appName: 'Google Chrome',
    capturedAt: '2026-06-22T00:00:00.000Z',
    maxDepth: 15,
    truncated: false,
    root: {
      uid: 'root',
      role: 'AXWindow',
      bounds: { x: 0, y: 0, width: 900, height: 700 },
      children: [
        {
          uid: 'scroll-source',
          role: rootRole,
          bounds: { x: 0, y: 120, width: 900, height: 580 },
          scroll,
          children: [],
        },
      ],
    },
  }
}

describe('chrome scroll boundary', () => {
  it('does not promote AXWebArea string value evidence into scroll boundary state', () => {
    const boundary = buildChromeScrollBoundary({
      axSnapshot: axSnapshot('AXWebArea', {
        role: 'AXWebArea',
        orientation: 'unknown',
        min_value: 0,
        max_value: 0,
        bounds: { x: 0, y: 120, width: 900, height: 580 },
        known_limits: [
          'AXValue is string, not typed numeric',
          'AXOrientation unavailable',
        ],
      }),
    })

    expect(boundary.basis).not.toContain('ax_scroll_value')
    expect(boundary.confidence).toBe('unknown')
    expect(boundary.canScrollDown).toBe('unknown')
    expect(boundary.knownLimits).toEqual(expect.arrayContaining([
      'macos_ax_bridge_does_not_expose_chrome_page_scroll_offsets',
    ]))
  })

  it('uses numeric AXScrollBar evidence as heuristic boundary state when DOM metrics are unavailable', () => {
    const boundary = buildChromeScrollBoundary({
      axSnapshot: axSnapshot('AXScrollBar', {
        role: 'AXScrollBar',
        orientation: 'vertical',
        value: 0.5,
        min_value: 0,
        max_value: 1,
        bounds: { x: 880, y: 120, width: 16, height: 580 },
        known_limits: [],
      }),
    })

    expect(boundary).toMatchObject({
      basis: ['ax_scroll_value'],
      confidence: 'heuristic',
      canScrollUp: true,
      canScrollDown: true,
      atTop: false,
      atBottom: false,
    })
  })
})
