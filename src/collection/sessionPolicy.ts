import type { CollectionSession, SourceType } from '../types.js'
import { asRecord } from '../automation/visualState.js'

const ALLOWED_SOURCE_CLASSES = new Set([
  'search_engine',
  'company_site',
  'public_careers',
  'public_ats',
  'engineering_blog',
  'documentation',
  'changelog',
  'github_org',
] satisfies SourceType[])

const ALLOWED_STOP_CONDITIONS = new Set([
  'login_required',
  'captcha',
  'rate_limited',
  'security_prompt',
  'budget_exceeded',
  'payment_prompt',
  'personal_contact_data',
  'send_action',
])

export function validateCollectionSession(session: unknown): CollectionSession {
  const record = asRecord(session, 'Collection session')

  assertSlug(record.id, 'session.id')
  assertNonEmptyString(record.goal, 'session.goal')
  assertStringArray(record.sourceScope, 'session.sourceScope')
  assertPageBudget(record.pageBudget)
  assertStringArray(record.stopConditions, 'session.stopConditions')

  for (const sourceClass of record.sourceScope) {
    if (!isSourceType(sourceClass)) {
      throw new Error(`Unsupported source class: ${sourceClass}`)
    }
  }

  for (const condition of record.stopConditions) {
    if (!ALLOWED_STOP_CONDITIONS.has(condition)) {
      throw new Error(`Unsupported stop condition: ${condition}`)
    }
  }

  return {
    id: record.id,
    goal: record.goal.trim(),
    sourceScope: [...record.sourceScope] as SourceType[],
    pageBudget: {
      maxPages: record.pageBudget.maxPages,
    },
    stopConditions: [...record.stopConditions],
  }
}

function isSourceType(value: string): value is SourceType {
  return ALLOWED_SOURCE_CLASSES.has(value as SourceType)
}

function assertPageBudget(pageBudget: unknown): asserts pageBudget is { maxPages: number } {
  const record = asRecord(pageBudget, 'session.pageBudget')

  if (!Number.isInteger(record.maxPages) || (record.maxPages as number) <= 0) {
    throw new TypeError('session.pageBudget.maxPages must be a positive integer.')
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new TypeError(`${label} must be a non-empty string array.`)
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string.`)
  }
}

function assertSlug(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(`${label} must be a lowercase slug.`)
  }
}
