# Architecture

CareerDeepSeek is a local-first eval and workflow repository with a bounded visible-browser computer-use runtime for target and opportunity discovery.

## Components

- Opportunity scoring rubric: `docs/scoring-rubric.md` is the canonical human-edited rubric for specific job opportunities.
- Target hunting rubric: `docs/target-rubric.md` is the canonical human-edited rubric for company or team targets before a specific role exists.
- Runtime rubric artifacts: `config/scoring-rubric.json` and `config/target-rubric.json` are generated from the Markdown rubrics.
- Scoring engines: deterministic scoring from structured opportunity or target signals and the generated runtime rubrics.
- macOS Chrome driver: `src/computer-use/macos-chrome-driver/` is the only bottom-level Chrome observation/action driver. It separates open-ended observation from target-specific recognition.
- Computer-use observation core: the driver captures Chrome window screenshots, capture coordinate contracts, window metadata, AX tree, OCR text, and read-only Chrome DOM semantics.
- Computer-use recognition core: target-specific `recognize(...)` calls locate a known target such as an address bar, search box, button, link, or visible text. Successful recognition can be promoted into a candidate ref for action.
- Computer-use action core: `src/computer-use/macos-actions.ts` executes mouse, keyboard, key, and scroll actions through Swift + Quartz `CGEvent`.
- Foreground context guard: `MacOSChromeDriver.observe()`, `recognize()`, and action methods ensure Google Chrome is open and frontmost before observation or input. The default policy rejects when another app is frontmost; `auto_focus_chrome` may use OS-level app activation and must recheck before continuing.
- Browser safety gate: deterministic code detects high-risk browser states and low-risk blocking overlays before evidence extraction. Cookie consent and marketing overlays may be dismissed through observed CGEvent clicks. Login, CAPTCHA, payment, checkout, apply, and send-message states produce hard stops.
- URL navigation is performed through the visible Chrome address bar with `Cmd+L`, keyboard text input, and Enter. There is no `open_url` action or URL-opening bootstrap helper.
- LLM decision layer: structured JSON model contract, DeepSeek V4 Pro adapter through Vercel AI SDK, visual action planner, evidence extractor, and end-to-end discovery workflow.
- Browser session policy: bounded visible-browser rules for source scope, stop conditions, private writes, and prohibited actions.
- Collection workflow core: session validation, action contract checks, page observation normalization, candidate classification, review item building, and private review queue writes.
- Page observation and evidence extraction: structured conversion of visible page content into short evidence summaries, missing information, risk flags, source labels, and observed timestamps.
- Candidate classifier: classifies pages as target company, job opportunity, person/contact surface, source evidence, or irrelevant.
- Review queue writer: writes ranked findings requiring human approval to the private data root.
- Synthetic evals: public fixtures that test decision thresholds and risk handling.
- Policy docs: browser-use and privacy constraints that every agent must follow.
- Private data root: repo-external directory for real CRM data and evidence.

## Data Flow

```txt
docs/scoring-rubric.md
  -> npm run generate:rubric
  -> config/scoring-rubric.json

docs/target-rubric.md
  -> npm run generate:target-rubric
  -> config/target-rubric.json

synthetic fixture or user-provided opportunity
  -> structured scoring inputs
  -> scoring engine
  -> decision and evidence summary
  -> eval comparison or private CRM write

target company/team JSON
  -> structured target signals
  -> target scoring engine
  -> decision, evidence summary, and next action
  -> optional private target record under CAREERDEEPSEEK_DATA_DIR/targets

bounded visible-browser discovery session
  -> MacOSChromeDriver.observe() ensures Chrome foreground
  -> address-bar keyboard navigation only when bootstrap is needed
  -> Chrome window screenshot + capture contract + windows + AX + OCR + read-only Chrome DOM
  -> MacOSChromeObservationSnapshot
  -> deterministic browser safety gate
  -> overlay dismissal or blocking stop
  -> recognize(target) for the next named target
  -> promoteChromeCandidate(recognition)
  -> coordinate-grounded CGEvent action against the promoted candidate
  -> observe/action/observe progress verification
  -> LLM evidence extraction
  -> target/opportunity classification
  -> scoring
  -> private CRM record and review queue write
```

Real opportunity records must be written only to `CAREERDEEPSEEK_DATA_DIR`.

## Computer-Use Runtime

The default runtime is macOS local computer-use.

Observation answers "what is currently visible?":

- `screencapture -l<windowid> -x -o` captures the active Chrome window and records a coordinate contract.
- `CGWindowListCopyWindowInfo` returns visible window bounds, titles, owner PIDs, real window numbers, layers, bundle ids, and frontmost app metadata.
- `AXUIElement` returns desktop accessibility roles, labels, values, bounds, focus, enabled state, and children.
- macOS Vision OCR reads visible text from the captured Chrome window screenshot.
- JXA `tab.execute({ javascript })` reads Chrome DOM semantics from the active tab.

Recognition answers "is the target I am looking for present and actionable?":

- `recognize({ kind: 'text_input', name })` locates search boxes, address bars, and text inputs.
- `recognize({ kind: 'button', text })` locates buttons such as cookie consent controls.
- `recognize({ kind: 'link', text })` locates page links for navigation.
- `recognize({ kind: 'visible_text', text })` confirms visible evidence text.
- Recognition returns `best`, `filtered`, `all`, evidence refs, and known limits. Action requires a promoted candidate, not a raw coordinate from the planner.

The JXA observer is read-only. It must not navigate, click, type, set values, dispatch events, mutate DOM, attach CDP, or use browser-internal action APIs.

