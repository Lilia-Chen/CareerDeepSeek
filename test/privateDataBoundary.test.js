import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePrivateDataDir } from "../src/privateData/dataDir.js";
import { writeTargetRecord } from "../src/targets/writeTargetRecord.js";
import { writeReviewQueueItem } from "../src/collection/writeReviewQueue.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("rejects private data directories inside the public repository", async () => {
  const inRepoDataDir = join(repoRoot, "data");

  assert.throws(
    () => resolvePrivateDataDir({ CAREERDEEPSEEK_DATA_DIR: inRepoDataDir }),
    /outside this repository/
  );

  await assert.rejects(
    () =>
      writeTargetRecord(
        {
          id: "synthetic-target",
          name: "Synthetic Target",
          category: "agent_infrastructure",
          total: 90,
          decision: "priority_target"
        },
        { dataDir: inRepoDataDir }
      ),
    /outside this repository/
  );

  await assert.rejects(
    () =>
      writeReviewQueueItem(
        {
          recordType: "review_queue_item",
          schemaVersion: "0.1.0",
          id: "synthetic-session-synthetic-target",
          sessionId: "synthetic-session",
          candidateType: "target_company",
          candidateId: "synthetic-target",
          privateRecordType: "target_company",
          score: 90,
          decision: "priority_target"
        },
        { dataDir: inRepoDataDir }
      ),
    /outside this repository/
  );
});

test("allows private data directories outside the public repository", async () => {
  const externalDataDir = await mkdtemp(join(tmpdir(), "careerdeepseek-data-"));

  assert.equal(resolvePrivateDataDir({ CAREERDEEPSEEK_DATA_DIR: externalDataDir }), externalDataDir);
});
