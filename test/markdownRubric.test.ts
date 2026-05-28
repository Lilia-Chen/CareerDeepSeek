import { it } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parseRubricMarkdown } from '../src/scoring/markdownRubric.js'
import { readJson } from '../src/io/readJson.js'

const rootDir = fileURLToPath(new URL('..', import.meta.url))

it('parses the canonical markdown rubric into the runtime JSON shape', async () => {
  const markdown = await readFile(join(rootDir, 'docs', 'scoring-rubric.md'), 'utf8')
  const rubric = parseRubricMarkdown(markdown)

  assert.equal(rubric.version, '0.3.0')
  assert.equal(rubric.maxScore, 100)
  assert.equal(rubric.dimensions.length, 8)
  assert.deepEqual(
    rubric.dimensions.map(dimension => dimension.id),
    [
      'stage_hiring_pressure',
      'team_composition',
      'operating_model',
      'culture_work_style',
      'technical_relevance',
      'coding_ownership',
      'visa_location',
      'interview_signal',
    ],
  )

  const technicalRelevance = rubric.dimensions.find(dimension => dimension.id === 'technical_relevance')
  assert.ok(technicalRelevance)
  assert.ok(technicalRelevance.levels)
  assert.equal(technicalRelevance.weight, 18)
  assert.equal(technicalRelevance.min, 0)
  assert.equal(technicalRelevance.max, 5)
  assert.equal(technicalRelevance.levels['5'], 'Role core directly targets agent infra, retrieval, eval, runtime, memory, observability, AI/data systems, or production AI workflows.')

  const rightToWork = rubric.dimensions.find(dimension => dimension.id === 'visa_location')
  assert.ok(rightToWork)
  assert.ok(rightToWork.levels)
  assert.equal(rightToWork.label, 'Right to Work & Location')
  assert.equal(rightToWork.levels['0'], 'Clearly cannot sponsor and there is no other right-to-work path; hard blocker.')

  assert.deepEqual(rubric.hardBlockers, [
    'visa_impossible',
    'auto_apply_required',
    'unpaid_or_unclear_compensation',
    'obvious_scam_signal',
  ])
})

it('keeps committed runtime JSON generated from the markdown rubric', async () => {
  const markdown = await readFile(join(rootDir, 'docs', 'scoring-rubric.md'), 'utf8')
  const generated = parseRubricMarkdown(markdown)
  const committed = await readJson(join(rootDir, 'config', 'scoring-rubric.json'))

  assert.deepEqual(committed, generated)
})
