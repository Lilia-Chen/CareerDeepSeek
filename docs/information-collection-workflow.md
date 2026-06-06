# Information Collection Workflow

CareerDeepSeek collects job-search intelligence through bounded visible-browser sessions. The default runtime uses local macOS computer-use: observe the real screen, ground visible targets, interact through OS mouse and keyboard events, extract short evidence, classify candidates, score them, and write private records only after the private-write boundary is approved.

It must not become a raw scraper, crawler, hidden API client, CAPTCHA bypass tool, or browser-internal automation system.

## Goal

```txt
bounded browser session
  -> adapter observe() ensures Chrome foreground
  -> screenshot + windows + AX + read-only Chrome DOM observation
  -> DesktopGroundingSnapshot
  -> hardcoded browser safety gate
  -> low-risk overlay dismissal when needed
  -> coordinate-grounded CGEvent action
  -> observe/action/observe progress verification
  -> page observation
  -> LLM evidence extraction
  -> candidate classification
  -> rubric scoring
  -> private record and review queue write
```

## Required Tools

### Computer-Use Adapter

The default adapter is `MacOSComputerUseAdapter` from `src/computer-use/`.

```txt
observe() -> VisualState-compatible observation
act(action) -> ActionResult
```

`observe()` first ensures Google Chrome is frontmost, then captures:

- screenshot PNG metadata through `screencapture -x`
- visible windows through `CGWindowListCopyWindowInfo`
- desktop accessibility nodes through `AXUIElement`
- Chrome DOM semantics through read-only JXA `tab.execute()`

The observation sources are merged into a `DesktopGroundingSnapshot`. Candidate source priority is:

```txt
chrome_dom > ax > vision > raw
```

`act(action)` executes:

- `click` through Swift + Quartz `CGEvent` mouse movement and click
- `type` through keyboard events; ASCII uses physical virtual key codes, non-ASCII keeps a Unicode fallback
- `press` through keyboard virtual key events
- `scroll` through Quartz scroll wheel events
- `wait`
- `capture_screenshot`
- `stop`

At task startup and before every later observation, `observe()` must ensure Google Chrome is frontmost. If Chrome is not open, auto-focus mode may use OS-level app activation to open it. If another app is frontmost, auto-focus mode may activate Chrome. The adapter must recheck the window state and confirm a visible Chrome window is frontmost before returning observation.

Before `click`, `type`, `press`, or `scroll`, `act()` must check the foreground app again. Default behavior is to reject input unless Google Chrome is frontmost. Real desktop workflows may explicitly opt into OS-level Chrome activation; after activation, the adapter must recheck that Chrome is frontmost before posting CGEvents.

Two states must not be conflated. Desktop foreground state decides whether OS mouse and keyboard input can reach Chrome. Page-visible DOM state decides which observed page elements are action candidates. The workflow should fix desktop foreground through adapter guard before observation. Within a loaded page, hidden, covered, offscreen, or overlay-blocked DOM must not be clicked even if the read-only DOM observer can see it.

Before `type`, the action executor temporarily selects a Latin keyboard input source (`U.S.` or `ABC`), sends CGEvent key codes, then restores the previous user input source. This prevents active CJK IMEs from converting ASCII queries.

URL navigation is not a separate action. It must be composed through the visible Chrome address bar with `press Cmd+L`, `type`, and `press Enter`.

Before any screen action, the workflow must observe the current desktop. Action coordinates must be copied from the current observation for a named target. For example, address-bar navigation first observes Chrome's AX tree, finds the `AXTextField` described as "Address and search bar", clicks that observed center, then sends keyboard events. Page-internal search first observes the page search field, clicks its observed center, then types. The workflow must not use fixed offsets or guessed browser chrome coordinates.

After a search results page is reached, deeper navigation must use currently observed page links. The workflow may scroll the visible results page, observe again, extract visible candidate links, and click the chosen link's observed center. It must not take a result href and re-enter it through the address bar. If already on a usable LinkedIn feed, the next search step uses the observed LinkedIn page search box, not the Chrome address bar.

If several visible controls have the same text, the workflow must rank candidates before clicking. The rank must use current workflow intent, local page region, href target, and nearby text rather than first text match. On LinkedIn, company-local tabs such as `/company/{slug}/jobs/`, `/company/{slug}/posts/`, and `/company/{slug}/people/` must be distinguished from global top-nav links with the same labels.

