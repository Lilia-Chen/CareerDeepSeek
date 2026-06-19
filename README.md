# CareerDeepSeek

CareerDeepSeek is a bounded visible-browser job search agent for discovering AI engineering targets, evaluating opportunities, drafting outreach, and improving targeting through offline evals.

The repository is designed to be public. Real job leads, contacts, CVs, cover letters, screenshots, recruiter messages, and browsing evidence must stay outside this repo.

## Scope

- Score opportunities against a transparent fit rubric.
- Qualify target companies and teams before a specific role exists.
- Run offline evals on synthetic fixtures.
- Provide bounded macOS Chrome computer-use primitives for supervised research runs.
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

Computer-use code lives under `src/computer-use/`. Real browser traces and screenshots are private runtime data and should be written under `COMPUTER_USE_SESSION_ROOT` outside this repository.

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
docs/            Privacy, rubric, and QA notes
templates/       Public templates with placeholders only
```

## Privacy model

Public repo contains the engine. Private local data contains the fuel.

Do not store real assets under this repository. Use `CAREERDEEPSEEK_DATA_DIR` for all real CRM data, drafts, evidence, screenshots, and browsing outputs.
