import type { ArtifactRef, RecognitionBox, SurfaceNode } from './types.js'

export interface AtomicCrossSourceAudit {
  status: 'agreement' | 'conflict' | 'unknown'
  sourceGroups: string[]
  comparedItems: Array<{
    itemId: string
    kind: string
    source: string
    relation?: 'same_object' | 'candidate_inside_other' | 'other_inside_candidate' | 'partial_overlap'
    status: 'agreement' | 'conflict' | 'unknown'
    reasons: string[]
    knownLimits: string[]
  }>
  knownLimits: string[]
}

export interface AtomicMatch {
  kind: string
  text: string
  box: RecognitionBox
  normalizedBox?: AtomicTargetHint
  confidence: number
  logicalPoint: { x: number, y: number }
  matchIndex: number
  detail?: Record<string, unknown>
}

export interface AtomicFindResult {
  found: boolean
  recognitionId: string
  matchCount: number
  best?: AtomicMatch
  matches: AtomicMatch[]
  nodes?: SurfaceNode[]
  audit?: AtomicCrossSourceAudit
  evidence: ArtifactRef[]
  knownLimits: string[]
}

export interface AtomicWaitForTextResult {
  found: boolean
  query: string
  elapsedMs: number
  pollCount: number
  best?: AtomicMatch
  matches: AtomicMatch[]
  nodes?: SurfaceNode[]
  audit?: AtomicCrossSourceAudit
  evidence: ArtifactRef[]
  knownLimits: string[]
}

export interface AtomicClickResult {
  clicked: AtomicMatch & {
    anchorOffset: { x: number, y: number }
  }
  candidates?: AtomicTargetCandidate[]
  evidence: ArtifactRef[]
  knownLimits: string[]
}

export type AtomicClickTargetKind = 'text' | 'button' | 'link' | 'menuitem' | 'any'

export interface AtomicTargetHint {
  left: number
  top: number
  right: number
  bottom: number
}

export interface AtomicTargetCandidate {
  kind: string
  label: string
  box: RecognitionBox
  normalizedBox: AtomicTargetHint
  sourceTier: 'interactive_ax' | 'actionable_dom' | 'ocr_only'
  sourceSummary: string[]
  inputCapable: boolean
  targetable: boolean
  providerScore: number
  evidenceRefs: ArtifactRef[]
  detail?: Record<string, unknown>
}

export interface AtomicTypeTextResult {
  typed: {
    textLength: number
    submitKey: string | null
    target?: AtomicMatch
    inputMode: 'replace'
  }
  candidates?: AtomicTargetCandidate[]
  evidence: ArtifactRef[]
  knownLimits: string[]
}

export interface AtomicKeyResult {
  pressed: {
    key: string
    modifiers: string[]
  }
  evidence: ArtifactRef[]
  knownLimits: string[]
}

export interface AtomicScrollRegionResult {
  scrolled: {
    direction: string
    amount: number
    logicalPoint: { x: number, y: number }
    region: { left: number, top: number, right: number, bottom: number }
  }
  evidence: ArtifactRef[]
  knownLimits: string[]
}