If a click moves the session to the wrong page, the workflow should recover through observed Chrome history controls. It must observe the current page, click the observed Back or Forward button through CGEvent, then observe again. It must not recover by typing the previous URL into the address bar.

If browser history does not reach the intended workflow page, the workflow should continue through observed page controls rather than address-bar recovery. On LinkedIn, the page search control and an observed exact recent query can return the session to a known search result set, after which the workflow chooses the required vertical filter.

Before extracting evidence from a page, the workflow must detect whether the visible page is blocked by a transient overlay rather than showing the real page content. Cookie consent prompts and low-risk marketing modals may be dismissed by deterministic code only. The dismissal target must come from the current observation and must be clicked through the normal CGEvent action path.

Cookie consent is treated as a low-risk browsing prerequisite. If the current observation contains a cookie prompt with `Yes, I agree`, `I agree`, `Accept all cookies`, or equivalent accept controls, the workflow may click that observed control. If only a close control or rejection control is visible, the workflow may use that observed control. It must not open cookie preference managers as part of automated collection.

Marketing overlays such as newsletter prompts, report download promos, demo promos, or modal popups may be closed only through an observed close/dismiss/no-thanks control. The workflow must not click the overlay's CTA, submit a form, enter an email address, download a report, request a demo, or sign up.

Login, CAPTCHA, payment, checkout, account, identity, apply, and send-message states are not dismissible overlays. They are hard stop states. The workflow must record `blocking_stop_signal` in the trace and end the session with `stopped`, not ask the model to reason about whether it can continue.

### Read-Only Chrome DOM Observer

Chrome DOM observation uses JXA only to read the active tab. The injected script may collect:

- current URL and title
- visible text
- role/name/text approximations from HTML and ARIA
- computed visibility
- viewport-clipped bounding boxes
- center points
- `elementFromPoint(center)` occlusion checks
- stop signals such as CAPTCHA, login, or rate limit text

The injected script must not:

- navigate
- click
- type
- set input values
- dispatch DOM events
- mutate DOM
- attach CDP/debugger
- use hidden APIs

### LLM Adapter

The LLM adapter exposes:

```txt
generateJson(request) -> object
```

The model never receives permission to execute actions directly. It only returns structured JSON to deterministic code.

The current workflow calls the model for:

- `plan_visual_action` - choose one next visible, coordinate-grounded action.
- `extract_page_observation` - convert a final visual state into short evidence and candidate fields.

Deterministic code owns:

- action policy checks
- stop-condition checks
- overlay dismissal and high-risk browser safety gates
- progress verification
- scoring
- file writes

## Runtime Mode Boundary

CareerDeepSeek has two different modes:

- Development mode: engineers may edit code, register tools, change policy, and run tests.
- Production agent mode: the agent may only call pre-registered tools. It must not create new tools, modify tool policy, add browser automation paths, change stop conditions, or bypass the harness while a task is running.

Production agent mode relies on hardcoded controllers before any model decision. The model may report what it sees, propose evidence, or select among allowed visible actions. It does not get authority to decide that a high-risk state is safe, invent a new action, or continue past a hard stop.

Future work may add a browser/profile-level safety harness for unattended sessions. That harness should use a dedicated Chrome agent profile rather than the user's daily profile. At startup, it should detect the active Chrome profile and refuse to run, or switch through an approved startup path, unless the active profile is the agent profile. The agent profile may keep approved logged-in state for a small set of research sources, but should avoid stored payment methods, broad password autofill, unrelated accounts, and personal browsing history.

The profile sandbox is a second hard boundary around the workflow. It should reduce the damage available from an accidental click even if a page tries to lead the agent into an identity, payment, or account flow. Exact Chrome profile and policy support must be checked against official Chrome documentation before implementation.

## Visual State

A visual state is the agent's grounded view of the current surface:

