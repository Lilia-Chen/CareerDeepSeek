import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { normalizeToSurfaceNodes } from '../../src/computer-use/macos-chrome-driver/surface-node.js'
import type { ArtifactRef, OcrTextMatch } from '../../src/computer-use/macos-chrome-driver/types.js'
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
const captureArtifact: ArtifactRef = { run_id: runId, artifact_id: 'screenshot_mco_1', span_id: spanId }
const captureContractArtifact: ArtifactRef = { run_id: runId, artifact_id: 'capture_contract_mco_1', span_id: spanId }

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

  it('preserves OCR text evidence detail with capture-pixel and projected logical coordinates', () => {
    const ocrMatches: OcrTextMatch[] = [
      { matchIndex: 3, text: 'Apply now', confidence: 0.91, bounds: { x: 160, y: 120, width: 240, height: 48 } },
    ]

    const nodes = normalizeToSurfaceNodes({
      ocrMatches,
      contract,
      runId,
      spanId,
      captureArtifact,
      captureContractArtifact,
    })

    assert.equal(nodes.length, 1)
    const node = nodes[0]!
    assert.equal(node.kind, 'ocr_text')
    assert.equal(node.provider_score, 0.91)
    assert.deepEqual(node.source_artifacts, ['screenshot_mco_1', 'capture_contract_mco_1'])
    assert.deepEqual(node.box, { x: 80, y: 100, width: 120, height: 24 })
    assert.equal(node.detail.match_index, 3)
    assert.equal(node.detail.text, 'Apply now')
    assert.equal(node.detail.confidence, 0.91)
    assert.deepEqual(node.detail.raw_pixel_bounds, { x: 160, y: 120, width: 240, height: 48 })
    assert.deepEqual(node.detail.coordinate_spaces, {
      raw: 'capture_pixel',
      projected: 'source_global_logical',
    })
    assert.deepEqual(node.detail.bounds, {
      capture_pixel: { x: 160, y: 120, width: 240, height: 48 },
      source_global_logical: { x: 80, y: 100, width: 120, height: 24 },
    })
    assert.deepEqual(node.detail.projection, {
      contract_version: 1,
      pixel_to_logical_scale: { x: 0.5, y: 0.5 },
      source_global_logical_bounds: { x: 0, y: 40, width: 1000, height: 800 },
    })
    assert.deepEqual(node.detail.source_artifacts, {
      capture_artifact: captureArtifact,
      capture_contract_artifact: captureContractArtifact,
    })
    assert.deepEqual(node.detail.known_limits, [])
  })

  it('preserves current-capture row evidence without stable cross-scroll identity', () => {
    const nodes = normalizeToSurfaceNodes({
      ocrMatches: [],
      ocrRows: [
        {
          rowIndex: 2,
          source: 'ocr_row',
          bounds: { x: 100, y: 200, width: 900, height: 80 },
          textFragments: [
            { matchIndex: 5, text: 'Company', confidence: 0.88, bounds: { x: 100, y: 200, width: 180, height: 32 } },
            { matchIndex: 6, text: 'AI Engineer', confidence: 0.84, bounds: { x: 340, y: 204, width: 260, height: 34 } },
          ],
          knownLimits: ['row grouping is heuristic within current capture'],
        },
      ],
      contract,
      runId,
      spanId,
      captureArtifact,
      captureContractArtifact,
    })

    assert.equal(nodes.length, 1)
    const node = nodes[0]!
    assert.equal(node.kind, 'ocr_row')
    assert.equal(node.recognition_source, 'ocr_row')
    assert.equal(node.provider_score, undefined)
    assert.equal(node.node_ref.node_id, 'ocr_row_2')
    assert.deepEqual(node.box, { x: 50, y: 140, width: 450, height: 40 })
    assert.equal(node.detail.row_index, 2)
    assert.equal(node.detail.source, 'ocr_row')
    assert.deepEqual(node.detail.row_bounds, {
      capture_pixel: { x: 100, y: 200, width: 900, height: 80 },
      source_global_logical: { x: 50, y: 140, width: 450, height: 40 },
    })
    assert.deepEqual(node.detail.text_fragments, ['Company', 'AI Engineer'])
    assert.deepEqual((node.detail.fragment_evidence as Array<Record<string, unknown>>).map(fragment => ({
      match_index: fragment.match_index,
      text: fragment.text,
      confidence: fragment.confidence,
      bounds: fragment.bounds,
    })), [
      {
        match_index: 5,
        text: 'Company',
        confidence: 0.88,
        bounds: {
          capture_pixel: { x: 100, y: 200, width: 180, height: 32 },
          source_global_logical: { x: 50, y: 140, width: 90, height: 16 },
        },
      },
      {
        match_index: 6,
        text: 'AI Engineer',
        confidence: 0.84,
        bounds: {
          capture_pixel: { x: 340, y: 204, width: 260, height: 34 },
          source_global_logical: { x: 170, y: 142, width: 130, height: 17 },
        },
      },
    ])
    assert.deepEqual(node.detail.source_artifacts, {
      capture_artifact: captureArtifact,
      capture_contract_artifact: captureContractArtifact,
    })
    assert.ok((node.detail.known_limits as string[]).includes('row confidence unavailable from provider'))
    assert.ok((node.detail.known_limits as string[]).includes('row grouping is heuristic within current capture'))
    assert.equal('stable_id' in node.detail, false)
    assert.equal('cross_scroll_id' in node.detail, false)
    assert.equal('list_id' in node.detail, false)
    assert.equal('scroll_identity' in node.detail, false)
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
