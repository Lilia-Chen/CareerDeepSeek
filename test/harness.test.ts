import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { runPrivateHarness } from '../src/harness/privateHarness.js'
import { runPrivacyScan, scanPrivacyContent } from '../src/harness/privacyScan.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

it('passes the current tracked public repository privacy scan', async () => {
  const result = await runPrivacyScan(repoRoot)

  assert.equal(result.findings.length, 0)
  assert.ok(result.filesScanned > 0)
})

it('flags secrets, personal email addresses, and local user paths without echoing values', () => {
  const findings = scanPrivacyContent(
    'example.txt',
    [
      `token=${['sk-test', 'abcdefghijklmnopqrstuvwxyz'].join('_')}`,
      `email=${['person', 'example.com'].join('@')}`,
      'path=C:\\Users\\Example\\private.txt',
    ].join('\n'),
  )

  assert.deepEqual(
    findings.map(finding => finding.rule),
    ['secret-openai-key', 'personal-email', 'local-windows-user-path'],
  )
  assert.equal(findings.some(finding => finding.message.includes(['person', 'example.com'].join('@'))), false)
})

it('skips private harness when no repo-external data directory is configured', async () => {
  const result = await runPrivateHarness({
    env: {},
    defaultDataDir: join(tmpdir(), 'missing-careerdeepseek-data'),
    repoRoot,
  })

  assert.equal(result.status, 'skipped')
  assert.equal(result.dataDirConfigured, false)
})

it('validates private target and review queue records without exposing record ids in errors', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'careerdeepseek-data-'))
  await mkdir(join(dataDir, 'targets'))
  await mkdir(join(dataDir, 'review-queue'))

  await writeFile(
    join(dataDir, 'target.json'),
    '{}\n',
    'utf8',
  )

  await writeFile(
    join(dataDir, 'targets', 'synthetic-target.json'),
    `${JSON.stringify({
      recordType: 'target_company',
      schemaVersion: '0.1.0',
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
    }, null, 2)}\n`,
    'utf8',
  )

  await writeFile(
    join(dataDir, 'review-queue', 'synthetic-session-synthetic-target.json'),
    `${JSON.stringify({
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
    }, null, 2)}\n`,
    'utf8',
  )

  const result = await runPrivateHarness({
    dataDir,
    env: {},
    repoRoot,
  })

  assert.equal(result.status, 'passed')
  assert.equal(result.targetsChecked, 1)
  assert.equal(result.reviewItemsChecked, 1)
})
