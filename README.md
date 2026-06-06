# CareerDeepSeek

CareerDeepSeek is a bounded visible-browser job search agent for discovering AI engineering targets, evaluating opportunities, drafting outreach, and improving targeting through offline evals.

The repository is designed to be public. Real job leads, contacts, CVs, cover letters, screenshots, recruiter messages, and browsing evidence must stay outside this repo.

## Scope

- Score opportunities against a transparent fit rubric.
- Qualify target companies and teams before a specific role exists.
- Automate bounded visible-browser discovery sessions for target and opportunity search.
- Run offline evals on synthetic fixtures.
- Keep browser-use boundaries explicit.
- Use local macOS computer-use by default: screenshot, window metadata, AX tree, read-only Chrome DOM observation, and CGEvent input.
- Provide OpenCode/Codex project instructions for bounded work sessions.
- Generate drafts and CRM records in a private data directory, not in this repository.

## Non-goals

- No raw HTTP scraping.
- No hidden API reverse engineering.
- No unbounded background browsing.
- No headless bulk collection.
- No auto-apply.
- No auto-send messages.
- No real personal or contact data in public fixtures.

## Quick start

```bash
pnpm install
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run eval
pnpm run demo:discovery
pnpm run privacy:scan
```

The scoring rubrics are edited in Markdown. Generate the runtime JSON after rubric edits:

```bash
pnpm run generate:rubric
pnpm run generate:target-rubric
```

Score a target company/team JSON without writing private records:

```bash
pnpm exec tsx scripts/score-target.ts path/to/target.json
```

Write a scored target record only when `CAREERDEEPSEEK_DATA_DIR` points outside this repository:

```bash
CAREERDEEPSEEK_DATA_DIR=../CareerDeepSeek-data pnpm exec tsx scripts/score-target.ts path/to/target.json --write
```

Optional private data directory:

```bash
cp .env.example .env
```

Set `CAREERDEEPSEEK_DATA_DIR` to a repo-external path such as `../CareerDeepSeek-data`.

Optional DeepSeek model access:

```env
DEEPSEEK_API_KEY=
```

The real LLM capability is implemented as a Vercel AI SDK DeepSeek adapter at `src/llm/deepseekModelAdapter.ts`. It uses `deepseek-v4-pro`, DeepSeek thinking mode, and JSON output by default while preserving the internal `generateJson(request)` contract.

Run a real DeepSeek JSON smoke test after setting `DEEPSEEK_API_KEY`:

```bash
pnpm run smoke:llm
```

The default visible-browser runtime is `src/computer-use/`. Observation combines `screencapture -x`, `CGWindowListCopyWindowInfo`, macOS `AXUIElement`, and read-only JXA `tab.execute()` for Chrome DOM semantics. JXA is observation-only: it may read DOM text, attributes, computed style, viewport boxes, and occlusion data, but it must not click, type, navigate, dispatch events, or mutate DOM.

Before sending any CGEvent input, `MacOSComputerUseAdapter.act()` checks the foreground app. The default policy refuses mouse, keyboard, or scroll actions unless Google Chrome is frontmost. Real desktop scripts may explicitly opt into OS-level Chrome activation (`foregroundPolicy: 'auto_focus_chrome'`), which runs app activation only, rechecks the foreground app, and then continues with normal computer-use actions.

Real desktop tasks start by capturing a desktop screenshot, ensuring Google Chrome is open and frontmost, then capturing another screenshot after Chrome is confirmed frontmost. If Chrome is not open, the task may use OS-level app activation to open it; if Chrome is open but behind another app, the task may activate it. The task must observe the window state and confirm Chrome is frontmost before address-bar or page actions.

Run a local computer-use observation smoke test:

```bash
pnpm exec tsx scripts/run-computer-use-smoke.ts https://example.com
```

There is no `open_url` action or URL-opening bootstrap helper. URL navigation uses the same computer-use action path as other browsing: observe Chrome's AX tree, click the observed address-bar center, press `Cmd+L`, type the URL with CGEvent keyboard input, then press Enter. Page-internal search uses observed page elements such as a search box, not DOM actions.

Every screen action follows observe-before-act. CGEvent click coordinates must come from observed target bounds, not fixed offsets or guessed browser layout. Text entry temporarily switches macOS to a Latin keyboard input source (`U.S.` or `ABC`) while typing, then restores the previous user input source so IMEs do not rewrite ASCII queries.

Company discovery traces are structured as observe/action/observe steps with decision, action, before, after, duration, and result fields. Search-result deep dives must click the currently observed result link. Retyping a result URL into the address bar is a trace-visible policy failure.

Lightweight screen recording is a future debug artifact only. It may help review real runs, but it is not part of the action API and does not loosen the no browser-internal-automation boundary.

The older `src/observation/` browser observation modules are retained as reference implementations. They are not the default runtime.

## CI and local harness

Public CI runs only deterministic checks and synthetic fixtures. It does not call an LLM API and does not read private data:

```bash
pnpm run ci:public
```

Install the local pre-push hook when you want the full local gate before pushing:

```bash
pnpm run hooks:install
```

The pre-push hook runs lint, typecheck, tests, synthetic eval, synthetic discovery, the public privacy scan, and the private harness. The private harness reads `CAREERDEEPSEEK_DATA_DIR` or `../CareerDeepSeek-data` when present, validates repo-external target/review records, and prints only aggregate counts. If no private data directory is configured, it skips without failing.

## Project layout

```txt
src/
  automation/    Visual-action computer-use loop
  collection/    Collection workflow contracts
  computer-use/  macOS screenshot/window/AX/JXA observation and CGEvent actions
  llm/           Structured JSON model planner and extractor contracts
  observation/   Reference browser observation implementations
  workflows/     End-to-end discovery workflows
  scoring/       Fit scoring logic
  targets/       Target company/team scoring logic
  privateData/   Repo-external private data directory resolution
scripts/         Local eval and smoke-test commands
evals/           Synthetic fixtures, expected results, reports
config/          Generated runtime rubric and policy config
docs/            Architecture, privacy, browser-use policy, ADRs
templates/       Public templates with placeholders only
.opencode/       OpenCode project skills and prompts
```

## Privacy model

Public repo contains the engine. Private local data contains the fuel.

Do not store real assets under this repository. Use `CAREERDEEPSEEK_DATA_DIR` for all real CRM data, drafts, evidence, screenshots, and browsing outputs.
