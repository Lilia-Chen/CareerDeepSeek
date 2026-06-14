---
name: company-research-workflow
description: Use when researching companies or teams for CareerDeepSeek target hunting, especially when deciding whether evidence is deep enough to score, stop, shortlist, or recommend a company.
---

# Company Research Workflow

Use this skill after the browser-use policy. Browser-use defines how to observe and act. This skill defines how to think, when to continue, and when evidence is good enough.

## Core Rule

Score is not confidence. A company can look highly relevant and still be `research_more` if the evidence is thin.

Do not produce a final recommendation until the company has enough source coverage, rubric coverage, and a concrete next action. If the evidence is incomplete, say so and keep the company in `research_more` or `qualified_watch`.

This workflow is iterative. A research pass is not complete just because it produced a ranked table. After every pass, audit the research quality. If the audit fails, identify whether the failure came from the workflow skill, deterministic scoring guard, browser execution, or the research judgment, then patch the responsible layer and rerun the relevant path.

## Research State

Maintain this state during the task:

```txt
objective
candidate_pool
shortlist
current_company
evidence_matrix
open_questions
source_queue
decision_state
quality_audit
workflow_change_log
```

For each company, the evidence matrix must cover the target rubric:

```txt
stage_hiring_pressure
team_composition
technical_closure
domain_alignment
culture_ownership_signal
right_to_work_location
reachability_signal
```

Each dimension status is one of:

- `confirmed` - directly supported by useful visible evidence.
- `partial` - some evidence exists, but a decision-relevant unknown remains.
- `unknown` - no useful evidence yet.
- `blocked` - the relevant path hit login, CAPTCHA, payment, apply, send, or another stop state.

## Discovery

Build a candidate pool before deep-diving.

Target pool size:

- Start with 10-15 candidates.
- Shortlist 5-8 for deep dive.
- Write final recommendations only for companies with enough evidence coverage.

A candidate can enter the pool when it has:

- a clear company or team name;
- a plausible connection to AI agents, agent infrastructure, production AI workflows, eval, observability, runtime, memory, retrieval, or AI tooling;
- at least one traceable source;
- a short hypothesis for why it may fit.

Discovery sources are allowed and often useful:

- Google organic results;
- LinkedIn company/search results;
- ranking pages;
- directories;
- analyst posts;
- ecosystem lists;
- technical articles naming multiple companies.

Do not reject a page just because it is not a company homepage. Extract candidate names and context, then follow up through direct sources.

## Triage

Shortlist a company for deep dive only when at least one is true:

- two independent sources point to the same company and direction;
- one direct source is unusually strong, such as a careers page with relevant roles or a product page clearly describing owned agent infrastructure;
- the company is a known strategic target and the current source adds a new decision-relevant signal.

Reject or deprioritize during triage when:

- the page is pure sponsor/SEO noise with no extractable company evidence;
- the company is mostly consulting, staffing, job-board, marketplace, or content aggregation;
- the visible evidence points away from the target direction;
- a hard blocker appears.

## Deep Dive Source Queue

For each shortlisted company, try to answer the open questions through source classes, not random links:

```txt
company/product page
careers or ATS page
LinkedIn company page
LinkedIn jobs/posts/people surface
engineering blog, docs, changelog, GitHub org, or technical content
independent discovery or market source
```

You do not need every source class for every company. You do need enough source diversity to justify the final confidence.

Priority target evidence normally needs at least:

- 4 useful sources;
- 3 source classes;
- all 7 rubric dimensions marked `confirmed` or `partial`;
- no critical gap in `stage_hiring_pressure`, `technical_closure`, `domain_alignment`, or `right_to_work_location`;
- a concrete next action.

Medium confidence normally needs:

- 2 useful sources;
- 2 source classes;
- at least 5 rubric dimensions marked `confirmed` or `partial`;
- no more than one critical gap.

Otherwise confidence is low.

## Company Completion Gate

A company is not researched to completion until the workflow can make a defensible decision and there is no obvious, low-cost, decision-changing source path left untried.

Required source classes for a completed company review:

```txt
direct company surface
hiring surface
LinkedIn company/jobs/people surface
technical evidence surface
independent source
```

Each required source class must be one of:

- `useful` - observed and contributed decision-relevant evidence;
- `exhausted` - observed, searched, scrolled, or followed through reasonable visible controls but did not produce useful evidence;
- `blocked` - stopped by login, CAPTCHA, payment, application submission, security, or another hard stop;
- `not_applicable` - explicitly irrelevant to this company and explained.

