const CANDIDATE_TYPES = new Set([
  "target_company",
  "job_opportunity",
  "person_contact_surface",
  "source_evidence",
  "irrelevant"
]);

export function classifyCandidate(observation) {
  if (!observation || typeof observation !== "object") {
    throw new TypeError("Observation must be an object.");
  }

  const candidateType = observation.extracted?.candidateType;
  if (!CANDIDATE_TYPES.has(candidateType)) {
    throw new Error("Observation must define a supported extracted.candidateType.");
  }

  return {
    candidateType,
    candidateId: candidateIdFor(observation, candidateType),
    sourceType: observation.sourceType,
    reason: "explicit_observation_candidate_type"
  };
}

function candidateIdFor(observation, candidateType) {
  if (candidateType === "target_company") {
    return observation.extracted.target?.id ?? null;
  }

  if (candidateType === "job_opportunity") {
    return observation.extracted.opportunity?.id ?? null;
  }

  return observation.extracted.id ?? null;
}
