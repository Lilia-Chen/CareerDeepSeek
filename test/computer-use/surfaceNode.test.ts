import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { normalizeToSurfaceNodes } from '../../src/computer-use/macos-chrome-driver/surface-node.js'
import type { OcrTextMatch } from '../../src/computer-use/macos-chrome-driver/types.js'
import type { AXSnapshot, ChromeDomObservation } from '../../src/computer-use/types.js'

const contract = {
  coordinateContractVersion: 1 as const,
  captureSource: { kind: 'window' as const, windowNumber: 42, ownerPid: 123 },
  sourceGlobalLogicalBounds: { x: 0, y: 40, width: 1000, height: 800 },
  screenshotPixelSize: { width: 2000, height: 1600 },
  pixelToLogicalScale: { x: 0.5, y: 0.5 },
  logicalToPixelScale: { x: 2, y: 2 },
  capturedAt: '2026-06-14T00:00:00.000Z',
}

const runId = 'run_1'
const spanId = 'span_1'

describe('normalizeToSurfaceNodes', () => {
  it('converts OCR matches to SurfaceNode with correct coordinate projection', () => {
    const ocrMatches: OcrTextMatch[] = [
      { matchIndex: 0, text: 'Search', confidence: 0.97, bounds: { x: 100, y: 76, width: 248, height: 76 } },
    ]
    const nodes = normalizeToSurfaceNodes({ ocrMatches, contract, runId, spanId })
    assert.equal(nodes.length, 1)
    const node = nodes[0]!
    assert.equal(node.kind, 'ocr_text')
    assert.equal(node.label, 'Search')
    assert.equal(node.provider_score, 0.97)
    // Pixel coords (100,76) * scale (0.5,0.5) + logical offset (0,40) = (50,78)
    assert.equal(node.box.x, 50)
    assert.equal(node.box.y, 78)
    assert.equal(node.box.width, 124)
    assert.equal(node.box.height, 38)
    assert.equal(node.recognition_source, 'ocr_text')
    assert.equal(node.node_ref.run_id, runId)
    assert.equal(node.node_ref.span_id, spanId)
    assert.equal(node.node_ref.node_id, 'ocr_0')
  })

  it('converts AX nodes with bounds and text to SurfaceNode', () => {
    const axSnapshot: AXSnapshot = {
      snapshotId: 'ax-1',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-14T00:00:00.000Z',
      maxDepth: 5,
      truncated: false,
      root: {
        uid: 'btn-1',
        role: 'AXButton',
        title: 'Accept',
        bounds: { x: 520, y: 280, width: 280, height: 44 },
        children: [],
      },
    }
    const nodes = normalizeToSurfaceNodes({
      ocrMatches: [],
      axSnapshot,
      contract,
      runId,
      spanId,
    })
    assert.equal(nodes.length, 1)
    const node = nodes[0]!
    assert.equal(node.kind, 'ax_button')
    assert.equal(node.label, 'Accept')
    assert.equal(node.recognition_source, 'custom')
    assert.equal(node.provider_score, 0.75)
    assert.equal(node.node_ref.node_id, 'ax_btn-1')
  })

  it('converts DOM elements to SurfaceNode', () => {
    const domObservation: ChromeDomObservation = {
      url: 'https://example.com',
      title: 'Test',
      observedAt: '2026-06-14T00:00:00.000Z',
      visibleText: 'Home',
      signals: [],
      elements: [{
        id: 'link-1',
        tagName: 'a',
        role: 'link',
        name: 'Home',
        text: 'Home',
        href: '/home',
        bounds: { x: 0, y: 0, width: 80, height: 30 },
        center: { x: 40, y: 15 },
        confidence: 0.9,
        actionable: true,
        states: {},
      }],
    }
    const viewportBounds = { x: 100, y: 0, width: 900, height: 800 }
    const nodes = normalizeToSurfaceNodes({
      ocrMatches: [],
      domObservation,
      contract,
      runId,
      spanId,
      viewportBounds,
    })
    assert.equal(nodes.length, 1)
    const node = nodes[0]!
    assert.equal(node.kind, 'dom_link')
    assert.equal(node.label, 'Home')
    assert.equal(node.recognition_source, 'chrome_dom')
    // DOM bounds (0,0) + viewport offset (100,0) = (100,0)
    assert.equal(node.box.x, 100)
    assert.equal(node.box.y, 0)
    assert.equal(node.detail.href, '/home')
    assert.ok(node.center !== undefined)
  })

  it('returns empty array for empty input', () => {
    const nodes = normalizeToSurfaceNodes({ ocrMatches: [], contract, runId, spanId })
    assert.equal(nodes.length, 0)
  })

  it('sorts nodes by y then x position', () => {
    const ocrMatches: OcrTextMatch[] = [
      { matchIndex: 0, text: 'Bottom', confidence: 0.9, bounds: { x: 100, y: 600, width: 200, height: 40 } },
      { matchIndex: 1, text: 'Top', confidence: 0.9, bounds: { x: 100, y: 80, width: 200, height: 40 } },
      { matchIndex: 2, text: 'TopRight', confidence: 0.9, bounds: { x: 500, y: 82, width: 200, height: 40 } },
    ]
    const nodes = normalizeToSurfaceNodes({ ocrMatches, contract, runId, spanId })
    assert.equal(nodes.length, 3)
    assert.equal(nodes[0]!.label, 'Top')
    assert.equal(nodes[1]!.label, 'TopRight')
    assert.equal(nodes[2]!.label, 'Bottom')
  })
})
