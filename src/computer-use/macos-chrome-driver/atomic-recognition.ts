import type { Bounds } from '../types.js'
import type { AtomicFindResult, AtomicMatch } from './atomic-types.js'
import type {
  ArtifactRef,
  ChromeCaptureContract,
  RecognitionBox,
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