Actions:

- Mouse movement and click use Swift + Quartz `CGEvent`.
- Text input uses keyboard events: ASCII characters use physical virtual key codes, and non-ASCII characters keep a Unicode fallback.
- Key chords use virtual key events.
- Scrolling uses Quartz scroll wheel events.

At task startup and before later observations, the driver ensures Google Chrome is open and frontmost. If Chrome is not open, `auto_focus_chrome` may open it through OS-level app activation. If Chrome is behind another app, `auto_focus_chrome` may activate it. The driver must observe window state and confirm a visible Chrome window is frontmost before returning observation.

Before `click`, `type`, `press`, or `scroll`, the driver checks the desktop foreground context again. The default policy is `require_chrome`: if Google Chrome is not frontmost, the operation is rejected before capture or CGEvent input. Workflows that need to recover from another local app being frontmost may opt into `auto_focus_chrome`; that policy uses OS-level app activation only, waits briefly, then rechecks that Chrome is frontmost. This does not allow browser-internal action APIs.

Desktop foreground state and page-visible DOM state are separate. Foreground state controls whether OS-level mouse and keyboard events can reach Chrome. Page-visible DOM state controls which elements from the current Chrome viewport/screenshot may be used as action targets. The runtime may keep read-only active-tab context, but only visible, unoccluded page elements should become action candidates.

Every screen action must be preceded by observation. Click coordinates must come from the current observation's DOM, AX, or window bounds for a named target. The runtime must not infer screen coordinates from fixed offsets, layout guesses, or hard-coded Chrome geometry.

The automatic visual action policy allows only click, type, press, scroll, wait, capture screenshots, or stop. URL navigation is not a separate action type; it is composed from visible keyboard actions against the Chrome address bar. Page-internal search uses observed page controls, such as a search box, and then normal CGEvent typing.

The browser safety gate runs before normal page work. It is hardcoded controller logic, not model judgment. It may dismiss low-risk overlays that block the real page content:

- cookie consent prompts, including `Yes, I agree` or equivalent accept controls
- marketing modals with an observed close, dismiss, no-thanks, or skip control

It must stop instead of clicking through high-risk states:

- login, SSO, passkey, account-selection, or credential flows
- CAPTCHA, human verification, security prompts, or suspicious-activity blocks
- payment, checkout, billing, or purchase prompts
- application submission, send-message, connect, follow, or other external side-effect flows

Passive page links such as a header `Sign in` button are not themselves stop states. The stop applies when the visible page requires authentication, identity verification, payment, application submission, or sending before continuing.

A job description page with a visible `Apply` button remains readable evidence. The hard stop starts before application submission or form entry, not before extracting role, location, team, and technical signals from the JD.

Text entry temporarily switches macOS to a Latin keyboard input source (`U.S.` or `ABC`) while sending CGEvent key codes, then restores the previous user input source. This prevents CJK input methods from converting ASCII queries while keeping the user's desktop input source intact after the action.

Real discovery scripts must write structured computer-use traces under the configured session root. A trace entry records the phase, decision, action summary, before observation, after observation, duration, and result or error. Search-result deep dives must follow currently observed result links by coordinate-grounded click; they must not retype observed result hrefs into the address bar.

Overlay and stop handling must be trace-visible. `overlay_dismissal` records the observed overlay control and before/after observations. `blocking_stop_signal` records the high-risk signal and ends the run as `stopped`, not as a normal failed implementation error.

Production agent mode differs from development mode. Development mode may edit code and register tools. Production agent mode may only call pre-registered tools behind policy gates. It must not create new tools, change action policy, add browser automation routes, or modify stop conditions during a run.

Current workflow control is skill-driven. `.opencode/skills/browser-use-policy/SKILL.md` is the operational guide for the OpenCode/Codex agent during interactive browser research. The agent acts as the workflow controller, while computer-use remains the atomic observation/action layer. Stable, repeatedly validated parts of this skill workflow may later be encoded as deterministic state machines.

Future unattended runs should add a browser/profile-level safety harness around the workflow. The intended direction is a dedicated Chrome agent profile, not the user's daily profile. The harness should detect the active Chrome profile at startup and refuse to run, or switch through an approved startup path, unless the active profile is the agent profile. That profile may keep limited approved login state for research sources, while avoiding stored payment methods, broad password autofill, unrelated accounts, and personal browsing history. Chrome policy details must be verified against official Chrome policy documentation before implementation.

Future debugging may add lightweight screen recording with macOS-native capture, such as `screencapture` video mode or ScreenCaptureKit, so a reviewer can inspect action timing with multimodal tools. Recording is an audit artifact only. It is not an action primitive and must not introduce browser-internal automation.

## Reference Implementations

`src/observation/` remains in the repository as reference implementations for DOM semantic observation. CDP, Playwright, WebDriver, extension bridge actions, DOM click, DOM value assignment, and event dispatch are not part of the default runtime.

## Implementation Boundary

The current implementation proves:

- deterministic scoring and target rubric contracts
- public/private data separation
- synthetic eval loop
- computer-use observation and CGEvent action primitives
- deterministic overlay and browser safety gate
- LLM action planning constrained by visible coordinate-grounded actions
- review queue writes to repo-external private data

Out of scope until explicitly approved:

- raw HTTP scraping
- hidden APIs
- CAPTCHA bypass
- proxy rotation
- headless bulk collection
- auto-apply
- auto-send behavior
- browser-internal action routes
- databases
- LLM-driven self-modification
