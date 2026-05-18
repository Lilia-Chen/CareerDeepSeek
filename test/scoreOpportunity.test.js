import test from "node:test";
import assert from "node:assert/strict";
import { loadRubric } from "../src/scoring/rubric.js";
import { scoreOpportunity } from "../src/scoring/scoreOpportunity.js";

test("scores a borderline strong opportunity as strong_fit", async () => {
  const rubric = await loadRubric();
  const opportunity = {
    id: "synthetic-borderline-strong-fit",
    title: "Forward Deployed Software Engineer",
    company: "Synthetic Applied AI Lab",
    scores: {
      stage_hiring_pressure: 5,
      team_composition: 4,
      operating_model: 3,
      culture_work_style: 4,
      technical_relevance: 3,
      coding_ownership: 3,
      visa_location: 4,
      interview_signal: 5
    }
  };

  const result = scoreOpportunity(opportunity, rubric);

  assert.equal(result.decision, "strong_fit");
  assert.equal(result.total, 75.6);
});

test("hard blockers force reject even when the numeric score is high", async () => {
  const rubric = await loadRubric();
  const opportunity = {
    id: "synthetic-blocked-role",
    title: "AI Engineer",
    company: "Blocked Example",
    scores: {
      stage_hiring_pressure: 5,
      team_composition: 5,
      operating_model: 5,
      culture_work_style: 5,
      technical_relevance: 5,
      coding_ownership: 5,
      visa_location: 5,
      interview_signal: 5
    },
    riskFlags: ["visa_impossible"]
  };

  const result = scoreOpportunity(opportunity, rubric);

  assert.equal(result.decision, "reject");
  assert.deepEqual(result.hardBlockers, ["visa_impossible"]);
});

test("throws when a fixture misses a rubric dimension", async () => {
  const rubric = await loadRubric();
  const opportunity = {
    id: "missing-score",
    title: "Incomplete Role",
    company: "Incomplete Company",
    scores: {}
  };

  assert.throws(() => scoreOpportunity(opportunity, rubric), /missing numeric score/);
});
