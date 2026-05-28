const ALLOWED_SOURCE_CLASSES = new Set([
  "search_engine",
  "company_site",
  "public_careers",
  "public_ats",
  "engineering_blog",
  "documentation",
  "changelog",
  "github_org"
]);

const ALLOWED_STOP_CONDITIONS = new Set([
  "login_required",
  "captcha",
  "rate_limited",
  "security_prompt",
  "budget_exceeded",
  "payment_prompt",
  "personal_contact_data",
  "send_action"
]);

export function validateCollectionSession(session) {
  if (!session || typeof session !== "object") {
    throw new TypeError("Collection session must be an object.");
  }

  assertSlug(session.id, "session.id");
  assertNonEmptyString(session.goal, "session.goal");
  assertStringArray(session.sourceScope, "session.sourceScope");
  assertPageBudget(session.pageBudget);
  assertStringArray(session.stopConditions, "session.stopConditions");

  for (const sourceClass of session.sourceScope) {
    if (!ALLOWED_SOURCE_CLASSES.has(sourceClass)) {
      throw new Error(`Unsupported source class: ${sourceClass}`);
    }
  }

  for (const condition of session.stopConditions) {
    if (!ALLOWED_STOP_CONDITIONS.has(condition)) {
      throw new Error(`Unsupported stop condition: ${condition}`);
    }
  }

  return {
    id: session.id,
    goal: session.goal.trim(),
    sourceScope: [...session.sourceScope],
    pageBudget: {
      maxPages: session.pageBudget.maxPages
    },
    stopConditions: [...session.stopConditions]
  };
}

function assertPageBudget(pageBudget) {
  if (!pageBudget || typeof pageBudget !== "object") {
    throw new TypeError("session.pageBudget must be an object.");
  }

  if (!Number.isInteger(pageBudget.maxPages) || pageBudget.maxPages <= 0) {
    throw new TypeError("session.pageBudget.maxPages must be a positive integer.");
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new TypeError(`${label} must be a non-empty string array.`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function assertSlug(value, label) {
  assertNonEmptyString(value, label);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(`${label} must be a lowercase slug.`);
  }
}
