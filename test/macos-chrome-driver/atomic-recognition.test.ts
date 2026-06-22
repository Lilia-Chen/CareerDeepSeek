import { describe, expect, it } from 'vitest'
import { atomicScrollDelta } from '../../src/computer-use/macos-chrome-driver/chrome-command-sub-workflow.js'
import { auditSurfaceNodes, matchAtomicItems, projectPixelBoxToLogicalMatch, projectPixelPointToLogical } from '../../src/computer-use/macos-chrome-driver/atomic-recognition.js'
import type { AtomicMatchItem } from '../../src/computer-use/macos-chrome-driver/atomic-recognition.js'
import type { ChromeCaptureContract, SurfaceNode } from '../../src/computer-use/macos-chrome-driver/types.js'

const contract: ChromeCaptureContract = {
  coordinateContractVersion: 1,
  captureSource: {
    kind: 'window',
    windowNumber: 10,
    ownerPid: 123,
    ownerBundleId: 'com.google.Chrome',
  },
  sourceGlobalLogicalBounds: { x: 100, y: 200, width: 500, height: 300 },
  screenshotPixelSize: { width: 1000, height: 600 },
  pixelToLogicalScale: { x: 0.5, y: 0.5 },
  logicalToPixelScale: { x: 2, y: 2 },
  capturedAt: '2026-06-20T00:00:00.000Z',
}

describe('atomic recognition helpers', () => {
  it('returns completed-style no-match data without throwing', () => {
    const items: AtomicMatchItem[] = [{
      itemId: 'ocr_0',
      kind: 'ocr_text',
      text: 'Other',
      box: { x: 1, y: 1, width: 10, height: 10 },
      providerScore: 0.9,
      detail: {},
    }]

    const result = matchAtomicItems(items, { kind: 'ocr_text', text: 'LangChain' })

    expect(result.found).toBe(false)
    expect(result.matchCount).toBe(0)
    expect(result.matches).toEqual([])
  })

  it('projects OCR pixel bounds to global logical coordinates exactly once', () => {
    const match = projectPixelBoxToLogicalMatch({
      kind: 'ocr_text',
      text: 'LangChain',
      confidence: 0.9,
      matchIndex: 0,
      pixelBox: { x: 20, y: 40, width: 100, height: 60 },
      contract,
    })

    expect(match.box).toEqual({ x: 110, y: 220, width: 50, height: 30 })
    expect(match.logicalPoint).toEqual({ x: 135, y: 235 })
  })

  it('projects anchor offsets as capture pixel offsets before logical conversion', () => {
    const pixelCenter = { x: 70, y: 70 }
    const pixelAnchorOffset = { x: 8, y: -2 }
    const logicalPoint = projectPixelPointToLogical({
      x: pixelCenter.x + pixelAnchorOffset.x,
      y: pixelCenter.y + pixelAnchorOffset.y,
    }, contract)

    expect(logicalPoint).toEqual({ x: 139, y: 234 })
  })

  it('maps scroll directions with AUV-compatible signs', () => {
    expect(atomicScrollDelta('down', 4)).toEqual({ x: 0, y: -400 })
    expect(atomicScrollDelta('up', 4)).toEqual({ x: 0, y: 400 })
    expect(atomicScrollDelta('left', 4)).toEqual({ x: 400, y: 0 })
    expect(atomicScrollDelta('right', 4)).toEqual({ x: -400, y: 0 })
  })

  it('audits overlapping OCR and AX nodes as agreement when text matches', () => {
    const audit = auditSurfaceNodes([
      surfaceNode('ocr_0', 'ocr_text', 'Submit', { x: 10, y: 10, width: 80, height: 20 }),
      surfaceNode('ax_button_1', 'ax_button', 'Submit', { x: 8, y: 8, width: 90, height: 28 }),
    ])

    expect(audit.status).toBe('agreement')
    expect(audit.sourceGroups).toEqual(expect.arrayContaining(['ocr_text', 'ax']))
    expect(audit.comparedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: 'ocr_0',
        relation: 'same_object',
        status: 'agreement',
        reasons: expect.arrayContaining(['text_agreement']),
      }),
    ]))
  })

  it('audits overlapping OCR and DOM nodes as conflict when text disagrees', () => {
    const audit = auditSurfaceNodes([
      surfaceNode('ocr_0', 'ocr_text', 'Delete', { x: 10, y: 10, width: 80, height: 20 }),
      surfaceNode('dom_1', 'dom_button', 'Submit', { x: 8, y: 8, width: 90, height: 28 }),
    ])

    expect(audit.status).toBe('conflict')
    expect(audit.comparedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: 'ocr_0',
        status: 'conflict',
        reasons: expect.arrayContaining(['text_conflict']),
      }),
    ]))
  })
})

function surfaceNode(nodeId: string, kind: string, label: string, box: SurfaceNode['box']): SurfaceNode {
  return {
    node_ref: { run_id: 'run_test', span_id: 'span_test', node_id: nodeId },
    kind,
    label,
    box,
    source_artifacts: [],
    recognition_source: kind.startsWith('dom_') ? 'chrome_dom' : kind.startsWith('ocr_') ? 'ocr_text' : 'custom',
    provider_score: 0.9,
    detail: { known_limits: [] },
  }
}
