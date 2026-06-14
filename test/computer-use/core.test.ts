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
      /return await captureChromeDirectTab\(config\)/,
      'captureChromeDom should return direct tab URL/title instead of null when primary observation fails',
    )
  })
})

// ---------------------------------------------------------------------------
// discovery smoke script — Google search box role matching
// ---------------------------------------------------------------------------

describe('discovery task script', () => {
  it('navigates searches through the visible address bar', async () => {
    const source = await readFile(new URL('../../scripts/run-discovery-task.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /navigateViaObservedAddressBar\(driver, 'google\.com'\)/,
      'discovery should first navigate to Google through the visible address bar',
    )
    assert.match(
      source,
      /driver\.recognizeLegacy\(\{\s*kind:\s*'text_input',\s*name:\s*\/address and search bar\/i/,
      'discovery should recognize the Chrome address bar semantically',
    )
    assert.match(
      source,
      /promoteChromeCandidate\(addressBar\)/,
      'discovery should promote the address-bar recognition before clicking',
    )
    assert.match(
      source,
      /driver\.clickLegacy\(promoteChromeCandidate\(addressBar\)\)/,
      'discovery should click the promoted address-bar candidate before typing startup URLs',
    )
    assert.doesNotMatch(
      source,
      /window\.bounds\.(x|y)\s*\+|window\.bounds\.width\s*\*|window\.bounds\.height\s*\*/,
      'discovery click coordinates must come from observed target bounds, not inferred window offsets',
    )
    assert.match(
      source,
      /searchGoogle\(driver, query\)/,
      'discovery should locate and submit the Google search box through the driver',
    )
    assert.match(
      source,
      /promoteChromeCandidate\(searchBox\)/,
      'discovery should promote the recognized Google search box before clicking',
    )
  })

  it('does not use open_url for startup navigation', async () => {
    const source = await readFile(new URL('../../scripts/run-discovery-task.ts', import.meta.url), 'utf8')

    assert.doesNotMatch(
      source,
      /type:\s*['"]open_url['"]/,
      'discovery startup must navigate through the visible address bar with keyboard input',
    )
  })

  it('validates that address-bar navigation reached Google Search', async () => {
    const source = await readFile(new URL('../../scripts/run-discovery-task.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /assertGoogleSearch/,
      'discovery must fail if address-bar navigation did not reach Google Search',
    )
  })

  it('explicitly opts into OS-level Chrome focus for real desktop startup', async () => {
    const source = await readFile(new URL('../../scripts/run-discovery-task.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /new MacOSChromeDriver/,
      'discovery should use the macOS Chrome driver as its only real browser control entry',
    )
    assert.match(
      source,
      /foregroundPolicy:\s*'auto_focus_chrome'/,
      'discovery may activate Chrome at the OS layer before using observed address-bar coordinates',
    )
  })
})

describe('computer-use smoke script', () => {
  it('does not use open_url for startup navigation', async () => {
    const source = await readFile(new URL('../../scripts/run-computer-use-smoke.ts', import.meta.url), 'utf8')

    assert.doesNotMatch(
      source,
      /type:\s*['"]open_url['"]/,
      'smoke startup must navigate through the visible address bar with keyboard input',
    )
  })

  it('validates that address-bar navigation reached the requested URL', async () => {
    const source = await readFile(new URL('../../scripts/run-computer-use-smoke.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /normalizeOrigin/,
      'smoke must fail if visible observation did not reach the requested URL',
    )
    assert.match(
      source,
      /driver\.recognizeLegacy\(\{\s*kind:\s*'text_input',\s*name:\s*\/address and search bar\/i/,
      'smoke should recognize the Chrome address bar before clicking',
    )
    assert.doesNotMatch(
      source,
      /window\.bounds\.(x|y)\s*\+|window\.bounds\.width\s*\*|window\.bounds\.height\s*\*/,
      'smoke click coordinates must come from observed target bounds, not inferred window offsets',
    )
  })

  it('explicitly opts into OS-level Chrome focus for real desktop startup', async () => {
    const source = await readFile(new URL('../../scripts/run-computer-use-smoke.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /new MacOSChromeDriver/,
      'smoke should use the macOS Chrome driver as its only real browser control entry',
    )
    assert.match(
      source,
      /foregroundPolicy:\s*'auto_focus_chrome'/,
      'smoke may activate Chrome at the OS layer before using observed address-bar coordinates',
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

describe('opencode company research workflow skill', () => {
  it('documents evidence coverage, confidence caps, and completion criteria', async () => {
    const source = await readFile(new URL('../../.opencode/skills/company-research-workflow/SKILL.md', import.meta.url), 'utf8')

    assert.match(
      source,
      /Score is not confidence/,
      'company research skill must separate numeric fit from research confidence',
    )
    assert.match(
      source,
      /evidence matrix/i,
      'company research skill must force rubric-dimension evidence tracking',
    )
    assert.match(
      source,
      /10-15 candidates/,
      'company research skill must require a candidate pool before deep dive',
    )
    assert.match(
      source,
      /Shortlist 5-8/,
      'company research skill must define a shortlist size',
    )
    assert.match(
      source,
      /Decision caps/,
      'company research skill must define confidence-based decision caps',
    )
    assert.match(
      source,
      /Do not stop as complete/,
      'company research skill must prevent shallow completion',
    )
    assert.match(
      source,
      /Iteration Loop/,
      'company research skill must require rerun-audit-patch cycles',
    )
    assert.match(
      source,
      /Quality Audit/,
      'company research skill must define a final report quality audit',
    )
    assert.match(
      source,
      /Company Completion Gate/,
      'company research skill must define when an individual company review is complete',
    )
    assert.match(
      source,
      /no obvious, low-cost, decision-changing source path left untried/,
      'company completion must require exhausting obvious decision-changing source paths',
    )
    assert.match(
      source,
      /direct company surface[\s\S]*hiring surface[\s\S]*LinkedIn company\/jobs\/people surface[\s\S]*technical evidence surface[\s\S]*independent source/,
      'company completion must enumerate required source classes',
    )
    assert.match(
      source,
      /open official site[\s\S]*open careers[\s\S]*inspect LinkedIn jobs[\s\S]*inspect LinkedIn people[\s\S]*open GitHub/,
      'company completion must reject next actions that merely open obvious evidence sources',
    )
    assert.match(
      source,
      /Search Context Invariant/,
      'company research skill must require search-surface classification before typing a new query',
    )
    assert.match(
      source,
      /Google discovery query must be typed into an observed Google page search box/,
      'company research skill must prevent Google discovery queries from drifting into another site search box',
    )
    assert.match(
      source,
      /Do not type a Google discovery query into the LinkedIn top search box/,
      'company research skill must document the observed LinkedIn-search drift failure mode',
    )
    assert.match(
      source,
      /One Back is not proof/,
      'company research skill must require observation-based verification after browser history recovery',
    )
    assert.match(
      source,
      /search_submission_mismatch/,
      'company research skill must require verification that a submitted query actually changed the result page',
    )
    assert.match(
      source,
      /rank matches by source value before click/,
      'company research skill must prevent broad company-name matches from outranking direct sources',
    )
    assert.match(
      source,
      /Read more[\s\S]*Show more[\s\S]*Learn more[\s\S]*specific role title or JD page/,
      'company research skill must prevent generic Google expansion links from replacing concrete source entries',
    )
    assert.match(
      source,
      /job-list page/,
      'company research skill must not count ATS list pages as role-level evidence when a specific JD is needed',
    )
    assert.match(
      source,
      /specific JD/,
      'company research skill must require opening a specific job description when role evidence is still missing',
    )
    assert.match(
      source,
      /not satisfied.*goal complete|goal complete.*not satisfied/s,
      'company research skill must prevent premature completion when the researcher is still unsatisfied',
    )
    assert.match(
      source,
      /homepage-only company gets `priority_target`/,
      'company research skill must include the observed homepage-only failure mode',
    )
  })

  it('documents company research completion in the collection workflow', async () => {
    const source = await readFile(new URL('../../docs/information-collection-workflow.md', import.meta.url), 'utf8')

    assert.match(
      source,
      /Company Research Completion/,
      'collection workflow must reference company research completion criteria',
    )
    assert.match(
      source,
      /researchQuality\.confidence/,
      'collection workflow must require confidence separate from score',
    )
    assert.match(
      source,
      /Medium confidence caps/,
      'collection workflow must document confidence caps',
    )
    assert.match(
      source,
      /quality audit/i,
      'collection workflow must require quality audits between research passes',
    )
  })
})

// ---------------------------------------------------------------------------
// macos-actions — CGEvent delivery
// ---------------------------------------------------------------------------

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
})

describe('computer-use action API boundary', () => {
  it('does not expose open_url as a computer-use action', async () => {
    const sources = await Promise.all([
      readFile(new URL('../../src/types.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/automation/actionSpace.ts', import.meta.url), 'utf8'),
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
