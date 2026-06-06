import type { JsonRecord } from '../types.js'

export type BrowserObservationSource = 'dom_aria_approx' | 'cdp_debug'

export interface BrowserObservationBox {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserObservationPoint {
  x: number
  y: number
}

export interface BrowserObservationViewport {
  width: number
  height: number
  scrollX: number
  scrollY: number
}

export interface BrowserObservationScreenshot {
  source: 'cdp_Page.captureScreenshot'
  format: 'png'
  width?: number
  height?: number
  byteLength?: number
  sha256?: string
}

export interface BrowserSemanticElement {
  id: string
  tagName: string
  role: string
  name: string
  text: string
  href: string | null
  box: BrowserObservationBox
  center: BrowserObservationPoint
  states: JsonRecord
  relationships: JsonRecord
  visible: boolean
  occluded: boolean
  actionable: boolean
  confidence: number
  sources: string[]
}

export interface DomSemanticObservation {
  schemaVersion: 'browser-observation/v1'
  source: 'dom_aria_approx'
  url: string
  title: string
  observedAt: string
  viewport: BrowserObservationViewport
  visibleText: string
  elements: BrowserSemanticElement[]
  signals: string[]
  limits: {
    maxElements: number
    maxVisibleTextLength: number
    truncatedElements: boolean
    truncatedVisibleText: boolean
  }
  notes: string[]
}

export interface BrowserObservationAdapter {
  observe: () => Promise<DomSemanticObservation> | DomSemanticObservation
}

export function normalizeDomSemanticObservation(value: unknown): DomSemanticObservation {
  const record = asRecord(value, 'DOM semantic observation')
  assertLiteral(record.schemaVersion, 'browser-observation/v1', 'observation.schemaVersion')
  assertLiteral(record.source, 'dom_aria_approx', 'observation.source')
  assertNonEmptyString(record.url, 'observation.url')
  assertNonEmptyString(record.title, 'observation.title')
  assertNonEmptyString(record.observedAt, 'observation.observedAt')
  assertViewport(record.viewport)

  if (!Array.isArray(record.elements)) {
    throw new TypeError('observation.elements must be an array.')
  }

  const limits = asRecord(record.limits, 'observation.limits')

  return {
    schemaVersion: 'browser-observation/v1',
    source: 'dom_aria_approx',
    url: record.url,
    title: record.title,
    observedAt: record.observedAt,
    viewport: {
      width: record.viewport.width,
      height: record.viewport.height,
      scrollX: record.viewport.scrollX,
      scrollY: record.viewport.scrollY,
    },
    visibleText: typeof record.visibleText === 'string' ? record.visibleText : '',
    elements: record.elements.map(normalizeBrowserSemanticElement),
    signals: Array.isArray(record.signals) ? record.signals.filter(isString) : [],
    limits: {
      maxElements: finiteNumber(limits.maxElements, 'observation.limits.maxElements'),
      maxVisibleTextLength: finiteNumber(limits.maxVisibleTextLength, 'observation.limits.maxVisibleTextLength'),
      truncatedElements: Boolean(limits.truncatedElements),
      truncatedVisibleText: Boolean(limits.truncatedVisibleText),
    },
    notes: Array.isArray(record.notes) ? record.notes.filter(isString) : [],
  }
}

function normalizeBrowserSemanticElement(value: unknown): BrowserSemanticElement {
  const record = asRecord(value, 'semantic element')
  assertNonEmptyString(record.id, 'element.id')
  assertNonEmptyString(record.tagName, 'element.tagName')
  assertNonEmptyString(record.role, 'element.role')
  assertBox(record.box, 'element.box')
  assertPoint(record.center, 'element.center')

  return {
    id: record.id,
    tagName: record.tagName,
    role: record.role,
    name: typeof record.name === 'string' ? record.name : '',
    text: typeof record.text === 'string' ? record.text : '',
    href: typeof record.href === 'string' ? record.href : null,
    box: {
      x: record.box.x,
      y: record.box.y,
      width: record.box.width,
      height: record.box.height,
    },
    center: {
      x: record.center.x,
      y: record.center.y,
    },
    states: isRecord(record.states) ? { ...record.states } : {},
    relationships: isRecord(record.relationships) ? { ...record.relationships } : {},
    visible: Boolean(record.visible),
    occluded: Boolean(record.occluded),
    actionable: Boolean(record.actionable),
    confidence: finiteNumber(record.confidence, 'element.confidence'),
    sources: Array.isArray(record.sources) ? record.sources.filter(isString) : [],
  }
}

function assertViewport(value: unknown): asserts value is BrowserObservationViewport {
  const record = asRecord(value, 'observation.viewport')
  for (const key of ['width', 'height', 'scrollX', 'scrollY'] as const) {
    finiteNumber(record[key], `observation.viewport.${key}`)
  }
}

function assertBox(value: unknown, label: string): asserts value is BrowserObservationBox {
  const record = asRecord(value, label)
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    finiteNumber(record[key], `${label}.${key}`)
  }
  if ((record.width as number) <= 0 || (record.height as number) <= 0) {
    throw new TypeError(`${label} width and height must be positive.`)
  }
}

function assertPoint(value: unknown, label: string): asserts value is BrowserObservationPoint {
  const record = asRecord(value, label)
  for (const key of ['x', 'y'] as const) {
    finiteNumber(record[key], `${label}.${key}`)
  }
}

function assertLiteral<T extends string>(value: unknown, expected: T, label: string): asserts value is T {
  if (value !== expected) {
    throw new TypeError(`${label} must be ${expected}.`)
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string.`)
  }
}

function finiteNumber(value: unknown, label: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`)
  }
  return value as number
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  return value
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
