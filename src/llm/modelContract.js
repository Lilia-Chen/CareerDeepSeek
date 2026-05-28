export async function generateJson(model, request) {
  if (typeof model === "function") {
    return model(request);
  }

  if (model && typeof model.generateJson === "function") {
    return model.generateJson(request);
  }

  throw new TypeError("Model must be a function or expose generateJson(request).");
}

export function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}
