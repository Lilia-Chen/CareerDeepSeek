import type { DecisionThreshold, Rubric, RubricDimension, ScoredTarget, ScoreContribution, TargetInput } from '../types.js'
import { assessTargetResearchQuality, capDecisionByResearchQuality } from './researchQuality.js'

export function scoreTarget(target: TargetInput, rubric: Rubric): ScoredTarget {
  assertTargetShape(target)
  assertRubricShape(rubric)

  const hardBlockers = findHardBlockers(target, rubric)
  const contributions: ScoreContribution[] = rubric.dimensions.map((dimension) => {
    const value = target.scores[dimension.id]
    assertDimensionValue(target.id, dimension, value)

    const normalized = (value - dimension.min) / (dimension.max - dimension.min)
    const points = normalized * dimension.weight

    return {
      id: dimension.id,
      label: dimension.label,
      value,
      weight: dimension.weight,
      points: round(points),
    }
  })

  const total = clamp(round(contributions.reduce((sum, item) => sum + item.points, 0)), 0, rubric.maxScore)
  const scoreDecision = decisionForScore(total, rubric.decisionThresholds)
  const researchQuality = assessTargetResearchQuality(target, rubric)
  const decision = hardBlockers.length > 0 ? 'reject' : capDecisionByResearchQuality(scoreDecision, researchQuality)

  return {
    id: target.id,
    name: target.name,
    category: target.category,
    total,
    decision,
    hardBlockers,
    contributions,
    evidence: target.evidence ?? [],
    riskFlags: target.riskFlags ?? [],
    missingInfo: uniqueStrings([...(target.missingInfo ?? []), ...researchQuality.missingInfo]),
    nextAction: target.nextAction ?? null,
    researchQuality,
  }
}

export function decisionForScore(total: number, thresholds: DecisionThreshold[]): string {
  const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore)
  const match = sorted.find(threshold => total >= threshold.minScore)
  return match?.decision ?? 'reject'
}

function findHardBlockers(target: TargetInput, rubric: Rubric): string[] {
  const flags = new Set(target.riskFlags ?? [])
  return rubric.hardBlockers.filter(blocker => flags.has(blocker))
}

function assertTargetShape(target: TargetInput): void {
  if (!target || typeof target !== 'object') {
    throw new TypeError('Target must be an object.')
  }

  for (const key of ['id', 'name', 'category', 'scores']) {
    if (!(key in target)) {
      throw new TypeError(`Target is missing required field: ${key}`)
    }
  }
}

function assertRubricShape(rubric: Rubric): void {
  if (!rubric || !Array.isArray(rubric.dimensions) || !Array.isArray(rubric.decisionThresholds)) {
    throw new TypeError('Rubric must define dimensions and decisionThresholds arrays.')
  }
}

function assertDimensionValue(targetId: string, dimension: RubricDimension, value: unknown): asserts value is number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new TypeError(`Target ${targetId} is missing numeric score for ${dimension.id}.`)
  }

  if (value < dimension.min || value > dimension.max) {
    throw new RangeError(
      `Target ${targetId} score for ${dimension.id} must be between ${dimension.min} and ${dimension.max}.`,
    )
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))]
}
