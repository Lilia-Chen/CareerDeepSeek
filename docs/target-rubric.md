# Target Company / Team Hunting Rubric

Runtime version: `0.1.0`
Max score: `100`

This is the canonical human-edited rubric for target-level company and team hunting. It qualifies companies or teams before a specific role, interview process, or application exists.

## Hard Blockers

- `right_to_work_impossible` - The company or likely employing setup clearly cannot support any viable right-to-work path.
- `obvious_scam_signal` - The target has obvious scam or bad-faith signals.

## Scoring Dimensions

### D1: Stage & Hiring Pressure (weight 15)

Runtime ID: `stage_hiring_pressure`

| Score | Description |
| --- | --- |
| 5 | Clear growth or expansion signal, active technical hiring, and enough funding, revenue, or customer pressure to support engineering headcount. |
| 4 | Healthy company with visible technical hiring, but urgency or headcount expansion is less clear. |
| 3 | Company looks viable, but current hiring pressure is unknown. |
| 2 | Early or unstable company with weak evidence of engineering hiring capacity. |
| 1 | Speculative team, unclear budget, or mostly founder-only activity. |
| 0 | No credible company, team, or hiring capacity signal. |

### D2: Team Composition (weight 15)

Runtime ID: `team_composition`

| Score | Description |
| --- | --- |
| 5 | Engineering-led team with visible founders or early engineers in AI systems, infrastructure, data, research, or strong product engineering. |
| 4 | Clear technical leadership and enough visible engineers to support serious system-building. |
| 3 | Technical team exists, but technical leadership or depth is not yet clear. |
| 2 | Business, consulting, sales, or operations appear to dominate; engineering may be secondary. |
| 1 | Very little visible technical talent, or engineering appears outsourced. |
| 0 | No visible technical team behind a technical claim. |

### D3: Technical Closure (weight 20)

Runtime ID: `technical_closure`

| Score | Description |
| --- | --- |
| 5 | Company appears to own meaningful system layers: product, data, retrieval, eval, runtime, model, infrastructure, or production feedback loop. |
| 4 | Strong in-house engineering exists, but one important technical layer or long-term moat is still uncertain. |
| 3 | Product has real technical content, but closure vs. wrapper/delivery model needs more evidence. |
| 2 | Mainly integration, implementation, or services around third-party platforms. |
| 1 | Thin wrapper, prompt studio, or demo-heavy product with weak durable engineering asset signal. |
| 0 | No meaningful technical closure. |

### D4: Domain Alignment (weight 20)

Runtime ID: `domain_alignment`

| Score | Description |
| --- | --- |
| 5 | Directly matches AI agent systems, agent infrastructure, memory/retrieval, eval, runtime, observability, AI tooling, or production AI workflows. |
| 4 | Strong adjacent fit: workflow automation, data infrastructure, LLMOps/MLOps, voice AI infrastructure, or full-stack AI product engineering. |
| 3 | General AI/data/product engineering fit, but not clearly close to agent systems or infrastructure. |
| 2 | Some technical relevance, but mostly outside the target direction. |
| 1 | Weak fit with only surface-level AI branding. |
| 0 | No meaningful alignment with the target direction. |

### D5: Culture & Ownership Signal (weight 10)

Runtime ID: `culture_ownership_signal`

| Score | Description |
| --- | --- |
| 5 | Public signals show engineering ownership, technical taste, high standards, and room for individual judgment. |
| 4 | Builder culture or strong technical voice is visible, with manageable unknowns. |
| 3 | Culture is not clearly bad, but ownership and engineering quality are unknown. |
| 2 | Signals suggest delivery pressure, sales-led priority churn, or weak technical decision rights. |
| 1 | High-agency language likely means unclear scope, low support, or exploitative pace. |
| 0 | Clear chaos, exploitation, or bad-faith culture signal. |

### D6: Right to Work & Location (weight 10)

Runtime ID: `right_to_work_location`

| Score | Description |
| --- | --- |
| 5 | Location and employment setup clearly match a viable right-to-work path. |
| 4 | Likely feasible, but entity, remote setup, sponsorship, or start timing needs confirmation. |
| 3 | Location looks plausible, but right-to-work route is unknown. |
| 2 | Feasibility is weak and would require non-standard sponsorship, relocation, or contract conversion. |
| 1 | Company likely cannot support the needed path, but a personal alternative may exist. |
| 0 | No viable right-to-work path. |

### D7: Reachability Signal (weight 10)

Runtime ID: `reachability_signal`

| Score | Description |
| --- | --- |
| 5 | Clear reachable surface exists: engineering founders, hiring managers, recruiters, OSS/community presence, events, or warm network paths. |
| 4 | Some reachable people or community surfaces are visible. |
| 3 | Reachability unknown; company can be watched but needs contact research. |
| 2 | Few visible people or weak contact surface. |
| 1 | Hard to identify anyone relevant, and no hiring or community surface is visible. |
| 0 | No practical way to monitor or reach the target. |

## Decision Thresholds

| Min Score | Decision ID | Label | Action |
| --- | --- | --- | --- |
| 75 | priority_target | Priority Target | Track actively, identify people, monitor roles, and prepare tailored positioning. |
| 60 | qualified_watch | Qualified Watch | Keep on watchlist and refresh evidence periodically. |
| 45 | research_more | Research More | Gather missing evidence before deciding. |
| 30 | low_priority | Low Priority | Do not actively pursue unless new evidence appears. |
| 0 | reject | Reject | Do not spend time. |

## Formula

Weighted score = sum of each dimension's normalized score multiplied by its weight. A hard blocker forces `reject` regardless of numeric score.

## Research Confidence

The numeric score is not enough for a final recommendation. Runtime target scoring also evaluates `researchQuality`:

- `high` confidence may support `priority_target`.
- `medium` confidence caps the final decision at `qualified_watch`.
- `low` confidence caps the final decision at `research_more`.

Research confidence is based on useful source count, source-class diversity, rubric-dimension evidence coverage, and critical gaps. A company with strong domain fit but shallow evidence should remain `research_more` until the missing sources are checked.
