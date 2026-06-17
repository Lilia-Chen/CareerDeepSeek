import type { Bounds } from '../types.js'
import type { ArtifactRef, ObservationSnapshot } from './types.js'

export type ScrollBoundaryAxis = 'vertical'
export type ScrollBoundarySide = 'top' | 'bottom'
export type ScrollBoundaryState = 'unknown' | 'possible_boundary' | 'at_boundary' | 'not_at_boundary'
export type ScrollBoundaryConfidence = 'unknown' | 'heuristic' | 'corroborated'
export type ScrollBoundaryBasis
  = | 'ax_scrollbar_value'
    | 'ax_scrollarea_value'
    | 'ax_webarea_scroll_value'
    | 'ordinary_observe_default'
    | 'single_step_no_visible_change'
    | 'single_step_changed'
    | 'single_step_unknown'
    | 'ax_scroll_evidence_unavailable'
    | 'ax_scroll_evidence_incomplete'

export interface ScrollBoundaryEvidenceRef {
  source: 'ax_tree' | 'single_step_scroll_effect' | 'observation_snapshot'
  basis: ScrollBoundaryBasis
  axis: ScrollBoundaryAxis
  side?: ScrollBoundarySide
  node_ref?: {
    snapshot_id: string
    node_uid: string
    role: string
  }
  ax?: {
    role: string
    orientation?: 'vertical' | 'horizontal' | 'unknown'
    value?: number
    min_value?: number
    max_value?: number
    bounds?: Bounds
    relation?: 'direct' | 'descendant' | 'near_viewport' | 'unknown'
  }
  scroll_effect?: {
    direction: 'up' | 'down'
    effect: 'changed' | 'no_visible_change' | 'unknown'
    reason?: string
  }
  detail?: Record<string, unknown>
}

export interface ScrollBoundarySideClaim {
  state: ScrollBoundaryState
  confidence: ScrollBoundaryConfidence
  basis: ScrollBoundaryBasis[]
  evidence: ScrollBoundaryEvidenceRef[]
  known_limits: string[]
}

export interface ScrollBoundaryObservation {
  api_version: 'careerdeepseek.scroll_boundary.v1alpha1'
  axis: 'vertical'
  vertical: {
    top: ScrollBoundarySideClaim
    bottom: ScrollBoundarySideClaim
  }
  generated_at_millis: number
  capture_contract_ref?: ArtifactRef
  source_artifacts: ArtifactRef[]
  known_limits: string[]
}

interface BuildScrollBoundaryInput {
  generatedAtMillis: number
  captureContractRef?: ArtifactRef
  sourceArtifacts: ArtifactRef[]
}

const SCROLL_BOUNDARY_API_VERSION = 'careerdeepseek.scroll_boundary.v1alpha1'

export function buildScrollBoundaryObservation(input: BuildScrollBoundaryInput): ScrollBoundaryObservation {
  return defaultScrollBoundaryObservation({
    generatedAtMillis: input.generatedAtMillis,
    captureContractRef: input.captureContractRef,
    sourceArtifacts: input.sourceArtifacts,
  })
}

export function cloneObservationWithScrollEffectBoundary(input: {
  snapshot: ObservationSnapshot
  direction: 'up' | 'down'
  effect: 'changed' | 'no_visible_change' | 'unknown'
  reason?: string
  generatedAtMillis: number
}): ObservationSnapshot {
  const snapshot = cloneJson(input.snapshot)
  const boundary = defaultScrollBoundaryObservation({
    generatedAtMillis: input.generatedAtMillis,
    captureContractRef: snapshot.capture_contract_ref,
    sourceArtifacts: snapshot.evidence,
  })

  const side: ScrollBoundarySide = input.direction === 'down' ? 'bottom' : 'top'
  const basis = basisForSingleStepEffect(input.effect)
  boundary.vertical[side] = {
    state: stateForSingleStepEffect(input.effect),
    confidence: confidenceForSingleStepEffect(input.effect),
    basis: [basis],
    evidence: [{
      source: 'single_step_scroll_effect',
      basis,
      axis: 'vertical',
      side,
      scroll_effect: {
        direction: input.direction,
        effect: input.effect,
        reason: input.reason,
      },
    }],
    known_limits: knownLimitsForSingleStepEffect(side, input.effect),
  }

  snapshot.detail = {
    ...snapshot.detail,
    scroll_boundary: boundary,
  }
  return snapshot
}

function basisForSingleStepEffect(effect: 'changed' | 'no_visible_change' | 'unknown'): ScrollBoundaryBasis {
  if (effect === 'changed')
    return 'single_step_changed'
  if (effect === 'no_visible_change')
    return 'single_step_no_visible_change'
  return 'single_step_unknown'
}

function stateForSingleStepEffect(effect: 'changed' | 'no_visible_change' | 'unknown'): ScrollBoundaryState {
  if (effect === 'changed')
    return 'not_at_boundary'
  if (effect === 'no_visible_change')
    return 'at_boundary'
  return 'not_at_boundary'
}

function confidenceForSingleStepEffect(_effect: 'changed' | 'no_visible_change' | 'unknown'): ScrollBoundaryConfidence {
  return 'heuristic'
}

function knownLimitsForSingleStepEffect(
  side: ScrollBoundarySide,
  effect: 'changed' | 'no_visible_change' | 'unknown',
): string[] {
  if (effect === 'unknown')
    return [`single-step scroll effect unknown; default assumes ${side} is not at boundary`]
  if (effect === 'no_visible_change')
    return [`single-step no visible OCR change is heuristic ${side} boundary evidence`]
  return [`single-step changed means ${side} was not reached during this scroll action`]
}

function defaultScrollBoundaryObservation(input: {
  generatedAtMillis: number
  captureContractRef?: ArtifactRef
  sourceArtifacts: ArtifactRef[]
}): ScrollBoundaryObservation {
  return {
    api_version: SCROLL_BOUNDARY_API_VERSION,
    axis: 'vertical',
    vertical: {
      top: defaultNotAtBoundaryClaim('top'),
      bottom: defaultNotAtBoundaryClaim('bottom'),
    },
    generated_at_millis: input.generatedAtMillis,
    capture_contract_ref: input.captureContractRef,
    source_artifacts: input.sourceArtifacts,
    known_limits: [],
  }
}

function defaultNotAtBoundaryClaim(side: ScrollBoundarySide): ScrollBoundarySideClaim {
  return {
    state: 'not_at_boundary',
    confidence: 'heuristic',
    basis: ['ordinary_observe_default'],
    evidence: [{
      source: 'observation_snapshot',
      basis: 'ordinary_observe_default',
      axis: 'vertical',
      side,
      detail: {
        reason: 'ordinary observe defaults to incomplete scroll context until a scroll step proves otherwise',
      },
    }],
    known_limits: [
      `ordinary observe assumes ${side} is not at boundary; no scroll action has probed this side`,
    ],
  }
}

function cloneJson<T>(value: T): T {
  return structuredClone(value)
}
