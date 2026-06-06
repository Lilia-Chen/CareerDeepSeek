# Browser-Use Policy

CareerDeepSeek is a bounded visible-browser research agent. Its default browser layer is read-only observation: collect current-page DOM-visible content, ARIA/HTML-derived semantic approximation, viewport boxes, occlusion checks, and screenshot metadata through a real browser.

CareerDeepSeek is not a raw scraper, crawler, or platform-abuse tool.

## Session model

A browser session is allowed when it has:

- A clear search goal.
- A source scope.
- A page or time budget.
- Stop conditions.
- A repo-external private data target for any real records.

Inside an approved default observation session, the agent may read the current visible page and produce compact observations. Navigation, clicking, typing, private writes, and native AX/CDP debugging are separate explicit modes and require their own approval boundary.

## Allowed

- Read-only current-tab browser observation with a bounded session scope.
- Search engines, company websites, public careers pages, public ATS pages, engineering blogs, documentation, changelogs, GitHub organization pages, and other approved public sources.
- Reading visible current-page text.
- Screenshot-assisted understanding.
- DOM-visible element extraction with computed style, viewport bounds, and occlusion checks.
- ARIA/HTML-derived semantic approximation for role, name, state, and relationships.
- Extracting short evidence summaries, missing information, risk flags, source labels, and observed timestamps.
- Classifying pages as target company, job opportunity, person/contact surface, source evidence, or irrelevant.
- Scoring target companies and job opportunities with the project rubrics.
- Writing structured private CRM records and review queues to `CAREERDEEPSEEK_DATA_DIR` only after the private-write boundary is approved.
- Drafting summaries, outreach, and application messages for user approval.

## Explicit debug and automation modes

CDP debug mode is allowed only for local high-fidelity corroboration. The allowed CDP commands are:

- `Accessibility.getFullAXTree`
- `DOMSnapshot.captureSnapshot`
- `Page.captureScreenshot`

CDP debug mode must not use `Runtime.evaluate`, `Input.*`, DOM mutation commands, or network inspection commands.

Playwright/browser-use action mode is allowed only as an explicit debug or supervised automation mode. It is not the default observation layer.

## Forbidden

- Raw HTTP scraping.
- Hidden API reverse engineering.
- Sitemap crawling.
- CAPTCHA bypass.
- Proxy rotation.
- Headless bulk collection.
- Long-running background browsing without an approved session goal and page budget.
- Bulk extraction from restricted job boards, social networks, review sites, or salary sites.
- Treating ARIA/HTML semantic approximation as native accessibility tree data.
- Using `debugger`, CDP, or Playwright as the default low-footprint observation path.
- Using broad `<all_urls>` host permissions or persistent content scripts for the default observer.
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
- Starting CDP native AX/DOMSnapshot debug mode.
- Starting Playwright/browser-use action mode.
- Sending any message or application.
- Changing the source class or platform-specific behavior.

## Approval gates

Ask before:

- Starting a browser session against a new source class not covered by this policy.
- Increasing the page or time budget.
- Logging in.
- Handling account or security prompts.
- Saving contact data.
- Enabling CDP, debugger permission, broad host permissions, or persistent content scripts.
- Generating a real outreach draft.
- Writing private CRM records.
- Changing platform-specific behavior.
