import type { JsonRecord, ModelAdapter } from '../types.js'

export async function generateJson(model: ModelAdapter | ((request: JsonRecord) => unknown), request: JsonRecord): Promise<unknown> {
  if (typeof model === 'function') {
    return model(request)
  }

  if (model && typeof model.generateJson === 'function') {
    return model.generateJson(request)
  }

  throw new TypeError('Model must be a function or expose generateJson(request).')
}

export function assertPlainObject(value: unknown, label: string): asserts value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
}
