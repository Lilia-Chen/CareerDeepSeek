import { VISUAL_ACTION_TYPES } from "./actionSpace.js";
import { normalizeVisualState } from "./visualState.js";

const FORBIDDEN_ACTION_TYPES = new Set([
  "raw_http_fetch",
  "hidden_api_call",
  "sitemap_crawl",
  "solve_captcha",
  "bypass_captcha",
  "rotate_proxy",
  "headless_bulk_collect",
  "bulk_extract_platform",
  "auto_apply",
  "send_message",
  "auto_send_message",
  "auto_add_connection",
  "auto_like",
  "auto_comment",
  "auto_follow"
]);

const FORBIDDEN_ELEMENT_INTENTS = new Set([
  "auto_apply",
  "send_message",
  "auto_send_message",
  "auto_add_connection",
  "login",
  "solve_captcha",
  "payment"
]);

export function assertAutomationActionAllowed(action, state) {
  if (!action || typeof action !== "object") {
    throw new TypeError("Automation action must be an object.");
  }

  if (typeof action.type !== "string" || action.type.trim() === "") {
    throw new TypeError("Automation action type must be a non-empty string.");
  }

  if (FORBIDDEN_ACTION_TYPES.has(action.type)) {
    throw new Error(`forbidden automation action: ${action.type}`);
  }

  if (!VISUAL_ACTION_TYPES.has(action.type)) {
    throw new Error(`unsupported automation action: ${action.type}`);
  }

  if (action.type === "click") {
    assertClickActionAllowed(action, state);
  }

  return { ...action };
}

export function stopReasonForVisualState(state, session) {
  const normalized = normalizeVisualState(state);
  const stopConditions = new Set(session?.stopConditions ?? []);

  for (const signal of normalized.signals) {
    if (stopConditions.has(signal)) {
      return signal;
    }
  }

  return null;
}

function assertClickActionAllowed(action, state) {
  const normalized = normalizeVisualState(state);
  const element = normalized.elements.find((item) => item.id === action.elementId);
  if (!element) {
    throw new Error(`Click action references unknown element: ${action.elementId}`);
  }

  if (element.intent && FORBIDDEN_ELEMENT_INTENTS.has(element.intent)) {
    throw new Error(`forbidden element intent: ${element.intent}`);
  }
}
