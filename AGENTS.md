# CareerDeepSeek Agent Instructions

## Purpose

CareerDeepSeek is a public code repository for a bounded visible-browser job search agent. It automates target and opportunity discovery, evidence collection, scoring, private CRM writes, outreach drafting, and offline eval-driven improvement while keeping high-risk actions under human approval.

## Hard Boundary

This repository must remain safe to publish publicly.

Never write real personal assets, job leads, contacts, recruiter messages, CVs, cover letters, screenshots, raw page text, or private CRM records inside this repo. Use a repo-external data directory configured by `CAREERDEEPSEEK_DATA_DIR`.

## Session Memory

Use Nowledge (`/save` slash command or `nmem` CLI) for persisting session context. Do NOT use the built-in Claude memory system (`.claude/projects/.../memory/`).

## Workflow Precedence

1. User instructions override all reusable skills and project rules.
2. Superpowers is the primary workflow controller.
3. Installed agent-skills are specialist quality gates.
4. If Superpowers and another skill define the same phase, follow Superpowers.
5. If a specialist skill adds domain-specific checks not covered by Superpowers, use it.
6. If rules conflict, stop and report the conflict instead of merging them silently.

## Required Specialist Gates

- Use source-driven-development for external tools, framework APIs, OpenCode config, browser automation APIs, and dependency behavior.
- Use security-and-hardening for browser-use, CRM data, external sites, user input, file storage, and any integration.
- Use api-and-interface-design for schema, scoring contracts, CRM interfaces, and command interfaces.
- Use documentation-and-adrs for architecture choices, repo boundary changes, and public workflow decisions.
- Use code-review-and-quality before merging non-trivial changes.
- Use performance-optimization only when performance is a stated concern or a measured bottleneck exists.
- Use browser-testing-with-devtools only for local web app verification. Do not use it for job platform collection.

## Browser-use Policy

CareerDeepSeek is a visible browser-use agent, not a raw scraper.

Browser automation is allowed when the session is bounded by an explicit search goal, source scope, page budget, and stop conditions. The agent may search, click, read visible pages, classify candidates, score them, and write structured private records without asking before every click inside the approved session.

Allowed:
- Open search engines, company websites, public careers pages, public ATS pages, engineering blogs, docs, changelogs, GitHub organization pages, and other approved public sources in a visible browser.
- Type visible search keywords and refine queries.
- Click visible links and buttons needed for the approved search session.
- Read visible page text and classify pages as target company, job opportunity, person/contact surface, source evidence, or irrelevant.
- Capture screenshots for user-supervised understanding when useful.
- Extract short evidence summaries, missing information, risk flags, source labels, and observed timestamps.
- Score targets and opportunities with the project rubrics.
- Write structured records, summaries, and review queues to the repo-external private data directory.
- Draft outreach or application messages for user review.

Forbidden:
- Raw HTTP scraping.
- requests, cheerio, hidden API reverse engineering, or sitemap crawling.
- CAPTCHA bypass, proxy rotation, or robots bypass.
- Headless bulk collection.
- Long-running background browsing without a bounded session goal and page budget.
- Bulk extraction of jobs, profiles, reviews, salaries, or interview reports from restricted platforms.
- Auto-apply.
- Auto-send messages.
- Auto-add LinkedIn connections.
- Auto-like, comment, or follow.

## Public Data Rules

Fixtures under `evals/fixtures/synthetic/` must be synthetic or fully anonymized.

If a real case is useful for eval, first convert it into a synthetic fixture:
- Replace company and person names.
- Remove URLs, emails, handles, phone numbers, and addresses.
- Rewrite job text into a short derived summary.
- Remove any screenshot or copied page text.

## Stop Conditions

Stop and ask before:
- Creating or modifying external accounts.
- Sending messages or applications.
- Storing new categories of private data.
- Starting a new class of browser automation source not covered by the current browser-use policy.
- Moving private data into this repo.
- Changing the scoring rubric thresholds.
- Publishing or pushing a branch to GitHub.
