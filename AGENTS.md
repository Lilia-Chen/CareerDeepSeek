# DeepJobSeek Agent Instructions

## Purpose

DeepJobSeek is a public code repository for a human-in-the-loop job search workbench. It evaluates AI engineering opportunities, records evidence, drafts outreach, and supports offline eval-driven improvement.

## Hard Boundary

This repository must remain safe to publish publicly.

Never write real personal assets, job leads, contacts, recruiter messages, CVs, cover letters, screenshots, raw page text, or private CRM records inside this repo. Use a repo-external data directory configured by `DEEPJOBSEEK_DATA_DIR`.

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

Visible browser or computer-use only.

Allowed:
- Open user-approved pages.
- Type visible search keywords.
- Click visible buttons.
- Read current visible page text.
- Capture screenshots for user-supervised understanding.
- Summarize the current page.
- Write summaries to the repo-external private data directory.
- Draft messages for user review.

Forbidden:
- Raw HTTP scraping.
- requests, cheerio, hidden API reverse engineering, or sitemap crawling.
- CAPTCHA bypass, proxy rotation, or robots bypass.
- Headless bulk collection.
- Background unattended browsing.
- Bulk extraction of jobs, profiles, reviews, salaries, or interview reports.
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
- Adding browser automation beyond visible, low-frequency actions.
- Moving private data into this repo.
- Changing the scoring rubric thresholds.
- Publishing or pushing a branch to GitHub.

