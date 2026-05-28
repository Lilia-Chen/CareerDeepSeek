import { it } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateCollectionSession } from '../src/collection/sessionPolicy.js'
import { assertBrowserActionAllowed } from '../src/collection/toolContract.js'
import { normalizePageObservation } from '../src/collection/pageObservation.js'
import { classifyCandidate } from '../src/collection/classifyCandidate.js'
import { buildReviewItem } from '../src/collection/buildReviewItem.js'
import { writeReviewQueueItem } from '../src/collection/writeReviewQueue.js'
import { loadTargetRubric } from '../src/targets/targetRubric.js'
import { scoreTarget } from '../src/targets/scoreTarget.js'

const syntheticSession = {
  id: 'agent-discovery-2026-05-21',
  goal: 'Find production AI agent infrastructure companies with hiring signals.',
  sourceScope: ['search_engine', 'company_site', 'public_careers', 'engineering_blog', 'github_org'],
  pageBudget: {
    maxPages: 8,
  },
  stopConditions: ['login_required', 'captcha', 'rate_limited', 'budget_exceeded'],
}

const syntheticObservation = {
  sessionId: 'agent-discovery-2026-05-21',
  url: 'https://synthetic-agent-lab.example/careers',
  title: 'Synthetic Agent Lab Careers',
  sourceType: 'company_site',
  observedAt: '2026-05-21T10:00:00.000Z',
  visibleTextSummary:
    'Synthetic Agent Lab builds agent runtime observability and is hiring engineers for production AI systems.',
  evidence: [
    {
      label: 'domain_alignment',
      text: 'Builds agent runtime observability for production AI systems.',
      sourceUrl: 'https://synthetic-agent-lab.example/careers',
    },
    {
      label: 'hiring_pressure',
      text: 'Careers page shows active AI infrastructure engineering hiring.',
      sourceUrl: 'https://synthetic-agent-lab.example/careers',
    },
  ],
  extracted: {
    candidateType: 'target_company',
    target: {
      id: 'synthetic-agent-lab',
      name: 'Synthetic Agent Lab',
      category: 'agent_product',
      scores: {
        stage_hiring_pressure: 5,
        team_composition: 4,
        technical_closure: 5,
        domain_alignment: 5,
        culture_ownership_signal: 4,
        right_to_work_location: 3,
        reachability_signal: 4,
      },
      evidence: [
        'Builds agent runtime observability for production AI systems.',
        'Careers page shows active AI infrastructure engineering hiring.',
      ],
      missingInfo: ['Right-to-work path needs confirmation.'],
      riskFlags: [],
      nextAction: 'Review current roles and engineering team surface.',
    },
  },
}

it('validates bounded visible-browser collection sessions', () => {
  const session = validateCollectionSession(syntheticSession)

  assert.equal(session.id, 'agent-discovery-2026-05-21')
  assert.equal(session.pageBudget.maxPages, 8)
  assert.deepEqual(session.sourceScope, [
    'search_engine',
    'company_site',
    'public_careers',
    'engineering_blog',
    'github_org',
  ])

  assert.throws(
    () =>
      validateCollectionSession({
        ...syntheticSession,
        pageBudget: {},
      }),
    /pageBudget.maxPages/,
  )
})

it('rejects forbidden browser actions before workflow execution', () => {
  assert.equal(assertBrowserActionAllowed({ type: 'search', query: 'agent infrastructure hiring UK' }).type, 'search')
  assert.equal(
    assertBrowserActionAllowed({ type: 'click_visible_link', url: 'https://synthetic-agent-lab.example' }).type,
    'click_visible_link',
  )

  assert.throws(() => assertBrowserActionAllowed({ type: 'raw_http_fetch' }), /forbidden browser action/)
  assert.throws(() => assertBrowserActionAllowed({ type: 'solve_captcha' }), /forbidden browser action/)
  assert.throws(() => assertBrowserActionAllowed({ type: 'send_message' }), /forbidden browser action/)
})

it('classifies visible page observations and builds scored target review items', async () => {
  const session = validateCollectionSession(syntheticSession)
  const observation = normalizePageObservation(syntheticObservation)
  const classification = classifyCandidate(observation)
  const rubric = await loadTargetRubric()
  const target = observation.extracted.target
  assert.ok(target)
  const scoredTarget = scoreTarget(target, rubric)

  const reviewItem = buildReviewItem({ session, observation, classification, scoredRecord: scoredTarget })

  assert.equal(classification.candidateType, 'target_company')
  assert.equal(reviewItem.recordType, 'review_queue_item')
  assert.equal(reviewItem.privateRecordType, 'target_company')
  assert.equal(reviewItem.candidateId, 'synthetic-agent-lab')
  assert.equal(reviewItem.score, 89)
  assert.equal(reviewItem.decision, 'priority_target')
  assert.equal(reviewItem.source.url, 'https://synthetic-agent-lab.example/careers')
  assert.equal(reviewItem.evidence.length, 2)
  assert.deepEqual(reviewItem.missingInfo, ['Right-to-work path needs confirmation.'])
  assert.equal(JSON.stringify(reviewItem).includes(syntheticObservation.visibleTextSummary), false)
})

it('writes review queue items only under the private data directory', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'careerdeepseek-data-'))
  const session = validateCollectionSession(syntheticSession)
  const observation = normalizePageObservation(syntheticObservation)
  const classification = classifyCandidate(observation)
  const rubric = await loadTargetRubric()
  const target = observation.extracted.target
  assert.ok(target)
  const scoredTarget = scoreTarget(target, rubric)
  const reviewItem = buildReviewItem({ session, observation, classification, scoredRecord: scoredTarget })

  const outputPath = await writeReviewQueueItem(reviewItem, { dataDir })

  assert.equal(outputPath, join(dataDir, 'review-queue', 'agent-discovery-2026-05-21-synthetic-agent-lab.json'))
  const written = JSON.parse(await readFile(outputPath, 'utf8'))
  assert.equal(written.recordType, 'review_queue_item')
  assert.equal(written.candidateId, 'synthetic-agent-lab')
  assert.equal(JSON.stringify(written).includes(syntheticObservation.visibleTextSummary), false)
})
