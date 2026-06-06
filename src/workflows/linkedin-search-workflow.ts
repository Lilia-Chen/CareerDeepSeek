#!/usr/bin/env node

import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { MacOSComputerUseAdapter } from '../computer-use/macos-adapter.js'
import type { VisualAction, VisualElement, VisualState } from '../types.js'

const HARD_STOP_SIGNALS = new Set([
  'login_required',
  'captcha',
  'payment_required',
  'checkout_required',
  'apply_required',
  'send_message_required',
])

export type LinkedInSearchDecision
  = | { kind: 'action', action: VisualAction, reason: string }
    | { kind: 'observe', reason: string }
    | { kind: 'stop', reason: string }

type WorkflowState = VisualState & Record<string, unknown>
type StateLike = VisualState | Record<string, unknown>

export interface LinkedInSearchDecisionInput {
  state: StateLike
  query: string
}

export interface LinkedInSearchTraceStep {
  phase: string
  decision: LinkedInSearchDecision['kind']
  reason: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  action?: Record<string, unknown>
}

export function decideNextLinkedInSearchAction(
  input: LinkedInSearchDecisionInput,
): LinkedInSearchDecision {
  const { state, query } = input
  const signals = readSignals(state)
  const blockingSignal = signals.find(signal => HARD_STOP_SIGNALS.has(signal))
  if (blockingSignal) {
    return {
      kind: 'stop',
      reason: `Hard-stop browser signal detected: ${blockingSignal}.`,
    }
  }

  const pageClass = readNestedString(state, ['page', 'className'])
  const chromeFrontmost = readNestedBoolean(state, ['chrome', 'isFrontmost'])
  const activeTabUrl = readNestedString(state, ['chrome', 'activeTabUrl'])
  const onLinkedIn = pageClass?.startsWith('linkedin_') || activeTabUrl?.includes('linkedin.com')

  if (onLinkedIn && chromeFrontmost === false) {
    return {
      kind: 'stop',
      reason: 'Observation invariant failed: Chrome is not frontmost after adapter.observe().',
    }
  }

  if (pageClass === 'linkedin_feed') {
    const searchBox = findLinkedInSearchBox(readElements(state))
    if (!searchBox) {
      return {
        kind: 'observe',
        reason: 'LinkedIn feed is active, but no observed LinkedIn search box is currently actionable.',
      }
    }

    return {
      kind: 'action',
      reason: 'Continue from the current LinkedIn feed by clicking the observed LinkedIn search box.',
      action: {
        type: 'click',
        elementId: searchBox.id,
        point: searchBox.center,
        target: {
          role: searchBox.role,
          text: searchBox.text,
          href: searchBox.href,
          intent: searchBox.intent,
        },
        reason: 'Focus the observed LinkedIn page search box.',
        expectedChange: `The LinkedIn search box receives focus before typing "${query}".`,
      },
    }
  }

  if (pageClass === 'linkedin_search_results') {
    return {
      kind: 'stop',
      reason: 'LinkedIn search results are already open; collect and report current visible results.',
    }
  }

  return {
    kind: 'stop',
    reason: `Current page class is ${pageClass ?? 'unknown'}; this LinkedIn workflow does not use address-bar navigation once a page is open.`,
  }
}

export async function runLinkedInSearchExperiment(params: {
  query: string
  sessionId?: string
}): Promise<{ status: string, trace: LinkedInSearchTraceStep[], finalState: WorkflowState | null }> {
  const adapter = new MacOSComputerUseAdapter({
    sessionId: params.sessionId ?? `linkedin-${Date.now()}`,
    foregroundPolicy: 'auto_focus_chrome',
  })
  const trace: LinkedInSearchTraceStep[] = []

  let state = await adapter.observe() as WorkflowState
  for (let i = 0; i < 8; i++) {
    const decision = decideNextLinkedInSearchAction({ state, query: params.query })

    if (decision.kind === 'observe') {
      const after = await adapter.observe() as WorkflowState
      trace.push({
        phase: 'observe',
        decision: decision.kind,
        reason: decision.reason,
        before: summarizeState(state),
        after: summarizeState(after),
      })
      state = after
      continue
    }

    if (decision.kind === 'action') {
      await adapter.act(decision.action)
      const afterClick = await adapter.observe() as WorkflowState
      await adapter.act({
        type: 'type',
        text: params.query,
        reason: 'Type the LinkedIn search query into the focused page search box.',
        expectedChange: 'The query appears in the LinkedIn page search field.',
      })
      await adapter.act({
        type: 'press',
        key: 'enter',
        reason: 'Submit the LinkedIn page search.',
        expectedChange: 'LinkedIn opens search results for the typed query.',
      })
      await adapter.act({ type: 'wait', durationMs: 2500 })
      const after = await adapter.observe() as WorkflowState
      trace.push({
        phase: 'linkedin_search_submit',
        decision: decision.kind,
        reason: decision.reason,
        before: summarizeState(state),
        after: summarizeState(after),
        action: summarizeAction(decision.action),
      })
      state = afterClick
      state = after
      continue
    }

    trace.push({
      phase: 'stop',
      decision: decision.kind,
      reason: decision.reason,
      before: summarizeState(state),
    })
    return { status: 'stopped', trace, finalState: state }
  }

  return { status: 'max_steps', trace, finalState: state }
}

export function summarizeState(state: StateLike): Record<string, unknown> {
  const visibleText = readNestedString(state, ['visibleText'])
  return {
    url: readNestedString(state, ['url']) ?? null,
    title: readNestedString(state, ['title']) ?? null,
    page: readNested(state, ['page']) ?? null,
    chrome: readNested(state, ['chrome']) ?? null,
    foregroundApp: readNestedString(state, ['desktop', 'foregroundApp']),
    elementCount: readElements(state).length,
    signals: readSignals(state),
    visibleTextSnippet: visibleText
      ? visibleText.slice(0, 500)
      : '',
  }
}

function findLinkedInSearchBox(elements: VisualElement[]): VisualElement | null {
  return elements.find(element => {
    const text = element.text.trim().toLowerCase()
    const role = element.role.toLowerCase()
    return text === 'search'
      && (role === 'textbox' || role === 'searchbox' || role === 'combobox')
  }) ?? null
}

function readElements(state: StateLike): VisualElement[] {
  const elements = readNested(state, ['elements'])
  return Array.isArray(elements) ? elements as VisualElement[] : []
}

function readSignals(state: StateLike): string[] {
  const signals = readNested(state, ['signals'])
  return Array.isArray(signals)
    ? signals.filter((signal): signal is string => typeof signal === 'string')
    : []
}

function readNestedBoolean(state: StateLike, path: string[]): boolean | undefined {
  const value = readNested(state, path)
  return typeof value === 'boolean' ? value : undefined
}

function readNestedString(state: StateLike, path: string[]): string | undefined {
  const value = readNested(state, path)
  return typeof value === 'string' ? value : undefined
}

function readNested(state: StateLike, path: string[]): unknown {
  let current: unknown = state
  for (const part of path) {
    if (!current || typeof current !== 'object')
      return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function summarizeAction(action: VisualAction): Record<string, unknown> {
  return {
    type: action.type,
    elementId: 'elementId' in action ? action.elementId : undefined,
    point: 'point' in action ? action.point : undefined,
  }
}

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(' ').trim()
    || 'AI agent infrastructure companies hiring'
  const result = await runLinkedInSearchExperiment({ query })
  console.log(JSON.stringify(result, null, 2))
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
