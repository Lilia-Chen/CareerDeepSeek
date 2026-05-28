import type { EvidenceItem, JsonRecord, SourceType, VisualBox, VisualElement, VisualScreenshot, VisualState } from '../types.js'

export function normalizeVisualState(state: unknown): VisualState {
  const record = asRecord(state, 'Visual state')

  assertNonEmptyString(record.sessionId, 'state.sessionId')
  assertNonEmptyString(record.url, 'state.url')
  assertNonEmptyString(record.title, 'state.title')
  assertNonEmptyString(record.sourceType, 'state.sourceType')
  assertNonEmptyString(record.observedAt, 'state.observedAt')
  assertScreenshot(record.screenshot)

  if (!Array.isArray(record.elements)) {
    throw new TypeError('state.elements must be an array.')
  }

  return {
    sessionId: record.sessionId,
    step: Number.isInteger(record.step) ? record.step as number : 0,
    url: record.url,
    title: record.title,
    sourceType: record.sourceType as SourceType,
    observedAt: record.observedAt,
    screenshot: {
      id: record.screenshot.id,
      width: record.screenshot.width,
      height: record.screenshot.height,
    },
    visibleText: typeof record.visibleText === 'string' ? record.visibleText : '',
    elements: record.elements.map(normalizeElement),
    signals: Array.isArray(record.signals) ? record.signals.filter((signal): signal is string => typeof signal === 'string') : [],
    evidence: Array.isArray(record.evidence) ? record.evidence.map(normalizeEvidence) : [],
    extracted: isRecord(record.extracted) ? { ...record.extracted } : {},
  }
}

export function findVisualElement(state: unknown, elementId: string): VisualElement {
  const normalized = normalizeVisualState(state)
  const element = normalized.elements.find(item => item.id === elementId)
  if (!element) {
    throw new Error(`Visual element not found: ${elementId}`)
  }
  return element
}

export function asRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  return value
}

export function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeElement(element: unknown): VisualElement {
  const record = asRecord(element, 'Visual element')

  assertNonEmptyString(record.id, 'element.id')
  assertNonEmptyString(record.role, 'element.role')
  assertBox(record.box)

  return {
    id: record.id,
    role: record.role,
    text: typeof record.text === 'string' ? record.text : '',
    href: typeof record.href === 'string' ? record.href : null,
    intent: typeof record.intent === 'string' ? record.intent : null,
    box: {
      x: record.box.x,
      y: record.box.y,
      width: record.box.width,
      height: record.box.height,
    },
    center: {
      x: record.box.x + record.box.width / 2,
      y: record.box.y + record.box.height / 2,
    },
  }
}

function normalizeEvidence(evidence: unknown): EvidenceItem {
  const record = asRecord(evidence, 'Evidence item')

  assertNonEmptyString(record.label, 'evidence.label')
  assertNonEmptyString(record.text, 'evidence.text')
  assertNonEmptyString(record.sourceUrl, 'evidence.sourceUrl')

  return {
    label: record.label,
    text: record.text,
    sourceUrl: record.sourceUrl,
  }
}

function assertScreenshot(screenshot: unknown): asserts screenshot is VisualScreenshot {
  const record = asRecord(screenshot, 'state.screenshot')

  assertNonEmptyString(record.id, 'state.screenshot.id')
  for (const key of ['width', 'height'] as const) {
    if (!Number.isFinite(record[key]) || (record[key] as number) <= 0) {
      throw new TypeError(`state.screenshot.${key} must be a positive number.`)
    }
  }
}

function assertBox(box: unknown): asserts box is VisualBox {
  const record = asRecord(box, 'element.box')

  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (!Number.isFinite(record[key])) {
      throw new TypeError(`element.box.${key} must be a number.`)
    }
  }

  if ((record.width as number) <= 0 || (record.height as number) <= 0) {
    throw new TypeError('element.box width and height must be positive.')
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string.`)
  }
}
