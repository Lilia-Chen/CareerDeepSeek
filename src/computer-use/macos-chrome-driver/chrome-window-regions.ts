import type { AXNode, Bounds } from '../types.js'
import type { OcrRegionRatio } from './types.js'

export type ChromeWindowRegion = 'page_viewport' | 'browser_chrome' | 'unknown'
export type ChromeObservationScope = 'all' | 'viewport' | 'browser_chrome'
export type ChromeRegionConfidence = 'verified' | 'inferred' | 'fallback' | 'unknown'
export type ChromeRegionSource = 'ax_structure' | 'geometry' | 'mixed' | 'fallback'

export interface ChromeWindowRegionMap {
  windowBounds: Bounds
  pageViewport?: {
    bounds: Bounds
    confidence: 'verified' | 'inferred'
    source: 'ax_web_area' | 'fallback'
    reasons: string[]
  }
  regions: Array<{
    region: ChromeWindowRegion
    bounds: Bounds
    confidence: ChromeRegionConfidence
    source: ChromeRegionSource
    reasons: string[]
  }>
  knownLimits: string[]
}

export interface ChromeWindowRegionClassification {
  region: ChromeWindowRegion
  confidence: ChromeRegionConfidence
  source: ChromeRegionSource
  reasons: string[]
}

const WINDOW_MATCH_TOLERANCE = 8
const MIN_VIEWPORT_WIDTH = 100
const MIN_VIEWPORT_HEIGHT = 100

export function buildChromeWindowRegionMap(input: {
  windowBounds: Bounds
  axRoot?: AXNode
}): ChromeWindowRegionMap {
  const knownLimits: string[] = []
  const regions: ChromeWindowRegionMap['regions'] = []
  const pageViewport = input.axRoot
    ? findPageViewportFromAX(input.axRoot, input.windowBounds)
    : undefined

  if (pageViewport) {
    regions.push({
      region: 'page_viewport',
      bounds: pageViewport,
      confidence: 'verified',
      source: 'ax_structure',
      reasons: ['AXWebArea intersects the resolved Chrome window and satisfies minimum viewport size.'],
    })
    regions.push(...browserChromeRegions(input.windowBounds, pageViewport))
  }
  else {
    knownLimits.push(input.axRoot
      ? 'page_viewport_unavailable_no_valid_ax_web_area'
      : 'page_viewport_unavailable_ax_tree_missing')
    regions.push({
      region: 'unknown',
      bounds: input.windowBounds,
      confidence: 'unknown',
      source: 'fallback',
      reasons: ['No verified AXWebArea viewport was available; page commands must not fall back to the full window.'],
    })
  }

  return {
    windowBounds: input.windowBounds,
    pageViewport: pageViewport
      ? {
          bounds: pageViewport,
          confidence: 'verified',
          source: 'ax_web_area',
          reasons: ['Selected largest valid AXWebArea inside the resolved Chrome window.'],
        }
      : undefined,
    regions,
    knownLimits,
  }
}

export function classifyChromeWindowRegion(input: {
  regionMap: ChromeWindowRegionMap
  box: Bounds
}): ChromeWindowRegionClassification {
  if (!validBounds(input.box)) {
    return {
      region: 'unknown',
      confidence: 'unknown',
      source: 'geometry',
      reasons: ['Evidence bounds are invalid.'],
    }
  }

  if (!boundsIntersect(input.box, input.regionMap.windowBounds)) {
    return {
      region: 'unknown',
      confidence: 'unknown',
      source: 'geometry',
      reasons: ['Evidence bounds do not intersect the resolved Chrome window.'],
    }
  }

  const pageViewport = input.regionMap.pageViewport
  if (!pageViewport) {
    return {
      region: 'unknown',
      confidence: 'unknown',
      source: 'fallback',
      reasons: ['No verified page viewport exists for this Chrome window.'],
    }
  }

  const center = centerOf(input.box)
  if (pointInsideBounds(center, pageViewport.bounds)) {
    return {
      region: 'page_viewport',
      confidence: pageViewport.confidence,
      source: 'ax_structure',
      reasons: ['Evidence center is inside the verified AXWebArea viewport.'],
    }
  }

  return {
    region: 'browser_chrome',
    confidence: 'inferred',
    source: 'geometry',
    reasons: ['Evidence intersects the Chrome window but its center is outside the verified AXWebArea viewport.'],
  }
}

export function filterNodesByChromeObservationScope<T extends { region?: ChromeWindowRegion }>(
  nodes: T[],
  scope: ChromeObservationScope,
): T[] {
  if (scope === 'all')
    return nodes
  const region: ChromeWindowRegion = scope === 'viewport' ? 'page_viewport' : 'browser_chrome'
  return nodes.filter(node => node.region === region)
}

export function parseChromeObservationScope(value: unknown): ChromeObservationScope | undefined {
  if (value === undefined)
    return 'all'
  return value === 'all' || value === 'viewport' || value === 'browser_chrome'
    ? value
    : undefined
}

