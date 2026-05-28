# CareerDeepSeek

CareerDeepSeek is a bounded visible-browser job search agent for discovering AI engineering targets, evaluating opportunities, drafting outreach, and improving targeting through offline evals.

The repository is designed to be public. Real job leads, contacts, CVs, cover letters, screenshots, recruiter messages, and browsing evidence must stay outside this repo.

## Scope

- Score opportunities against a transparent fit rubric.
- Qualify target companies and teams before a specific role exists.
- Automate bounded visible-browser discovery sessions for target and opportunity search.
- Run offline evals on synthetic fixtures.
- Keep browser-use boundaries explicit.
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

## Project layout

```txt
src/
  automation/    Visual-action browser/computer-use loop
  collection/    Browser-use collection workflow contracts
  llm/           Structured JSON model planner and extractor contracts
  workflows/     End-to-end discovery workflows
  scoring/       Fit scoring logic
  targets/       Target company/team scoring logic
  privateData/   Repo-external private data directory resolution
scripts/         Local eval commands
evals/           Synthetic fixtures, expected results, reports
config/          Generated runtime rubric and policy config
docs/            Architecture, privacy, browser-use policy, ADRs
templates/       Public templates with placeholders only
.opencode/       OpenCode project skills and prompts
```

## Privacy model

Public repo contains the engine. Private local data contains the fuel.

Do not store real assets under this repository. Use `CAREERDEEPSEEK_DATA_DIR` for all real CRM data, drafts, evidence, screenshots, and browsing outputs.
