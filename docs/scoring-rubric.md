# Target Company Scorecard

Runtime version: `0.3.0`
Max score: `100`

This is the canonical human-edited rubric for CareerDeepSeek. Runtime JSON is generated from this document and should not be edited by hand.

## Hard Blockers

- `visa_impossible` - The employer clearly cannot sponsor and there is no other viable right-to-work path.
- `auto_apply_required` - The opportunity requires an auto-apply platform flow that prevents targeted application materials.
- `unpaid_or_unclear_compensation` - Compensation is unpaid or materially unclear.
- `obvious_scam_signal` - The opportunity has obvious scam signals.

## Scoring Dimensions

### D1: Stage & Hiring Pressure (weight 15)

Runtime ID: `stage_hiring_pressure`

| Score | Description |
| --- | --- |
| 5 | Series A-C or comparable growth company actively expanding the engineering team, with clear hiring motion and a newly opened role. |
| 4 | Profitable bootstrapped company expanding the team, or growth-stage company with visible technical hiring need. |
| 3 | Hiring exists but urgency is unclear, or the company is earlier stage but has revenue. |
| 2 | Pre-revenue seed company with unclear engineering organization. |
| 1 | Idea-stage company or speculative reserved headcount. |
| 0 | No real engineering organization, or a temporary 2-3 person team trying to assemble technical capacity. |

### D2: Team Composition (weight 12)

Runtime ID: `team_composition`

| Score | Description |
| --- | --- |
| 5 | Founding team has strong engineering background, early engineers are visible from major tech or research contexts, and technical staff appear to be more than 60 percent of the team. |
| 4 | Clear technical leader exists, with visible full-stack, infrastructure, or AI systems people. |
| 3 | Mixed team where technical people exist but do not clearly drive the company. |
| 2 | Team is mainly business development, operations, or consulting; technology appears auxiliary. |
| 1 | Technical people are barely visible, or engineering appears outsourced. |
| 0 | Fully non-technical team building a technology product. |

### D3: Operating Model / Technical Closure (weight 12)

Runtime ID: `operating_model`

| Score | Description |
| --- | --- |
| 5 | Full technical closure around complex or innovative business problems: self-developed core systems, durable engineering assets, and evidence of owned data, model, training, fine-tuning, small-model, retrieval, workflow, runtime, eval, or infrastructure capability. |
| 4 | Strong in-house engineering and complex business context, but technical closure is incomplete or the model layer mainly depends on external platforms. |
| 3 | Consulting and product are mixed, with uncertain split. |
| 2 | Mainly custom implementation or delivery work, with productization far away. |
| 1 | Short-cycle traffic product relying mostly on third-party models. |
| 0 | Pure prompt studio, content mill, or third-party wrapper business. |

### D4: Culture & Work Style (weight 10)

Runtime ID: `culture_work_style`

| Score | Description |
| --- | --- |
| 5 | Technical people have clear ownership and judgment rights, scope boundaries are explicit, and there is visible code review, quality bar, and technical debt awareness; pace is fast but sustainable. |
| 4 | Technical voice is strong, builder culture is visible, and basic engineering quality standards exist; minor pace or boundary risks are controllable. |
| 3 | Ordinary startup culture or insufficient information; ownership, quality standards, and sustainable pace need more evidence. |
| 2 | Priorities are often pulled by sales or customer requests, product and engineering judgment appears weak, and technical scope is blurry. |
| 1 | High agency appears to mean unlimited responsibility, low compensation pressure, or engineering subordinated to delivery; ownership and quality risks are high. |
| 0 | Exploitative, chaotic, or opaque environment with clearly irregular process or role boundaries. |

### D5: Technical Relevance (weight 18)

Runtime ID: `technical_relevance`

| Score | Description |
| --- | --- |
| 5 | Role core directly targets agent infra, retrieval, eval, runtime, memory, observability, AI/data systems, or production AI workflows. |
| 4 | Strongly related adjacent engineering: workflow automation, data integration, AI product infrastructure, observability, or full-stack AI product engineering. |
| 3 | General backend or full-stack role, or the company has AI/data components but the role only partially touches them. |
| 2 | Mainly frontend, mobile, internal tools, or non-AI platform engineering. |
| 1 | Mainly demo building, prompt tuning, customer training, or lightweight prototyping. |
| 0 | Does not build systems; mainly writes proposals, configuration, or operations delivery. |

### D6: Coding Ownership (weight 15)

Runtime ID: `coding_ownership`

| Score | Description |
| --- | --- |
| 5 | Long-term ownership of production code and system design, including maintenance, quality, review, and technical decisions. |
| 4 | Coding is a major responsibility, with clear module or system ownership. |
| 3 | Coding is explicitly part of the role, but the proportion, production path, or ownership boundary is unconfirmed. |
| 2 | Mainly configuration, platform setup, low-code work, or data/workflow operations. |
| 1 | Mainly customer communication, solutioning, project management, or delivery, with occasional scripts or demos. |
| 0 | Engineer title but no real coding responsibility. |

### D7: Right to Work & Location (weight 10)

Runtime ID: `visa_location`

| Score | Description |
| --- | --- |
| 5 | Target location matches and the employer clearly can sponsor, or there is already a viable right-to-work path. |
| 4 | Overall feasible, but location, employing entity, start date, or contract type needs handling. |
| 3 | Location matches, but right-to-work or visa path is unconfirmed; no hard blocker, but it must be checked. |
| 2 | Feasibility is weak because it requires a new sponsor licence, cross-border remote conversion to employment, contract-to-perm, or another extra path. |
| 1 | Employer clearly does not sponsor, but another personal route may exist. |
| 0 | Clearly cannot sponsor and there is no other right-to-work path; hard blocker. |

### D8: Interview Signal (weight 8)

Runtime ID: `interview_signal`

| Score | Description |
| --- | --- |
| 5 | Process includes coding, system design, and a technical case or debugging exercise, so it can verify real engineering ability. |
| 4 | Clear technical interview exists and includes coding, but the system design or case format is unconfirmed. |
| 3 | Interview process is unknown; treat as neutral and record as missing information. |
| 2 | Process leans behavioral, consulting-style, or business-case-heavy, with light technical verification. |
| 1 | Process mainly tests communication, industry experience, or customer management. |
| 0 | Process clearly has no technical evaluation, or the process is abnormal or irregular. |

## Decision Thresholds

| Min Score | Decision ID | Label | Action |
| --- | --- | --- | --- |
| 75 | strong_fit | Strong Fit | Prioritize: apply, find referral, customize materials. |
| 60 | worth_pursuing | Worth Pursuing | Apply with moderate customization. |
| 45 | watch | Watch | Monitor hiring and funding; do not proactively apply. |
| 30 | low_priority | Low Priority | Consider only if there are no better options. |
| 0 | reject | Reject | Do not spend time. |

## Formula

Weighted score = sum of each dimension's normalized score multiplied by its weight. A hard blocker forces `reject` regardless of numeric score.
