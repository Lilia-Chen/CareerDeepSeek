import { describe, expect, it } from 'vitest'
import { atomicScrollDelta, findBestAXNodeForAtomicAction } from '../../src/computer-use/macos-chrome-driver/atomic-commands.js'
import { matchAtomicItems, projectPixelBoxToLogicalMatch, projectPixelPointToLogical } from '../../src/computer-use/macos-chrome-driver/atomic-recognition.js'
import type { AXNode } from '../../src/computer-use/types.js'
import type { AtomicMatchItem } from '../../src/computer-use/macos-chrome-driver/atomic-recognition.js'
import type { ChromeCaptureContract } from '../../src/computer-use/macos-chrome-driver/types.js'

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

  it('scopes AX matching to the resolved window bounds', () => {
    const root: AXNode = {
      uid: 'root',
      role: 'AXApplication',
      children: [
        {
          uid: 'wrong-window',
          role: 'AXTextField',
          title: 'Search',
          bounds: { x: 900, y: 100, width: 80, height: 20 },
          children: [],
        },
        {
          uid: 'current-window',
          role: 'AXTextField',
          title: 'Search',
          bounds: { x: 120, y: 220, width: 80, height: 20 },
          children: [],
        },
      ],
    }

    const match = findBestAXNodeForAtomicAction(
      root,
      'Search',
      new Set(['AXTextField']),
      { x: 100, y: 200, width: 500, height: 300 },
    )

    expect(match?.uid).toBe('current-window')
  })

  it('maps scroll directions with AUV-compatible signs', () => {
    expect(atomicScrollDelta('down', 4)).toEqual({ x: 0, y: -400 })
    expect(atomicScrollDelta('up', 4)).toEqual({ x: 0, y: 400 })
    expect(atomicScrollDelta('left', 4)).toEqual({ x: 400, y: 0 })
    expect(atomicScrollDelta('right', 4)).toEqual({ x: -400, y: 0 })
  })
})
