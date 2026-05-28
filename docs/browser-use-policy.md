# Browser-Use Policy

CareerDeepSeek is a bounded visible-browser agent. It should automate search, navigation, evidence collection, classification, scoring, and private CRM writes through a real browser.

CareerDeepSeek is not a raw scraper, crawler, or platform-abuse tool.

## Session model

A browser session is allowed when it has:

- A clear search goal.
- A source scope.
- A page or time budget.
- Stop conditions.
- A repo-external private data target for any real records.

Inside an approved browser session, the agent does not need per-click approval. It may search, click, read visible pages, score findings, and write structured private records until it reaches the budget or a stop condition.

## Allowed

- Visible browser or computer-use with a bounded session scope.
- Search engines, company websites, public careers pages, public ATS pages, engineering blogs, documentation, changelogs, GitHub organization pages, and other approved public sources.
- Query generation and query refinement.
- Clicking visible search results and in-page navigation controls.
- Reading visible current-page text.
- Screenshot-assisted understanding.
- Extracting short evidence summaries, missing information, risk flags, source labels, and observed timestamps.
- Classifying pages as target company, job opportunity, person/contact surface, source evidence, or irrelevant.
- Scoring target companies and job opportunities with the project rubrics.
- Writing structured private CRM records and review queues to `CAREERDEEPSEEK_DATA_DIR`.
- Drafting summaries, outreach, and application messages for user approval.

## Forbidden

- Raw HTTP scraping.
- Hidden API reverse engineering.
- Sitemap crawling.
- CAPTCHA bypass.
- Proxy rotation.
- Headless bulk collection.
- Long-running background browsing without an approved session goal and page budget.
- Bulk extraction from restricted job boards, social networks, review sites, or salary sites.
- Auto-apply.
- Auto-send messages.
- Auto-add connections.
- Auto-like, comment, or follow.

## Stop conditions

Stop the browser session and ask before:

- Logging in.
- Handling account, identity, payment, or security prompts.
- Solving CAPTCHA or anti-bot challenges.
- Continuing after platform rate limiting, blocking, or suspicious-activity warnings.
- Opening pages beyond the approved budget.
- Saving personal contact data.
- Sending any message or application.
- Changing the source class or platform-specific behavior.

## Approval gates

Ask before:

- Starting a browser session against a new source class not covered by this policy.
- Increasing the page or time budget.
- Logging in.
- Handling account or security prompts.
- Saving contact data.
- Generating a real outreach draft.
- Writing private CRM records.
- Changing platform-specific behavior.
