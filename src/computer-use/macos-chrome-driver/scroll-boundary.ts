import type { AXNode, AXSnapshot, Bounds, ChromeDomObservation } from '../types.js'
import type { ArtifactRef } from './types.js'
import type { ChromeWindowRegionMap } from './chrome-window-regions.js'
import { uniqueStrings } from './shared.js'

export type ChromeScrollBoundaryBasis
  = | 'dom_scroll_metrics'
    | 'ax_scroll_value'
    | 'post_scroll_delta'
    | 'screenshot_diff'
    | 'unknown'

export interface ChromeScrollBoundary {
  api_version: 'careerdeepseek.scroll_boundary.v1alpha1'
  axis: 'vertical'
  scrollTop?: number
  scrollHeight?: number
  viewportHeight?: number
  viewportWidth?: number
  scrollLeft?: number
  scrollWidth?: number
  canScrollUp: boolean | 'unknown'
  canScrollDown: boolean | 'unknown'
  atTop: boolean | 'unknown'
  atBottom: boolean | 'unknown'
  basis: ChromeScrollBoundaryBasis[]
  confidence: 'verified' | 'heuristic' | 'unknown'
  knownLimits: string[]
}

export interface ChromeScrollProgress {
  changed: boolean | 'unknown'
  boundaryReached: boolean | 'unknown'
  direction?: 'up' | 'down'
  delta?: number
  knownLimits: string[]
}

export function buildChromeScrollBoundary(input: {
  axSnapshot?: AXSnapshot
  domObservation?: ChromeDomObservation | null
  regionMap?: ChromeWindowRegionMap
  sourceArtifacts?: ArtifactRef[]
}): ChromeScrollBoundary {
  const dom = domBoundary(input.domObservation)
  const ax = axBoundary(input.axSnapshot, input.regionMap?.pageViewport?.bounds)
  const axUnavailableKnownLimit = input.axSnapshot
    ? 'macos_ax_bridge_does_not_expose_chrome_page_scroll_offsets'
    : 'ax_scroll_evidence_unavailable'
  const knownLimits = uniqueStrings([
    ...(dom?.knownLimits ?? ['dom_scroll_metrics_unavailable']),
    ...(ax?.knownLimits ?? [axUnavailableKnownLimit]),
    ...conflictKnownLimits(dom, ax),
  ])

  if (dom) {
    return {
      ...dom,
      basis: uniqueBasis([...dom.basis, ...(ax ? ax.basis : [])]),
      confidence: ax && conflictKnownLimits(dom, ax).length === 0 ? 'verified' : dom.confidence,
      knownLimits,
    }
  }

  if (ax) {
    return {
      ...ax,
      knownLimits,
    }
  }

  return {
    api_version: 'careerdeepseek.scroll_boundary.v1alpha1',
    axis: 'vertical',
    canScrollUp: 'unknown',
    canScrollDown: 'unknown',
    atTop: 'unknown',
    atBottom: 'unknown',
    basis: ['unknown'],
    confidence: 'unknown',
    knownLimits,
  }
}

export function compareChromeScrollBoundaries(input: {
  before?: ChromeScrollBoundary
  after?: ChromeScrollBoundary
  direction: 'up' | 'down'
}): ChromeScrollProgress {
  const beforeTop = input.before?.scrollTop
  const afterTop = input.after?.scrollTop
  const delta = Number.isFinite(beforeTop) && Number.isFinite(afterTop)
    ? afterTop! - beforeTop!
    : undefined
  const changed = Number.isFinite(delta) ? Math.abs(delta!) > 1 : 'unknown'
  const boundaryReached = input.direction === 'down'
    ? input.after?.atBottom ?? 'unknown'
    : input.after?.atTop ?? 'unknown'
  return {
    changed,
    boundaryReached,
    direction: input.direction,
    delta,
    knownLimits: uniqueStrings([
      ...(!input.before ? ['scroll_boundary_before_unavailable'] : []),
      ...(!input.after ? ['scroll_boundary_after_unavailable'] : []),
      ...(changed === 'unknown' ? ['scroll_delta_unavailable'] : []),
      ...(boundaryReached === 'unknown' ? ['scroll_boundary_after_side_unknown'] : []),
    ]),
  }
}

