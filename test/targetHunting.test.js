import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadTargetRubric } from "../src/targets/targetRubric.js";
import { scoreTarget } from "../src/targets/scoreTarget.js";
import { writeTargetRecord } from "../src/targets/writeTargetRecord.js";

const execFileAsync = promisify(execFile);
const rootDir = fileURLToPath(new URL("..", import.meta.url));

test("loads the target hunting rubric with company/team dimensions", async () => {
  const rubric = await loadTargetRubric();

  assert.equal(rubric.version, "0.1.0");
  assert.equal(rubric.maxScore, 100);
  assert.deepEqual(
    rubric.dimensions.map((dimension) => dimension.id),
    [
      "stage_hiring_pressure",
      "team_composition",
      "technical_closure",
      "domain_alignment",
      "culture_ownership_signal",
      "right_to_work_location",
      "reachability_signal"
    ]
  );
});

test("scores a strong company/team target without requiring a live role", async () => {
  const rubric = await loadTargetRubric();
  const target = {
    id: "synthetic-agent-lab",
    name: "Synthetic Agent Lab",
    category: "agent_product",
    scores: {
      stage_hiring_pressure: 5,
      team_composition: 5,
      technical_closure: 5,
      domain_alignment: 5,
      culture_ownership_signal: 4,
      right_to_work_location: 4,
      reachability_signal: 4
    },
    evidence: [
      "Engineering-led team building production agent infrastructure.",
      "No current role is required for target-level qualification."
    ],
    missingInfo: [
      "Current right-to-work path needs direct confirmation."
    ],
    riskFlags: []
  };

  const result = scoreTarget(target, rubric);

  assert.equal(result.total, 94);
  assert.equal(result.decision, "priority_target");
  assert.equal(result.name, "Synthetic Agent Lab");
  assert.equal(result.contributions.length, 7);
});

test("target hard blockers force reject even when company score is high", async () => {
  const rubric = await loadTargetRubric();
  const target = {
    id: "blocked-target",
    name: "Blocked Target",
    category: "agent_product",
    scores: {
      stage_hiring_pressure: 5,
      team_composition: 5,
      technical_closure: 5,
      domain_alignment: 5,
      culture_ownership_signal: 5,
      right_to_work_location: 5,
      reachability_signal: 5
    },
    riskFlags: ["right_to_work_impossible"]
  };

  const result = scoreTarget(target, rubric);

  assert.equal(result.decision, "reject");
  assert.deepEqual(result.hardBlockers, ["right_to_work_impossible"]);
});

test("writes scored target records only under the private data target directory", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "careerdeepseek-data-"));
  const scoredTarget = {
    id: "synthetic-agent-lab",
    name: "Synthetic Agent Lab",
    category: "agent_product",
    total: 94,
    decision: "priority_target",
    hardBlockers: [],
    contributions: [],
    evidence: ["Synthetic public fixture evidence."],
    riskFlags: [],
    missingInfo: [],
    nextAction: "Find engineering team surface."
  };

  const outputPath = await writeTargetRecord(scoredTarget, { dataDir });

  assert.equal(outputPath, join(dataDir, "targets", "synthetic-agent-lab.json"));
  const written = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(written.id, "synthetic-agent-lab");
  assert.equal(written.decision, "priority_target");
  assert.equal(written.recordType, "target_company");
});

test("score-target CLI scores input JSON and writes private records only with --write", async () => {
  const scratchDir = await mkdtemp(join(tmpdir(), "target-cli-"));
  const dataDir = await mkdtemp(join(tmpdir(), "careerdeepseek-data-"));
  const inputPath = join(scratchDir, "target.json");

  await writeFile(
    inputPath,
    `${JSON.stringify(
      {
        id: "synthetic-agent-lab",
        name: "Synthetic Agent Lab",
        category: "agent_product",
        scores: {
          stage_hiring_pressure: 5,
          team_composition: 5,
          technical_closure: 5,
          domain_alignment: 5,
          culture_ownership_signal: 4,
          right_to_work_location: 4,
          reachability_signal: 4
        },
        evidence: ["Synthetic public fixture evidence."],
        riskFlags: [],
        missingInfo: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const { stdout } = await execFileAsync("node", ["scripts/score-target.js", inputPath, "--write"], {
    cwd: rootDir,
    env: {
      ...process.env,
      CAREERDEEPSEEK_DATA_DIR: dataDir
    }
  });

  const output = JSON.parse(stdout);
  assert.equal(output.decision, "priority_target");
  assert.equal(output.total, 94);
  assert.equal(output.outputPath, join(dataDir, "targets", "synthetic-agent-lab.json"));
});
