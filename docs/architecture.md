# Architecture

DeepJobSeek starts as a local-first eval and workflow repository.

## Components

- Scoring engine: deterministic scoring from structured opportunity signals.
- Synthetic evals: public fixtures that test decision thresholds and risk handling.
- OpenCode configuration: project agents and commands for planning, scoring, and review.
- Policy docs: browser-use and privacy constraints that every agent must follow.
- Private data root: repo-external directory for real CRM data and evidence.

## Data flow

```txt
synthetic fixture or user-provided opportunity
  -> structured scoring inputs
  -> scoring engine
  -> decision and evidence summary
  -> eval comparison or private CRM write
```

Real opportunity records must be written only to `DEEPJOBSEEK_DATA_DIR`.

## First implementation boundary

The first version deliberately avoids browser automation, databases, external APIs, and LLM-driven self-modification. It proves the scoring contract and eval loop on synthetic offline data.

