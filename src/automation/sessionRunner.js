import { validateCollectionSession } from "../collection/sessionPolicy.js";
import { normalizeVisualState } from "./visualState.js";
import { assertAutomationActionAllowed, stopReasonForVisualState } from "./actionPolicy.js";
import { verifyActionProgress } from "./progressVerifier.js";

export async function runVisualActionSession({ session, adapter, planner, maxActions = 20 }) {
  const boundedSession = validateCollectionSession(session);
  assertAdapter(adapter);
  if (typeof planner !== "function") {
    throw new TypeError("Visual action session requires a planner function.");
  }

  const observations = [];
  const actions = [];
  const history = [];
  const seenUrls = new Set();

  for (let step = 0; step < maxActions; step += 1) {
    const before = normalizeVisualState(await adapter.observe());
    pushObservation(observations, before);
    seenUrls.add(before.url);

    const stopReason = stopReasonForVisualState(before, boundedSession);
    if (stopReason) {
      return {
        status: "stopped",
        stopReason,
        observations,
        actions,
        history
      };
    }

    if (seenUrls.size > boundedSession.pageBudget.maxPages) {
      return {
        status: "stopped",
        stopReason: "budget_exceeded",
        observations,
        actions,
        history
      };
    }

    const plannedAction = await planner({ session: boundedSession, state: before, history });
    if (!plannedAction || plannedAction.type === "stop") {
      return {
        status: "stopped",
        stopReason: plannedAction?.reason ?? "planner_stop",
        observations,
        actions,
        history
      };
    }

    const action = assertAutomationActionAllowed(plannedAction, before);
    await adapter.act(action);
    actions.push(action);

    const after = normalizeVisualState(await adapter.observe());
    pushObservation(observations, after);
    seenUrls.add(after.url);

    const progress = verifyActionProgress({ before, action, after });
    history.push({
      before,
      action,
      after,
      progress
    });
  }

  return {
    status: "stopped",
    stopReason: "action_budget_exceeded",
    observations,
    actions,
    history
  };
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter.observe !== "function" || typeof adapter.act !== "function") {
    throw new TypeError("Visual action session requires an adapter with observe() and act(action).");
  }
}

function pushObservation(observations, observation) {
  const last = observations.at(-1);
  if (
    last &&
    last.url === observation.url &&
    last.title === observation.title &&
    last.screenshot.id === observation.screenshot.id
  ) {
    return;
  }

  observations.push(observation);
}
