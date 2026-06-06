/**
 * Computer-use configuration resolved from environment variables.
 *
 * All binary paths and runtime parameters are configurable via env vars
 * so the adapter works without hard-coded assumptions about the user's
 * macOS toolchain layout.
 */

import type { Bounds } from './types.js'

import process from 'node:process'

export interface ComputerUseConfig {
  /** Root directory for session artifacts (screenshots, audit logs). */
  sessionRoot: string
  /** Directory where screenshots are persisted. */
  screenshotsDir: string
  /** Maximum milliseconds for any single subprocess call. */
  timeoutMs: number

  binaries: {
    swift: string
    osascript: string
    screencapture: string
    open: string
  }

  /** Display bounds the adapter may interact within (global screen coords). */
  allowedBounds?: Bounds
  /** App names the adapter must never open or focus. */
  denyApps: string[]
  /** App names the adapter is allowed to open. */
  openableApps: string[]
}

function parseList(value: string | undefined, fallback: string[] = []): string[] {
  if (!value)
    return fallback
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value)
    return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseBounds(value: string | undefined): Bounds | undefined {
  if (!value)
    return undefined
  const parts = value.split(',').map(item => Number.parseFloat(item.trim()))
  if (parts.length !== 4 || parts.some(item => !Number.isFinite(item))) {
    throw new Error(`invalid COMPUTER_USE_ALLOWED_BOUNDS: ${value}`)
  }
  const [x, y, width, height] = parts
  if (width <= 0 || height <= 0) {
    throw new Error(`invalid COMPUTER_USE_ALLOWED_BOUNDS dimensions: ${value}`)
  }
  return { x, y, width, height }
}

export function resolveComputerUseConfig(
  env: NodeJS.ProcessEnv = process.env,
): ComputerUseConfig {
  const sessionRoot = env.COMPUTER_USE_SESSION_ROOT?.trim()
    || './.computer-use'

  return {
    sessionRoot,
    screenshotsDir: `${sessionRoot}/screenshots`,
    timeoutMs: parseInteger(env.COMPUTER_USE_TIMEOUT_MS, 15_000),

    binaries: {
      swift: env.COMPUTER_USE_SWIFT_BINARY?.trim() || 'swift',
      osascript: env.COMPUTER_USE_OSASCRIPT_BINARY?.trim() || 'osascript',
      screencapture: env.COMPUTER_USE_SCREENSHOT_BINARY?.trim() || 'screencapture',
      open: env.COMPUTER_USE_OPEN_BINARY?.trim() || 'open',
    },

    allowedBounds: parseBounds(env.COMPUTER_USE_ALLOWED_BOUNDS),
    denyApps: parseList(env.COMPUTER_USE_DENY_APPS, [
      '1Password',
      'Keychain',
      'System Settings',
      'Activity Monitor',
    ]),
    openableApps: parseList(env.COMPUTER_USE_OPENABLE_APPS, [
      'Finder',
      'Terminal',
      'Cursor',
      'Visual Studio Code',
      'Google Chrome',
    ]),
  }
}
