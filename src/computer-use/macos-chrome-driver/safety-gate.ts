import type { ChromeContextSnapshot, ProfileConfig, SafetyCheckResult, SafetyFailure } from './types.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HARD_STOP_PATTERNS: Array<[string, RegExp]> = [
  ['captcha', /\b(?:captcha|verify you are human|human verification|complete (?:this )?security check|quick check needed|confirm (?:you(?:'re| are)(?: a)? )?real person|check the box below)\b/i],
  ['login_required', /\b(?:please )?(?:sign in|log in|login|create an account|create account|register).{0,40}(?:to continue|before continuing|required)|\bto continue.{0,40}(?:sign in|log in|login|required)\b/i],
  ['payment_required', /\b(?:enter|provide|add).{0,24}(?:payment details|billing details|credit card|card details)|\b(?:pay now|checkout to continue|purchase required)\b/i],
  ['checkout', /\b(?:checkout|complete purchase|place order|confirm and pay)\b/i],
  ['password_field', /\b(?:password|passcode|pin)\b/i],
]

export function detectHardStopSignals(visibleText: string): string[] {
  const signals: string[] = []
  for (const [name, pattern] of HARD_STOP_PATTERNS) {
    if (pattern.test(visibleText)) {
      signals.push(name)
    }
  }
  return signals
}

export function checkSafetyGate(
  chromeContext: ChromeContextSnapshot,
  visibleText: string,
  profileConfig: ProfileConfig,
): SafetyCheckResult {
  const failures: SafetyFailure[] = []

  const profileVerified = chromeContext.profile.status === 'verified'
    && chromeContext.profile.profile_path === profileConfig.profile_path
  if (!profileVerified) {
    failures.push({
      code: 'profile_mismatch',
      detail: `Expected "${profileConfig.profile_path}", observed "${chromeContext.profile.profile_path ?? 'unknown'}" (${chromeContext.profile.status})`,
      observed: chromeContext.profile.profile_path,
      expected: profileConfig.profile_path,
    })
  }

  const chromeForeground = chromeContext.isFrontmost
    && (chromeContext.frontmostAppBundleId === 'com.google.Chrome' || chromeContext.frontmostAppName?.toLowerCase().includes('chrome') === true)
  if (!chromeForeground) {
    failures.push({
      code: 'chrome_not_foreground',
      detail: `Chrome must be foreground; current: ${chromeContext.frontmostAppName ?? 'unknown'}`,
      observed: { appName: chromeContext.frontmostAppName, bundleId: chromeContext.frontmostAppBundleId },
      expected: { appName: 'Google Chrome', bundleId: 'com.google.Chrome' },
    })
  }

  const hardStopSignals = detectHardStopSignals(visibleText)
  if (hardStopSignals.length > 0) {
    failures.push({
      code: 'hard_stop_signal',
      detail: `Signals detected: ${hardStopSignals.join(', ')}`,
      observed: hardStopSignals,
    })
  }

  return {
    passed: failures.length === 0,
    checks: {
      profile_verified: profileVerified,
      chrome_foreground: chromeForeground,
      no_hard_stop_signal: hardStopSignals.length === 0,
    },
    failures,
  }
}

export async function loadProfileConfig(sessionRoot: string): Promise<ProfileConfig> {
  const configPath = resolve(sessionRoot, 'profile.json')
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw) as ProfileConfig
    if (!config.profile_path?.trim()) {
      throw new Error('profile.json missing profile_path')
    }
    return config
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Profile config not found at ${configPath}. Create CareerDeepSeek-data/computer-use/profile.json`)
    }
    throw err
  }
}