```json
{
  "sessionId": "agent-discovery-2026-06-06",
  "url": "https://search.example/search?q=agent+infrastructure+hiring",
  "title": "Search results",
  "sourceType": "search_engine",
  "observedAt": "2026-06-06T11:00:00.000Z",
  "screenshot": {
    "id": "shot-search",
    "width": 1440,
    "height": 900
  },
  "visibleText": "Synthetic Agent Lab - Careers.",
  "elements": [
    {
      "id": "result-synthetic-agent-lab",
      "role": "link",
      "text": "Synthetic Agent Lab Careers",
      "href": "https://synthetic-agent-lab.example/careers",
      "box": {
        "x": 160,
        "y": 220,
        "width": 420,
        "height": 36
      },
      "center": {
        "x": 370,
        "y": 238
      }
    }
  ],
  "signals": []
}
```

The normalized visual state computes element centers so actions can be coordinate-grounded.

## Trace Contract

Real computer-use sessions write structured traces under the configured session root, not inside the public repository unless the session root is explicitly set there for a local test.

Each trace step records:

- `phase` - the workflow phase, such as Google search, result scroll, deep-dive click, or return to search results.
- `decision` - why this action was selected.
- `action` - the CGEvent action summary, including element id, point, key, scroll delta, or target metadata.
- `before` and `after` - compact observation summaries with URL, title, screenshot id, element count, link count, and visible text snippet.
- `durationMs` - elapsed action time.
- `result` or `error` - the observed outcome.

Trace replay must make URL-input misuse visible. If a deep-dive step follows a search result, its action must be a coordinate-grounded click on the observed result link, not address-bar navigation to that link's href.

Trace replay must also make wrong-navigation recovery visible. A recovery step should record the incorrect page, the observed Back or Forward control that was clicked, the recovered page, and the next disambiguated target selection.

Trace replay must also make overlay handling and hard stops visible. Overlay dismissals use `phase: "overlay_dismissal"` and include the overlay kind, the observed clicked element, before/after observation summaries, and the workflow phase that was blocked. High-risk states use `phase: "blocking_stop_signal"` and record the stop signal, such as `login_required`, `captcha`, `payment_required`, or `apply_or_send_required`.

Future debugging may add macOS-native screen recording for selected sessions. That recording would be a private audit artifact for human or multimodal review. It must not become a control path, DOM action route, or browser-internal automation mechanism.

## Action Contract

Automatic session actions:

- `click` - move the OS pointer to a visible element center and click.
- `type` - type text into the focused visible field.
- `press` - press a key or key chord.
- `scroll` - scroll the visible surface.
- `wait` - wait for visible page changes.
- `capture_screenshot` - capture a screenshot for supervised understanding.
- `stop` - stop when the budget or a stop condition is reached.

Forbidden action types include:

- `raw_http_fetch`
- `hidden_api_call`
- `sitemap_crawl`
- `solve_captcha`
- `rotate_proxy`
- `headless_bulk_collect`
- `bulk_extract_platform`
- `auto_apply`
- `send_message`
- `auto_add_connection`

Production agents must not add new action types at runtime. Any new action type, tool, policy branch, or browser control path is a development-mode code change and requires review before it can be registered.

## Processing Actions

Processing happens after visible page observation:

- Normalize page observations.
- Extract short evidence bullets.
- Classify the page as `target_company`, `job_opportunity`, `person_contact_surface`, `source_evidence`, or `irrelevant`.
- Score targets and opportunities with the generated runtime rubrics.
- Write private records and review queue items to `CAREERDEEPSEEK_DATA_DIR`.

## Session Contract

A collection session must define:

```json
{
  "id": "agent-discovery-2026-06-06",
  "goal": "Find production AI agent infrastructure companies with hiring signals.",
  "sourceScope": ["search_engine", "company_site", "public_careers", "engineering_blog", "github_org"],
  "pageBudget": {
    "maxPages": 8
  },
  "stopConditions": ["login_required", "captcha", "rate_limited", "budget_exceeded"]
}
```

Allowed source classes:

- `search_engine`
- `company_site`
- `public_careers`
- `public_ats`
- `engineering_blog`
- `documentation`
- `changelog`
- `github_org`

## Page Observation Contract

A page observation stores structured facts from the visible page. It must not store raw page dumps.

```json
{
  "sessionId": "agent-discovery-2026-06-06",
  "url": "https://synthetic-agent-lab.example/careers",
  "title": "Synthetic Agent Lab Careers",
  "sourceType": "company_site",
  "observedAt": "2026-06-06T10:00:00.000Z",
  "evidence": [
    {
      "label": "domain_alignment",
      "text": "Builds agent runtime observability for production AI systems.",
      "sourceUrl": "https://synthetic-agent-lab.example/careers"
    }
  ],
  "extracted": {
    "candidateType": "target_company"
  }
}
```

