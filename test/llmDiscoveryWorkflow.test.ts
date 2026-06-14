import { it } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateCollectionSession } from '../src/collection/sessionPolicy.js'
import { MockComputerUseAdapter } from '../src/automation/mockComputerUseAdapter.js'
import { planVisualAction } from '../src/llm/visualActionPlanner.js'
import { extractPageObservation } from '../src/llm/evidenceExtractor.js'
import { runDiscoveryWorkflow } from '../src/workflows/runDiscoveryWorkflow.js'
import type { JsonRecord, ModelAdapter } from '../src/types.js'

const session = validateCollectionSession({
  id: 'llm-discovery-session',
  goal: 'Find AI agent runtime infrastructure companies with hiring signals.',
  sourceScope: ['search_engine', 'company_site', 'public_careers'],
  pageBudget: {
    maxPages: 4,
  },
  stopConditions: ['login_required', 'captcha', 'rate_limited', 'budget_exceeded'],
})

const searchState = {
  sessionId: 'llm-discovery-session',
  step: 0,
  url: 'https://search.example/search?q=agent+runtime+hiring',
  title: 'Search results',
  sourceType: 'search_engine',
  observedAt: '2026-05-21T12:00:00.000Z',
  screenshot: {
    id: 'shot-search',
    width: 1440,
    height: 900,
  },
  visibleText: 'Synthetic Runtime Lab Careers - agent runtime observability and memory systems.',
  elements: [
    {
      id: 'result-synthetic-runtime-lab',
      role: 'link',
      text: 'Synthetic Runtime Lab Careers',
      href: 'https://synthetic-runtime-lab.example/careers',
      box: {
        x: 180,
        y: 250,
        width: 460,
        height: 40,
      },
    },
  ],
  signals: [],
}

const targetState = {
  sessionId: 'llm-discovery-session',
  step: 1,
  url: 'https://synthetic-runtime-lab.example/careers',
  title: 'Synthetic Runtime Lab Careers',
  sourceType: 'company_site',
  observedAt: '2026-05-21T12:00:06.000Z',
  screenshot: {
    id: 'shot-target',
    width: 1440,
    height: 900,
  },
  visibleText:
    'Synthetic Runtime Lab builds memory, eval, and runtime observability for AI agents. Hiring production AI infrastructure engineers.',
  elements: [],
  signals: [],
}

interface MockModel extends ModelAdapter {
  calls: JsonRecord[]
}

