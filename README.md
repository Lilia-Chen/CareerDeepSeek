# CareerDeepSeek

CareerDeepSeek is a bounded visible-browser job search agent for discovering AI engineering targets, evaluating opportunities, drafting outreach, and improving targeting through offline evals.

The repository is designed to be public. Real job leads, contacts, CVs, cover letters, screenshots, recruiter messages, and browsing evidence must stay outside this repo.

## Scope

- Score opportunities against a transparent fit rubric.
- Qualify target companies and teams before a specific role exists.
- Automate bounded visible-browser discovery sessions for target and opportunity search.
- Run offline evals on synthetic fixtures.
- Keep browser-use boundaries explicit.
- Use a low-footprint read-only browser observer by default.
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

The default browser observation capability is the read-only observer under `src/observation/` plus the minimal MV3 extension under `extensions/careerdeepseek-observer/`. It captures DOM-visible elements, ARIA/HTML-derived semantic approximation, viewport boxes, occlusion checks, and screenshot metadata. This is not Chrome's native accessibility tree.

Run the local browser observation experiment:

```bash
pnpm run experiment:browser-observation
```

Set `CAREERDEEPSEEK_OBSERVER_HEADLESS=true` when a headed browser is not available.

Native AX and DOMSnapshot corroboration is available only through the explicit CDP debug observer. The Playwright-backed `src/automation/browserUseAdapter.ts` remains a debug/automation adapter that can execute browser actions; it is not the default observation layer.

## CI and local harness

Public CI runs only deterministic checks and synthetic fixtures. It does not call an LLM API and does not read private data:

```bash
pnpm run browsers:install
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
  automation/    Visual-action browser/computer-use loop
  collection/    Browser-use collection workflow contracts
  llm/           Structured JSON model planner and extractor contracts
  observation/   Read-only browser observation and CDP debug observers
  workflows/     End-to-end discovery workflows
  scoring/       Fit scoring logic
  targets/       Target company/team scoring logic
  privateData/   Repo-external private data directory resolution
scripts/         Local eval commands
extensions/      Minimal read-only browser observer extension
evals/           Synthetic fixtures, expected results, reports
config/          Generated runtime rubric and policy config
docs/            Architecture, privacy, browser-use policy, ADRs
templates/       Public templates with placeholders only
.opencode/       OpenCode project skills and prompts
```

## Privacy model

Public repo contains the engine. Private local data contains the fuel.

Do not store real assets under this repository. Use `CAREERDEEPSEEK_DATA_DIR` for all real CRM data, drafts, evidence, screenshots, and browsing outputs.