## Review Queue Contract

The review queue is the handoff between automated collection and human decisions.

Review items include:

- Session id.
- Candidate type and id.
- Private record type.
- Score and decision.
- Source URL, title, source type, and observed timestamp.
- Short evidence bullets.
- Missing information.
- Risk flags.
- Next action.

Review items are written to:

```txt
$CAREERDEEPSEEK_DATA_DIR/review-queue
```

## Stop Conditions

The browser session must record a hard stop before:

- Entering a login, SSO, passkey, account-selection, or credential flow.
- Handling account, identity, payment, or security prompts.
- Solving CAPTCHA or anti-bot challenges.
- Continuing after rate limiting or suspicious-activity warnings.
- Opening pages beyond the approved budget.
- Saving personal contact data.
- Sending any message or application.
- Changing source class or platform-specific behavior.
- Starting CDP or any browser-internal automation mode.

Passive header links such as a normal `Sign in` button are not enough to stop the session. The stop condition applies when the visible page is asking the session to authenticate, verify identity, pay, apply, or send something before continuing.

## Implemented Modules

Default computer-use runtime:

- `src/computer-use/config.ts` - environment-backed runtime configuration.
- `src/computer-use/screenshot.ts` - `screencapture -x` screenshot capture.
- `src/computer-use/window-observation.ts` - `CGWindowListCopyWindowInfo` window observation.
- `src/computer-use/ax-tree.ts` - macOS AX tree capture.
- `src/computer-use/chrome-dom.ts` - read-only JXA Chrome DOM observation.
- `src/computer-use/desktop-grounding.ts` - source merging, de-duplication, and ranking.
- `src/computer-use/overlay-resolver.ts` - deterministic overlay dismissal and high-risk browser stop detection.
- `src/computer-use/macos-actions.ts` - Swift + Quartz CGEvent action executors.
- `src/computer-use/macos-adapter.ts` - `MacOSComputerUseAdapter`.

Automation and workflow:

- `src/automation/visualState.ts` - validates screenshot-backed visual state and computes element centers.
- `src/automation/actionSpace.ts` - constructs coordinate-grounded click/type actions.
- `src/automation/actionPolicy.ts` - rejects forbidden action types and high-risk element intents.
- `src/automation/progressVerifier.ts` - verifies action progress by URL, title, screenshot, or visible text changes.
- `src/automation/mockComputerUseAdapter.ts` - deterministic computer-use adapter for tests.
- `src/automation/sessionRunner.ts` - observe/action/observe session loop with budget and stop-condition handling.
- `src/automation/visualObservation.ts` - converts visual state into a collection page observation without saving raw visible text.
- `src/llm/modelContract.ts` - minimal `generateJson(request)` adapter contract.
- `src/llm/deepseekModelAdapter.ts` - Vercel AI SDK DeepSeek adapter for `deepseek-v4-pro` JSON output.
- `src/llm/visualActionPlanner.ts` - asks the model for the next visible action and converts click outputs into coordinate-grounded actions.
- `src/llm/evidenceExtractor.ts` - asks the model for evidence and candidate fields, then normalizes them into a page observation.
- `src/workflows/runDiscoveryWorkflow.ts` - runs the full discovery loop from visual state to review queue item.

Reference implementations:

- `src/observation/` — DOM observation contracts and CDP debug observer (not the default runtime).

## Demo Commands

Run the computer-use observation smoke test:

```bash
pnpm exec tsx scripts/run-computer-use-smoke.ts https://example.com
```

Run the computer-use Google discovery smoke task:

```bash
pnpm exec tsx scripts/run-discovery-task.ts "AI agent infrastructure hiring 2026"
```

Run the synthetic visual discovery demo:

```bash
pnpm run demo:discovery
```

The synthetic demo uses a mock computer-use adapter, a deterministic mock model, synthetic visual states, the real session runner, target scoring, and review queue builder. It does not write private files unless the script is run with `--write` and `CAREERDEEPSEEK_DATA_DIR` is configured.
