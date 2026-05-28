#!/usr/bin/env node

import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { readJson } from '../src/io/readJson.js'
import { loadRubric } from '../src/scoring/rubric.js'
import { scoreOpportunity } from '../src/scoring/scoreOpportunity.js'
import type { OpportunityInput } from '../src/types.js'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const fixtureDir = join(rootDir, 'evals', 'fixtures', 'synthetic')
const expectedPath = join(rootDir, 'evals', 'expected', 'synthetic-decisions.json')

const writeReport = process.argv.includes('--write-report')

const rubric = await loadRubric()
const expected = await readJson<Record<string, { decision: string }>>(expectedPath)
const fixtureFiles = (await readdir(fixtureDir)).filter(file => file.endsWith('.json')).sort()

const results: Array<{
  id: string
  file: string
  score: number
  decision: string
  expectedDecision: string | undefined
  passed: boolean
  hardBlockers: string[]
  riskFlags: string[]
}> = []

for (const file of fixtureFiles) {
  const opportunity = await readJson<OpportunityInput>(join(fixtureDir, file))
  const scored = scoreOpportunity(opportunity, rubric)
  const expectedDecision = expected[scored.id]?.decision
  const passed = scored.decision === expectedDecision

  results.push({
    id: scored.id,
    file,
    score: scored.total,
    decision: scored.decision,
    expectedDecision,
    passed,
    hardBlockers: scored.hardBlockers,
    riskFlags: scored.riskFlags,
  })
}

const failures = results.filter(result => !result.passed)

console.info(JSON.stringify(
  results.map(result => ({
    id: result.id,
    score: result.score,
    decision: result.decision,
    expected: result.expectedDecision,
    passed: result.passed,
  })),
  null,
  2,
))

if (writeReport) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = join(rootDir, 'evals', 'reports', `run-${timestamp}.json`)
  await writeFile(reportPath, `${JSON.stringify({ results }, null, 2)}\n`, 'utf8')
  console.info(`Wrote eval report: ${reportPath}`)
}

if (failures.length > 0) {
  console.error(`Eval failed: ${failures.length} mismatch(es).`)
  process.exitCode = 1
}
else {
  console.info(`Eval passed: ${results.length} fixture(s).`)
}
