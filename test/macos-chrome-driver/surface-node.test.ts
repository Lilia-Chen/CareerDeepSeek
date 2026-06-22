import { describe, expect, it } from 'vitest'
import { normalizeToSurfaceNodes } from '../../src/computer-use/macos-chrome-driver/surface-node.js'
import { buildChromeWindowRegionMap } from '../../src/computer-use/macos-chrome-driver/chrome-window-regions.js'
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
      viewport: {
        width: 1000,
        height: 500,
        scrollX: 0,
        scrollY: 240,
        scrollWidth: 1000,
        scrollHeight: 1800,
        clientWidth: 1000,
        clientHeight: 500,
      },
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
      regionMap: buildChromeWindowRegionMap({
        windowBounds: contract.sourceGlobalLogicalBounds,
        axRoot: axSnapshot.root,
      }),
    })

    const domButton = nodes.find(node => node.kind === 'dom_button')
    expect(domButton?.box).toEqual({ x: 10, y: 220, width: 100, height: 30 })
    expect(domButton).toMatchObject({
      region: 'page_viewport',
      region_confidence: 'verified',
      region_source: 'ax_structure',
    })
    expect(domButton?.detail.bounds).toMatchObject({
      viewport_offset_logical: { x: 0, y: 200 },
      viewport_offset_source: 'ax_web_area',
    })
    expect(domButton?.detail.dom_viewport_metrics).toMatchObject({
      scrollY: 240,
      scrollHeight: 1800,
      clientHeight: 500,
    })
  })

  it('retains browser chrome AX evidence with coarse region metadata', () => {
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
          uid: 'toolbar',
          role: 'AXToolbar',
          title: 'Toolbar',
          bounds: { x: 0, y: 33, width: 1000, height: 80 },
          children: [],
        }, {
          uid: 'web-area',
          role: 'AXWebArea',
          bounds: { x: 0, y: 200, width: 1000, height: 500 },
          children: [],
        }],
      },
    }

    const nodes = normalizeToSurfaceNodes({
      ocrMatches: [],
      axSnapshot,
      contract,
      runId: 'run_test',
      spanId: 'span_test',
      viewportBounds: { x: 0, y: 200, width: 1000, height: 500 },
      regionMap: buildChromeWindowRegionMap({
        windowBounds: contract.sourceGlobalLogicalBounds,
        axRoot: axSnapshot.root,
      }),
    })

    const toolbar = nodes.find(node => node.label === 'Toolbar')
    expect(toolbar).toMatchObject({
      kind: 'ax_evidence',
      region: 'browser_chrome',
      detail: { evidence_role: 'browser_chrome_observation' },
    })
  })

  it('normalizes AX nodes only from the capture window when Chrome exposes multiple AXWindow roots', () => {
    const axSnapshot: AXSnapshot = {
      snapshotId: 'ax_test',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-20T00:00:00.000Z',
      maxDepth: 15,
      truncated: false,
      root: {
        uid: 'app-root',
        role: 'AXApplication',
        children: [{
          uid: 'target-window',
          role: 'AXWindow',
          bounds: { x: 0, y: 33, width: 1000, height: 700 },
          children: [{
            uid: 'target-web',
            role: 'AXWebArea',
            bounds: { x: 0, y: 200, width: 1000, height: 500 },
            children: [{
              uid: 'target-text',
              role: 'AXStaticText',
              value: 'Target Window Text',
              bounds: { x: 20, y: 220, width: 160, height: 30 },
              enabled: true,
              children: [],
            }],
          }],
        }, {
          uid: 'other-window',
          role: 'AXWindow',
          bounds: { x: 0, y: 33, width: 900, height: 650 },
          children: [{
            uid: 'other-web',
            role: 'AXWebArea',
            bounds: { x: 0, y: 200, width: 900, height: 450 },
            children: [{
              uid: 'other-text',
              role: 'AXStaticText',
              value: 'Other Window Text',
              bounds: { x: 20, y: 220, width: 160, height: 30 },
              enabled: true,
              children: [],
            }],
          }],
        }],
      },
    }

    const nodes = normalizeToSurfaceNodes({
      ocrMatches: [],
      axSnapshot,
      contract,
      runId: 'run_test',
      spanId: 'span_test',
      viewportBounds: { x: 0, y: 200, width: 1000, height: 500 },
      regionMap: buildChromeWindowRegionMap({
        windowBounds: contract.sourceGlobalLogicalBounds,
        axRoot: axSnapshot.root,
      }),
    })

    expect(nodes.some(node => node.label === 'Target Window Text')).toBe(true)
    expect(nodes.some(node => node.label === 'Other Window Text')).toBe(false)
  })
})
