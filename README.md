# CareerDeepSeek

CareerDeepSeek is a human-in-the-loop job search workbench for evaluating AI engineering opportunities, drafting outreach, and improving targeting through offline evals.

The repository is designed to be public. Real job leads, contacts, CVs, cover letters, screenshots, recruiter messages, and browsing evidence must stay outside this repo.

## Scope

- Score opportunities against a transparent fit rubric.
- Run offline evals on synthetic fixtures.
- Keep browser-use boundaries explicit.
- Provide OpenCode/Codex project instructions for bounded work sessions.
- Generate drafts and CRM records in a private data directory, not in this repository.

## Non-goals

- No raw HTTP scraping.
- No hidden API reverse engineering.
- No unattended platform browsing.
- No auto-apply.
- No auto-send messages.
- No real personal or contact data in public fixtures.

## Quick start

```bash
npm test
npm run eval
```

Optional private data directory:

```bash
cp .env.example .env
```

Set `CAREERDEEPSEEK_DATA_DIR` to a repo-external path such as `../CareerDeepSeek-data`.

## Project layout

```txt
src/
  scoring/       Fit scoring logic
scripts/         Local eval commands
evals/           Synthetic fixtures, expected results, reports
config/          Public scoring rubric and policy config
docs/            Architecture, privacy, browser-use policy, ADRs
templates/       Public templates with placeholders only
.opencode/       OpenCode project skills and prompts
```

## Privacy model

Public repo contains the engine. Private local data contains the fuel.

Do not store real assets under this repository. Use `CAREERDEEPSEEK_DATA_DIR` for all real CRM data, drafts, evidence, screenshots, and browsing outputs.