export function viewportOcrRegionRatio(input: {
  viewportBounds: Bounds
  sourceGlobalLogicalBounds: Bounds
}): OcrRegionRatio {
  const source = input.sourceGlobalLogicalBounds
  const viewport = intersectBounds(input.viewportBounds, source)
  if (!viewport || !validBounds(viewport))
    throw Object.assign(new Error('Verified page viewport does not intersect the capture source bounds.'), { code: 'page_viewport_crop_unavailable' })
  return {
    left: clamp01((viewport.x - source.x) / source.width),
    top: clamp01((viewport.y - source.y) / source.height),
    right: clamp01((viewport.x + viewport.width - source.x) / source.width),
    bottom: clamp01((viewport.y + viewport.height - source.y) / source.height),
  }
}

export function requirePageViewport(regionMap: ChromeWindowRegionMap): Bounds {
  const viewport = regionMap.pageViewport?.bounds
  if (!viewport)
    throw Object.assign(new Error('Verified Chrome page viewport is unavailable; refusing to target the full Chrome window.'), { code: 'page_viewport_unavailable' })
  return viewport
}

function findPageViewportFromAX(root: AXNode, windowBounds: Bounds): Bounds | undefined {
  const windowRoot = collectAXWindows(root)
    .find(node => node.bounds && boundsNear(node.bounds, windowBounds))
    ?? (root.role === 'AXWindow' && root.bounds && boundsNear(root.bounds, windowBounds) ? root : undefined)
  if (!windowRoot)
    return undefined

  return collectAXWebAreas(windowRoot)
    .map(node => node.bounds ? intersectBounds(node.bounds, windowBounds) : undefined)
    .filter((bounds): bounds is Bounds => validViewportBounds(bounds))
    .sort((a, b) => areaOfBounds(b) - areaOfBounds(a))[0]
}

function collectAXWindows(root: AXNode): AXNode[] {
  const windows: AXNode[] = []
  walkAX(root, (node) => {
    if (node.role === 'AXWindow')
      windows.push(node)
  })
  return windows
}

function collectAXWebAreas(root: AXNode): AXNode[] {
  const webAreas: AXNode[] = []
  walkAX(root, (node) => {
    if (node.role === 'AXWebArea')
      webAreas.push(node)
  })
  return webAreas
}

function walkAX(node: AXNode, visit: (node: AXNode) => void): void {
  visit(node)
  for (const child of node.children)
    walkAX(child, visit)
}

function validViewportBounds(bounds: Bounds | undefined): bounds is Bounds {
  return validBounds(bounds)
    && bounds.width >= MIN_VIEWPORT_WIDTH
    && bounds.height >= MIN_VIEWPORT_HEIGHT
}

function validBounds(bounds: Bounds | undefined): bounds is Bounds {
  return bounds !== undefined
    && Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width > 0
    && bounds.height > 0
}

function boundsNear(a: Bounds, b: Bounds): boolean {
  return Math.abs(a.x - b.x) <= WINDOW_MATCH_TOLERANCE
    && Math.abs(a.y - b.y) <= WINDOW_MATCH_TOLERANCE
    && Math.abs(a.width - b.width) <= WINDOW_MATCH_TOLERANCE
    && Math.abs(a.height - b.height) <= WINDOW_MATCH_TOLERANCE
}

function intersectBounds(a: Bounds, b: Bounds): Bounds | undefined {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  if (x2 <= x1 || y2 <= y1)
    return undefined
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

function browserChromeRegions(windowBounds: Bounds, pageViewport: Bounds): ChromeWindowRegionMap['regions'] {
  const regions: ChromeWindowRegionMap['regions'] = []
  const top = pageViewport.y - windowBounds.y
  const bottomY = pageViewport.y + pageViewport.height
  const bottom = windowBounds.y + windowBounds.height - bottomY
  const left = pageViewport.x - windowBounds.x
  const rightX = pageViewport.x + pageViewport.width
  const right = windowBounds.x + windowBounds.width - rightX
  const common = {
    region: 'browser_chrome' as const,
    confidence: 'inferred' as const,
    source: 'mixed' as const,
    reasons: ['P2.1 treats resolved Chrome-window evidence outside AXWebArea as coarse browser_chrome.'],
  }
  if (top > 0) {
    regions.push({
      ...common,
      bounds: { x: windowBounds.x, y: windowBounds.y, width: windowBounds.width, height: top },
    })
  }
  if (bottom > 0) {
    regions.push({
      ...common,
      bounds: { x: windowBounds.x, y: bottomY, width: windowBounds.width, height: bottom },
    })
  }
  if (left > 0) {
    regions.push({
      ...common,
      bounds: { x: windowBounds.x, y: pageViewport.y, width: left, height: pageViewport.height },
    })
  }
  if (right > 0) {
    regions.push({
      ...common,
      bounds: { x: rightX, y: pageViewport.y, width: right, height: pageViewport.height },
    })
  }
  return regions
}

function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
}

function pointInsideBounds(point: { x: number, y: number }, bounds: Bounds): boolean {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height
}

function centerOf(bounds: Bounds): { x: number, y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

function areaOfBounds(bounds: Bounds): number {
  return bounds.width * bounds.height
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
