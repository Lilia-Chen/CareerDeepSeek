export function buildReviewItem({ session, observation, classification, scoredRecord }) {
  assertObject(session, "session");
  assertObject(observation, "observation");
  assertObject(classification, "classification");
  assertObject(scoredRecord, "scoredRecord");

  const candidateId = classification.candidateId ?? scoredRecord.id;
  assertSlug(candidateId, "candidateId");

  return {
    recordType: "review_queue_item",
    schemaVersion: "0.1.0",
    id: `${session.id}-${candidateId}`,
    sessionId: session.id,
    candidateType: classification.candidateType,
    candidateId,
    privateRecordType: privateRecordTypeFor(classification.candidateType),
    score: scoredRecord.total,
    decision: scoredRecord.decision,
    source: {
      url: observation.url,
      title: observation.title,
      sourceType: observation.sourceType,
      observedAt: observation.observedAt
    },
    evidence: observation.evidence,
    missingInfo: scoredRecord.missingInfo ?? [],
    riskFlags: scoredRecord.riskFlags ?? [],
    nextAction: scoredRecord.nextAction ?? null
  };
}

function privateRecordTypeFor(candidateType) {
  if (candidateType === "target_company") {
    return "target_company";
  }

  if (candidateType === "job_opportunity") {
    return "job_opportunity";
  }

  return "candidate_evidence";
}

function assertObject(value, label) {
  if (!value || typeof value !== "object") {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertSlug(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(`${label} must be a lowercase slug.`);
  }
}
