import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { buildPointerTrace } from '../../src/computer-use/pointer-trace.js'
import { resolveComputerUseConfig } from '../../src/computer-use/config.js'

// ---------------------------------------------------------------------------
// pointer-trace — Bezier curve path generation
// ---------------------------------------------------------------------------

describe('buildPointerTrace', () => {
  it('generates a trace from start to target with expected endpoint', () => {
    const trace = buildPointerTrace({
      from: { x: 100, y: 200 },
      to: { x: 400, y: 500 },
    })

    assert.ok(trace.length >= 4, `trace should have at least 4 points, got ${trace.length}`)
    assert.ok(trace.length <= 16, `trace should not exceed 16 points, got ${trace.length}`)

    // Last point must be the exact target
    const last = trace.at(-1)!
    assert.equal(last.x, 400)
    assert.equal(last.y, 500)
  })

  it('returns empty array when start equals target', () => {
    const trace = buildPointerTrace({
      from: { x: 100, y: 100 },
      to: { x: 100, y: 100 },
    })
    assert.equal(trace.length, 0)
  })

  it('generates a fallback start when from is omitted', () => {
    const trace = buildPointerTrace({
      to: { x: 400, y: 500 },
    })

    assert.ok(trace.length >= 4)
    const last = trace.at(-1)!
    assert.equal(last.x, 400)
    assert.equal(last.y, 500)

    // Fallback start should be offset from target
    const first = trace[0]
    assert.ok(first.x < 400, 'fallback start x should be less than target x')
  })

  it('respects custom step count', () => {
    const trace6 = buildPointerTrace({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      steps: 6,
    })
    assert.equal(trace6.length, 6)

    const trace20 = buildPointerTrace({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      steps: 20,
    })
    assert.equal(trace20.length, 20)
  })

  it('clamps points within allowed bounds', () => {
    const bounds = { x: 0, y: 0, width: 500, height: 400 }
    const trace = buildPointerTrace({
      from: { x: 10, y: 10 },
      to: { x: 600, y: 500 },
      bounds,
    })

    // All points must be within bounds
    for (const point of trace) {
      assert.ok(point.x >= bounds.x, `x=${point.x} should be >= ${bounds.x}`)
      assert.ok(point.x <= bounds.x + bounds.width, `x=${point.x} should be <= ${bounds.x + bounds.width}`)
      assert.ok(point.y >= bounds.y, `y=${point.y} should be >= ${bounds.y}`)
      assert.ok(point.y <= bounds.y + bounds.height, `y=${point.y} should be <= ${bounds.y + bounds.height}`)
    }
  })

  it('all points have valid delay values', () => {
    const trace = buildPointerTrace({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
    })

    for (const point of trace) {
      assert.ok(Number.isFinite(point.delayMs), `delayMs should be finite, got ${point.delayMs}`)
      assert.ok(point.delayMs >= 0)
    }
  })
})

// ---------------------------------------------------------------------------
// config — environment variable resolution
// ---------------------------------------------------------------------------

describe('resolveComputerUseConfig', () => {
  it('returns defaults when no env vars are set', () => {
    const config = resolveComputerUseConfig({})
    assert.equal(config.timeoutMs, 15_000)
    assert.equal(config.binaries.swift, 'swift')
    assert.equal(config.binaries.screencapture, 'screencapture')
    assert.equal(config.binaries.osascript, 'osascript')
    assert.equal(config.binaries.open, 'open')
    assert.ok(config.denyApps.includes('1Password'))
    assert.ok(config.openableApps.includes('Google Chrome'))
  })

  it('parses timeout from env', () => {
    const config = resolveComputerUseConfig({ COMPUTER_USE_TIMEOUT_MS: '5000' })
    assert.equal(config.timeoutMs, 5000)
  })

  it('parses custom binary paths', () => {
    const config = resolveComputerUseConfig({
      COMPUTER_USE_SWIFT_BINARY: '/opt/swift/bin/swift',
      COMPUTER_USE_OPENABLE_APPS: 'Terminal,Chrome',
    })
    assert.equal(config.binaries.swift, '/opt/swift/bin/swift')
    assert.equal(config.openableApps.length, 2)
    assert.equal(config.openableApps[0], 'Terminal')
    assert.equal(config.openableApps[1], 'Chrome')
  })

  it('parses deny apps from env', () => {
    const config = resolveComputerUseConfig({
      COMPUTER_USE_DENY_APPS: 'Photos,Messages',
    })
    assert.equal(config.denyApps.length, 2)
    assert.equal(config.denyApps[0], 'Photos')
    assert.equal(config.denyApps[1], 'Messages')
  })

  it('rejects malformed allowed bounds', () => {
    assert.throws(
      () => resolveComputerUseConfig({ COMPUTER_USE_ALLOWED_BOUNDS: '0,0,-1,500' }),
      /dimensions/,
    )
  })

  it('returns undefined allowed bounds when not set', () => {
    const config = resolveComputerUseConfig({})
    assert.equal(config.allowedBounds, undefined)
  })
})

