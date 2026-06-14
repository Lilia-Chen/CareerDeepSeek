# Browser-Use Policy

CareerDeepSeek is a bounded visible-browser research agent. Its default browser layer is read-only observation: collect current-page DOM-visible content, ARIA/HTML-derived semantic approximation, viewport boxes, occlusion checks, and screenshot metadata through a real browser.

CareerDeepSeek is not a raw scraper, crawler, or platform-abuse tool.

## Session Model

A browser session is allowed when it has:

- A clear search goal.
- A source scope.
- A page or time budget.
- Stop conditions.
- A repo-external private data target for any real records.

Inside an approved session, the agent may observe the visible browser, classify pages, score candidates, and produce review outputs. Page interaction after bootstrap must use the computer-use action layer.

OS-level context management is allowed for the local desktop. `MacOSChromeDriver.observe()`, target `recognize(...)`, and action methods must ensure Google Chrome is the foreground app before observing or sending input. In `auto_focus_chrome` mode, the driver may use native app activation, then must recheck the foreground app before continuing. This permission does not extend to browser-internal automation inside the page.

Development mode and production agent mode are separate. Development mode may change code, tests, registered tools, and policy. Production agent mode may only call pre-registered tools. It must not invent tools, change policy, register new action types, add browser-internal automation routes, or bypass the computer-use harness during a run.

Current workflow mode is skill-driven. The OpenCode/Codex agent reads `.opencode/skills/browser-use-policy/SKILL.md` and acts as the interactive workflow controller: observe, classify the current page, decide the next allowed visible action, act through computer-use, then observe again. Stable workflow fragments may later be promoted into deterministic state machines, but the current priority is preserving the workflow discipline during real interactive runs.

## Default Observation

The default observation stack is `src/computer-use/`:

- `MacOSChromeDriver.observe()` for open-ended Chrome state observation.
- `screencapture -l<windowid> -x -o` for Chrome window PNG screenshots and capture coordinate contracts.
- `CGWindowListCopyWindowInfo` for visible window position, title, owner, real window number, bundle id, and layer metadata.
- macOS `AXUIElement` for accessibility roles, labels, bounds, focus, and enabled state.
- macOS Vision OCR for text visible in the captured Chrome window screenshot.
- JXA `tab.execute({ javascript })` for read-only Chrome DOM semantics.

Observation answers what is currently visible. It does not directly authorize a click.

Target recognition is a separate driver call. `recognize(...)` answers whether a known target is present, such as the Chrome address bar, a page search box, a cookie accept button, a result link, or visible evidence text. A successful recognition result must be promoted into a candidate before the driver clicks it.

JXA is observation-only. It may read:

- Current tab URL and title.
- DOM-visible text.
- HTML and ARIA attributes.
- computed style visibility.
- viewport boxes and centers.
- `document.elementFromPoint(center)` occlusion checks.

JXA must not:

- Navigate or set `tab.url`.
- Click.
- Type.
- Set input values.
- Dispatch DOM events.
- Mutate DOM.
- Attach debugger/CDP.

## Default Actions

The action stack is `src/computer-use/macos-actions.ts`:

- Mouse movement and clicks use Swift + Quartz `CGEvent`.
- Text entry uses keyboard events: ASCII characters use physical virtual key codes, and non-ASCII characters keep a Unicode fallback.
- Key chords use virtual key events.
- Scrolling uses Quartz scroll wheel events.

Text entry may temporarily switch macOS to a Latin keyboard input source (`U.S.` or `ABC`) while sending CGEvent key codes, then restore the previous user input source. This is OS-level context management for reliable text entry; it is not browser-internal automation.

Automatic session actions are limited to visible, coordinate-grounded `click`, `type`, `press`, `scroll`, `wait`, `capture_screenshot`, and `stop`.

Before `observe`, `recognize`, `click`, `type`, `press`, or `scroll`, the driver must ensure Google Chrome is the foreground app. The default policy rejects the operation when another app is frontmost. A real desktop workflow may explicitly opt into OS-level Chrome activation, then the driver must confirm Chrome is frontmost before continuing.

There is no `open_url` action. URL navigation must be composed from observed Chrome address-bar actions: locate the address bar through AX bounds, click its observed center, press `Cmd+L`, type the URL, then press Enter. Searches inside a loaded page must use observed page controls and normal CGEvent input.

Every screen action must follow observation and target recognition. Mouse coordinates must come from a promoted recognition candidate with current evidence from OCR, Chrome DOM, AX, or window capture contract. Fixed offsets, guessed toolbar positions, and hard-coded browser geometry are forbidden.

Two visibility states are separate. Desktop foreground state controls whether OS-level input can reach Chrome. Page-visible DOM state controls which page elements may be acted on. Chrome being behind another app is fixed by foreground guard before observation. Hidden, covered, offscreen, or overlay-blocked page DOM must not become action targets.

