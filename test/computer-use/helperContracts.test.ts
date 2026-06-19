import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

describe('p1.6 helper contract characterization', () => {
  it('object-like record contract accepts arrays', () => {
    // Mirrors current local helper bodies; these are contract characterization tests, not shared helpers.
    const isObjectLikeRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null

    assert.equal(isObjectLikeRecord({}), true)
    assert.equal(isObjectLikeRecord([]), true)
    assert.equal(isObjectLikeRecord(null), false)
    assert.equal(isObjectLikeRecord('value'), false)
  })

  it('non-array record contract rejects arrays', () => {
    const isNonArrayRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value)

    assert.equal(isNonArrayRecord({}), true)
    assert.equal(isNonArrayRecord([]), false)
    assert.equal(isNonArrayRecord(null), false)
    assert.equal(isNonArrayRecord('value'), false)
  })

  it('stringifying thrown value contract preserves String(error) fallback', () => {
    const stringifyThrownValue = (error: unknown): string =>
      error instanceof Error ? error.message : String(error)

    assert.equal(stringifyThrownValue(new Error('boom')), 'boom')
    assert.equal(stringifyThrownValue('plain'), 'plain')
    assert.equal(stringifyThrownValue({ code: 'E_TEST' }), '[object Object]')
    assert.equal(stringifyThrownValue(undefined), 'undefined')
  })

  it('safe error message contract hides non-string thrown values', () => {
    const safeErrorMessage = (error: unknown): string => {
      if (error instanceof Error)
        return error.message
      if (typeof error === 'string')
        return error
      return 'unknown error'
    }

    assert.equal(safeErrorMessage(new Error('boom')), 'boom')
    assert.equal(safeErrorMessage('plain'), 'plain')
    assert.equal(safeErrorMessage({ code: 'E_TEST' }), 'unknown error')
    assert.equal(safeErrorMessage(undefined), 'unknown error')
  })
})