// ---------------------------------------------------------------------------
// public barrel — driver-level computer-use API only
// ---------------------------------------------------------------------------

describe('computer-use public barrel', () => {
  it('does not expose raw observation or action primitives', async () => {
    const [publicApi, source] = await Promise.all([
      import('../../src/computer-use/index.js'),
      readFile(new URL('../../src/computer-use/index.ts', import.meta.url), 'utf8'),
    ])

    const forbiddenRuntimeExports = [
      'captureScreenshot',
      'observeWindows',
      'captureAXTree',
      'captureChromeDom',
      'buildPointerTrace',
      'executeMoveAndClick',
      'executeTypeText',
      'executePressKeys',
      'executeScroll',
      'executeOpenApp',
      'executeWindowTargetedScroll',
    ]

    for (const exportName of forbiddenRuntimeExports) {
      assert.equal(exportName in publicApi, false, `${exportName} must not be exported from the public barrel`)
      assert.doesNotMatch(
        source,
        new RegExp(`\\b${exportName}\\b`),
        `workflow-facing computer-use barrel must not re-export ${exportName}`,
      )
    }

    assert.doesNotMatch(
      source,
      /\bWindowTargetedScrollInput\b/,
      'workflow-facing computer-use barrel must not re-export the raw window-targeted scroll input type',
    )
  })
})

// ---------------------------------------------------------------------------
// chrome-dom — read-only JXA observer safety
// ---------------------------------------------------------------------------

