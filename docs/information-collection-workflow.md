# Information Collection Workflow

CareerDeepSeek collects job-search intelligence through bounded visible-browser sessions. The default browser layer behaves like a careful human observer using a real browser: read the current visible page, corroborate DOM-visible structure with screenshot context, extract short evidence, classify candidates, score them, and write structured private records only after the private-write boundary is approved.

It must not become a raw scraper, crawler, hidden API client, CAPTCHA bypass tool, or auto-application system.

## Goal

Automate the collection loop for AI engineering targets and opportunities:

```txt
bounded browser session
  -> read-only browser observation
  -> DOM-visible + ARIA/HTML semantic approximation
  -> screenshot corroboration
  -> optional CDP debug corroboration
  -> page observation
  -> LLM evidence extraction
  -> candidate classification
  -> rubric scoring
  -> private record and review queue write
```

## Required Tools

### Read-Only Browser Observer

The default browser observer has one method:

```txt
observe() -> DomSemanticObservation
```

`observe()` returns the current visible page state. It does not click, type, navigate, mutate DOM, create global markers, or attach CDP. The default observer is implemented by `src/observation/` and the minimal MV3 extension under `extensions/careerdeepseek-observer/`.

The default observation contains:

- DOM-visible semantic candidates.
- ARIA/HTML-derived role, name, state, and relationship approximation.
- computed style visibility.
- viewport bounding boxes.
- `elementFromPoint(center)` occlusion checks.
- screenshot preview or screenshot metadata.

This is not native browser accessibility tree data.

### CDP Debug Observer

Native AX tree corroboration is explicit debug mode only. The initial CDP allowlist is:

```txt
Accessibility.getFullAXTree
DOMSnapshot.captureSnapshot
Page.captureScreenshot
```

The debug observer must not use `Runtime.evaluate`, `Input.*`, DOM mutation commands, or network inspection commands.

### Computer-Use Adapter

The action-capable debug/automation path expects a browser-use adapter with two methods:

```txt
observe() -> VisualState
act(action) -> ActionResult
```

`observe()` returns the current visual state of the browser surface. `act(action)` executes one policy-checked action such as clicking a coordinate-grounded element, typing text, pressing a key, scrolling, waiting, opening a URL, or stopping.

The repository includes a mock adapter for deterministic tests and a Playwright-backed browser-use adapter for explicit debug/automation experiments. The Playwright adapter is not the default browser observation layer. It must not call `element.click()`, assign `input.value`, dispatch synthetic DOM events, or control the OS desktop.

### LLM Adapter

The MVP expects an LLM adapter with one method:

```txt
generateJson(request) -> object
```

The model never receives permission to execute actions directly. It only returns structured JSON to deterministic code.

The current MVP calls the model for two tasks:

- `plan_visual_action` - choose one next visual action from the current state.
- `extract_page_observation` - convert the final visual state into short evidence and candidate fields.

The deterministic workflow still owns:

- action policy checks
- stop-condition checks
- progress verification
- scoring
- file writes

### Visual State

A visual state is the agent's grounded view of the current surface:

```json
{
  "sessionId": "agent-discovery-2026-05-21",
  "url": "https://search.example/search?q=agent+infrastructure+hiring",
  "title": "Search results",
  "sourceType": "search_engine",
  "observedAt": "2026-05-21T11:00:00.000Z",
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
      }
    }
  ],
  "signals": []
}
```

The normalized visual state computes element center points so actions can be coordinate-grounded.

### Browser Actions

The browser adapter exposes only visible-browser actions:

- `open_url` - open an approved public URL in the visible browser.
- `click` - move the browser mouse to a visible element center point and click.
- `type` - type text into the focused visible field.
- `press` - press a key.
- `scroll` - scroll the visible surface.
- `wait` - wait for visible page changes.
- `capture_screenshot` - capture a screenshot for supervised understanding.
- `stop_session` - stop when the budget or a stop condition is reached.

The workflow rejects forbidden action types before execution, including:

- `raw_http_fetch`
- `hidden_api_call`
- `sitemap_crawl`
- `solve_captcha`
- `rotate_proxy`
- `headless_bulk_collect`
- `auto_apply`
- `send_message`
- `auto_add_connection`

### Processing Actions

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
  "id": "agent-discovery-2026-05-21",
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
  "sessionId": "agent-discovery-2026-05-21",
  "url": "https://synthetic-agent-lab.example/careers",
  "title": "Synthetic Agent Lab Careers",
  "sourceType": "company_site",
  "observedAt": "2026-05-21T10:00:00.000Z",
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

The browser session must stop and ask before:

- Logging in.
- Handling account, identity, payment, or security prompts.
- Solving CAPTCHA or anti-bot challenges.
- Continuing after rate limiting or suspicious-activity warnings.
- Opening pages beyond the approved budget.
- Saving personal contact data.
- Sending any message or application.
- Changing source class or platform-specific behavior.
- Starting CDP native AX/DOMSnapshot debug mode.
- Starting Playwright/browser-use action mode.

