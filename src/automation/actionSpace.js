import { findVisualElement } from "./visualState.js";

export const VISUAL_ACTION_TYPES = new Set([
  "open_url",
  "click",
  "type",
  "press",
  "scroll",
  "wait",
  "capture_screenshot",
  "stop"
]);

export function createClickAction({ elementId, state }) {
  const element = findVisualElement(state, elementId);
  return {
    type: "click",
    elementId,
    point: element.center,
    target: {
      role: element.role,
      text: element.text,
      href: element.href,
      intent: element.intent
    }
  };
}

export function createTypeAction({ text }) {
  if (typeof text !== "string" || text.length === 0) {
    throw new TypeError("Type action text must be a non-empty string.");
  }

  return {
    type: "type",
    text
  };
}

export function createOpenUrlAction({ url }) {
  if (typeof url !== "string" || url.trim() === "") {
    throw new TypeError("Open URL action url must be a non-empty string.");
  }

  return {
    type: "open_url",
    url
  };
}
