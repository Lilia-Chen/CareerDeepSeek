#!/usr/bin/env node

import process from 'node:process'
import { validateCollectionSession } from '../src/collection/sessionPolicy.js'
import { MockComputerUseAdapter } from '../src/automation/mockComputerUseAdapter.js'
import { runDiscoveryWorkflow } from '../src/workflows/runDiscoveryWorkflow.js'
import type { JsonRecord, ModelAdapter } from '../src/types.js'

const shouldWrite = process.argv.includes('--write')

const session = validateCollectionSession({
  id: 'synthetic-visual-discovery',
  goal: 'Find AI agent runtime infrastructure companies with hiring signals.',
  sourceScope: ['search_engine', 'company_site', 'public_careers'],
  pageBudget: {
    maxPages: 4,
  },
  stopConditions: ['login_required', 'captcha', 'rate_limited', 'budget_exceeded'],
})

const searchState = {
  sessionId: 'synthetic-visual-discovery',
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
  sessionId: 'synthetic-visual-discovery',
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

const model: ModelAdapter = {
  async generateJson(request: JsonRecord) {
    if (request.task === 'plan_visual_action') {
      const state = request.state as { url: string }
      if (state.url.includes('search.example')) {
        return {
          type: 'click',
          elementId: 'result-synthetic-runtime-lab',
          reason: 'Open the most relevant visible careers result.',
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

const result = await runDiscoveryWorkflow({
  session,
  adapter: new MockComputerUseAdapter([searchState, targetState]),
  model,
  write: shouldWrite,
})

process.stdout.write(
  `${JSON.stringify(
    {
      session: {
        status: result.sessionResult.status,
        stopReason: result.sessionResult.stopReason,
        actions: result.sessionResult.actions,
        observations: result.sessionResult.observations.map(observation => ({
          url: observation.url,
          title: observation.title,
          screenshot: observation.screenshot.id,
        })),
      },
      reviewItems: result.reviewItems,
      outputPaths: result.outputPaths,
    },
    null,
    2,
  )}\n`,
)
