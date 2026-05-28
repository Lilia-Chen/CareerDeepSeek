import { it } from 'vitest'
import assert from 'node:assert/strict'
import { validateCollectionSession } from '../src/collection/sessionPolicy.js'
import { normalizePageObservation } from '../src/collection/pageObservation.js'
import { normalizeVisualState } from '../src/automation/visualState.js'
import { createClickAction, createTypeAction } from '../src/automation/actionSpace.js'
import { assertAutomationActionAllowed, stopReasonForVisualState } from '../src/automation/actionPolicy.js'
import { verifyActionProgress } from '../src/automation/progressVerifier.js'
import { MockComputerUseAdapter } from '../src/automation/mockComputerUseAdapter.js'
import { runVisualActionSession } from '../src/automation/sessionRunner.js'
import { visualStateToPageObservation } from '../src/automation/visualObservation.js'

const session = validateCollectionSession({
  id: 'visual-agent-discovery',
  goal: 'Find AI agent infrastructure companies with hiring signals.',
  sourceScope: ['search_engine', 'company_site', 'public_careers'],
  pageBudget: {
    maxPages: 3,
  },
  stopConditions: ['login_required', 'captcha', 'rate_limited', 'budget_exceeded'],
})

const searchState = {
  sessionId: 'visual-agent-discovery',
  step: 0,
  url: 'https://search.example/search?q=agent+infrastructure+hiring',
  title: 'Search results',
  sourceType: 'search_engine',
  observedAt: '2026-05-21T11:00:00.000Z',
  screenshot: {
    id: 'shot-search',
    width: 1440,
    height: 900,
  },
  visibleText: 'Synthetic Agent Lab - Careers. Building agent runtime observability.',
  elements: [
    {
      id: 'result-synthetic-agent-lab',
      role: 'link',
      text: 'Synthetic Agent Lab Careers',
      href: 'https://synthetic-agent-lab.example/careers',
      box: {
        x: 160,
        y: 220,
        width: 420,
        height: 36,
      },
    },
  ],
  signals: [],
}

const companyState = {
  sessionId: 'visual-agent-discovery',
  step: 1,
  url: 'https://synthetic-agent-lab.example/careers',
  title: 'Synthetic Agent Lab Careers',
  sourceType: 'company_site',
  observedAt: '2026-05-21T11:00:05.000Z',
  screenshot: {
    id: 'shot-company-careers',
    width: 1440,
    height: 900,
  },
  visibleText: 'Synthetic Agent Lab builds agent runtime observability and is hiring engineers.',
  elements: [
    {
      id: 'engineering-role',
      role: 'link',
      text: 'AI Infrastructure Engineer',
      href: 'https://synthetic-agent-lab.example/careers/ai-infra-engineer',
      box: {
        x: 220,
        y: 360,
        width: 360,
        height: 32,
      },
    },
  ],
  signals: [],
  evidence: [
    {
      label: 'domain_alignment',
      text: 'Builds agent runtime observability.',
      sourceUrl: 'https://synthetic-agent-lab.example/careers',
    },
  ],
  extracted: {
    candidateType: 'target_company',
    target: {
      id: 'synthetic-agent-lab',
    },
  },
}

it('normalizes visual state with screenshot and coordinate-grounded elements', () => {
  const state = normalizeVisualState(searchState)

  assert.equal(state.screenshot.id, 'shot-search')
  assert.equal(state.elements[0].center.x, 370)
  assert.equal(state.elements[0].center.y, 238)

  assert.throws(
    () =>
      normalizeVisualState({
        ...searchState,
        screenshot: null,
      }),
    /screenshot/,
  )
})

it('allows visual click and type actions but blocks high-risk intents', () => {
  const state = normalizeVisualState({
    ...companyState,
    elements: [
      ...companyState.elements,
      {
        id: 'apply-button',
        role: 'button',
        text: 'Apply now',
        intent: 'auto_apply',
        box: {
          x: 1000,
          y: 720,
          width: 120,
          height: 44,
        },
      },
    ],
  })

  const safeClick = createClickAction({ elementId: 'engineering-role', state })
  const safeType = createTypeAction({ text: 'agent infrastructure hiring' })

  assert.equal(assertAutomationActionAllowed(safeClick, state).type, 'click')
  assert.equal(assertAutomationActionAllowed(safeType, state).type, 'type')
  assert.throws(
    () => assertAutomationActionAllowed(createClickAction({ elementId: 'apply-button', state }), state),
    /forbidden element intent/,
  )
})

it('verifies visual action progress after navigation', () => {
  const before = normalizeVisualState(searchState)
  const after = normalizeVisualState(companyState)
  const action = createClickAction({ elementId: 'result-synthetic-agent-lab', state: before })
  const progress = verifyActionProgress({ before, action, after })

  assert.equal(progress.changed, true)
  assert.equal(progress.reason, 'url_changed')
})

it('runs observe-action-observe visual session loop with mock computer-use adapter', async () => {
  const adapter = new MockComputerUseAdapter([searchState, companyState])

  const result = await runVisualActionSession({
    session,
    adapter,
    planner: ({ state }) => {
      if (state.url.includes('search.example')) {
        return createClickAction({ elementId: 'result-synthetic-agent-lab', state })
      }
      return { type: 'stop', reason: 'target_page_reached' }
    },
  })

  assert.equal(result.status, 'stopped')
  assert.equal(result.stopReason, 'target_page_reached')
  assert.equal(result.actions.length, 1)
  assert.equal(result.actions[0].type, 'click')
  assert.deepEqual(result.actions[0].point, { x: 370, y: 238 })
  assert.equal(result.observations.length, 2)
  assert.equal(result.observations[1].url, 'https://synthetic-agent-lab.example/careers')
  assert.equal(result.history[0].progress.changed, true)
})

it('stops before acting when visual state exposes a stop condition', async () => {
  const adapter = new MockComputerUseAdapter([
    {
      ...searchState,
      signals: ['captcha'],
    },
  ])

  const result = await runVisualActionSession({
    session,
    adapter,
    planner: ({ state }) => createClickAction({ elementId: 'result-synthetic-agent-lab', state }),
  })

  assert.equal(stopReasonForVisualState(result.observations[0], session), 'captcha')
  assert.equal(result.status, 'stopped')
  assert.equal(result.stopReason, 'captcha')
  assert.equal(result.actions.length, 0)
})

it('converts a visual state into a collection page observation without raw visible text', () => {
  const visualState = normalizeVisualState(companyState)
  const observation = normalizePageObservation(visualStateToPageObservation(visualState))

  assert.equal(observation.url, 'https://synthetic-agent-lab.example/careers')
  assert.equal(observation.sourceType, 'company_site')
  assert.equal(observation.evidence.length, 1)
  assert.equal(observation.extracted.candidateType, 'target_company')
  assert.equal(JSON.stringify(observation).includes(companyState.visibleText), false)
})