function createMockModel(): MockModel {
  return {
    calls: [],
    async generateJson(request: JsonRecord) {
      this.calls.push(request)

      if (request.task === 'plan_visual_action') {
        const state = request.state as { url: string }
        if (state.url.includes('search.example')) {
          return {
            type: 'click',
            elementId: 'result-synthetic-runtime-lab',
            reason: 'Open the visible company careers result.',
            expectedChange: 'Navigate to the company careers page.',
          }
        }

        return {
          type: 'stop',
          reason: 'candidate_page_ready',
        }
      }

      if (request.task === 'extract_page_observation') {
        return {
          evidence: [
            {
              label: 'domain_alignment',
              text: 'Builds memory, eval, and runtime observability for AI agents.',
              sourceUrl: targetState.url,
            },
            {
              label: 'hiring_pressure',
              text: 'Careers page says the company is hiring production AI infrastructure engineers.',
              sourceUrl: targetState.url,
            },
          ],
          extracted: {
            candidateType: 'target_company',
            target: {
              id: 'synthetic-runtime-lab',
              name: 'Synthetic Runtime Lab',
              category: 'agent_infrastructure',
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
                'Builds memory, eval, and runtime observability for AI agents.',
                'Hiring production AI infrastructure engineers.',
              ],
              researchQuality: {
                sourceCount: 4,
                sourceTypes: ['search_engine', 'company_site', 'public_careers', 'engineering_blog'],
                evidenceCoverage: [
                  {
                    dimensionId: 'stage_hiring_pressure',
                    status: 'confirmed',
                    sourceCount: 2,
                    note: 'Careers and search results show active engineering hiring.',
                  },
                  {
                    dimensionId: 'team_composition',
                    status: 'partial',
                    sourceCount: 1,
                    note: 'Technical team signal exists but full team depth needs confirmation.',
                  },
                  {
                    dimensionId: 'technical_closure',
                    status: 'confirmed',
                    sourceCount: 2,
                    note: 'Memory, eval, and runtime observability are owned technical layers.',
                  },
                  {
                    dimensionId: 'domain_alignment',
                    status: 'confirmed',
                    sourceCount: 2,
                    note: 'Direct match to AI agent runtime and observability.',
                  },
                  {
                    dimensionId: 'culture_ownership_signal',
                    status: 'partial',
                    sourceCount: 1,
                    note: 'Engineering culture signal is plausible but not fully verified.',
                  },
                  {
                    dimensionId: 'right_to_work_location',
                    status: 'partial',
                    sourceCount: 1,
                    note: 'Location path needs confirmation but is not blocked.',
                  },
                  {
                    dimensionId: 'reachability_signal',
                    status: 'confirmed',
                    sourceCount: 1,
                    note: 'Company and careers surfaces are reachable.',
                  },
                ],
              },
              missingInfo: ['Right-to-work route needs confirmation.'],
              riskFlags: [],
              nextAction: 'Inspect current roles and engineering team surfaces.',
            },
          },
        }
      }

      throw new Error(`Unexpected model task: ${request.task}`)
    },
  }
}

it('lLM visual planner returns coordinate-grounded actions through the action space', async () => {
  const model = createMockModel()

  const action = await planVisualAction({
    model,
    session,
    state: searchState,
    history: [],
  })

  assert.equal(action.type, 'click')
  assert.equal(action.elementId, 'result-synthetic-runtime-lab')
  assert.deepEqual(action.point, { x: 410, y: 270 })
  const firstCall = model.calls[0]
  assert.ok(firstCall)
  assert.equal(firstCall.task, 'plan_visual_action')
  assert.equal((firstCall.state as { visibleTextIncluded: boolean }).visibleTextIncluded, true)
})

it('lLM evidence extractor returns page observations without raw visible text', async () => {
  const model = createMockModel()

  const observation = await extractPageObservation({
    model,
    session,
    state: targetState,
  })

  assert.equal(observation.url, targetState.url)
  assert.equal(observation.extracted.candidateType, 'target_company')
  const target = observation.extracted.target
  assert.ok(target)
  assert.equal(target.id, 'synthetic-runtime-lab')
  assert.equal(observation.evidence.length, 2)
  assert.equal(JSON.stringify(observation).includes(targetState.visibleText), false)
})

it('runs an end-to-end LLM discovery workflow and writes a private review queue item', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'careerdeepseek-data-'))
  const adapter = new MockComputerUseAdapter([searchState, targetState])
  const model = createMockModel()

  const result = await runDiscoveryWorkflow({
    session,
    adapter,
    model,
    dataDir,
  })

  assert.equal(result.sessionResult.status, 'stopped')
  assert.equal(result.sessionResult.stopReason, 'candidate_page_ready')
  assert.equal(result.reviewItems.length, 1)
  assert.equal(result.reviewItems[0].candidateId, 'synthetic-runtime-lab')
  assert.equal(result.reviewItems[0].decision, 'priority_target')
  assert.equal(result.outputPaths.length, 1)
  assert.equal(result.outputPaths[0], join(dataDir, 'review-queue', 'llm-discovery-session-synthetic-runtime-lab.json'))

  const written = JSON.parse(await readFile(result.outputPaths[0], 'utf8'))
  assert.equal(written.recordType, 'review_queue_item')
  assert.equal(written.privateRecordType, 'target_company')
})
