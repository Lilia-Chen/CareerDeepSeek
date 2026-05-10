import test from "node:test";
import assert from "node:assert/strict";
import { loadRubric } from "../src/scoring/rubric.js";
import { scoreOpportunity } from "../src/scoring/scoreOpportunity.js";

test("scores a strong agent infrastructure opportunity as apply_now", async () => {
  const rubric = await loadRubric();
  const opportunity = {
    id: "synthetic-agent-infra-strong",
    title: "Agent Infrastructure Engineer",
    company: "Synthetic Systems Lab",
    scores: {
      agent_systems_relevance: 5,
      memory_retrieval_context_relevance: 5,
      runtime_infrastructure_relevance: 5,
      eval_observability_reliability_relevance: 5,
      engineering_depth: 5,
      product_domain_interest: 5,
      visa_location_feasibility: 5,
      growth_upside: 5,
      risk_level: 0,
      application_cost: 0
    }
  };

  const result = scoreOpportunity(opportunity, rubric);

  assert.equal(result.decision, "apply_now");
  assert.equal(result.total, 89);
});

test("hard blockers force skip even when the numeric score is high", async () => {
  const rubric = await loadRubric();
  const opportunity = {
    id: "synthetic-blocked-role",
    title: "AI Engineer",
    company: "Blocked Example",
    scores: {
      agent_systems_relevance: 5,
      memory_retrieval_context_relevance: 5,
      runtime_infrastructure_relevance: 5,
      eval_observability_reliability_relevance: 5,
      engineering_depth: 5,
      product_domain_interest: 5,
      visa_location_feasibility: 5,
      growth_upside: 5,
      risk_level: 0,
      application_cost: 0
    },
    riskFlags: ["visa_impossible"]
  };

  const result = scoreOpportunity(opportunity, rubric);

  assert.equal(result.decision, "skip");
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
