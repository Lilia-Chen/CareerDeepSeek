import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { buildPointerTrace } from '../../src/computer-use/pointer-trace.js'
import { boundsIoU } from '../../src/computer-use/desktop-grounding.js'
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
// boundsIoU — Intersection over Union
// ---------------------------------------------------------------------------

describe('boundsIoU', () => {
  it('returns 1 for identical bounds', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    assert.equal(boundsIoU(a, a), 1)
  })

  it('returns 0 for completely separate bounds', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 200, y: 200, width: 100, height: 100 }
    assert.equal(boundsIoU(a, b), 0)
  })

  it('returns ~0.5 for half-overlapping bounds', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 50, y: 0, width: 100, height: 100 }
    const iou = boundsIoU(a, b)
    // Intersection area = 50*100 = 5000
    // Union area = 10000 + 10000 - 5000 = 15000
    // IoU = 5000/15000 = 0.333...
    assert.ok(iou > 0.3 && iou < 0.35, `expected ~0.333, got ${iou}`)
  })

  it('handles bounds with zero dimensions', () => {
    const a = { x: 0, y: 0, width: 0, height: 100 }
    const b = { x: 0, y: 0, width: 100, height: 100 }
    assert.equal(boundsIoU(a, b), 0)
  })

  it('handles negative intersection gracefully', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 150, y: 150, width: 100, height: 100 }
    assert.equal(boundsIoU(a, b), 0)
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
      /navigateToUrl\(adapter, config, 'google\.com'\)/,
      'discovery should first navigate to Google through the visible address bar',
    )
    assert.match(
      source,
      /captureAXTree\(config, \{ pid: window\.ownerPid/,
      'discovery should locate Chrome address-bar bounds from AX observation',
    )
    assert.match(
      source,
      /address and search bar/i,
      'discovery should identify the Chrome address bar semantically, not by fixed coordinates',
    )
    assert.match(
      source,
      /elementId:\s*'chrome-address-bar'/,
      'discovery should click the observed Chrome address-bar target before typing startup URLs',
    )
    assert.doesNotMatch(
      source,
      /window\.bounds\.(x|y)\s*\+|window\.bounds\.width\s*\*|window\.bounds\.height\s*\*/,
      'discovery click coordinates must come from observed target bounds, not inferred window offsets',
    )
    assert.match(
      source,
      /findGoogleSearchBox/,
      'discovery should locate the Google search box from observed page elements',
    )
    assert.match(
      source,
      /const center = \(searchBox\.center \|\| searchBox\.box\)/,
      'discovery should click the observed search-box center before typing',
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
      /assertUrlIsGoogleSearch/,
      'discovery must fail if address-bar navigation did not reach Google Search',
    )
    assert.match(
      source,
      /submitAddressBar/,
      'discovery should retry Enter until the observed address bar submits',
    )
  })

  it('explicitly opts into OS-level Chrome focus for real desktop startup', async () => {
    const source = await readFile(new URL('../../scripts/run-discovery-task.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /ensureChromeReadyAtTaskStart\(config\)/,
      'discovery should initialize Chrome context before address-bar or page actions',
    )
    assert.match(
      source,
      /captureScreenshot\(config, 'task_start_before_chrome_context'\)/,
      'discovery should capture the desktop before entering browser work',
    )
    assert.match(
      source,
      /captureScreenshot\(config, 'task_start_chrome_frontmost'\)/,
      'discovery should capture proof after Chrome is confirmed frontmost',
    )
    assert.match(
      source,
      /executeOpenApp\(config, 'Google Chrome'\)/,
      'discovery may open or activate Chrome at the OS layer when the task starts',
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
      /assertObservedUrlMatchesTarget/,
      'smoke must fail if visible observation did not reach the requested URL',
    )
    assert.match(
      source,
      /captureAXTree\(config, \{ pid: window\.ownerPid/,
      'smoke should locate Chrome address-bar bounds from AX observation',
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
      /ensureChromeReadyAtTaskStart\(config\)/,
      'smoke should initialize Chrome context before address-bar actions',
    )
    assert.match(
      source,
      /captureScreenshot\(config, 'task_start_before_chrome_context'\)/,
      'smoke should capture the desktop before entering browser work',
    )
    assert.match(
      source,
      /captureScreenshot\(config, 'task_start_chrome_frontmost'\)/,
      'smoke should capture proof after Chrome is confirmed frontmost',
    )
    assert.match(
      source,
      /executeOpenApp\(config, 'Google Chrome'\)/,
      'smoke may open or activate Chrome at the OS layer when the task starts',
    )
    assert.match(
      source,
      /foregroundPolicy:\s*'auto_focus_chrome'/,
      'smoke may activate Chrome at the OS layer before using observed address-bar coordinates',
    )
  })
})

describe('company discovery script', () => {
  it('deep-dives by clicking observed search-result links, not by typing hrefs into the address bar', async () => {
    const source = await readFile(new URL('../../scripts/run-company-discovery.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /visitByClick\(adapter, link,/,
      'company deep-dive must follow the observed result link with a coordinate-grounded click',
    )
    assert.doesNotMatch(
      source,
      /visitCompanySite/,
      'company deep-dive must not call a URL-navigation helper for result links',
    )
    assert.doesNotMatch(
      source,
      /navigateToUrl\(adapter, config, link\.href\)|navigateToUrl\(adapter, config, canonicalHref\)/,
      'company deep-dive must not retype observed result hrefs through the address bar',
    )
  })

  it('scrolls down through Google results before collecting links', async () => {
    const source = await readFile(new URL('../../scripts/run-company-discovery.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /deltaY:\s*-\d+/,
      'scrolling down the Google results page uses negative deltaY in this CGEvent runtime',
    )
    assert.match(
      source,
      /collectSearchResultsWithScroll/,
      'company discovery should observe and scroll repeatedly until enough search-result links are visible',
    )
  })

  it('writes structured action trace entries with before and after observations', async () => {
    const source = await readFile(new URL('../../scripts/run-company-discovery.ts', import.meta.url), 'utf8')

    assert.match(source, /recordStep/, 'company discovery should record structured trace steps')
    assert.match(source, /before:/, 'trace entries should include the before observation')
    assert.match(source, /after:/, 'trace entries should include the after observation')
    assert.match(source, /action:/, 'trace entries should include the executed action')
    assert.match(source, /decision:/, 'trace entries should include the decision rationale')
    assert.match(source, /durationMs:/, 'trace entries should include elapsed time')
  })

  it('returns from result pages opened in a new Chrome tab without URL re-entry', async () => {
    const source = await readFile(new URL('../../scripts/run-company-discovery.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /readChromeTabContext/,
      'company discovery should observe Chrome tab context before clicking a search result',
    )
    assert.match(
      source,
      /if \(!window\.tabs\.length\)/,
      'Chrome tab context reading must handle an empty Chrome window without assuming activeTab exists',
    )
    assert.match(
      source,
      /tabCount\s*>\s*expected\.tabCount/,
      'company discovery should detect result links that opened a new tab',
    )
    assert.match(
      source,
      /isGoogleSearchUrl\(currentTab\.url\)/,
      'company discovery should not close tabs when the active tab is already back on Google Search',
    )
    assert.match(
      source,
      /key:\s*'w',\s*modifiers:\s*\['command'\]/,
      'company discovery should close the newly opened tab through CGEvent Cmd+W',
    )
    assert.match(
      source,
      /focusOpenedBackgroundTab/,
      'company discovery should handle result links that open a background tab',
    )
    assert.match(
      source,
      /key:\s*'right',\s*modifiers:\s*\['command',\s*'option'\]/,
      'company discovery should switch to a newly opened background tab through CGEvent keyboard input',
    )
    assert.doesNotMatch(
      source,
      /navigateToUrl\(adapter, config, .*return/i,
      'company discovery must not recover from result pages by typing URLs into the address bar',
    )
  })

  it('uses address-bar navigation only when the current page is not already Google', async () => {
    const source = await readFile(new URL('../../scripts/run-company-discovery.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /function isGooglePageUrl/,
      'company discovery should classify whether the current observed page is already a Google page',
    )
    assert.match(
      source,
      /if \(!isGooglePageUrl\(googleState\.url\)\)/,
      'company discovery should gate startup address-bar navigation behind the current page context',
    )
    assert.match(
      source,
      /google_context_reuse/,
      'company discovery should trace when it reuses the observed Google page instead of typing into the address bar',
    )
  })

  it('does not close tabs or fail return logic on unreliable about:statusindicator observations', async () => {
    const source = await readFile(new URL('../../scripts/run-company-discovery.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /isObservationUrlUnreliable/,
      'company discovery should identify Chrome status-indicator observations as unreliable page URLs',
    )
    assert.match(
      source,
      /about:statusindicator/,
      'company discovery should explicitly treat about:statusindicator as an unreliable observation URL',
    )
    assert.match(
      source,
      /patchStateUrlFromTab/,
      'company discovery should patch unreliable observed URLs from direct Chrome tab context',
    )
    assert.match(
      source,
      /canCloseNewTabForReturn/,
      'company discovery should gate Cmd+W recovery behind a deterministic close-safety check',
    )
    assert.match(
      source,
      /!isObservationUrlUnreliable\(currentTab\.url\)/,
      'company discovery must not close a tab when the current tab URL is an unreliable status page',
    )
    assert.match(
      source,
      /currentTab\.tabCount\s*>\s*1/,
      'company discovery must never close the last remaining Chrome tab during return recovery',
    )
    assert.match(
      source,
      /isGoogleSearchUrl\(expected\.url\)/,
      'company discovery should only close a newly opened result tab when the expected tab context is Google Search',
    )
    assert.match(
      source,
      /const afterTab = await readChromeTabContext\(\)[\s\S]*patchStateUrlFromTab\(after, afterTab\)/,
      'overlay dismissal must patch unreliable post-dismissal observations from direct Chrome tab context',
    )
  })

  it('writes trace output even when the real desktop run fails mid-session', async () => {
    const source = await readFile(new URL('../../scripts/run-company-discovery.ts', import.meta.url), 'utf8')

    assert.match(source, /writeTraceFile/, 'company discovery should centralize trace persistence')
    assert.match(source, /finally\s*\{[\s\S]*writeTraceFile/, 'company discovery should persist trace in a finally block')
  })

  it('filters Google text-fragment sublinks such as read-more from company candidates', async () => {
    const source = await readFile(new URL('../../scripts/run-company-discovery.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /url\.hash\s*=\s*''/,
      'company discovery should dedupe text-fragment hrefs against the primary result URL',
    )
    assert.match(
      source,
      /'read more'/,
      'company discovery should reject Google read-more sublinks as candidates',
    )
  })

  it('dedupes search candidates by company domain and rejects CTA or job-board links', async () => {
    const source = await readFile(new URL('../../scripts/run-company-discovery.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /candidateDomainKey/,
      'company discovery should dedupe Google result candidates by domain',
    )
    assert.match(
      source,
      /NON_CANDIDATE_LINK_TEXTS/,
      'company discovery should reject generic CTA sitelinks such as demo, contact, and about links',
    )
    assert.match(
      source,
      /BLOCKED_CANDIDATE_HOSTS/,
      'company discovery should reject job boards and non-company aggregation hosts',
    )
  })

  it('filters listicle and directory hosts from direct company deep dives', async () => {
    const source = await readFile(new URL('../../scripts/run-company-discovery.ts', import.meta.url), 'utf8')

    for (const host of [
      'wellows.com',
      'startupnetworks.co.uk',
      'entrepreneurloop.com',
      'aimultiple.com',
      'cbinsights.com',
    ]) {
      assert.match(
        source,
        new RegExp(`'${host.replace(/\./g, '\\.')}'`),
        `company discovery should not treat ${host} listicle/directory pages as company targets`,
      )
    }
  })

  it('filters sponsored Google result links before collecting company candidates', async () => {
    const source = await readFile(new URL('../../scripts/run-company-discovery.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /collapseSponsoredResults/,
      'company discovery should collapse visible sponsored Google results before collecting candidates',
    )
    assert.match(
      source,
      /phase:\s*'sponsored_results_collapse'/,
      'sponsored result collapse should be visible in the trace',
    )
    assert.match(
      source,
      /googleSponsoredResultRange/,
      'company discovery should identify the visible sponsored-results block on Google Search',
    )
    assert.match(
      source,
      /Hide sponsored results/,
      'company discovery should use the observed end of the sponsored block as a deterministic boundary',
    )
    assert.match(
      source,
      /isGoogleSponsoredResultLink/,
      'company discovery should filter sponsored links before planning deep dives',
    )
  })

  it('uses a deterministic overlay gate before extracting deep-dive evidence', async () => {
    const source = await readFile(new URL('../../scripts/run-company-discovery.ts', import.meta.url), 'utf8')

    assert.match(
      source,
      /detectBlockingStopSignal/,
      'company discovery should hard-stop high-risk states through code, not through model judgment',
    )
    assert.match(
      source,
      /planOverlayDismissal/,
      'company discovery should use a deterministic overlay resolver before evidence extraction',
    )
    assert.match(
      source,
      /phase:\s*'overlay_dismissal'/,
      'overlay dismissal must be visible in the structured trace',
    )
    assert.match(
      source,
      /phase:\s*'blocking_stop_signal'/,
      'login, CAPTCHA, payment, apply, or send states must be marked in the structured trace',
    )
    assert.match(
      source,
      /status:\s*'running'\s*\|\s*'completed'\s*\|\s*'failed'\s*\|\s*'stopped'/,
      'high-risk blocking states should stop the session without marking the run as a failed implementation error',
    )
    assert.doesNotMatch(
      source,
      /planNextVisualAction\(.*overlay|overlay.*planNextVisualAction/s,
      'overlay safety decisions must not be delegated to the LLM visual action planner',
    )
  })
})

describe('OpenCode browser-use skill', () => {
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
      readFile(new URL('../../src/computer-use/macos-adapter.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/computer-use/index.ts', import.meta.url), 'utf8'),
    ])

    assert.doesNotMatch(
      sources.join('\n'),
      /open_url|executeOpenUrl/,
      'navigation must be address-bar keyboard input, not an open-url action/helper',
    )
  })
})
