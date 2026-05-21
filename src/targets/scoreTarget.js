export function scoreTarget(target, rubric) {
  assertTargetShape(target);
  assertRubricShape(rubric);

  const hardBlockers = findHardBlockers(target, rubric);
  const contributions = rubric.dimensions.map((dimension) => {
    const value = target.scores[dimension.id];
    assertDimensionValue(target.id, dimension, value);

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
    id: target.id,
    name: target.name,
    category: target.category,
    total,
    decision,
    hardBlockers,
    contributions,
    evidence: target.evidence ?? [],
    riskFlags: target.riskFlags ?? [],
    missingInfo: target.missingInfo ?? [],
    nextAction: target.nextAction ?? null
  };
}

export function decisionForScore(total, thresholds) {
  const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore);
  const match = sorted.find((threshold) => total >= threshold.minScore);
  return match?.decision ?? "reject";
}

function findHardBlockers(target, rubric) {
  const flags = new Set(target.riskFlags ?? []);
  return rubric.hardBlockers.filter((blocker) => flags.has(blocker));
}

function assertTargetShape(target) {
  if (!target || typeof target !== "object") {
    throw new TypeError("Target must be an object.");
  }

  for (const key of ["id", "name", "category", "scores"]) {
    if (!(key in target)) {
      throw new TypeError(`Target is missing required field: ${key}`);
    }
  }
}

function assertRubricShape(rubric) {
  if (!rubric || !Array.isArray(rubric.dimensions) || !Array.isArray(rubric.decisionThresholds)) {
    throw new TypeError("Rubric must define dimensions and decisionThresholds arrays.");
  }
}

function assertDimensionValue(targetId, dimension, value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new TypeError(`Target ${targetId} is missing numeric score for ${dimension.id}.`);
  }

  if (value < dimension.min || value > dimension.max) {
    throw new RangeError(
      `Target ${targetId} score for ${dimension.id} must be between ${dimension.min} and ${dimension.max}.`
    );
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
