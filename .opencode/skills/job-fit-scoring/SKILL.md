---
name: job-fit-scoring
description: Use when scoring job opportunities against DeepJobSeek's AI agent systems fit rubric.
---

# Job Fit Scoring

Use `config/scoring-rubric.json` as the source of truth.

Process:

1. Identify the opportunity and source.
2. Extract evidence for each rubric dimension.
3. Mark missing information explicitly.
4. Assign scores from 0 to 5 for each dimension.
5. Apply hard blockers before threshold decisions.
6. Output decision: `apply_now`, `network_first`, `research_more`, `keep_warm`, or `skip`.

Never claim fit without evidence.

