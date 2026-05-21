# Architecture

CareerDeepSeek starts as a local-first eval and workflow repository.

## Components

- Opportunity scoring rubric: `docs/scoring-rubric.md` is the canonical human-edited rubric for specific job opportunities.
- Target hunting rubric: `docs/target-rubric.md` is the canonical human-edited rubric for company or team targets before a specific role exists.
- Runtime rubric artifacts: `config/scoring-rubric.json` and `config/target-rubric.json` are generated from the Markdown rubrics.
- Scoring engines: deterministic scoring from structured opportunity or target signals and the generated runtime rubrics.
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
```

Real opportunity records must be written only to `CAREERDEEPSEEK_DATA_DIR`.

## First implementation boundary

The first version deliberately avoids browser automation, databases, external APIs, and LLM-driven self-modification. It proves the opportunity scoring contract, target-level company/team scoring contract, and eval loop on synthetic offline data.