function domBoundary(domObservation: ChromeDomObservation | null | undefined): ChromeScrollBoundary | undefined {
  const viewport = domObservation?.viewport
  if (!viewport)
    return undefined

  const scrollTop = finiteOrUndefined(viewport.scrollY)
  const scrollLeft = finiteOrUndefined(viewport.scrollX)
  const scrollHeight = finiteOrUndefined(viewport.scrollHeight)
  const viewportHeight = finiteOrUndefined(viewport.clientHeight) ?? finiteOrUndefined(viewport.height)
  const scrollWidth = finiteOrUndefined(viewport.scrollWidth)
  const viewportWidth = finiteOrUndefined(viewport.clientWidth) ?? finiteOrUndefined(viewport.width)
  const maxScrollTop = Number.isFinite(scrollHeight) && Number.isFinite(viewportHeight)
    ? Math.max(0, scrollHeight! - viewportHeight!)
    : undefined
  const atTop = Number.isFinite(scrollTop) ? scrollTop! <= 1 : 'unknown'
  const atBottom = Number.isFinite(scrollTop) && Number.isFinite(maxScrollTop)
    ? scrollTop! >= maxScrollTop! - 1
    : 'unknown'

  return {
    api_version: 'careerdeepseek.scroll_boundary.v1alpha1',
    axis: 'vertical',
    scrollTop,
    scrollHeight,
    viewportHeight,
    viewportWidth,
    scrollLeft,
    scrollWidth,
    canScrollUp: atTop === 'unknown' ? 'unknown' : !atTop,
    canScrollDown: atBottom === 'unknown' ? 'unknown' : !atBottom,
    atTop,
    atBottom,
    basis: ['dom_scroll_metrics'],
    confidence: Number.isFinite(scrollTop) && Number.isFinite(maxScrollTop) ? 'verified' : 'heuristic',
    knownLimits: uniqueStrings([
      ...(viewport.knownLimits ?? []),
      ...(!Number.isFinite(scrollTop) ? ['dom_scroll_top_unavailable'] : []),
      ...(!Number.isFinite(scrollHeight) ? ['dom_scroll_height_unavailable'] : []),
      ...(!Number.isFinite(viewportHeight) ? ['dom_viewport_height_unavailable'] : []),
    ]),
  }
}

function axBoundary(axSnapshot: AXSnapshot | undefined, pageViewport?: Bounds): ChromeScrollBoundary | undefined {
  if (!axSnapshot)
    return undefined

  const evidence = collectAXScrollEvidence(axSnapshot.root)
    .filter(item => item.node.role === 'AXScrollBar')
    .filter(item => item.node.scroll?.orientation !== 'horizontal')
    .filter(item => hasCompleteNumericScrollBarEvidence(item.node))
    .sort((a, b) => axScrollRank(b.node, pageViewport) - axScrollRank(a.node, pageViewport))[0]
  const scroll = evidence?.node.scroll
  if (!scroll)
    return undefined

  const value = finiteOrUndefined(scroll.value)
  const min = finiteOrUndefined(scroll.min_value)
  const max = finiteOrUndefined(scroll.max_value)
  const atTop = Number.isFinite(value) && Number.isFinite(min) ? value! <= min! + 0.01 : 'unknown'
  const atBottom = Number.isFinite(value) && Number.isFinite(max) ? value! >= max! - 0.01 : 'unknown'

  return {
    api_version: 'careerdeepseek.scroll_boundary.v1alpha1',
    axis: 'vertical',
    scrollTop: value,
    canScrollUp: atTop === 'unknown' ? 'unknown' : !atTop,
    canScrollDown: atBottom === 'unknown' ? 'unknown' : !atBottom,
    atTop,
    atBottom,
    basis: ['ax_scroll_value'],
    confidence: Number.isFinite(value) && Number.isFinite(min) && Number.isFinite(max) ? 'heuristic' : 'unknown',
    knownLimits: uniqueStrings([
      ...(scroll.known_limits ?? []),
      ...(!Number.isFinite(value) ? ['ax_scroll_value_missing'] : []),
      ...(!Number.isFinite(max) ? ['ax_scroll_max_missing'] : []),
      'ax_scroll_value_may_be_normalized_or_provider_specific',
    ]),
  }
}

function conflictKnownLimits(
  dom: ChromeScrollBoundary | undefined,
  ax: ChromeScrollBoundary | undefined,
): string[] {
  if (!dom || !ax)
    return []
  const limits: string[] = []
  if (dom.atTop !== 'unknown' && ax.atTop !== 'unknown' && dom.atTop !== ax.atTop)
    limits.push('dom_ax_scroll_top_disagree')
  if (dom.atBottom !== 'unknown' && ax.atBottom !== 'unknown' && dom.atBottom !== ax.atBottom)
    limits.push('dom_ax_scroll_bottom_disagree')
  return limits
}

function collectAXScrollEvidence(root: AXNode): Array<{ node: AXNode }> {
  const nodes: Array<{ node: AXNode }> = []
  walkAX(root, (node) => {
    if (node.scroll)
      nodes.push({ node })
  })
  return nodes
}

function axScrollRank(node: AXNode, pageViewport: Bounds | undefined): number {
  let rank = 0
  if (node.role === 'AXScrollBar')
    rank += 2
  if (pageViewport && node.bounds && boundsOverlapRatio(node.bounds, pageViewport) > 0.5)
    rank += 5
  return rank
}

function hasCompleteNumericScrollBarEvidence(node: AXNode): boolean {
  const scroll = node.scroll
  return node.role === 'AXScrollBar'
    && Number.isFinite(finiteOrUndefined(scroll?.value))
    && Number.isFinite(finiteOrUndefined(scroll?.min_value))
    && Number.isFinite(finiteOrUndefined(scroll?.max_value))
}

function boundsOverlapRatio(a: Bounds, b: Bounds): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  if (x2 <= x1 || y2 <= y1)
    return 0
  return ((x2 - x1) * (y2 - y1)) / Math.max(1, a.width * a.height)
}

function walkAX(node: AXNode, visit: (node: AXNode) => void): void {
  visit(node)
  for (const child of node.children)
    walkAX(child, visit)
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function uniqueBasis(values: ChromeScrollBoundaryBasis[]): ChromeScrollBoundaryBasis[] {
  return [...new Set(values)]
}
