export function normalizeVisualState(state) {
  if (!state || typeof state !== "object") {
    throw new TypeError("Visual state must be an object.");
  }

  assertNonEmptyString(state.sessionId, "state.sessionId");
  assertNonEmptyString(state.url, "state.url");
  assertNonEmptyString(state.title, "state.title");
  assertNonEmptyString(state.sourceType, "state.sourceType");
  assertNonEmptyString(state.observedAt, "state.observedAt");
  assertScreenshot(state.screenshot);

  if (!Array.isArray(state.elements)) {
    throw new TypeError("state.elements must be an array.");
  }

  return {
    sessionId: state.sessionId,
    step: Number.isInteger(state.step) ? state.step : 0,
    url: state.url,
    title: state.title,
    sourceType: state.sourceType,
    observedAt: state.observedAt,
    screenshot: {
      id: state.screenshot.id,
      width: state.screenshot.width,
      height: state.screenshot.height
    },
    visibleText: typeof state.visibleText === "string" ? state.visibleText : "",
    elements: state.elements.map(normalizeElement),
    signals: Array.isArray(state.signals) ? [...state.signals] : [],
    evidence: Array.isArray(state.evidence) ? state.evidence.map((item) => ({ ...item })) : [],
    extracted: state.extracted && typeof state.extracted === "object" ? { ...state.extracted } : {}
  };
}

export function findVisualElement(state, elementId) {
  const normalized = normalizeVisualState(state);
  const element = normalized.elements.find((item) => item.id === elementId);
  if (!element) {
    throw new Error(`Visual element not found: ${elementId}`);
  }
  return element;
}

function normalizeElement(element) {
  if (!element || typeof element !== "object") {
    throw new TypeError("Visual element must be an object.");
  }

  assertNonEmptyString(element.id, "element.id");
  assertNonEmptyString(element.role, "element.role");
  assertBox(element.box);

  return {
    id: element.id,
    role: element.role,
    text: typeof element.text === "string" ? element.text : "",
    href: typeof element.href === "string" ? element.href : null,
    intent: typeof element.intent === "string" ? element.intent : null,
    box: {
      x: element.box.x,
      y: element.box.y,
      width: element.box.width,
      height: element.box.height
    },
    center: {
      x: element.box.x + element.box.width / 2,
      y: element.box.y + element.box.height / 2
    }
  };
}

function assertScreenshot(screenshot) {
  if (!screenshot || typeof screenshot !== "object") {
    throw new TypeError("state.screenshot must be an object.");
  }

  assertNonEmptyString(screenshot.id, "state.screenshot.id");
  for (const key of ["width", "height"]) {
    if (!Number.isFinite(screenshot[key]) || screenshot[key] <= 0) {
      throw new TypeError(`state.screenshot.${key} must be a positive number.`);
    }
  }
}

function assertBox(box) {
  if (!box || typeof box !== "object") {
    throw new TypeError("element.box must be an object.");
  }

  for (const key of ["x", "y", "width", "height"]) {
    if (!Number.isFinite(box[key])) {
      throw new TypeError(`element.box.${key} must be a number.`);
    }
  }

  if (box.width <= 0 || box.height <= 0) {
    throw new TypeError("element.box width and height must be positive.");
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}
