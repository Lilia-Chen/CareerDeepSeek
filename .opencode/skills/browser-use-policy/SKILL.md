---
name: browser-use-policy
description: Use before any browser-use or external platform interaction in CareerDeepSeek.
---

# Browser-use Policy

CareerDeepSeek uses visible browser / computer-use only.

Current workflow mode:

- Treat yourself as the workflow controller.
- For company or team target research, also load `company-research-workflow`. This policy controls browser safety and visible actions; the research workflow controls evidence depth, source coverage, stop criteria, and final recommendations.
- The computer-use adapter is an atomic observation/action tool, not the workflow.
- P0 browser-use scope is frozen by `docs/computer-use-auv-scope-freeze.md`. The target is the CareerDeepSeek Chrome window driver, not a full AUV desktop driver.
- Prefer the registered `MacOSChromeAgentHarness` for interactive browser work. It wraps `observe -> recognize -> promote -> act -> observe` and avoids ad hoc glue mistakes. Do not bypass it unless debugging the driver itself.
- Use only the AUV-aligned `MacOSChromeDriver` / `MacOSChromeAgentHarness` APIs. Legacy observation, recognition, candidate-promotion, and click helpers are removed and must not be recreated in workflow code.
- Do not recreate legacy paths under new names. Do not invent `open_url`, direct DOM action, Playwright, CDP, raw HTTP, or page-executed action routes.
- Do not let an individual capability slice expand the contract locally. New artifact roles, trace payload fields, action result schemas, driver APIs, or workflow helpers require a scope-freeze update first.
- Use the P0B contract as the implementation input for Chrome window capture, `ObservationSnapshot`, `RecognitionResult`, `SurfaceNode`, `PromotedCandidate`, `ArtifactRef`, `TraceStore` payload discipline, and Chrome lease/profile/foreground/hard-stop action gates.
- Treat yourself as the semantic research controller for internet research. Computer-use can show what is visible and perform allowed clicks/typing/scrolling; it cannot decide whether a page is valuable, whether a source answers the research question, or which company deserves deeper work.
- Every browser step must run `observe -> decide -> act -> observe`.
- Do not invent tools at runtime.
- Do not bypass computer-use with raw browser automation, Playwright, CDP, direct HTTP, or page-executed actions.

Testing and QA boundary:

- Deterministic tests verify primitive contracts: event payloads, candidate promotion, safety gates, coordinate projection, and forbidden action surfaces.
- P0 deterministic tests should assert kebab-case trace artifact roles: `screenshot`, `capture-contract`, `observation-snapshot`, `recognition-result`, `promoted-candidate`, `action-execution`.
- All frozen P0 roles are not metadata-only. P0B must not mark any artifact referenced by the frozen contract as metadata-only. Metadata-only roles can only be added by a later scope-freeze update.
- Artifacts referenced by `ArtifactRef` for frozen P0 roles must have real paths and parse according to MIME type. Screenshots must be real PNG files. `capture-contract` must be JSON containing the coordinate system, window source, scale, and captured timestamp.
- `action-execution` must be JSON containing action id/type, run/span, candidate/ref, precondition result, executed/refused status, timestamp, and known limits.
- Click/pointer actions must consume a traced `promoted-candidate` artifact produced by `driver.promoteCandidate()`. Missing promoted-candidate artifact ref is a hard refusal, not metadata-only, and not a `candidate_ref:null` success.
- On that refusal, `action-execution` must still be written with `executed:false`, `refused:true`, `candidate_ref:null`, and `missing_promoted_candidate_artifact`.
- `typeText`, `pressKey`, and `scroll` may use `candidate_ref:null` because they are not candidate-click actions.
- Deterministic tests must not encode a fixed Google, LinkedIn, or company-research workflow and treat that as research quality.
- Agent QA is separate. It evaluates whether the workflow controller uses observation, recognition, scrolling, overlay handling, and semantic source judgment correctly on real pages.
- Agent QA may use the harness as a convenience layer. It must not call a fixed task script that already decides the research path.
- Agent QA should produce a trace and a research result. It must not bypass the agent by calling a fixed task script that already decides every step.
- A passing unit test means the primitive contract is intact. It does not prove the company-research workflow is good.

Research workflow:

- For company research, decide from visible page semantics before acting. Ask what the page contributes to the current objective: company discovery, company evidence, hiring evidence, reachability evidence, or nothing useful.
- Do not reduce research to URL/title/domain if-else filtering. Rankings, directories, comparison articles, analyst posts, and tool libraries can be valuable discovery source pages even when they are not target companies.
- A discovery source is not the scored target. Use it to extract candidate company names, context, and source evidence, then decide which companies need direct follow-up through their website, LinkedIn company page, careers page, engineering blog, GitHub org, or other approved visible sources.
- Score and write records for companies or teams, not for articles, directories, ads, or job-board pages.
- Job postings and careers pages are job signal sources. Use them to support hiring-pressure and domain-alignment evidence for a company; do not treat a freelance marketplace listing as a company target.
- Before each click, record the semantic reason: why this visible link or control is useful now, what evidence is expected, and what would make the page a stop or reject.
- Google sponsored results should be collapsed when the observed `Hide sponsored results` control is available. After that, evaluate organic results semantically instead of blindly clicking by rank.

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
- Must not modify browser-use scope, add legacy compatibility wrappers, or introduce non-P0 AUV desktop capabilities during a workflow run.

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

Stop if login, SSO, passkey, account-selection, CAPTCHA, security prompt, payment, checkout, external send/apply, or other high-risk continuation is required before continuing.

A normal header `Sign in` link is not enough to stop. Stop when the visible page is requiring authentication, verification, payment, applying, or sending before continuing.

A job description page with a visible `Apply` button is still readable evidence. Record the role and hiring evidence, but do not click `Apply`, `Submit application`, upload files, or enter an application flow.

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
4. If login, CAPTCHA, payment, checkout, application submission, send-message, or account/security verification blocks the page, stop and record the reason.
