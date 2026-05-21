#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { loadTargetRubric } from "../src/targets/targetRubric.js";
import { scoreTarget } from "../src/targets/scoreTarget.js";
import { writeTargetRecord } from "../src/targets/writeTargetRecord.js";

const args = process.argv.slice(2);
const inputPath = args.find((arg) => !arg.startsWith("-"));
const shouldWrite = args.includes("--write");

if (!inputPath) {
  console.error("Usage: node scripts/score-target.js <target.json> [--write]");
  process.exitCode = 1;
} else {
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const rubric = await loadTargetRubric();
  const scored = scoreTarget(input, rubric);
  const output = { ...scored };

  if (shouldWrite) {
    output.outputPath = await writeTargetRecord(scored);
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
