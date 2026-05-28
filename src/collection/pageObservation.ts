import type { EvidenceItem, PageObservation, SourceType } from '../types.js'
import { asRecord } from '../automation/visualState.js'

const ALLOWED_SOURCE_TYPES = new Set([
  'search_engine',
  'company_site',
  'public_careers',
  'public_ats',
  'engineering_blog',
  'documentation',
  'changelog',
  'github_org',
])

export function normalizePageObservation(observation: unknown): PageObservation {
  const record = asRecord(observation, 'Page observation')

  assertNonEmptyString(record.sessionId, 'observation.sessionId')
  assertNonEmptyString(record.url, 'observation.url')
  assertNonEmptyString(record.title, 'observation.title')
  assertNonEmptyString(record.sourceType, 'observation.sourceType')
  assertNonEmptyString(record.observedAt, 'observation.observedAt')

  if (!ALLOWED_SOURCE_TYPES.has(record.sourceType)) {
    throw new Error(`Unsupported observation source type: ${record.sourceType}`)
  }

  if (Number.isNaN(Date.parse(record.observedAt))) {
    throw new TypeError('observation.observedAt must be an ISO timestamp.')
  }

  if (!Array.isArray(record.evidence)) {
    throw new TypeError('observation.evidence must be an array.')
  }

  return {
    sessionId: record.sessionId,
    url: record.url,
    title: record.title,
    sourceType: record.sourceType as SourceType,
    observedAt: record.observedAt,
    evidence: record.evidence.map(normalizeEvidence),
    extracted: normalizeExtracted(record.extracted),
  }
}

function normalizeEvidence(evidence: unknown): EvidenceItem {
  const record = asRecord(evidence, 'Evidence item')

  assertNonEmptyString(record.label, 'evidence.label')
  assertNonEmptyString(record.text, 'evidence.text')
  assertNonEmptyString(record.sourceUrl, 'evidence.sourceUrl')

  return {
    label: record.label,
    text: record.text,
    sourceUrl: record.sourceUrl,
  }
}

function normalizeExtracted(extracted: unknown): PageObservation['extracted'] {
  return { ...asRecord(extracted, 'observation.extracted') }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string.`)
  }
}
