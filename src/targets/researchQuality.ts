import type {
  EvidenceCoverageItem,
  EvidenceCoverageStatus,
  ResearchConfidence,
  Rubric,
  TargetInput,
  TargetResearchQualityAssessment,
} from '../types.js'

const CRITICAL_DIMENSIONS = new Set([
  'stage_hiring_pressure',
  'technical_closure',
  'domain_alignment',
  'right_to_work_location',
])

const DECISION_RANK: Record<string, number> = {
  reject: 0,
  low_priority: 1,
  research_more: 2,
  qualified_watch: 3,
  priority_target: 4,
}

export function assessTargetResearchQuality(target: TargetInput, rubric: Rubric): TargetResearchQualityAssessment {
  const rawQuality = target.researchQuality
  const evidenceCoverage = rubric.dimensions.map((dimension) => {
    const raw = rawQuality?.evidenceCoverage?.find(item => item.dimensionId === dimension.id)
    return normalizeCoverageItem(raw, dimension.id)
  })

  const sourceCount = normalizeSourceCount(rawQuality?.sourceCount, target.evidence)
  const sourceTypes = normalizeSourceTypes(rawQuality?.sourceTypes)
  const coverageSummary = summarizeCoverage(evidenceCoverage)
  const confidence = rawQuality?.confidence ?? inferConfidence({
    sourceCount,
    sourceTypes,
    coverageSummary,
    dimensionCount: rubric.dimensions.length,
  })
  const decisionCap = decisionCapFor(confidence)
  const missingInfo = buildQualityMissingInfo({
    sourceCount,
    sourceTypes,
    evidenceCoverage,
    coverageSummary,
  })

  return {
    sourceCount,
    sourceTypes,
    evidenceCoverage,
    confidence,
    stopReason: rawQuality?.stopReason ?? null,
    coverageSummary,
    decisionCap,
    missingInfo,
  }
}

export function capDecisionByResearchQuality(baseDecision: string, quality: TargetResearchQualityAssessment): string {
  if (baseDecision === 'reject' || quality.decisionCap === null) {
    return baseDecision
  }

  const baseRank = DECISION_RANK[baseDecision] ?? 0
  const capRank = DECISION_RANK[quality.decisionCap] ?? 0
  if (baseRank <= capRank) {
    return baseDecision
  }

  return quality.decisionCap
}

function normalizeCoverageItem(raw: EvidenceCoverageItem | undefined, dimensionId: string): EvidenceCoverageItem {
  const status = normalizeCoverageStatus(raw?.status)
  const sourceCount = typeof raw?.sourceCount === 'number' && Number.isFinite(raw.sourceCount)
    ? Math.max(0, Math.floor(raw.sourceCount))
    : 0

  return {
    dimensionId,
    status,
    sourceCount,
    note: typeof raw?.note === 'string' && raw.note.trim() ? raw.note.trim() : 'No dimension-specific evidence recorded.',
  }
}

function normalizeCoverageStatus(status: unknown): EvidenceCoverageStatus {
  if (status === 'confirmed' || status === 'partial' || status === 'unknown' || status === 'blocked') {
    return status
  }

  return 'unknown'
}

function normalizeSourceCount(sourceCount: unknown, evidence: string[] | undefined): number {
  if (typeof sourceCount === 'number' && Number.isFinite(sourceCount)) {
    return Math.max(0, Math.floor(sourceCount))
  }

  return Array.isArray(evidence) ? evidence.length : 0
}

function normalizeSourceTypes(sourceTypes: unknown): string[] {
  if (!Array.isArray(sourceTypes)) {
    return []
  }

  return [...new Set(
    sourceTypes
      .filter((sourceType): sourceType is string => typeof sourceType === 'string')
      .map(sourceType => sourceType.trim())
      .filter(Boolean),
  )].sort()
}

function summarizeCoverage(evidenceCoverage: EvidenceCoverageItem[]): TargetResearchQualityAssessment['coverageSummary'] {
  const criticalGaps: string[] = []
  let confirmedDimensions = 0
  let partialDimensions = 0
  let unknownDimensions = 0
  let blockedDimensions = 0

  for (const item of evidenceCoverage) {
    if (item.status === 'confirmed') {
      confirmedDimensions += 1
    }
    else if (item.status === 'partial') {
      partialDimensions += 1
    }
    else if (item.status === 'blocked') {
      blockedDimensions += 1
    }
    else {
      unknownDimensions += 1
    }

    if (CRITICAL_DIMENSIONS.has(item.dimensionId) && (item.status === 'unknown' || item.status === 'blocked')) {
      criticalGaps.push(item.dimensionId)
    }
  }

  return {
    confirmedDimensions,
    partialDimensions,
    unknownDimensions,
    blockedDimensions,
    criticalGaps,
  }
}

function inferConfidence({
  sourceCount,
  sourceTypes,
  coverageSummary,
  dimensionCount,
}: {
  sourceCount: number
  sourceTypes: string[]
  coverageSummary: TargetResearchQualityAssessment['coverageSummary']
  dimensionCount: number
}): ResearchConfidence {
  const coveredDimensions = coverageSummary.confirmedDimensions + coverageSummary.partialDimensions

  if (
    sourceCount >= 4
    && sourceTypes.length >= 3
    && coveredDimensions === dimensionCount
    && coverageSummary.confirmedDimensions >= 4
    && coverageSummary.criticalGaps.length === 0
  ) {
    return 'high'
  }

  if (
    sourceCount >= 2
    && sourceTypes.length >= 2
    && coveredDimensions >= Math.min(5, dimensionCount)
    && coverageSummary.criticalGaps.length <= 1
  ) {
    return 'medium'
  }

  return 'low'
}

function decisionCapFor(confidence: ResearchConfidence): string | null {
  if (confidence === 'high') {
    return null
  }

  if (confidence === 'medium') {
    return 'qualified_watch'
  }

  return 'research_more'
}

function buildQualityMissingInfo({
  sourceCount,
  sourceTypes,
  evidenceCoverage,
  coverageSummary,
}: {
  sourceCount: number
  sourceTypes: string[]
  evidenceCoverage: EvidenceCoverageItem[]
  coverageSummary: TargetResearchQualityAssessment['coverageSummary']
}): string[] {
  const missingInfo: string[] = []

  if (sourceCount < 4) {
    missingInfo.push('Research confidence is below priority-target level: inspect at least four useful sources before final recommendation.')
  }

  if (sourceTypes.length < 3) {
    missingInfo.push('Research confidence is below priority-target level: use at least three source classes such as company site, careers/jobs, LinkedIn, engineering blog, GitHub, docs, or independent discovery source.')
  }

  if (coverageSummary.criticalGaps.length > 0) {
    missingInfo.push(`Critical target-rubric evidence gaps remain: ${coverageSummary.criticalGaps.join(', ')}.`)
  }

  const unknown = evidenceCoverage
    .filter(item => item.status === 'unknown')
    .map(item => item.dimensionId)
  if (unknown.length > 0) {
    missingInfo.push(`Unknown target-rubric dimensions: ${unknown.join(', ')}.`)
  }

  const blocked = evidenceCoverage
    .filter(item => item.status === 'blocked')
    .map(item => item.dimensionId)
  if (blocked.length > 0) {
    missingInfo.push(`Blocked target-rubric dimensions: ${blocked.join(', ')}.`)
  }

  return missingInfo
}