Do not mark an individual company complete while the recommended next action is still to open an obvious evidence source such as the official site, careers page, ATS, LinkedIn jobs, LinkedIn people, GitHub, docs, or engineering blog. That next action means the current review is incomplete.

Acceptable completion next actions are:

```txt
apply_or_prepare_materials
contact_or_identify_people
monitor_roles
reject
wait_for_new_signal
blocked_by_hard_stop
```

Unacceptable completion next actions are:

```txt
open official site
open careers
inspect LinkedIn jobs
inspect LinkedIn people
open GitHub
check docs
look for engineering blog
```

For `qualified_watch`, the bar is not lower. The workflow may stop at `qualified_watch` only after the obvious source paths have been tried, blocked, or exhausted. The reason should be a substantive gap such as no current role, unclear sponsorship, no reachable hiring contact, or weak team evidence, not an untried source.

## Per-Page Decision Loop

Every observe step answers these questions before acting:

```txt
Where am I?
What source class is this page?
Which evidence-matrix gap can this page answer?
Is the real page blocked by an overlay?
What is the most decision-relevant missing fact right now?
Can this page still answer it through visible controls, scroll, tabs, or links?
If not, what source class should I seek next?
```

Click only when the expected evidence is clear. If the current page cannot answer an open question, return, switch source class, or stop the company with a reason.

## Search Context Invariant

Before typing a new query, classify the current search surface from observation:

```txt
google_search
linkedin_search
company_site_search
unknown_or_company_page
```

A query may only be typed into the search surface it was intended for.

- A Google discovery query must be typed into an observed Google page search box on a Google page.
- A LinkedIn query must be typed into an observed LinkedIn search box only when the current task is intentionally using LinkedIn search.
- A company-site query must be typed into that site's own search only when the current task is intentionally searching within that site.

Do not type a Google discovery query into the LinkedIn top search box just because it has role `combobox` and text `Search`. That is search-context drift.

After following a result link, record the expected return context. If Back/Forward is needed, use observed browser recovery and then verify the page class before continuing. One Back is not proof that the workflow returned to Google results.

If bounded history recovery and observed page controls cannot return to the intended search surface, record `search_context_lost` and perform a bootstrap back to the approved search surface. Bootstrap means reaching Google, LinkedIn, or another approved starting surface; it does not mean retyping a target URL or a result href.

After submitting a search query, observe again and verify that the current page matches the intended query. Use URL query parameters, visible search text, page title, and result semantics. If the page still shows the previous query, record `search_submission_mismatch`, recover the intended search surface, and retry before collecting evidence.

When choosing a search result, rank matches by source value before click:

```txt
direct company/careers/ATS source
LinkedIn company/jobs/people source
engineering/docs/GitHub technical source
independent market/discovery source
```

Do not let a broad target-name match outrank a direct source. For example, a result containing only a company name should not be clicked before a visible careers, company, LinkedIn, GitHub, or docs source for the same target.

Do not treat generic Google result expansion links such as `Read more`, `Show more`, or `Learn more` as source entries when a concrete result title, company page, careers page, JD, LinkedIn page, GitHub, docs, or article title is visible or reachable by scrolling. For hiring evidence, prefer a specific role title or JD page over a broad jobs page, a snippet expansion link, or an unrelated go-to-market role.

When a careers or ATS source opens a job-list page, do not count it as role-level evidence unless the visible text already answers the role question. If the open question requires hiring, location, or technical role evidence, continue through observed filters, search controls, scroll, or relevant role links until a specific JD is reached or the path is exhausted.

## Iteration Loop

Run company research as repeated quality-improvement cycles:

```txt
run research pass
  -> write/update target records
  -> audit output quality
  -> identify root cause of any quality failure
  -> patch workflow skill, scoring guard, or execution harness
  -> rerun the affected path
  -> compare with the previous pass
```

Do not mark the task complete after a single rerun if the audit still has unresolved quality failures.

Every cycle records:

- what was run;
- what evidence changed;
- which recommendations changed;
- what still failed the quality audit;
- whether the failure is a workflow problem, code guard problem, browser execution problem, or normal unavailable evidence.

If a problem repeats twice, the workflow must become more explicit. Add a rule, checklist item, pressure scenario, scoring guard, or trace requirement so the same failure is harder to repeat.

## Stop Criteria

Stop deep-diving a company and recommend it when:

