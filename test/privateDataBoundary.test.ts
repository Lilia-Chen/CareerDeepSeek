import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { resolvePrivateDataDir } from '../src/privateData/dataDir.js'
import { writeTargetRecord } from '../src/targets/writeTargetRecord.js'
import { writeReviewQueueItem } from '../src/collection/writeReviewQueue.js'
import type { TargetResearchQualityAssessment } from '../src/types.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const researchQuality: TargetResearchQualityAssessment = {
  sourceCount: 4,
  sourceTypes: ['company_site', 'public_careers', 'linkedin_company', 'engineering_blog'],
  evidenceCoverage: [
    {
      dimensionId: 'stage_hiring_pressure',
      status: 'confirmed',
      sourceCount: 2,
      note: 'Synthetic source coverage.',
    },
    {
      dimensionId: 'team_composition',
      status: 'confirmed',
      sourceCount: 2,
      note: 'Synthetic source coverage.',
    },
    {
      dimensionId: 'technical_closure',
      status: 'confirmed',
      sourceCount: 2,
      note: 'Synthetic source coverage.',
    },
    {
      dimensionId: 'domain_alignment',
      status: 'confirmed',
      sourceCount: 2,
      note: 'Synthetic source coverage.',
    },
    {
      dimensionId: 'culture_ownership_signal',
      status: 'partial',
      sourceCount: 1,
      note: 'Synthetic source coverage.',
    },
    {
      dimensionId: 'right_to_work_location',
      status: 'partial',
      sourceCount: 1,
      note: 'Synthetic source coverage.',
    },
    {
      dimensionId: 'reachability_signal',
      status: 'partial',
      sourceCount: 1,
      note: 'Synthetic source coverage.',
    },
  ],
  confidence: 'high',
  stopReason: null,
  coverageSummary: {
    confirmedDimensions: 4,
    partialDimensions: 3,
    unknownDimensions: 0,
    blockedDimensions: 0,
    criticalGaps: [],
  },
  decisionCap: null,
  missingInfo: [],
}

it('rejects private data directories inside the public repository', async () => {
  const inRepoDataDir = join(repoRoot, 'data')

  assert.throws(
    () => resolvePrivateDataDir({ CAREERDEEPSEEK_DATA_DIR: inRepoDataDir }),
    /outside this repository/,
  )

  await assert.rejects(
    () =>
      writeTargetRecord(
        {
          id: 'synthetic-target',
          name: 'Synthetic Target',
          category: 'agent_infrastructure',
          total: 90,
          decision: 'priority_target',
          hardBlockers: [],
          contributions: [],
          riskFlags: [],
          missingInfo: [],
          nextAction: null,
          researchQuality,
        },
        { dataDir: inRepoDataDir },
      ),
    /outside this repository/,
  )

  await assert.rejects(
    () =>
      writeReviewQueueItem(
        {
          recordType: 'review_queue_item',
          schemaVersion: '0.1.0',
          id: 'synthetic-session-synthetic-target',
          sessionId: 'synthetic-session',
          candidateType: 'target_company',
          candidateId: 'synthetic-target',
          privateRecordType: 'target_company',
          score: 90,
          decision: 'priority_target',
          source: {
            url: 'https://synthetic.example',
            title: 'Synthetic Target',
            sourceType: 'company_site',
            observedAt: '2026-05-21T10:00:00.000Z',
          },
          evidence: [],
          missingInfo: [],
          riskFlags: [],
          nextAction: null,
        },
        { dataDir: inRepoDataDir },
      ),
    /outside this repository/,
  )
})

it('allows private data directories outside the public repository', async () => {
  const externalDataDir = await mkdtemp(join(tmpdir(), 'careerdeepseek-data-'))

  assert.equal(resolvePrivateDataDir({ CAREERDEEPSEEK_DATA_DIR: externalDataDir }), externalDataDir)
})