## Browser Observation MVP

The default MVP implements the read-only observation loop:

```txt
current tab
  -> one-shot DOM observation
  -> ARIA/HTML semantic approximation
  -> viewport and occlusion filtering
  -> screenshot metadata
  -> compact observation JSON
```

Implemented observation modules:

- `src/observation/browserObservation.js` - observation contracts and boundary validation.
- `src/observation/domSemanticObserver.js` - browser-context read-only DOM and ARIA/HTML semantic approximation.
- `src/observation/cdpDebugObserver.js` - explicit CDP debug observer with read-only command allowlist.
- `extensions/careerdeepseek-observer/` - minimal MV3 extension using `activeTab` and `scripting`.
- `scripts/run-browser-observation-experiment.ts` - local synthetic browser experiment comparing default observation with CDP debug corroboration.

## Visual Action Debug MVP

The action-capable debug MVP implements the visual-action loop:

```txt
normalize visual state
  -> choose visual action
  -> check action policy
  -> act through browser-use adapter
  -> observe again
  -> verify progress
  -> repeat or stop
```

Implemented automation modules:

- `src/automation/visualState.js` - validates screenshot-backed visual state and computes element centers.
- `src/automation/actionSpace.js` - constructs visual actions such as coordinate-grounded clicks and typing.
- `src/automation/actionPolicy.js` - rejects forbidden action types and high-risk element intents such as apply, login, CAPTCHA, payment, or send-message actions.
- `src/automation/progressVerifier.js` - verifies action progress by URL, title, screenshot, or visible text changes.
- `src/automation/mockComputerUseAdapter.js` - deterministic computer-use adapter for tests.
- `src/automation/browserUseAdapter.js` - Playwright-backed debug/automation adapter that observes DOM-plus-screenshot visual state and executes through mouse/keyboard/page actions.
- `src/automation/sessionRunner.js` - observe/action/observe session loop with budget and stop-condition handling.
- `src/automation/visualObservation.js` - converts a visual state into a collection page observation without saving raw visible text.

## LLM Discovery MVP

The current discovery MVP still wires visual action to model decisions:

```txt
VisualState
  -> src/llm/visualActionPlanner.js
  -> policy-checked Action
  -> src/automation/sessionRunner.js
  -> final VisualState
  -> src/llm/evidenceExtractor.js
  -> PageObservation
  -> collection classification/scoring/review queue
```

Implemented LLM/workflow modules:

- `src/llm/modelContract.js` - minimal `generateJson(request)` adapter contract.
- `src/llm/deepseekModelAdapter.js` - Vercel AI SDK DeepSeek adapter for `deepseek-v4-pro` JSON output.
- `src/llm/visualActionPlanner.js` - asks the model for the next action and converts click outputs into coordinate-grounded actions.
- `src/llm/evidenceExtractor.js` - asks the model for evidence and candidate fields, then normalizes them into a page observation.
- `src/workflows/runDiscoveryWorkflow.js` - runs the full discovery loop from visual state to review queue item.

The model may suggest actions and extraction fields, but it cannot bypass policy checks, write files directly, or perform high-risk actions.

## Demo Command

Run the browser observation experiment:

```bash
pnpm run experiment:browser-observation
```

Set `CAREERDEEPSEEK_OBSERVER_HEADLESS=true` when a headed browser is not available.

Run the synthetic visual discovery demo:

```bash
npm run demo:discovery
```

The demo uses:

- a mock computer-use adapter
- a deterministic mock model
- synthetic search and company visual states
- the real session runner, LLM planner/extractor interfaces, target scoring, and review queue builder

It prints the visual action trace and generated review queue item. It does not write private files unless the script is run with `--write` and `CAREERDEEPSEEK_DATA_DIR` is configured.

## Current Implementation

The current implementation provides the workflow core, read-only browser observation MVP, and visual-action debug MVP:

- `src/observation/browserObservation.js`
- `src/observation/domSemanticObserver.js`
- `src/observation/cdpDebugObserver.js`
- `src/automation/visualState.js`
- `src/automation/actionSpace.js`
- `src/automation/actionPolicy.js`
- `src/automation/progressVerifier.js`
- `src/automation/mockComputerUseAdapter.js`
- `src/automation/sessionRunner.js`
- `src/automation/visualObservation.js`
- `src/llm/modelContract.js`
- `src/llm/deepseekModelAdapter.js`
- `src/llm/visualActionPlanner.js`
- `src/llm/evidenceExtractor.js`
- `src/workflows/runDiscoveryWorkflow.js`
- `src/collection/sessionPolicy.js`
- `src/collection/toolContract.js`
- `src/collection/pageObservation.js`
- `src/collection/classifyCandidate.js`
- `src/collection/buildReviewItem.js`
- `src/collection/writeReviewQueue.js`

It now ships a minimal read-only browser observer and an explicit CDP debug observer. The next step is wiring read-only observation outputs into discovery before reintroducing any supervised action-capable browser automation.
