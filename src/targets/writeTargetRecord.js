import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolvePrivateDataDir } from "../privateData/dataDir.js";

export async function writeTargetRecord(scoredTarget, options = {}) {
  assertScoredTarget(scoredTarget);

  const dataDir = resolvePrivateDataDir(options.env, { dataDir: options.dataDir });
  const targetDir = join(dataDir, "targets");
  const outputPath = join(targetDir, `${scoredTarget.id}.json`);
  const now = new Date().toISOString();

  const record = {
    recordType: "target_company",
    schemaVersion: "0.1.0",
    updatedAt: now,
    ...scoredTarget
  };

  await mkdir(targetDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  return outputPath;
}

function assertScoredTarget(scoredTarget) {
  if (!scoredTarget || typeof scoredTarget !== "object") {
    throw new TypeError("Scored target must be an object.");
  }

  for (const key of ["id", "name", "category", "total", "decision"]) {
    if (!(key in scoredTarget)) {
      throw new TypeError(`Scored target is missing required field: ${key}`);
    }
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(scoredTarget.id)) {
    throw new Error("Scored target id must be a lowercase slug.");
  }
}
