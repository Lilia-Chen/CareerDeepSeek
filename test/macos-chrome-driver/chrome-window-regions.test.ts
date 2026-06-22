import { describe, expect, it } from 'vitest'
import { buildChromeWindowRegionMap, classifyChromeWindowRegion, viewportOcrRegionRatio } from '../../src/computer-use/macos-chrome-driver/chrome-window-regions.js'
import type { AXNode, Bounds } from '../../src/computer-use/types.js'

const windowBounds: Bounds = { x: 100, y: 200, width: 800, height: 600 }

function axRoot(children: AXNode[]): AXNode {
  return {
    uid: 'window',
    role: 'AXWindow',
    bounds: windowBounds,
    children,
  }
}

describe('chrome window regions', () => {
  it('derives page_viewport from AXWebArea and classifies outside evidence as browser_chrome', () => {
    const regionMap = buildChromeWindowRegionMap({
      windowBounds,
      axRoot: axRoot([{
        uid: 'web',
        role: 'AXWebArea',
        bounds: { x: 100, y: 260, width: 800, height: 540 },
        children: [],
      }]),
    })

    expect(regionMap.pageViewport?.bounds).toEqual({ x: 100, y: 260, width: 800, height: 540 })
    expect(regionMap.regions.filter(region => region.region === 'browser_chrome')).toEqual([
      expect.objectContaining({
        bounds: { x: 100, y: 200, width: 800, height: 60 },
      }),
    ])
    expect(regionMap.regions.find(region => region.region === 'browser_chrome')?.bounds).not.toEqual(windowBounds)
    expect(classifyChromeWindowRegion({
      regionMap,
      box: { x: 140, y: 320, width: 100, height: 30 },
    })).toMatchObject({ region: 'page_viewport', confidence: 'verified' })
    expect(classifyChromeWindowRegion({
      regionMap,
      box: { x: 140, y: 220, width: 100, height: 30 },
    })).toMatchObject({ region: 'browser_chrome', confidence: 'inferred' })
  })

  it('does not invent a full-window page viewport when AXWebArea is missing', () => {
    const regionMap = buildChromeWindowRegionMap({
      windowBounds,
      axRoot: axRoot([]),
    })

    expect(regionMap.pageViewport).toBeUndefined()
    expect(regionMap.knownLimits).toContain('page_viewport_unavailable_no_valid_ax_web_area')
    expect(classifyChromeWindowRegion({
      regionMap,
      box: { x: 140, y: 320, width: 100, height: 30 },
    })).toMatchObject({ region: 'unknown', confidence: 'unknown' })
  })

  it('converts viewport bounds into capture-relative OCR region ratios', () => {
    expect(viewportOcrRegionRatio({
      viewportBounds: { x: 100, y: 260, width: 800, height: 540 },
      sourceGlobalLogicalBounds: windowBounds,
    })).toEqual({
      left: 0,
      top: 0.1,
      right: 1,
      bottom: 1,
    })
  })
})
