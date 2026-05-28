import { validateCollectionSession } from '../collection/sessionPolicy.js'
import { normalizeVisualState } from './visualState.js'
import { assertAutomationActionAllowed, stopReasonForVisualState } from './actionPolicy.js'
import { verifyActionProgress } from './progressVerifier.js'
import type {
  ActionProgress,
  CollectionSession,
  ComputerUseAdapter,
  VisualAction,
  VisualActionHistoryItem,
  VisualState,
} from '../types.js'

export interface VisualActionSessionResult {
  status: 'stopped'
  stopReason: string
  observations: VisualState[]
  actions: VisualAction[]
  history: VisualActionHistoryItem[]
}

export async function runVisualActionSession({
  session,
  adapter,
  planner,
  maxActions = 20,
}: {
  session: unknown
  adapter: ComputerUseAdapter
  planner: (input: {
    session: CollectionSession
    state: VisualState
    history: VisualActionHistoryItem[]
  }) => Promise<VisualAction> | VisualAction
  maxActions?: number
}): Promise<VisualActionSessionResult> {
  const boundedSession = validateCollectionSession(session)
  assertAdapter(adapter)
  if (typeof planner !== 'function') {
    throw new TypeError('Visual action session requires a planner function.')
  }

  const observations: VisualState[] = []
  const actions: VisualAction[] = []
  const history: VisualActionHistoryItem[] = []
  const seenUrls = new Set<string>()

  for (let step = 0; step < maxActions; step += 1) {
    const before = normalizeVisualState(await adapter.observe())
    pushObservation(observations, before)
    seenUrls.add(before.url)

    const stopReason = stopReasonForVisualState(before, boundedSession)
    if (stopReason) {
      return {
        status: 'stopped',
        stopReason,
        observations,
        actions,
        history,
      }
    }

    if (seenUrls.size > boundedSession.pageBudget.maxPages) {
      return {
        status: 'stopped',
        stopReason: 'budget_exceeded',
        observations,
        actions,
        history,
      }
    }

    const plannedAction = await planner({ session: boundedSession, state: before, history })
    if (!plannedAction || plannedAction.type === 'stop') {
      return {
        status: 'stopped',
        stopReason: plannedAction?.reason ?? 'planner_stop',
        observations,
        actions,
        history,
      }
    }

    const action = assertAutomationActionAllowed(plannedAction, before)
    await adapter.act(action)
    actions.push(action)

    const after = normalizeVisualState(await adapter.observe())
    pushObservation(observations, after)
    seenUrls.add(after.url)

    const progress: ActionProgress = verifyActionProgress({ before, action, after })
    history.push({
      before,
      action,
      after,
      progress,
    })
  }

  return {
    status: 'stopped',
    stopReason: 'action_budget_exceeded',
    observations,
    actions,
    history,
  }
}

function assertAdapter(adapter: unknown): asserts adapter is ComputerUseAdapter {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('Visual action session requires an adapter with observe() and act(action).')
  }

  const candidate = adapter as Partial<ComputerUseAdapter>
  if (typeof candidate.observe !== 'function' || typeof candidate.act !== 'function') {
    throw new TypeError('Visual action session requires an adapter with observe() and act(action).')
  }
}

function pushObservation(observations: VisualState[], observation: VisualState): void {
  const last = observations.at(-1)
  if (
    last
    && last.url === observation.url
    && last.title === observation.title
    && last.screenshot.id === observation.screenshot.id
  ) {
    return
  }

  observations.push(observation)
}
