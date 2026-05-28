import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { assertPrivateDataDirOutsideRepo } from '../privateData/dataDir.js'

const PUBLIC_REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export interface PrivateHarnessOptions {
  dataDir?: string
  defaultDataDir?: string
  env?: NodeJS.ProcessEnv
  repoRoot?: string
  reportPath?: string
}

export interface PrivateHarnessResult {
  status: 'passed' | 'failed' | 'skipped'
  dataDirConfigured: boolean
  targetsChecked: number
  reviewItemsChecked: number
  errors: string[]
}

interface JsonRecord {
  [key: string]: unknown
}

export async function runPrivateHarness(options: PrivateHarnessOptions = {}): Promise<PrivateHarnessResult> {
  const repoRoot = options.repoRoot ?? PUBLIC_REPO_ROOT
  const dataDir = await resolveHarnessDataDir(options, repoRoot)

  if (!dataDir) {
    const result: PrivateHarnessResult = {
      status: 'skipped',
      dataDirConfigured: false,
      targetsChecked: 0,
      reviewItemsChecked: 0,
      errors: [],
    }
    await writeReportIfRequested(result, options.reportPath)
    return result
  }

  assertPrivateDataDirOutsideRepo(dataDir, repoRoot)

  const errors: string[] = []
  const targetFiles = await listJsonFiles(join(dataDir, 'targets'))
  const reviewQueueFiles = await listJsonFiles(join(dataDir, 'review-queue'))

  await validateRecords(targetFiles, 'targets', validateTargetRecord, errors)
  await validateRecords(reviewQueueFiles, 'review-queue', validateReviewQueueItem, errors)

  const result: PrivateHarnessResult = {
    status: errors.length === 0 ? 'passed' : 'failed',
    dataDirConfigured: true,
    targetsChecked: targetFiles.length,
    reviewItemsChecked: reviewQueueFiles.length,
    errors,
  }

  await writeReportIfRequested(result, options.reportPath)
  return result
}

async function resolveHarnessDataDir(options: PrivateHarnessOptions, repoRoot: string): Promise<string | null> {
  const env = options.env ?? process.env
  const configured = options.dataDir ?? env.CAREERDEEPSEEK_DATA_DIR
  if (configured) {
    return resolve(configured)
  }

  const defaultDataDir = options.defaultDataDir ?? resolve(repoRoot, '..', 'CareerDeepSeek-data')
  if (await exists(defaultDataDir)) {
    return resolve(defaultDataDir)
  }

  return null
}

async function listJsonFiles(dir: string): Promise<string[]> {
  if (!(await exists(dir))) {
    return []
  }

  const entries = await readdir(dir)
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const entryStat = await stat(fullPath)
    if (entryStat.isFile() && entry.endsWith('.json')) {
      files.push(fullPath)
    }
  }

  return files.sort()
}

async function validateRecords(
  files: string[],
  bucket: string,
  validate: (record: JsonRecord) => string[],
  errors: string[],
): Promise<void> {
  for (const [index, file] of files.entries()) {
    try {
      const record = JSON.parse(await readFile(file, 'utf8')) as unknown
      if (!isRecord(record)) {
        errors.push(`${bucket}[${index}] is not a JSON object`)
        continue
      }

      for (const error of validate(record)) {
        errors.push(`${bucket}[${index}]: ${error}`)
      }
    }
    catch {
      errors.push(`${bucket}[${index}] is not valid JSON`)
    }
  }
}

function validateTargetRecord(record: JsonRecord): string[] {
  const errors: string[] = []

  expectEqual(record, 'recordType', 'target_company', errors)
  expectSlug(record, 'id', errors)
  expectString(record, 'name', errors)
  expectString(record, 'category', errors)
  expectNumber(record, 'total', errors)
  expectString(record, 'decision', errors)
  expectArray(record, 'hardBlockers', errors)
  expectArray(record, 'contributions', errors)
  expectArray(record, 'riskFlags', errors)
  expectArray(record, 'missingInfo', errors)

  return errors
}

function validateReviewQueueItem(record: JsonRecord): string[] {
  const errors: string[] = []

  expectEqual(record, 'recordType', 'review_queue_item', errors)
  expectSlug(record, 'id', errors)
  expectSlug(record, 'sessionId', errors)
  expectString(record, 'candidateType', errors)
  expectSlug(record, 'candidateId', errors)
  expectString(record, 'privateRecordType', errors)
  expectNumber(record, 'score', errors)
  expectString(record, 'decision', errors)
  expectArray(record, 'evidence', errors)
  expectArray(record, 'missingInfo', errors)
  expectArray(record, 'riskFlags', errors)

  if (!isRecord(record.source)) {
    errors.push('source must be an object')
  }

  return errors
}

function expectEqual(record: JsonRecord, key: string, expected: unknown, errors: string[]): void {
  if (record[key] !== expected) {
    errors.push(`${key} must be ${String(expected)}`)
  }
}

function expectString(record: JsonRecord, key: string, errors: string[]): void {
  if (typeof record[key] !== 'string' || record[key].trim() === '') {
    errors.push(`${key} must be a non-empty string`)
  }
}

function expectNumber(record: JsonRecord, key: string, errors: string[]): void {
  if (typeof record[key] !== 'number' || Number.isNaN(record[key])) {
    errors.push(`${key} must be a number`)
  }
}

function expectArray(record: JsonRecord, key: string, errors: string[]): void {
  if (!Array.isArray(record[key])) {
    errors.push(`${key} must be an array`)
  }
}

function expectSlug(record: JsonRecord, key: string, errors: string[]): void {
  if (typeof record[key] !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(record[key])) {
    errors.push(`${key} must be a lowercase slug`)
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

async function writeReportIfRequested(result: PrivateHarnessResult, reportPath: string | undefined): Promise<void> {
  if (!reportPath) {
    return
  }

  const report = {
    status: result.status,
    dataDirConfigured: result.dataDirConfigured,
    targetsChecked: result.targetsChecked,
    reviewItemsChecked: result.reviewItemsChecked,
    errors: result.errors,
  }

  await mkdir(resolve(reportPath, '..'), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export function toRepoRelativePath(repoRoot: string, path: string): string {
  return relative(repoRoot, path).replaceAll('\\', '/')
}
