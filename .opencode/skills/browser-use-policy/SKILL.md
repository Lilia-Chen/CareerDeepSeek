---
name: browser-use-policy
description: Use before any browser-use or external platform interaction in CareerDeepSeek.
---

# Browser-use Policy

CareerDeepSeek uses visible browser / computer-use only.

Current workflow mode:

- Treat yourself as the workflow controller.
- The computer-use adapter is an atomic observation/action tool, not the workflow.
- Every browser step must run `observe -> decide -> act -> observe`.
- Do not invent tools at runtime.
- Do not bypass computer-use with raw browser automation, Playwright, CDP, direct HTTP, or page-executed actions.

Two states must stay separate:

- Desktop foreground state: Chrome must be the active top application before `observe` and before `act`. This is an operating-system input-routing requirement.
- Page-visible DOM state: only DOM elements visible in the current Chrome viewport/screenshot may become action candidates. Hidden, covered, offscreen, or smoke-screen DOM is not actionable.

Navigation policy:

- Address-bar use is bootstrap-only.
- If Chrome has no useful tab, use the visible Chrome address bar to reach Google, LinkedIn, or another user-approved starting page.
- Once a page is open and usable, continue through page controls and observed links.
- Deep-dive navigation must click observed result links. Do not retype observed hrefs through the address bar.
- If already on the LinkedIn feed, click the observed LinkedIn page search box, type the query, press Enter, then observe results.
- If already on Google results, scroll/click observed organic result links. Do not restart by typing the same query or URL into the address bar.

Disambiguate duplicate labels:

- Never click the first visible element just because its text matches the target label.
- Rank candidates by current task, page region, href target, and surrounding text.
- For company-local LinkedIn navigation, prefer links whose href stays under the current company path, such as `/company/{slug}/jobs/`, `/company/{slug}/posts/`, or `/company/{slug}/people/`.
- Do not treat the global LinkedIn top-nav `Jobs` link as the same action as a company page `Jobs` tab.

Back/Forward recovery:

- If a click navigates to the wrong page, observe the current page and then click the observed Chrome Back or Forward button.
- Do not recover by typing the previous URL into the address bar.
- After recovery, observe again before choosing the next control.
- If browser history does not reach the intended workflow page, continue through observed page controls such as the site search box, local navigation tabs, or filters.
- On LinkedIn, if the page search UI shows an observed exact recent query matching the task, selecting that option is allowed and preferred over retyping.

Production agent mode:

- May only call pre-registered tools.
- Must not create tools, register action types, modify policy, or bypass the computer-use harness.
- Must let hardcoded workflow logic decide stop/dismiss behavior before any model action.

Allowed:

- User-approved pages.
- Low-frequency visible browsing.
- Current-page visible text.
- Screenshots for supervised understanding.
- Cookie consent dismissal through observed buttons such as `Yes, I agree` or `Accept all cookies`.
- Marketing popup dismissal through observed close/dismiss/no-thanks controls.
- Draft generation.
- Private CRM writes to `CAREERDEEPSEEK_DATA_DIR`.

Forbidden:

- Raw HTTP scraping.
- Hidden APIs.
- Headless bulk collection.
- CAPTCHA bypass.
- Auto-apply.
- Auto-send.
- Auto-add connections.
- Auto-like, comment, or follow.
- Runtime tool creation or policy modification by the production agent.

Stop if login, SSO, passkey, account-selection, CAPTCHA, security prompt, payment, checkout, external send/apply, or other high-risk continuation appears.

A normal header `Sign in` link is not enough to stop. Stop when the visible page is requiring authentication, verification, payment, applying, or sending before continuing.

If the page is hidden behind a popup, first decide whether it is dismissible:

- Cookie consent: click the observed accept/agreement button when available.
- Marketing modal: click the observed close/dismiss/no-thanks control.
- Login, payment, CAPTCHA, apply, send: record the stop signal and stop.

LinkedIn search workflow:

1. Observe.
2. If the current page is LinkedIn feed, locate the observed page search box.
3. If the current page is another usable LinkedIn page, locate the observed LinkedIn page search box or search button.
4. Click that search control through computer-use.
5. If an observed exact recent query matches the task, click it; otherwise type the query through computer-use.
6. Press Enter through computer-use when typing was used.
7. Observe the result page and report visible candidate companies, posts, people, or filters.
8. Do not click connect, message, follow, apply, premium, payment, login, security, or verification flows.

Overlay workflow:

1. Observe the current page and screenshot.
2. If cookie consent blocks the page, click `Yes, I agree`, `Accept all cookies`, or equivalent observed agreement button.
3. If a marketing modal blocks the page, click an observed close/dismiss/no-thanks control.
4. If login, CAPTCHA, payment, checkout, apply, send-message, or account/security verification blocks the page, stop and record the reason.
