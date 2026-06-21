import type { Bounds } from '../types.js'
import type { AtomicCrossSourceAudit, AtomicFindResult, AtomicMatch } from './atomic-types.js'
import type {
  ArtifactRef,
  ChromeCaptureContract,
  RecognitionBox,
  SurfaceNode,
} from './types.js'

export type AtomicRecognitionTarget
  = | {
    kind: 'text_input'
    name: string | RegExp
  }
  | {
    kind: 'button'
    text: string | RegExp
  }
  | {
    kind: 'link'
    text: string | RegExp
  }
  | {
    kind: 'visible_text'
    text: string | RegExp
  }
  | {
    kind: 'ocr_text'
    text: string | RegExp
  }
  | {
    kind: 'ocr_row'
    text: string | RegExp
  }

export interface AtomicMatchItem {
  itemId: string
  kind: string
  box: RecognitionBox
  text?: string
  providerScore?: number
  detail: Record<string, unknown>
}

const TEXT_INPUT_KINDS: ReadonlySet<string> = new Set([
  'dom_textbox',
  'dom_searchbox',
  'dom_combobox',
  'ax_textfield',
  'ax_textarea',
  'ax_combobox',
])

const BUTTON_KINDS: ReadonlySet<string> = new Set([
  'dom_button',
  'ax_button',
])

const LINK_KINDS: ReadonlySet<string> = new Set([
  'dom_link',
  'ax_link',
])

