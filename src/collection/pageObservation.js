const ALLOWED_SOURCE_TYPES = new Set([
  "search_engine",
  "company_site",
  "public_careers",
  "public_ats",
  "engineering_blog",
  "documentation",
  "changelog",
  "github_org"
]);

export function normalizePageObservation(observation) {
  if (!observation || typeof observation !== "object") {
    throw new TypeError("Page observation must be an object.");
  }

  assertNonEmptyString(observation.sessionId, "observation.sessionId");
  assertNonEmptyString(observation.url, "observation.url");
  assertNonEmptyString(observation.title, "observation.title");
  assertNonEmptyString(observation.sourceType, "observation.sourceType");
  assertNonEmptyString(observation.observedAt, "observation.observedAt");

  if (!ALLOWED_SOURCE_TYPES.has(observation.sourceType)) {
    throw new Error(`Unsupported observation source type: ${observation.sourceType}`);
  }

  if (Number.isNaN(Date.parse(observation.observedAt))) {
    throw new Error("observation.observedAt must be an ISO timestamp.");
  }

  if (!Array.isArray(observation.evidence)) {
    throw new TypeError("observation.evidence must be an array.");
  }

  return {
    sessionId: observation.sessionId,
    url: observation.url,
    title: observation.title,
    sourceType: observation.sourceType,
    observedAt: observation.observedAt,
    evidence: observation.evidence.map(normalizeEvidence),
    extracted: normalizeExtracted(observation.extracted)
  };
}

function normalizeEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") {
    throw new TypeError("Evidence item must be an object.");
  }

  assertNonEmptyString(evidence.label, "evidence.label");
  assertNonEmptyString(evidence.text, "evidence.text");
  assertNonEmptyString(evidence.sourceUrl, "evidence.sourceUrl");

  return {
    label: evidence.label,
    text: evidence.text,
    sourceUrl: evidence.sourceUrl
  };
}

function normalizeExtracted(extracted) {
  if (!extracted || typeof extracted !== "object") {
    throw new TypeError("observation.extracted must be an object.");
  }

  return {
    ...extracted
  };
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}
