import { createClickAction, createTypeAction } from '../automation/actionSpace.js'
import { assertAutomationActionAllowed } from '../automation/actionPolicy.js'
import { normalizeVisualState } from '../automation/visualState.js'
import { generateJson, assertPlainObject } from './modelContract.js'
import type {
  CollectionSession,
  JsonRecord,
  ModelAdapter,
  VisualAction,
  VisualActionHistoryItem,
  VisualState,
} from '../types.js'

export async function planVisualAction({
  model,
  session,
  state,
  history = [],
}: {
  model: ModelAdapter
  session: CollectionSession
  state: unknown
  history?: VisualActionHistoryItem[]
}): Promise<VisualAction> {
  const visualState = normalizeVisualState(state)
  const output = await generateJson(model, {
    task: 'plan_visual_action',
    instructions:
      'Return exactly one JSON action. Prefer visible, coordinate-grounded actions. Do not send messages, apply, log in, solve CAPTCHA, or use hidden APIs.',
    session: {
      id: session.id,
      goal: session.goal,
      sourceScope: session.sourceScope,
      pageBudget: session.pageBudget,
      stopConditions: session.stopConditions,
    },
    state: summarizeVisualStateForModel(visualState),
    history: history.map(item => ({
      action: item.action,
      progress: item.progress,
    })),
    allowedActionTypes: ['click', 'type', 'press', 'scroll', 'wait', 'capture_screenshot', 'stop'],
  })

  const action = normalizeModelAction(output, visualState)
  return assertAutomationActionAllowed(action, visualState)
}

function summarizeVisualStateForModel(state: VisualState): JsonRecord {
  return {
    url: state.url,
    title: state.title,
    sourceType: state.sourceType,
    observedAt: state.observedAt,
    screenshot: state.screenshot,
    visibleText: state.visibleText,
    visibleTextIncluded: true,
    elements: state.elements.map(element => ({
      id: element.id,
      role: element.role,
      text: element.text,
      href: element.href,
      intent: element.intent,
      box: element.box,
      center: element.center,
    })),
    signals: state.signals,
  }
}

function normalizeModelAction(output: unknown, state: VisualState): VisualAction {
  assertPlainObject(output, 'Model action output')

  if (output.type === 'click') {
    if (typeof output.elementId !== 'string') {
      throw new TypeError('Model click action must include elementId.')
    }
    return {
      ...createClickAction({ elementId: output.elementId, state }),
      reason: optionalText(output.reason),
      expectedChange: optionalText(output.expectedChange),
    }
  }

  if (output.type === 'type') {
    if (typeof output.text !== 'string') {
      throw new TypeError('Model type action must include text.')
    }
    return {
      ...createTypeAction({ text: output.text }),
      reason: optionalText(output.reason),
      expectedChange: optionalText(output.expectedChange),
    }
  }

  if (output.type === 'stop') {
    return {
      type: 'stop',
      reason: typeof output.reason === 'string' ? output.reason : 'model_stop',
    }
  }

  return output as VisualAction
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
