import { describe, expect, it } from 'vitest'
import { normalizeToSurfaceNodes } from '../../src/computer-use/macos-chrome-driver/surface-node.js'
import type { AXSnapshot, ChromeDomObservation } from '../../src/computer-use/types.js'
import type { ChromeCaptureContract } from '../../src/computer-use/macos-chrome-driver/types.js'

const contract: ChromeCaptureContract = {
  coordinateContractVersion: 1,
  captureSource: { kind: 'window', windowNumber: 10, ownerPid: 123 },
  sourceGlobalLogicalBounds: { x: 0, y: 33, width: 1000, height: 700 },
  screenshotPixelSize: { width: 2000, height: 1400 },
  pixelToLogicalScale: { x: 0.5, y: 0.5 },
  logicalToPixelScale: { x: 2, y: 2 },
  capturedAt: '2026-06-20T00:00:00.000Z',
}

describe('surface node normalization', () => {
  it('projects Chrome DOM viewport-local bounds from AXWebArea origin when available', () => {
    const axSnapshot: AXSnapshot = {
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: {
        uid: 'root',
        role: 'AXWindow',
        bounds: { x: 0, y: 33, width: 1000, height: 700 },
        children: [{
          uid: 'web-area',
          role: 'AXWebArea',
          bounds: { x: 0, y: 200, width: 1000, height: 500 },
          children: [],
        }],
      },
    }
    const domObservation: ChromeDomObservation = {
      url: 'https://example.test',
      title: 'Example',
      observedAt: '2026-06-20T00:00:00.000Z',
      visibleText: '',
      signals: [],
      elements: [{
        id: 'search',
        tagName: 'button',
        role: 'button',
        name: 'Search',
        text: 'Search',
        href: null,
        bounds: { x: 10, y: 20, width: 100, height: 30 },
        center: { x: 60, y: 35 },
        confidence: 0.85,
        actionable: true,
        states: {},
      }],
    }

    const nodes = normalizeToSurfaceNodes({
      ocrMatches: [],
      axSnapshot,
      domObservation,
      contract,
      runId: 'run_test',
      spanId: 'span_test',
      viewportBounds: { x: 0, y: 33, width: 1000, height: 700 },
    })

    const domButton = nodes.find(node => node.kind === 'dom_button')
    expect(domButton?.box).toEqual({ x: 10, y: 220, width: 100, height: 30 })
    expect(domButton?.detail.bounds).toMatchObject({
      viewport_offset_logical: { x: 0, y: 200 },
      viewport_offset_source: 'ax_web_area',
    })
  })
})
