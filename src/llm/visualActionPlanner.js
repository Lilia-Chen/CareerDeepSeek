import { createClickAction, createOpenUrlAction, createTypeAction } from "../automation/actionSpace.js";
import { assertAutomationActionAllowed } from "../automation/actionPolicy.js";
import { normalizeVisualState } from "../automation/visualState.js";
import { generateJson, assertPlainObject } from "./modelContract.js";

export async function planVisualAction({ model, session, state, history = [] }) {
  const visualState = normalizeVisualState(state);
  const output = await generateJson(model, {
    task: "plan_visual_action",
    instructions:
      "Return exactly one JSON action. Prefer visible, coordinate-grounded actions. Do not send messages, apply, log in, solve CAPTCHA, or use hidden APIs.",
    session: {
      id: session.id,
      goal: session.goal,
      sourceScope: session.sourceScope,
      pageBudget: session.pageBudget,
      stopConditions: session.stopConditions
    },
    state: summarizeVisualStateForModel(visualState),
    history: history.map((item) => ({
      action: item.action,
      progress: item.progress
    })),
    allowedActionTypes: ["open_url", "click", "type", "press", "scroll", "wait", "capture_screenshot", "stop"]
  });

  const action = normalizeModelAction(output, visualState);
  return assertAutomationActionAllowed(action, visualState);
}

function summarizeVisualStateForModel(state) {
  return {
    url: state.url,
    title: state.title,
    sourceType: state.sourceType,
    observedAt: state.observedAt,
    screenshot: state.screenshot,
    visibleText: state.visibleText,
    visibleTextIncluded: true,
    elements: state.elements.map((element) => ({
      id: element.id,
      role: element.role,
      text: element.text,
      href: element.href,
      intent: element.intent,
      box: element.box,
      center: element.center
    })),
    signals: state.signals
  };
}

function normalizeModelAction(output, state) {
  assertPlainObject(output, "Model action output");

  if (output.type === "click") {
    return {
      ...createClickAction({ elementId: output.elementId, state }),
      reason: output.reason ?? null,
      expectedChange: output.expectedChange ?? null
    };
  }

  if (output.type === "type") {
    return {
      ...createTypeAction({ text: output.text }),
      reason: output.reason ?? null,
      expectedChange: output.expectedChange ?? null
    };
  }

  if (output.type === "open_url") {
    return {
      ...createOpenUrlAction({ url: output.url }),
      reason: output.reason ?? null,
      expectedChange: output.expectedChange ?? null
    };
  }

  if (output.type === "stop") {
    return {
      type: "stop",
      reason: output.reason ?? "model_stop"
    };
  }

  return {
    ...output
  };
}