When multiple visible controls share a label, the workflow must disambiguate before clicking. Selection should use the current task, page region, href target, and surrounding text. For example, on LinkedIn a global top-nav `Jobs` link is not the same action as a company-local `/company/{slug}/jobs/` tab.

If a click navigates to the wrong page, recovery must use observed browser history controls, such as Chrome Back or Forward, through the normal computer-use action layer. The workflow must not recover by retyping the previous URL into the address bar.

If browser history cannot return to the intended workflow page, the workflow should continue through observed page controls. On LinkedIn, that may mean clicking the page search control, selecting an observed exact recent query, and then choosing the required search vertical such as Companies, Jobs, People, or Posts.

Before normal page work, deterministic code must handle browser safety states:

- Cookie consent prompts are low-risk browsing prerequisites. The workflow may click an observed `Yes, I agree`, `I agree`, `Accept all cookies`, or equivalent accept control.
- Marketing popups may be closed only through an observed close, dismiss, no-thanks, or skip control.
- Login, SSO, passkey, account-selection, CAPTCHA, security, payment, checkout, application-submission, and send-message states are hard stops. They must be recorded and stopped, not delegated to model judgment.
- A job description page with a visible `Apply` button is still a readable evidence page. The workflow may extract role, location, team, and technical evidence, but must not click `Apply`, `Submit application`, upload documents, or enter the application flow.

The model may report what it sees and choose among allowed visible actions. It must not decide that a high-risk state is safe to continue through.

## Allowed

- Bounded sessions over search engines, company websites, public careers pages, public ATS pages, engineering blogs, documentation, changelogs, GitHub organization pages, and other approved public sources.
- Reading visible current-page text.
- Screenshot-assisted understanding.
- DOM-visible element extraction through read-only JXA.
- AX-derived desktop accessibility observation.
- Coordinate-grounded clicking, typing, key presses, and scrolling through CGEvent.
- Extracting short evidence summaries, missing information, risk flags, source labels, and observed timestamps.
- Classifying pages as target company, job opportunity, person/contact surface, source evidence, or irrelevant.
- Scoring target companies and job opportunities with the project rubrics.
- Writing structured private CRM records and review queues to `CAREERDEEPSEEK_DATA_DIR` only after the private-write boundary is approved.
- Drafting summaries, outreach, and application messages for user approval.

## Forbidden

- Raw HTTP scraping.
- Hidden API reverse engineering.
- Sitemap crawling.
- CAPTCHA bypass.
- Proxy rotation.
- Headless bulk collection.
- Browser-internal clicks, input value assignment, event dispatch, or DOM mutation.
- CDP, WebDriver, Playwright, extension bridge, or any browser-internal action routing.
- Long-running background browsing without an approved session goal and page budget.
- Bulk extraction from restricted job boards, social networks, review sites, or salary sites.
- Treating ARIA/HTML semantic approximation as native accessibility tree data.
- Auto-apply.
- Auto-send messages.
- Auto-add connections.
- Auto-like, comment, or follow.
- Runtime tool creation, policy modification, or new action registration by the production agent.

## Stop Conditions

Stop the browser session and ask before:

- Entering login, SSO, passkey, account-selection, or credential flows.
- Handling account, identity, payment, or security prompts.
- Solving CAPTCHA or anti-bot challenges.
- Continuing after platform rate limiting, blocking, or suspicious-activity warnings.
- Opening pages beyond the approved budget.
- Saving personal contact data.
- Starting CDP/native debug mode.
- Sending any message or application.
- Changing the source class or platform-specific behavior.

A passive header `Sign in` link is not a stop condition by itself. Stop when the current page requires authentication, identity verification, payment, application submission, or sending before continuing.

## Browser/Profile Safety Harness

The computer-use workflow is the first safety layer. Unattended or long-running sessions should also use a browser/profile-level safety layer.

The intended direction is a dedicated Chrome profile for agent mode. It should not be the user's daily Chrome profile. At task startup, the harness should detect the active Chrome profile and refuse to run, or switch through an approved startup path, unless the active profile is the agent profile.

The agent profile may contain approved logged-in state for a small set of research sources, such as selected job or company-intelligence sites. It should avoid stored payment methods, broad password autofill, personal browsing history, and unrelated logged-in accounts. This creates a practical profile sandbox: the agent can read through approved logged-in surfaces but cannot accidentally continue through most identity, payment, or account flows.

Candidate controls include download restrictions, sensitive URL or page-class blocking, payment and checkout continuation limits, and explicit user activation for identity, payment, or verification flows.

Do not implement Chrome policy assumptions from memory. Check official Chrome policy documentation before adding profile-level controls.

## Approval Gates

Ask before:

- Starting a browser session against a new source class not covered by this policy.
- Increasing the page or time budget.
- Logging in.
- Handling account or security prompts.
- Saving contact data.
- Enabling CDP, debugger permission, or browser-internal action routes.
- Generating a real outreach draft.
- Writing private CRM records.
- Changing platform-specific behavior.
