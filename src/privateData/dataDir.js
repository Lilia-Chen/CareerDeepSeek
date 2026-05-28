import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function resolvePrivateDataDir(env = process.env, options = {}) {
  const configured = options.dataDir ?? env.CAREERDEEPSEEK_DATA_DIR;
  if (!configured) {
    throw new Error("CAREERDEEPSEEK_DATA_DIR must be set before writing private records.");
  }

  const dataDir = resolve(configured);
  assertPrivateDataDirOutsideRepo(dataDir, options.repoRoot ?? PUBLIC_REPO_ROOT);
  return dataDir;
}

export function assertPrivateDataDirOutsideRepo(dataDir, repoRoot = PUBLIC_REPO_ROOT) {
  if (typeof dataDir !== "string" || dataDir.trim() === "") {
    throw new TypeError("Private data directory must be a non-empty string.");
  }

  const resolvedDataDir = resolve(dataDir);
  const resolvedRepoRoot = resolve(repoRoot);
  const repoRelativePath = relative(resolvedRepoRoot, resolvedDataDir);
  const isInsideRepo =
    repoRelativePath === "" || (!repoRelativePath.startsWith("..") && !isAbsolute(repoRelativePath));

  if (isInsideRepo) {
    throw new Error("CAREERDEEPSEEK_DATA_DIR must point outside this repository.");
  }
}