describe('chrome DOM observer script', () => {
  it('guards text extraction against missing label and aria-labelledby targets', async () => {
    const source = await readFile(new URL('../../src/computer-use/chrome-dom.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /function text\(el\)\{if\(!el\)return'';/,
      'the embedded observer must handle null elements before reading innerText or textContent',
    )
  })

  it('collects viewport-visible text instead of whole-page body text', async () => {
    const source = await readFile(new URL('../../src/computer-use/chrome-dom.ts', import.meta.url), 'utf8')

    assert.doesNotMatch(
      source,
      /body&&doc\.body\.innerText|documentElement&&doc\.documentElement\.innerText/,
      'Chrome visibleText must not be populated from whole-page innerText because offscreen forms can trigger false stop signals',
    )
    assert.match(
      source,
      /createTreeWalker/,
      'Chrome visibleText should be collected from visible text nodes',
    )
    assert.match(
      source,
      /getClientRects/,
      'Chrome visibleText should use text-node rects to keep text viewport-bounded',
    )
  })

  it('does not emit login_required from passive header login text alone', async () => {
    const source = await readFile(new URL('../../src/computer-use/chrome-dom.ts', import.meta.url), 'utf8')

    assert.doesNotMatch(
      source,
      /low\.indexOf\('sign in'\).*login_required/s,
      'DOM observer should not mark any page with a Sign in header as login_required',
    )
    assert.match(
      source,
      /loginRequiredPattern/,
      'DOM observer should use blocking-login phrases before emitting login_required',
    )
  })

  it('recursively observes readable same-origin iframe content with viewport offsets', async () => {
    const source = await readFile(new URL('../../src/computer-use/chrome-dom.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /querySelectorAll\('iframe'\)/,
      'DOM observer should inspect same-origin iframes such as LinkedIn company preload frames',
    )
    assert.match(
      source,
      /contentDocument/,
      'DOM observer should read iframe documents when browser same-origin policy allows it',
    )
    assert.match(
      source,
      /frameRect\.x/,
      'iframe element bounds should be offset into the top-level viewport coordinate system',
    )
  })

  it('falls back to direct Chrome tab URL and title when DOM execution cannot be parsed', async () => {
    const source = await readFile(new URL('../../src/computer-use/chrome-dom.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /captureChromeDirectTab/,
      'Chrome observation should have an outer direct tab fallback when the full DOM JXA script fails',
    )
    assert.match(
      source,
      /return await captureChromeDirectTab\(config, targetWindow\)/,
      'captureChromeDom should return direct tab URL/title instead of null when primary observation fails',
    )
  })

  it('does not silently observe Chrome windows[0] when a target window hint is supplied', async () => {
    const source = await readFile(new URL('../../src/computer-use/chrome-dom.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /selectChromeWindow/,
      'Chrome DOM observer should select the target Chrome window before reading its active tab',
    )
    assert.match(
      source,
      /target_window_not_found/,
      'Chrome DOM observer should fail closed when a requested target window cannot be matched',
    )
    assert.doesNotMatch(
      source,
      /var tab = windows\[0\]\.activeTab\(\);/,
      'Chrome DOM observer must not blindly read windows[0] when the driver has a leased window',
    )
  })
})

describe('macOS scroll foreground HID fallback', () => {
  it('restores the real mouse position before settle sleep', async () => {
    const source = await readFile(new URL('../../src/computer-use/macos-actions.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /scrollEvent\.post\(tap: \.cghidEventTap\)[\s\S]*CGWarpMouseCursorPosition\(originalLocation\)[\s\S]*if settleMs > 0/,
      'foreground HID scroll must restore the cursor after posting the scroll event and before settle sleep',
    )
  })
})

describe('opencode browser-use skill', () => {
  it('documents the computer-use workflow boundary and LinkedIn page workflow', async () => {
    const source = await readFile(new URL('../../.opencode/skills/browser-use-policy/SKILL.md', import.meta.url), 'utf8')

    assert.match(
      source,
      /Desktop foreground state/,
      'skill must separate desktop foreground state from page-visible DOM state',
    )
    assert.match(
      source,
      /Page-visible DOM state/,
      'skill must explain that only visible page DOM candidates are actionable',
    )
    assert.match(
      source,
      /Address-bar use is bootstrap-only/,
      'skill must prevent repeated deep-dive navigation through the address bar',
    )
    assert.match(
      source,
      /LinkedIn feed/,
      'skill must tell agents how to continue from an already-open LinkedIn feed',
    )
    assert.match(
      source,
      /observe -> decide -> act -> observe/,
      'skill must preserve the observation/action loop',
    )
    assert.match(
      source,
      /cookie consent/i,
      'skill must include overlay handling',
    )
    assert.match(
      source,
      /CAPTCHA|payment|apply|send/i,
      'skill must include hard stop conditions',
    )
    assert.match(
      source,
      /semantic research controller/i,
      'skill must place internet research judgment in the agent controller, not in low-level automation rules',
    )
    assert.match(
      source,
      /discovery source/i,
      'skill must preserve rankings, directories, and analysis pages as company-discovery sources instead of treating every non-company page as irrelevant',
    )
  })

  it('documents duplicate-label disambiguation and browser-history recovery', async () => {
    const source = await readFile(new URL('../../.opencode/skills/browser-use-policy/SKILL.md', import.meta.url), 'utf8')

    assert.match(
      source,
      /Disambiguate duplicate labels/,
      'skill must prevent first-match clicks when multiple visible controls share the same label',
    )
    assert.match(
      source,
      /\/company\/\{slug\}\/jobs\//,
      'skill must distinguish company-local Jobs links from global LinkedIn Jobs navigation',
    )
    assert.match(
      source,
      /Back\/Forward recovery/,
      'skill must instruct agents to recover wrong navigation with observed browser Back/Forward controls',
    )
    assert.match(
      source,
      /Do not recover by typing the previous URL/,
      'wrong navigation recovery must not re-enter URLs through the address bar',
    )
    assert.match(
      source,
      /If browser history does not reach the intended workflow page/,
      'skill must handle SPA history gaps through observed page controls rather than address-bar URL re-entry',
    )
    assert.match(
      source,
      /observed exact recent query/,
      'LinkedIn workflow should allow selecting an observed exact recent search query from the page search UI',
    )
  })
})

describe('macOS action scripts', () => {
  it('posts input events through the session event tap', async () => {
    const source = await readFile(new URL('../../src/computer-use/macos-actions.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /\.cgSessionEventTap/,
      'macOS 26 Chrome receives keyboard and mouse CGEvents through the session event tap',
    )
  })

  it('uses the combined session event source for delivered input events', async () => {
    const source = await readFile(new URL('../../src/computer-use/macos-actions.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /\.combinedSessionState/,
      'macOS 26 Chrome receives posted CGEvents reliably from the combined session source',
    )
  })

  it('types ASCII text through physical virtual key events before Unicode fallback', async () => {
    const source = await readFile(new URL('../../src/computer-use/macos-actions.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /let asciiKeyMap: \[String: \(UInt16, CGEventFlags\)\]/,
      'Chrome omnibox ignores Unicode-only CGEvents; ASCII text must use physical key codes',
    )
    assert.match(
      source,
      /if let spec = asciiKeyMap\[charStr\.lowercased\(\)\]/,
      'ASCII characters should be routed through the physical key-code path',
    )
    assert.match(
      source,
      /keyboardSetUnicodeString/,
      'non-ASCII text should keep the Unicode fallback path',
    )
  })

  it('selects a Latin input source while typing and restores the previous source', async () => {
    const source = await readFile(new URL('../../src/computer-use/macos-actions.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /import Carbon/,
      'typing must use the macOS Text Input Source API',
    )
    assert.match(
      source,
      /com\.apple\.keylayout\.US/,
      'typing should prefer the U.S. Latin keyboard layout',
    )
    assert.match(
      source,
      /com\.apple\.keylayout\.ABC/,
      'typing should fall back to the ABC Latin keyboard layout',
    )
    assert.match(
      source,
      /restorePreviousInputSource\(\)/,
      'typing should restore the user input source after CGEvent text entry',
    )
  })

  it('routes window-targeted scroll events with AUV-compatible pid, window, and local-point fields', async () => {
    const source = await readFile(new URL('../../src/computer-use/macos-actions.ts', import.meta.url), 'utf8')

    assert.match(source, /scrollEvent\.location = screenLocation/)
    assert.match(source, /\.eventTargetUnixProcessID,\s*value: pid/)
    assert.match(source, /setRawIntegerField\(scrollEvent,\s*40,\s*pid\)/)
    assert.match(source, /setRawIntegerField\(scrollEvent,\s*51,\s*windowNumber\)/)
    assert.match(source, /setRawIntegerField\(scrollEvent,\s*91,\s*windowNumber\)/)
    assert.match(source, /setRawIntegerField\(scrollEvent,\s*92,\s*windowNumber\)/)
    assert.match(source, /CGEventSetWindowLocation/)
    assert.match(source, /slEventPostToPid\(pid_t\(pid\),\s*scrollEvent\)/)
    assert.match(source, /scrollEvent\.postToPid\(pid_t\(pid\)\)/)
  })

  it('restores the real cursor location after foreground HID scroll fallback', async () => {
    const source = await readFile(new URL('../../src/computer-use/macos-actions.ts', import.meta.url), 'utf8')

    assert.match(source, /let originalLocation = CGEvent\(source: nil\)\?\.location \?\? location/)
    assert.match(
      source,
      /scrollEvent\.post\(tap: \.cghidEventTap\)[\s\S]*CGWarpMouseCursorPosition\(originalLocation\)[\s\S]*if settleMs > 0/,
    )
  })
})

describe('computer-use action API boundary', () => {
  it('does not expose open_url as a computer-use action', async () => {
    const sources = await Promise.all([
      readFile(new URL('../../src/types.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/computer-use/macos-chrome-driver/driver.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/computer-use/index.ts', import.meta.url), 'utf8'),
    ])

    assert.doesNotMatch(
      sources.join('\n'),
      /open_url|executeOpenUrl/,
      'navigation must be address-bar keyboard input, not an open-url action/helper',
    )
  })
})
