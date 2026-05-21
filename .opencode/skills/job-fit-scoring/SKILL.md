---
name: job-fit-scoring
description: Use when scoring job opportunities against CareerDeepSeek's AI agent systems fit rubric.
---

# Job Fit Scoring

Use `docs/scoring-rubric.md` as the source of truth. `config/scoring-rubric.json` is generated from the Markdown file for runtime and eval use.

Process:

1. Identify the opportunity and source.
2. Extract evidence for each rubric dimension.
3. Mark missing information explicitly.
4. Assign scores from 0 to 5 for each dimension.
5. Apply hard blockers before threshold decisions.
6. Output decision: `strong_fit`, `worth_pursuing`, `watch`, `low_priority`, or `reject`.

Never claim fit without evidence.
