import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { checkSafetyGate, detectHardStopSignals } from '../../src/computer-use/macos-chrome-driver/safety-gate.js'
import type { ChromeContextSnapshot, ProfileConfig } from '../../src/computer-use/macos-chrome-driver/types.js'

const profileConfig: ProfileConfig = {
  profile_path: 'Profile 4',
  profile_name: 'CareerDeepSeek',
  verified_at: '2026-06-14T00:00:00.000Z',
}

function makeContext(overrides: Partial<ChromeContextSnapshot> = {}): ChromeContextSnapshot {
  return {
    running: true, isFrontmost: true,
    frontmostAppName: 'Google Chrome', frontmostAppBundleId: 'com.google.Chrome',
    activeTabUrl: 'https://example.com', activeTabTitle: 'Test',
    profile: { status: 'verified', reason: 'checked', profile_path: 'Profile 4' },
    window: { id: '42', windowNumber: 42, appName: 'Google Chrome', ownerPid: 123,
      ownerBundleId: 'com.google.Chrome', title: 'Test',
      bounds: { x: 0, y: 40, width: 1000, height: 800 }, layer: 0 },
    ...overrides,
  }
}

describe('detectHardStopSignals', () => {
  it('detects captcha', () => {
    assert.ok(detectHardStopSignals('Please complete this security check to continue').includes('captcha'))
  })
  it('detects login_required', () => {
    assert.ok(detectHardStopSignals('You must sign in to continue').includes('login_required'))
  })
  it('detects payment_required', () => {
    assert.ok(detectHardStopSignals('Enter your credit card details').includes('payment_required'))
  })
  it('returns empty for clean text', () => {
    assert.equal(detectHardStopSignals('Welcome to our company page').length, 0)
  })
})

describe('checkSafetyGate', () => {
  it('passes when all checks succeed', () => {
    const result = checkSafetyGate(makeContext(), 'Welcome text', profileConfig)
    assert.equal(result.passed, true)
    assert.equal(result.failures.length, 0)
  })
  it('fails when profile is mismatch', () => {
    const ctx = makeContext({
      profile: { status: 'mismatch', reason: 'wrong', profile_path: 'Default' },
    })
    assert.equal(checkSafetyGate(ctx, 'clean', profileConfig).passed, false)
  })
  it('fails when profile is unverified', () => {
    const ctx = makeContext({
      profile: { status: 'unverified', reason: 'not checked' },
    })
    assert.equal(checkSafetyGate(ctx, 'clean', profileConfig).passed, false)
  })
  it('fails when Chrome not foreground', () => {
    const ctx = makeContext({
      isFrontmost: false,
      frontmostAppName: 'Safari',
      frontmostAppBundleId: 'com.apple.Safari',
    })
    assert.equal(checkSafetyGate(ctx, 'clean', profileConfig).passed, false)
  })
  it('fails on hard-stop signal in text', () => {
    assert.equal(checkSafetyGate(makeContext(), 'verify you are human', profileConfig).passed, false)
  })
})