export function matchAtomicItems(
  items: AtomicMatchItem[],
  target: AtomicRecognitionTarget,
  evidence: ArtifactRef[] = [],
  knownLimits: string[] = [],
): AtomicFindResult {
  const matches = items
    .filter(item => itemMatchesTarget(item, target))
    .sort(compareAtomicItem)
    .map((item, matchIndex): AtomicMatch => {
      const box = item.box
      return {
        kind: item.kind,
        text: item.text ?? '',
        box,
        confidence: item.providerScore ?? 0,
        logicalPoint: centerOf(box),
        matchIndex,
        detail: item.detail,
      }
    })

  return {
    found: matches.length > 0,
    recognitionId: `atomic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    matchCount: matches.length,
    best: matches[0],
    matches,
    evidence,
    knownLimits,
  }
}

export function projectPixelBoxToLogicalMatch(input: {
  kind: string
  text: string
  confidence: number
  matchIndex: number
  pixelBox: Bounds
  contract: ChromeCaptureContract
  detail?: Record<string, unknown>
}): AtomicMatch {
  const box = projectPixelBoxToLogical(input.pixelBox, input.contract)
  return {
    kind: input.kind,
    text: input.text,
    box,
    normalizedBox: normalizeBoxToWindow(box, input.contract.sourceGlobalLogicalBounds),
    confidence: input.confidence,
    logicalPoint: centerOf(box),
    matchIndex: input.matchIndex,
    detail: {
      ...input.detail,
      rawPixelBox: input.pixelBox,
    },
  }
}

export function projectPixelBoxToLogical(
  box: Bounds,
  contract: ChromeCaptureContract,
): RecognitionBox {
  const origin = projectPixelPointToLogical({ x: box.x, y: box.y }, contract)
  return {
    x: origin.x,
    y: origin.y,
    width: box.width * contract.pixelToLogicalScale.x,
    height: box.height * contract.pixelToLogicalScale.y,
  }
}

export function projectPixelPointToLogical(
  point: { x: number, y: number },
  contract: ChromeCaptureContract,
): { x: number, y: number } {
  return {
    x: contract.sourceGlobalLogicalBounds.x + point.x * contract.pixelToLogicalScale.x,
    y: contract.sourceGlobalLogicalBounds.y + point.y * contract.pixelToLogicalScale.y,
  }
}

export function centerOf(box: RecognitionBox): { x: number, y: number } {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  }
}

export function normalizeBoxToWindow(box: Bounds, windowBounds: Bounds): { left: number, top: number, right: number, bottom: number } {
  return {
    left: (box.x - windowBounds.x) / windowBounds.width,
    top: (box.y - windowBounds.y) / windowBounds.height,
    right: (box.x + box.width - windowBounds.x) / windowBounds.width,
    bottom: (box.y + box.height - windowBounds.y) / windowBounds.height,
  }
}

export function auditSurfaceNodes(nodes: SurfaceNode[]): AtomicCrossSourceAudit {
  const sourceGroups = uniqueStrings(nodes.map(node => atomicSourceGroup(node)))
  const comparedItems = nodes.map((node) => {
    const comparable = nodes.filter(other =>
      other.node_ref.node_id !== node.node_ref.node_id
      && atomicSourceGroup(other) !== atomicSourceGroup(node)
      && boundsIntersect(node.box, other.box))
    const best = comparable
      .map(other => ({ other, overlap: boundsOverlapRatio(node.box, other.box) }))
      .sort((a, b) => b.overlap - a.overlap)[0]

    if (!best) {
      return {
        itemId: node.node_ref.node_id,
        kind: node.kind,
        source: atomicSourceGroup(node),
        status: 'unknown' as const,
        reasons: ['missing_comparable_evidence'],
        knownLimits: nodeKnownLimits(node),
      }
    }

    const relation = nodeRelation(node.box, best.other.box)
    const textStatus = textAgreementStatus(node.label, best.other.label)
    return {
      itemId: node.node_ref.node_id,
      kind: node.kind,
      source: atomicSourceGroup(node),
      relation,
      status: textStatus,
      reasons: uniqueStrings([
        relation,
        textStatus === 'agreement' ? 'text_agreement' : textStatus === 'conflict' ? 'text_conflict' : 'insufficient_text_for_agreement',
      ]),
      knownLimits: nodeKnownLimits(node),
    }
  })

  const status = comparedItems.some(item => item.status === 'conflict')
    ? 'conflict'
    : comparedItems.some(item => item.status === 'agreement') && sourceGroups.length > 1
      ? 'agreement'
      : 'unknown'

  return {
    status,
    sourceGroups,
    comparedItems,
    knownLimits: uniqueStrings([
      ...(sourceGroups.length > 1 ? [] : ['single_source_evidence_only']),
      ...ambiguityKnownLimits(nodes),
    ]),
  }
}

export function relatedNodesForBox(nodes: SurfaceNode[], box: Bounds): SurfaceNode[] {
  return nodes
    .filter(node => boundsIntersect(node.box, box))
    .sort((a, b) => boundsOverlapRatio(b.box, box) - boundsOverlapRatio(a.box, box))
    .slice(0, 8)
}

function itemMatchesTarget(item: AtomicMatchItem, target: AtomicRecognitionTarget): boolean {
  if (!kindMatchesTarget(item.kind, target.kind))
    return false

  const query = 'name' in target ? target.name : target.text
  const text = item.text ?? ''
  if (query instanceof RegExp)
    return query.test(text)

  return text.toLowerCase().includes(query.toLowerCase())
}

function kindMatchesTarget(itemKind: string, targetKind: AtomicRecognitionTarget['kind']): boolean {
  switch (targetKind) {
    case 'visible_text':
    case 'ocr_text':
      return itemKind === 'ocr_text'
    case 'ocr_row':
      return itemKind === 'ocr_row'
    case 'text_input':
      return TEXT_INPUT_KINDS.has(itemKind)
    case 'button':
      return BUTTON_KINDS.has(itemKind)
    case 'link':
      return LINK_KINDS.has(itemKind)
  }
}

function compareAtomicItem(a: AtomicMatchItem, b: AtomicMatchItem): number {
  const score = (b.providerScore ?? 0) - (a.providerScore ?? 0)
  if (score !== 0)
    return score

  const dy = a.box.y - b.box.y
  return dy !== 0 ? dy : a.box.x - b.box.x
}

function atomicSourceGroup(node: SurfaceNode): 'ocr_text' | 'ocr_row' | 'ax' | 'chrome_dom' | 'unknown' {
  if (node.kind.startsWith('ax_'))
    return 'ax'
  if (node.kind.startsWith('dom_'))
    return 'chrome_dom'
  if (node.kind === 'ocr_row')
    return 'ocr_row'
  if (node.kind.startsWith('ocr_'))
    return 'ocr_text'
  return 'unknown'
}

function nodeKnownLimits(node: SurfaceNode): string[] {
  const limits = node.detail.known_limits
  return Array.isArray(limits) ? limits.filter((item): item is string => typeof item === 'string') : []
}

function textAgreementStatus(a: string | undefined, b: string | undefined): 'agreement' | 'conflict' | 'unknown' {
  const left = normalizeText(a)
  const right = normalizeText(b)
  if (!left || !right)
    return 'unknown'
  if (left === right || left.includes(right) || right.includes(left))
    return 'agreement'
  return 'conflict'
}

function normalizeText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, ' ').toLowerCase() ?? ''
}

function nodeRelation(candidate: Bounds, other: Bounds): 'same_object' | 'candidate_inside_other' | 'other_inside_candidate' | 'partial_overlap' {
  if (boundsOverlapRatio(candidate, other) >= 0.5)
    return 'same_object'
  if (boundsContains(other, centerOf(candidate)))
    return 'candidate_inside_other'
  if (boundsContains(candidate, centerOf(other)))
    return 'other_inside_candidate'
  return 'partial_overlap'
}

function ambiguityKnownLimits(nodes: SurfaceNode[]): string[] {
  const keys = new Map<string, number>()
  for (const node of nodes) {
    const label = normalizeText(node.label)
    if (!label)
      continue
    const key = `${atomicSourceGroup(node)}:${node.kind}:${label}`
    keys.set(key, (keys.get(key) ?? 0) + 1)
  }
  return [...keys.values()].some(count => count > 1) ? ['multiple_same_label_surface_nodes'] : []
}

function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
}

function boundsOverlapRatio(a: Bounds, b: Bounds): number {
  const intersection = intersectionArea(a, b)
  const smaller = Math.min(a.width * a.height, b.width * b.height)
  return smaller > 0 ? intersection / smaller : 0
}

function boundsContains(bounds: Bounds, point: { x: number, y: number }): boolean {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height
}

function intersectionArea(a: Bounds, b: Bounds): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(value => value.trim().length > 0))]
}
