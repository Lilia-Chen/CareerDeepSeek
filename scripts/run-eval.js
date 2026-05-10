#!/usr/bin/env node

import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "../src/io/readJson.js";
import { loadRubric } from "../src/scoring/rubric.js";
import { scoreOpportunity } from "../src/scoring/scoreOpportunity.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const fixtureDir = join(rootDir, "evals", "fixtures", "synthetic");
const expectedPath = join(rootDir, "evals", "expected", "synthetic-decisions.json");

const writeReport = process.argv.includes("--write-report");

const rubric = await loadRubric();
const expected = await readJson(expectedPath);
const fixtureFiles = (await readdir(fixtureDir)).filter((file) => file.endsWith(".json")).sort();

const results = [];

for (const file of fixtureFiles) {
  const opportunity = await readJson(join(fixtureDir, file));
  const scored = scoreOpportunity(opportunity, rubric);
  const expectedDecision = expected[scored.id]?.decision;
  const passed = scored.decision === expectedDecision;

  results.push({
    id: scored.id,
    file,
    score: scored.total,
    decision: scored.decision,
    expectedDecision,
    passed,
    hardBlockers: scored.hardBlockers,
    riskFlags: scored.riskFlags
  });
}

const failures = results.filter((result) => !result.passed);

console.table(
  results.map((result) => ({
    id: result.id,
    score: result.score,
    decision: result.decision,
    expected: result.expectedDecision,
    passed: result.passed
  }))
);

if (writeReport) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(rootDir, "evals", "reports", `run-${timestamp}.json`);
  await writeFile(reportPath, `${JSON.stringify({ results }, null, 2)}\n`, "utf8");
  console.log(`Wrote eval report: ${reportPath}`);
}

if (failures.length > 0) {
  console.error(`Eval failed: ${failures.length} mismatch(es).`);
  process.exitCode = 1;
} else {
  console.log(`Eval passed: ${results.length} fixture(s).`);
}

