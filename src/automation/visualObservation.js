export function visualStateToPageObservation(visualState) {
  return {
    sessionId: visualState.sessionId,
    url: visualState.url,
    title: visualState.title,
    sourceType: visualState.sourceType,
    observedAt: visualState.observedAt,
    evidence: visualState.evidence ?? [],
    extracted: visualState.extracted ?? {}
  };
}
