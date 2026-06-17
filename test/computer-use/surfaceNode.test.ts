import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import * as surfaceNodeModule from '../../src/computer-use/macos-chrome-driver/surface-node.js'
import type { ArtifactRef, OcrTextMatch } from '../../src/computer-use/macos-chrome-driver/types.js'
import type { AXSnapshot, ChromeDomObservation } from '../../src/computer-use/types.js'

const { normalizeToSurfaceNodes } = surfaceNodeModule

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
const downstreamActionableKinds = new Set([
  'dom_button',
  'dom_link',
  'dom_textbox',
  'dom_searchbox',
  'dom_combobox',
  'ax_button',
  'ax_link',
  'ax_textfield',
  'ax_textarea',
  'ax_combobox',
  'ax_menu_item',
  'ax_tab',
])

function validSurfaceBox(box: { x: number, y: number, width: number, height: number }): boolean {
  return Number.isFinite(box.x)
    && Number.isFinite(box.y)
    && Number.isFinite(box.width)
    && Number.isFinite(box.height)
    && box.width > 0
    && box.height > 0
}

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
        enabled: true,
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

  it('does not emit AXWindow containers as page surface nodes', () => {
    const axSnapshot: AXSnapshot = {
      snapshotId: 'ax-window-container',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-14T00:00:00.000Z',
      maxDepth: 5,
      truncated: false,
      root: {
        uid: 'root',
        role: 'AXApplication',
        children: [{
          uid: 'window-1',
          role: 'AXWindow',
          title: 'LinkedIn - Google Chrome - CareerDeepSeek',
          enabled: true,
          bounds: { x: 0, y: 40, width: 1000, height: 800 },
          children: [{
            uid: 'btn-1',
            role: 'AXButton',
            title: 'Accept',
            enabled: true,
            bounds: { x: 520, y: 280, width: 280, height: 44 },
            children: [],
          }],
        }],
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
    assert.equal(nodes[0]!.kind, 'ax_button')
    assert.equal(nodes[0]!.label, 'Accept')
    assert.equal(nodes.some(node => node.recognized_item_kind === 'AXWindow'), false)
    assert.equal(nodes.some(node => node.label === 'LinkedIn - Google Chrome - CareerDeepSeek'), false)
  })

  it('preserves AX read-only evidence detail with source-global logical bounds and capture refs', () => {
    const axSnapshot: AXSnapshot = {
      snapshotId: 'ax-1',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-14T00:00:00.000Z',
      maxDepth: 5,
      truncated: false,
      root: {
        uid: 'root',
        role: 'AXApplication',
        children: [{
          uid: 'btn-1',
          role: 'AXButton',
          title: 'Accept',
          value: 'Accepted value',
          description: 'Accept cookies',
          enabled: false,
          focused: true,
          bounds: { x: 520, y: 280, width: 280, height: 44 },
          children: [],
        }],
      },
    }

    const nodes = normalizeToSurfaceNodes({
      ocrMatches: [],
      axSnapshot,
      contract,
      runId,
      spanId,
      captureArtifact,
      captureContractArtifact,
    })

    assert.equal(nodes.length, 1)
    const node = nodes[0]!
    assert.equal(downstreamActionableKinds.has(node.kind), false)
    assert.equal(node.kind, 'ax_evidence')
    assert.equal(node.label, 'Accept')
    assert.equal(node.recognized_item_kind, 'AXButton')
    assert.deepEqual(node.source_artifacts, ['screenshot_mco_1', 'capture_contract_mco_1'])
    assert.deepEqual(node.box, { x: 520, y: 280, width: 280, height: 44 })
    assert.equal(node.detail.ax_role, 'AXButton')
    assert.equal(node.detail.ax_title, 'Accept')
    assert.equal(node.detail.ax_value, 'Accepted value')
    assert.equal(node.detail.ax_description, 'Accept cookies')
    assert.equal(node.detail.enabled, false)
    assert.equal(node.detail.focused, true)
    assert.deepEqual(node.detail.coordinate_spaces, {
      source: 'source_global_logical',
      note: 'AX bounds are provider source-global logical bounds, not OCR capture pixels',
    })
    assert.deepEqual(node.detail.bounds, {
      source_global_logical: { x: 520, y: 280, width: 280, height: 44 },
    })
    assert.deepEqual(node.detail.ax_snapshot, {
      snapshot_id: 'ax-1',
      pid: 123,
      app_name: 'Google Chrome',
      captured_at: '2026-06-14T00:00:00.000Z',
      max_depth: 5,
      truncated: false,
    })
    assert.deepEqual(node.detail.source_artifacts, {
      capture_artifact: captureArtifact,
      capture_contract_artifact: captureContractArtifact,
    })
    assert.ok((node.detail.known_limits as string[]).includes('AX node reports enabled=false; provider actionability is not clean action truth'))
    assert.equal('actionable' in node.detail, false)
  })

  it('keeps truncation-only AX evidence as provider actionable kind while carrying known_limit', () => {
    const axSnapshot: AXSnapshot = {
      snapshotId: 'ax-truncated',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-14T00:00:00.000Z',
      maxDepth: 5,
      truncated: true,
      root: {
        uid: 'root',
        role: 'AXApplication',
        children: [{
          uid: 'btn-truncated',
          role: 'AXButton',
          title: 'Continue',
          enabled: true,
          focused: false,
          bounds: { x: 120, y: 160, width: 180, height: 44 },
          children: [],
        }],
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
    assert.equal(downstreamActionableKinds.has(node.kind), true)
    assert.equal(node.detail.ax_role, 'AXButton')
    assert.ok((node.detail.known_limits as string[]).includes('AX snapshot truncated; descendant evidence may be incomplete'))
    assert.equal((node.detail.known_limits as string[]).some(limit => limit.includes('enabled=false')), false)
    assert.equal(validSurfaceBox(node.box), true)
  })

  it('downgrades AX evidence with unavailable enabled state while preserving provider role', () => {
    const axSnapshot: AXSnapshot = {
      snapshotId: 'ax-enabled-missing',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-14T00:00:00.000Z',
      maxDepth: 5,
      truncated: false,
      root: {
        uid: 'root',
        role: 'AXApplication',
        children: [{
          uid: 'btn-enabled-missing',
          role: 'AXButton',
          title: 'Continue',
          bounds: { x: 120, y: 160, width: 180, height: 44 },
          children: [],
        }],
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
    assert.equal(node.kind, 'ax_evidence')
    assert.equal(downstreamActionableKinds.has(node.kind), false)
    assert.equal(node.recognized_item_kind, 'AXButton')
    assert.equal(node.detail.ax_role, 'AXButton')
    assert.equal(node.detail.enabled, undefined)
    assert.ok((node.detail.known_limits as string[]).includes('AX provider enabled unavailable/uncertain'))
    assert.equal(validSurfaceBox(node.box), true)
  })

  it('downgrades disabled AX evidence while preserving provider role and known_limit', () => {
    const axSnapshot: AXSnapshot = {
      snapshotId: 'ax-disabled',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-14T00:00:00.000Z',
      maxDepth: 5,
      truncated: false,
      root: {
        uid: 'root',
        role: 'AXApplication',
        children: [{
          uid: 'btn-disabled',
          role: 'AXButton',
          title: 'Disabled continue',
          enabled: false,
          bounds: { x: 120, y: 160, width: 180, height: 44 },
          children: [],
        }],
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
    assert.equal(node.kind, 'ax_evidence')
    assert.equal(downstreamActionableKinds.has(node.kind), false)
    assert.equal(node.recognized_item_kind, 'AXButton')
    assert.equal(node.detail.ax_role, 'AXButton')
    assert.ok((node.detail.known_limits as string[]).includes('AX node reports enabled=false; provider actionability is not clean action truth'))
    assert.equal(validSurfaceBox(node.box), true)
  })

  it('skips AX nodes with invalid bounds instead of emitting invalid boxes', () => {
    const axSnapshot: AXSnapshot = {
      snapshotId: 'ax-invalid',
      pid: 123,
      appName: 'Google Chrome',
      capturedAt: '2026-06-14T00:00:00.000Z',
      maxDepth: 5,
      truncated: false,
      root: {
        uid: 'root',
        role: 'AXApplication',
        children: [{
          uid: 'btn-invalid',
          role: 'AXButton',
          title: 'Invalid',
          enabled: true,
          bounds: { x: Number.NaN, y: 160, width: 0, height: 44 },
          children: [],
        }],
      },
    }

    const nodes = normalizeToSurfaceNodes({
      ocrMatches: [],
      axSnapshot,
      contract,
      runId,
      spanId,
    })

    assert.equal(nodes.length, 0)
    assert.equal(nodes.every(node => validSurfaceBox(node.box)), true)
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

  it('preserves DOM read-only evidence detail with viewport-local and source-global bounds', () => {
    const domObservation: ChromeDomObservation = {
      url: 'https://example.com/jobs',
      title: 'Jobs',
      observedAt: '2026-06-14T00:00:00.000Z',
      visibleText: 'Apply now',
      signals: [],
      elements: [{
        id: 'apply',
        tagName: 'a',
        role: 'link',
        name: 'Apply now',
        text: 'Apply now',
        href: 'https://example.com/apply',
        bounds: { x: 20, y: 30, width: 120, height: 40 },
        center: { x: 80, y: 50 },
        confidence: 0.82,
        actionable: true,
        states: { visited: false },
      }],
    }
    const viewportBounds = { x: 100, y: 80, width: 900, height: 700 }

    const nodes = normalizeToSurfaceNodes({
      ocrMatches: [],
      domObservation,
      contract,
      runId,
      spanId,
      viewportBounds,
      captureArtifact,
      captureContractArtifact,
    })

    assert.equal(nodes.length, 1)
    const node = nodes[0]!
    assert.equal(node.kind, 'dom_link')
    assert.equal(node.label, 'Apply now')
    assert.deepEqual(node.box, { x: 120, y: 110, width: 120, height: 40 })
    assert.deepEqual(node.center, { x: 180, y: 130 })
    assert.deepEqual(node.source_artifacts, ['screenshot_mco_1', 'capture_contract_mco_1'])
    assert.equal(node.detail.dom_role, 'link')
    assert.equal(node.detail.dom_name, 'Apply now')
    assert.equal(node.detail.dom_text, 'Apply now')
    assert.equal(node.detail.tag_name, 'a')
    assert.equal(node.detail.href, 'https://example.com/apply')
    assert.deepEqual(node.detail.states, { visited: false })
    assert.equal(node.detail.provider_actionable, true)
    assert.equal(node.detail.provider_confidence, 0.82)
    assert.deepEqual(node.detail.coordinate_spaces, {
      provider: 'dom_viewport_local_logical',
      projected: 'source_global_logical',
    })
    assert.deepEqual(node.detail.bounds, {
      dom_viewport_local_logical: { x: 20, y: 30, width: 120, height: 40 },
      viewport_offset_logical: { x: 100, y: 80 },
      source_global_logical: { x: 120, y: 110, width: 120, height: 40 },
    })
    assert.deepEqual(node.detail.center, {
      dom_viewport_local_logical: { x: 80, y: 50 },
      source_global_logical: { x: 180, y: 130 },
    })
    assert.deepEqual(node.detail.source_artifacts, {
      capture_artifact: captureArtifact,
      capture_contract_artifact: captureContractArtifact,
    })
    assert.deepEqual(node.detail.known_limits, [])
    assert.equal('actionable' in node.detail, false)
  })

  it('downgrades DOM evidence when provider reports not actionable while preserving provider role', () => {
    const domObservation: ChromeDomObservation = {
      url: 'https://example.com/jobs',
      title: 'Jobs',
      observedAt: '2026-06-14T00:00:00.000Z',
      visibleText: 'Apply',
      signals: [],
      elements: [{
        id: 'apply-disabled',
        tagName: 'button',
        role: 'button',
        name: 'Apply',
        text: 'Apply',
        href: null,
        bounds: { x: 20, y: 30, width: 120, height: 40 },
        center: { x: 80, y: 50 },
        confidence: 0.82,
        actionable: false,
        states: {},
      }],
    }
    const viewportBounds = { x: 100, y: 80, width: 900, height: 700 }

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
    assert.equal(node.kind, 'dom_evidence')
    assert.equal(downstreamActionableKinds.has(node.kind), false)
    assert.equal(node.recognized_item_kind, 'button')
    assert.equal(node.detail.dom_role, 'button')
    assert.equal(node.detail.provider_actionable, false)
    assert.ok((node.detail.known_limits as string[]).includes('DOM provider reports actionable=false; provider reports not actionable'))
    assert.equal(validSurfaceBox(node.box), true)
  })

  it('downgrades DOM evidence when provider actionability is unavailable while preserving provider role', () => {
    const domObservation = {
      url: 'https://example.com/jobs',
      title: 'Jobs',
      observedAt: '2026-06-14T00:00:00.000Z',
      visibleText: 'Apply',
      signals: [],
      elements: [{
        id: 'apply-actionability-missing',
        tagName: 'button',
        role: 'button',
        name: 'Apply',
        text: 'Apply',
        href: null,
        bounds: { x: 20, y: 30, width: 120, height: 40 },
        center: { x: 80, y: 50 },
        confidence: 0.82,
        states: {},
      }],
    } as unknown as ChromeDomObservation
    const viewportBounds = { x: 100, y: 80, width: 900, height: 700 }

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
    assert.equal(node.kind, 'dom_evidence')
    assert.equal(downstreamActionableKinds.has(node.kind), false)
    assert.equal(node.recognized_item_kind, 'button')
    assert.equal(node.detail.dom_role, 'button')
    assert.equal(node.detail.provider_actionable, undefined)
    assert.ok((node.detail.known_limits as string[]).includes('DOM provider actionability unavailable/uncertain'))
    assert.equal(validSurfaceBox(node.box), true)
  })

  it('downgrades DOM evidence when provider center is outside bounds and viewport', () => {
    const domObservation: ChromeDomObservation = {
      url: 'https://example.com/jobs',
      title: 'Jobs',
      observedAt: '2026-06-14T00:00:00.000Z',
      visibleText: 'Apply',
      signals: [],
      elements: [{
        id: 'apply-impossible-center',
        tagName: 'button',
        role: 'button',
        name: 'Apply',
        text: 'Apply',
        href: null,
        bounds: { x: 20, y: 30, width: 120, height: 40 },
        center: { x: 9999, y: 9999 },
        confidence: 0.82,
        actionable: true,
        states: {},
      }],
    }
    const viewportBounds = { x: 100, y: 80, width: 900, height: 700 }

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
    assert.equal(node.kind, 'dom_evidence')
    assert.equal(downstreamActionableKinds.has(node.kind), false)
    assert.equal(node.recognized_item_kind, 'button')
    assert.equal(node.detail.dom_role, 'button')
    assert.ok((node.detail.known_limits as string[]).includes('DOM provider center outside bounds or viewport; visibility/actionability uncertain'))
    assert.equal(validSurfaceBox(node.box), true)
  })

  it('marks uncertain DOM evidence limits instead of representing provider actionability as clean truth', () => {
    const domObservation: ChromeDomObservation = {
      url: 'https://example.com/jobs',
      title: 'Jobs',
      observedAt: '2026-06-14T00:00:00.000Z',
      visibleText: 'Hidden apply',
      signals: [],
      elements: [{
        id: 'hidden-apply',
        tagName: 'button',
        role: 'button',
        name: 'Hidden apply',
        text: 'Hidden apply',
        href: null,
        bounds: { x: -260, y: 10, width: 120, height: 40 },
        center: { x: -200, y: 30 },
        confidence: 1.7,
        actionable: true,
        states: { hidden: true, offscreen: true },
      }],
    }
    const viewportBounds = { x: 100, y: 80, width: 900, height: 700 }

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
    assert.equal(downstreamActionableKinds.has(node.kind), false)
    assert.equal(node.kind, 'dom_evidence')
    assert.equal(node.recognized_item_kind, 'button')
    assert.equal(node.detail.dom_role, 'button')
    assert.equal(node.detail.provider_actionable, true)
    assert.equal(node.detail.provider_confidence, 1.7)
    assert.equal('actionable' in node.detail, false)
    assert.ok((node.detail.known_limits as string[]).includes('DOM provider confidence invalid or outside 0..1'))
    assert.ok((node.detail.known_limits as string[]).includes('DOM provider state indicates hidden evidence'))
    assert.ok((node.detail.known_limits as string[]).includes('DOM provider state indicates offscreen evidence'))
    assert.ok((node.detail.known_limits as string[]).includes('DOM provider bounds do not intersect the reported viewport; visibility/actionability uncertain'))
  })

  it('handles invalid or missing DOM geometry fields without throwing or emitting invalid boxes', () => {
    const domObservation = {
      url: 'https://example.com/jobs',
      title: 'Jobs',
      observedAt: '2026-06-14T00:00:00.000Z',
      visibleText: 'Broken apply',
      signals: [],
      elements: [
        {
          id: 'invalid-bounds',
          tagName: 'button',
          role: 'button',
          name: 'Invalid bounds',
          text: 'Invalid bounds',
          href: null,
          bounds: { x: Number.NaN, y: 10, width: 120, height: 40 },
          center: { x: 60, y: 30 },
          confidence: 0.8,
          actionable: true,
          states: {},
        },
        {
          id: 'missing-bounds',
          tagName: 'button',
          role: 'button',
          name: 'Missing bounds',
          text: 'Missing bounds',
          href: null,
          confidence: 0.8,
          actionable: true,
        },
        {
          id: 'missing-center-states',
          tagName: 'button',
          role: 'button',
          name: 'Missing center and states',
          text: 'Missing center and states',
          href: null,
          bounds: { x: 20, y: 30, width: 120, height: 40 },
          confidence: 0.8,
          actionable: true,
        },
      ],
    } as unknown as ChromeDomObservation
    const viewportBounds = { x: 100, y: 80, width: 900, height: 700 }
    let nodes: ReturnType<typeof normalizeToSurfaceNodes> = []

    assert.doesNotThrow(() => {
      nodes = normalizeToSurfaceNodes({
        ocrMatches: [],
        domObservation,
        contract,
        runId,
        spanId,
        viewportBounds,
      })
    })

    assert.equal(nodes.length, 1)
    const node = nodes[0]!
    assert.equal(validSurfaceBox(node.box), true)
    assert.equal(node.kind, 'dom_evidence')
    assert.equal(downstreamActionableKinds.has(node.kind), false)
    assert.equal(node.recognized_item_kind, 'button')
    assert.equal(node.center, undefined)
    assert.ok((node.detail.known_limits as string[]).includes('DOM provider center missing or invalid'))
  })

  it('downgrades DOM evidence with invalid viewport bounds without emitting invalid boxes', () => {
    const domObservation: ChromeDomObservation = {
      url: 'https://example.com/jobs',
      title: 'Jobs',
      observedAt: '2026-06-14T00:00:00.000Z',
      visibleText: 'Apply',
      signals: [],
      elements: [{
        id: 'apply',
        tagName: 'button',
        role: 'button',
        name: 'Apply',
        text: 'Apply',
        href: null,
        bounds: { x: 20, y: 30, width: 120, height: 40 },
        center: { x: 80, y: 50 },
        confidence: 0.8,
        actionable: true,
        states: {},
      }],
    }
    const invalidViewportBounds = { x: Number.NaN, y: 80, width: 900, height: 700 }

    const nodes = normalizeToSurfaceNodes({
      ocrMatches: [],
      domObservation,
      contract,
      runId,
      spanId,
      viewportBounds: invalidViewportBounds,
    })

    assert.equal(nodes.length, 1)
    const node = nodes[0]!
    assert.equal(validSurfaceBox(node.box), true)
    assert.deepEqual(node.box, { x: 20, y: 30, width: 120, height: 40 })
    assert.equal(node.kind, 'dom_evidence')
    assert.equal(downstreamActionableKinds.has(node.kind), false)
    assert.ok((node.detail.known_limits as string[]).includes('DOM viewport bounds unavailable; source-global projection assumes zero viewport offset'))
    const detailBounds = node.detail.bounds as { viewport_offset_logical: { x: number, y: number } }
    assert.deepEqual(detailBounds.viewport_offset_logical, { x: 0, y: 0 })
  })

  it('exports only read-only normalization helpers and no DOM, CDP, Playwright, page, or AX action routes', () => {
    const exportedSymbols = Object.keys(surfaceNodeModule).sort()
    assert.deepEqual(exportedSymbols, ['inferObservationSource', 'normalizeToSurfaceNodes'])
    assert.equal(exportedSymbols.some(symbol => /click|press|focus|write|smartPress|playwright|cdp|page|execute|action/i.test(symbol)), false)
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
