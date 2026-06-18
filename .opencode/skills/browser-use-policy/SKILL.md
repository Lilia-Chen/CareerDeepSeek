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
- P1.5 programmatic invoke is the primary primitive path for new computer-use work.
- P1.5 uses the programmatic invoke API as the approved primitive entry point. Top-level computer-use exports the invoke entry; direct driver submodule access is reserved for driver implementation and tests.
- `MacOSChromeAgentHarness` is not an approved entry point for new P1.5 work. Legacy observation, recognition, candidate-promotion, click, targetless scroll, and overlay-dismissal helpers must not be recreated in workflow code.
- Do not recreate legacy paths under new names. Do not invent `open_url`, direct DOM action, Playwright, CDP, raw HTTP, or page-executed action routes.
- Do not let an individual capability slice expand the contract locally. New artifact roles, trace payload fields, `action-execution` schema fields beyond the authorized `grounding` field, action result schemas, driver APIs, public exports, tool entries, or workflow helpers require a scope-freeze update first.
- Use the P0B contract as the implementation input for Chrome window capture, `ObservationSnapshot`, `RecognitionResult`, `SurfaceNode`, `PromotedCandidate`, `ArtifactRef`, `TraceStore` payload discipline, and Chrome lease/profile/foreground/hard-stop action gates.
- Treat yourself as the semantic research controller for internet research. Computer-use can show what is visible and perform allowed clicks/typing/scrolling; it cannot decide whether a page is valuable, whether a source answers the research question, or which company deserves deeper work.
- Every browser action must be grounded in `observe -> recognize -> promote -> action -> observe`; the semantic research decision happens outside the primitive layer.
- Under P1.5 invoke, every input action must have explicit target/focus provenance. Pointer/click consumes a promoted `ocr_anchor` or OCR-derived `visual_row` candidate. `chrome.focusTextInput` consumes a promoted `ax_node` text input before keyboard input. Scroll consumes a promoted scroll target / region. `typeText` and `pressKey` must follow audited focus in the same command sequence. No action may depend on implicit current mouse position or keyboard focus.
- Driver liveness recheck remains mandatory and is not replaced by caller pre-action observation. Caller post-action observation is explicit; action commands must not hide automatic post-observe.
- Do not invent tools at runtime.
- Do not bypass computer-use with raw browser automation, Playwright, CDP, direct HTTP, or page-executed actions.

Testing and QA boundary:

- Deterministic tests verify primitive contracts: event payloads, candidate promotion, safety gates, coordinate projection, and forbidden action surfaces.
- P0 deterministic tests should assert kebab-case trace artifact roles: `screenshot`, `capture-contract`, `observation-snapshot`, `recognition-result`, `promoted-candidate`, `action-execution`.
- All frozen P0 roles are not metadata-only. P0B must not mark any artifact referenced by the frozen contract as metadata-only. Metadata-only roles can only be added by a later scope-freeze update.
- Artifacts referenced by `ArtifactRef` for frozen P0 roles must have real paths and parse according to MIME type. Screenshots must be real PNG files. `capture-contract` must be JSON containing the coordinate system, window source, scale, and captured timestamp.
- `action-execution` must be JSON containing action id/type, run/span, optional grounding, candidate/ref, precondition result, executed/refused status, timestamp, and known limits.
- Click/pointer actions must consume a traced `promoted-candidate` artifact produced by `driver.promoteCandidate()`. Missing promoted-candidate artifact ref is a hard refusal, not metadata-only, and not a `candidate_ref:null` success.
- On that refusal, `action-execution` must still be written with `executed:false`, `refused:true`, `candidate_ref:null`, and `missing_promoted_candidate_artifact`.
- For `typeText`, `pressKey`, and `scroll`, `action-execution.candidate_ref` can be `null` only as the candidate artifact field because they are not candidate-click artifact consumers. This is not permission to type, press, or scroll without target/focus provenance.
- Deterministic tests must not encode a fixed Google, LinkedIn, or company-research workflow and treat that as research quality.
- Agent QA is separate. It evaluates whether the workflow controller uses observation, recognition, promoted actions, hard-stop signals, and semantic source judgment correctly on real pages.
- New primitive QA must use programmatic invoke sequences directly. Legacy harness tests may cover adapter behavior only. Agent QA must not call a fixed task script that already decides the research path.
- Agent QA should produce a trace and a research result. It must not bypass the agent by calling a fixed task script that already decides every step.
- P1.5 primitive QA should produce command sequence, trace/artifact refs, `visual_report` path or reason absent, status, stable failure class/code, and known limits.
- QA scripts and research workflow remain separate. Do not use `gov.uk` or civil-service pages as career candidate targets in QA.
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
- If already on Google results, scroll/click observed organic result links. Do not restart by typing the same query or URL into the address bar.

Disambiguate duplicate labels:

- Never click the first visible element just because its text matches the target label.
- Rank candidates by current task, page region, href target, and surrounding text.
- For platform pages with repeated labels, prefer candidates whose href and surrounding text keep the action within the current task context.

Back/Forward recovery:

- Browser recovery/back/close is P2 until a browser transition contract exists.
- Do not perform unmodeled back/close, `Cmd+Left`, tab close, or Chrome toolbar Back/Forward recovery as part of P1.5 invoke behavior.
- If a click navigates to the wrong page, observe and record the current state, then stop or continue only through safe visible page controls already covered by policy.
- Do not recover by typing the previous URL into the address bar.
- If browser history recovery is later authorized by P2, observe again before choosing the next control.
- Without a recovery primitive, continue only through observed page controls such as the site search box, local navigation tabs, or filters when that remains within the approved task.
Production agent mode:

- May only call pre-registered tools.
- Must not create tools, register action types, modify policy, or bypass the approved computer-use entry point: P1.5 programmatic invoke.
- Must not productize new stop/dismiss behavior during a workflow run. P1.5 exposes hard-stop / safety signals only; structural overlay detection and dismissal primitives are P2.
- Must not modify browser-use scope, add legacy compatibility wrappers, or introduce non-P0 AUV desktop capabilities during a workflow run.

Allowed:

- User-approved pages.
- Low-frequency visible browsing.
- Current-page visible text.
- Screenshots for supervised understanding.
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

- P1.5 invoke does not include a structural overlay detector or dismissible overlay dismissal primitive.
- Cookie consent or marketing modal dismissal is P2 unless the owner explicitly authorizes a new primitive.
- Login, payment, CAPTCHA, apply, send, account/security verification, or any page-blocking overlay without an approved dismissal primitive: record the stop/block signal and stop.
- Do not add structural overlay detection or dismissal primitives in P1.5; those are P2.
