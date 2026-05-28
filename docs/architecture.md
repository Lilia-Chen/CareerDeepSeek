# Architecture

CareerDeepSeek starts as a local-first eval and workflow repository, then adds bounded visible-browser discovery sessions for automated job and target search.

## Components

- Opportunity scoring rubric: `docs/scoring-rubric.md` is the canonical human-edited rubric for specific job opportunities.
- Target hunting rubric: `docs/target-rubric.md` is the canonical human-edited rubric for company or team targets before a specific role exists.
- Runtime rubric artifacts: `config/scoring-rubric.json` and `config/target-rubric.json` are generated from the Markdown rubrics.
- Scoring engines: deterministic scoring from structured opportunity or target signals and the generated runtime rubrics.
- Visual-action automation core: screenshot-backed visual state, coordinate-grounded action space, action policy, progress verification, mock computer-use adapter, and session runner.
- LLM decision layer: structured JSON model contract, visual action planner, evidence extractor, and end-to-end discovery workflow.
- Browser session policy: bounded visible-browser automation rules for search, navigation, evidence extraction, stop conditions, and private writes.
- Collection workflow core: session validation, browser action contract checks, page observation normalization, candidate classification, review item building, and private review queue writes.
- Browser discovery runner: future adapter that executes approved visible-browser sessions against search engines, company sites, public careers pages, public ATS pages, engineering blogs, docs, changelogs, and GitHub organization pages.
- Page observation and evidence extraction: structured conversion of visible page content into short evidence summaries, missing information, risk flags, source labels, and observed timestamps.
- Candidate classifier: classifies pages as target company, job opportunity, person/contact surface, source evidence, or irrelevant.
- Review queue writer: writes ranked findings requiring human approval to the private data root.
- Synthetic evals: public fixtures that test decision thresholds and risk handling.
- OpenCode configuration: project agents and commands for planning, scoring, and review.
- Policy docs: browser-use and privacy constraints that every agent must follow.
- Private data root: repo-external directory for real CRM data and evidence.

## Data flow

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
  -> visual state observation
  -> LLM visual action planning
  -> coordinate-grounded browser/computer action
  -> progress verification
  -> page observation
  -> LLM evidence extraction
  -> target/opportunity classification
  -> scoring
  -> private CRM record and review queue write
```

Real opportunity records must be written only to `CAREERDEEPSEEK_DATA_DIR`.

## First implementation boundary

The committed first version proves the opportunity scoring contract, target-level company/team scoring contract, private data boundary, and eval loop on synthetic offline data.

The current implementation boundary is a tested visual-action and LLM discovery MVP with a mock computer-use adapter and deterministic mock model. It models browser/computer automation as `observe()` returning screenshot-backed visual state and `act(action)` executing policy-checked visual actions. It models model use as `generateJson(request)` returning structured action or evidence outputs that deterministic code validates.

The next boundary is a real visible-browser adapter and provider-specific LLM client. They should automate search and page reading through a real browser, but must not use raw HTTP scraping, hidden APIs, CAPTCHA bypass, proxy rotation, headless bulk collection, auto-apply, or auto-send behavior. Databases and LLM-driven self-modification remain out of scope until the real adapter is implemented and tested.
