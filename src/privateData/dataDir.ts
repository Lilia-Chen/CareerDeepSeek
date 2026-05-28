import { isAbsolute, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const PUBLIC_REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

interface ResolvePrivateDataDirOptions {
  dataDir?: string
  repoRoot?: string
}

export function resolvePrivateDataDir(
  env: NodeJS.ProcessEnv = process.env,
  options: ResolvePrivateDataDirOptions = {},
): string {
  const configured = options.dataDir ?? env.CAREERDEEPSEEK_DATA_DIR
  if (!configured) {
    throw new Error('CAREERDEEPSEEK_DATA_DIR must be set before writing private records.')
  }

  const dataDir = resolve(configured)
  assertPrivateDataDirOutsideRepo(dataDir, options.repoRoot ?? PUBLIC_REPO_ROOT)
  return dataDir
}

export function assertPrivateDataDirOutsideRepo(dataDir: string, repoRoot = PUBLIC_REPO_ROOT): void {
  if (typeof dataDir !== 'string' || dataDir.trim() === '') {
    throw new TypeError('Private data directory must be a non-empty string.')
  }

  const resolvedDataDir = resolve(dataDir)
  const resolvedRepoRoot = resolve(repoRoot)
  const repoRelativePath = relative(resolvedRepoRoot, resolvedDataDir)
  const isInsideRepo
    = repoRelativePath === '' || (!repoRelativePath.startsWith('..') && !isAbsolute(repoRelativePath))

  if (isInsideRepo) {
    throw new Error('CAREERDEEPSEEK_DATA_DIR must point outside this repository.')
  }
}
