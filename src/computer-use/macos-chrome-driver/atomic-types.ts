import type { ArtifactRef, RecognitionBox } from './types.js'

export interface AtomicMatch {
  kind: string
  text: string
  box: RecognitionBox
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
  evidence: ArtifactRef[]
  knownLimits: string[]
}

export interface AtomicClickResult {
  clicked: AtomicMatch & {
    anchorOffset: { x: number, y: number }
  }
  evidence: ArtifactRef[]
  knownLimits: string[]
}

export interface AtomicRowsResult {
  found: boolean
  recognitionId: string
  rowCount: number
  rows: AtomicMatch[]
  evidence: ArtifactRef[]
  knownLimits: string[]
}

export interface AtomicTypeTextResult {
  typed: {
    textLength: number
    submitKey: string | null
  }
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
