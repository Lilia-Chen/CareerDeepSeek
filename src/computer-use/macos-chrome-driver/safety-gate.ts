import type { ChromeContextSnapshot, ProfileConfig, SafetyCheckResult, SafetyFailure } from './types.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HARD_STOP_PATTERNS: Array<[string, RegExp]> = [
  ['captcha', /\b(?:captcha|verify you are human|human verification|complete (?:this )?security check)\b/i],
  ['login_required', /\b(?:please )?(?:sign in|log in|login|create an account|create account|register).{0,40}(?:to continue|before continuing|required)|\b(?:to continue).{0,40}(?:sign in|log in|login|required)\b/i],
  ['payment_required', /\b(?:enter|provide|add).{0,24}(?:payment details|billing details|credit card|card details)|\b(?:pay now|checkout to continue|purchase required)\b/i],
  ['checkout', /\b(?:checkout|complete purchase|place order|confirm and pay)\b/i],
  ['password_field', /\b(?:password|passcode|pin)\b/i],
]

export function detectHardStopSignals(visibleText: string): string[] {
  const signals: string[] = []
  for (const [name, pattern] of HARD_STOP_PATTERNS) {
    if (pattern.test(visibleText)) signals.push(name)
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
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Profile config not found at ${configPath}. Create CareerDeepSeek-data/computer-use/profile.json`)
    }
    throw err
  }
}

/**
 * Finds the Chrome window that is using the expected profile,
 * activates it, and returns the window index and profile path.
 * If no window matches, returns verified=false.
 */
export async function findAndActivateProfileWindow(expectedProfilePath: string): Promise<{
  verified: boolean
  windowIndex?: number
  observedPath?: string
  error?: string
}> {
  const jxaScript = `
var chrome = Application('Google Chrome');
var windows = chrome.windows();
if (windows.length === 0) {
  return JSON.stringify({ error: 'No Chrome windows open' });
}

for (var wi = 0; wi < windows.length; wi++) {
  try {
    var win = windows[wi];

    // Open chrome://version to check profile
    var versionTab = chrome.Tab({url: 'chrome://version/'});
    win.tabs.push(versionTab);
    delay(1.0);

    var text = versionTab.execute({javascript: 'document.body.innerText'});
    chrome.close(versionTab);

    // Parse Profile Path
    var profilePath = '';
    var lines = text.split('\\n');
    for (var j = 0; j < lines.length; j++) {
      if (lines[j].indexOf('Profile Path') === 0) {
        profilePath = lines[j].replace('Profile Path', '').trim();
        break;
      }
    }

    if (profilePath) {
      var profileDir = profilePath.split('/').pop();
      if (profileDir === '${expectedProfilePath}' || profilePath.indexOf('/Chrome/${expectedProfilePath}') >= 0) {
        // Found the right window — activate it
        win.index = 1; // bring to front
        chrome.activate();
        return JSON.stringify({
          windowIndex: wi,
          profilePath: profilePath,
          profileDir: profileDir,
        });
      }
    }
  } catch (e) {
    // JXA execute may be blocked on some windows — skip
  }
}

return JSON.stringify({ error: 'No Chrome window found with profile ${expectedProfilePath}' });
`

  try {
    const { execSync } = await import('node:child_process')
    const stdout = execSync(`osascript -l JavaScript -e '${jxaScript.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf-8',
      timeout: 30_000,
    })
    const result = JSON.parse(stdout.trim()) as { windowIndex?: number; profilePath?: string; profileDir?: string; error?: string }
    if (result.error) {
      return { verified: false, error: result.error }
    }
    return {
      verified: true,
      windowIndex: result.windowIndex,
      observedPath: result.profilePath,
    }
  } catch (err) {
    return { verified: false, error: `JXA profile find failed: ${(err as Error).message}` }
  }
}

