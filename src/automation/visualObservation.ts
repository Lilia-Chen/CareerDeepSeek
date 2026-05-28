import type { PageObservation, VisualState } from '../types.js'

export function visualStateToPageObservation(visualState: VisualState): PageObservation {
  return {
    sessionId: visualState.sessionId,
    url: visualState.url,
    title: visualState.title,
    sourceType: visualState.sourceType,
    observedAt: visualState.observedAt,
    evidence: visualState.evidence ?? [],
    extracted: visualState.extracted ?? {},
  }
}
