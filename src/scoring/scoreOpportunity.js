export function scoreOpportunity(opportunity, rubric) {
  assertOpportunityShape(opportunity);
  assertRubricShape(rubric);

  const hardBlockers = findHardBlockers(opportunity, rubric);
  const contributions = rubric.dimensions.map((dimension) => {
    const value = opportunity.scores[dimension.id];
    assertDimensionValue(opportunity.id, dimension, value);

    const normalized = (value - dimension.min) / (dimension.max - dimension.min);
    const points = normalized * dimension.weight;

    return {
      id: dimension.id,
      label: dimension.label,
      value,
      weight: dimension.weight,
      points: round(points)
    };
  });

  const total = clamp(round(contributions.reduce((sum, item) => sum + item.points, 0)), 0, rubric.maxScore);
  const decision = hardBlockers.length > 0 ? "reject" : decisionForScore(total, rubric.decisionThresholds);

  return {
    id: opportunity.id,
    title: opportunity.title,
    company: opportunity.company,
    total,
    decision,
    hardBlockers,
    contributions,
    evidence: opportunity.evidence ?? [],
    riskFlags: opportunity.riskFlags ?? [],
    missingInfo: opportunity.missingInfo ?? []
  };
}

export function decisionForScore(total, thresholds) {
  const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore);
  const match = sorted.find((threshold) => total >= threshold.minScore);
  return match?.decision ?? "reject";
}

function findHardBlockers(opportunity, rubric) {
  const flags = new Set(opportunity.riskFlags ?? []);
  return rubric.hardBlockers.filter((blocker) => flags.has(blocker));
}

function assertOpportunityShape(opportunity) {
  if (!opportunity || typeof opportunity !== "object") {
    throw new TypeError("Opportunity must be an object.");
  }

  for (const key of ["id", "title", "company", "scores"]) {
    if (!(key in opportunity)) {
      throw new TypeError(`Opportunity is missing required field: ${key}`);
    }
  }
}

function assertRubricShape(rubric) {
  if (!rubric || !Array.isArray(rubric.dimensions) || !Array.isArray(rubric.decisionThresholds)) {
    throw new TypeError("Rubric must define dimensions and decisionThresholds arrays.");
  }
}

function assertDimensionValue(opportunityId, dimension, value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new TypeError(`Opportunity ${opportunityId} is missing numeric score for ${dimension.id}.`);
  }

  if (value < dimension.min || value > dimension.max) {
    throw new RangeError(
      `Opportunity ${opportunityId} score for ${dimension.id} must be between ${dimension.min} and ${dimension.max}.`
    );
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