- the evidence matrix has all dimensions `confirmed` or `partial`;
- critical dimensions have no `unknown` or `blocked` status;
- source coverage is high enough for the recommendation level;
- the company completion gate has passed;
- the next action is concrete: apply or prepare materials, contact or identify people, monitor roles, reject, wait for new signal, or record a hard stop.

Stop but do not recommend when:

- login, CAPTCHA, payment, checkout, apply, send-message, or account verification blocks the next required step;
- right-to-work appears impossible;
- the company is clearly irrelevant after semantic review;
- 2-3 reasonable source paths fail to produce useful evidence.

Do not stop as complete when:

- only the homepage was inspected;
- only Google snippets were inspected;
- the company is scored high but only 2-3 rubric dimensions have evidence;
- LinkedIn/careers/technical-source gaps remain and are reachable;
- the next action is to open an obvious evidence source such as official site, careers, LinkedIn jobs, LinkedIn people, GitHub, docs, or engineering blog;
- there is no concrete next action.

Do not stop the whole research task when:

- the final report itself says the researcher is not satisfied;
- a priority target still lacks direct company/careers/role evidence;
- a medium-confidence target has an obvious direct source path that was not tried;
- the next iteration would likely change the ranking or action recommendation;
- the workflow failed in a new way that has not been written back into the skill or guardrails.

It is acceptable to stop with `research_more` for a company when reachable evidence is blocked or exhausted. It is not acceptable to stop the workflow without recording that exhaustion and updating the next action.

## Scoring Contract

For every scored target, record:

```txt
score
decision
researchQuality.sourceCount
researchQuality.sourceTypes
researchQuality.evidenceCoverage
researchQuality.confidence
missingInfo
nextAction
```

Decision caps:

- `high` confidence may support `priority_target`.
- `medium` confidence caps the decision at `qualified_watch`.
- `low` confidence caps the decision at `research_more`.

If the score and confidence disagree, explain the disagreement. Example: "Strong domain fit, but location and hiring evidence are not yet verified."

## Output Contract

Final output is a research result, not a trace log.

Include:

- ranked company list;
- company cards;
- score and confidence;
- evidence coverage by rubric dimension;
- useful source list;
- why target / why not;
- risks and missing information;
- recommended next action.

Do not lead with browser operations, screenshots, commands, or trace details unless the user asks.

## Quality Audit

Before presenting final output, audit the report against this checklist:

```txt
candidate_pool_size >= 10 unless blocked by scope
shortlist_size between 5 and 8 unless the pool is genuinely weak
each completed company has direct company, hiring, LinkedIn, technical, and independent source classes marked useful/exhausted/blocked/not_applicable
no completed company has a next action that is merely opening an obvious evidence source
each priority_target has direct company/careers/role evidence
each priority_target has high confidence
each qualified_watch has a clear reason it is not priority
each research_more target has specific missing sources
rank changes are explained by evidence, not preference
recommendations name concrete next actions
the report can guide what to do next without reading the trace
```

If any item fails, do not call the workflow complete. Patch the workflow or rerun the relevant source path.

## Failure Scenarios

These are failures:

- A homepage-only company gets `priority_target`.
- A Google snippet-only company gets a final recommendation.
- A ranking page is rejected only because it is not a company homepage.
- A sponsored result is treated as an organic discovery source.
- A LinkedIn page is already usable, but the workflow restarts through the address bar.
- A Google discovery query is typed into LinkedIn search because the current search surface was not verified.
- A single Back action is treated as return-to-results without observing and confirming the page class.
- A query submission is assumed successful even though observation still shows the previous query.
- A broad company-name regex clicks an independent article before a visible direct company or careers source.
- A hiring search shows a specific technical role, but the workflow clicks `Read more`, `Show more`, `Learn more`, or an unrelated role instead of opening the specific JD.
- An ATS list page is treated as direct role evidence even though no relevant JD was opened.
- A company is marked complete while its next action is to open official site, careers, LinkedIn jobs, LinkedIn people, GitHub, docs, or engineering blog.
- A careers gap remains reachable, but the company is marked complete.
- A company has strong technical fit but unknown location, yet receives high-confidence priority.
- The final answer is a work log instead of company research.
- The researcher says they are not satisfied and still marks the goal complete.
- A rerun improves the report but does not update the workflow skill to prevent the same weakness.
- A target remains medium confidence with an obvious direct source path untried, and no rerun is attempted.
