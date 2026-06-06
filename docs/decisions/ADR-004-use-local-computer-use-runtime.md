# ADR-004: Use Local Computer-Use Runtime for Visible Browser Sessions

## Status

Accepted

## Date

2026-06-06

## Context

CareerDeepSeek needs a visible-browser runtime for public web research that can observe the current browser state and act like a local user without turning the browser itself into the action executor.

The previous default direction used a minimal MV3 observer extension. That kept observation lightweight, but it added extension installation and permission friction. It also left action semantics split across browser and desktop layers.

The current product direction is computer-use:

- observe the real local desktop
- use Chrome DOM data only as a semantic observation source
- perform all page interaction through OS-level mouse, keyboard, and scroll events
- keep real browsing artifacts outside the public repository

## Decision

CareerDeepSeek's default visible-browser runtime is local macOS computer-use in `src/computer-use/`.

Observation sources:

- `screencapture -x` for screenshots.
- `CGWindowListCopyWindowInfo` for visible window metadata.
- `AXUIElement` for native macOS accessibility tree data.
- JXA `tab.execute({ javascript })` for read-only Chrome DOM semantics.

Observation is merged into `DesktopGroundingSnapshot` with target candidate priority:

```txt
chrome_dom > ax > vision > raw
```

JXA is observation-only. It may read the current tab URL, title, DOM-visible text, attributes, computed styles, viewport boxes, and occlusion state. It must not navigate, click, type, set input values, dispatch events, mutate DOM, or attach CDP/debugger.

Actions are OS-level:

- mouse movement and clicks through Swift + Quartz `CGEvent`
- text input through keyboard events; ASCII uses physical virtual key codes, non-ASCII keeps a Unicode fallback
- key chords through keyboard virtual key events
- scrolling through Quartz scroll wheel events

Task startup establishes the Chrome context first. Real desktop scripts must capture the current desktop, ensure Google Chrome is open and frontmost before address-bar or page actions, and capture another screenshot after Chrome is confirmed frontmost. If Chrome is not open, they may open it through OS-level app activation. If Chrome is open behind another app, they may activate it. Window observation must confirm a visible Chrome window is frontmost before the task continues.

Foreground context is also guarded before input. The default adapter policy rejects `click`, `type`, `press`, and `scroll` unless Google Chrome is frontmost. Real desktop startup scripts may explicitly opt into OS-level Chrome activation; activation must be followed by a foreground recheck before any CGEvent is posted.

Text input temporarily selects a Latin keyboard input source (`U.S.` or `ABC`) while sending CGEvent key codes, then restores the previous user input source. This prevents active IMEs from converting ASCII search queries.

There is no `open_url` action or URL-opening bootstrap helper. URL navigation is composed from observed Chrome address-bar actions: locate the address bar through AX bounds, click its observed center, press `Cmd+L`, type the URL, then press Enter. Page-internal search uses observed page controls and normal CGEvent typing.

All screen actions follow an observe-before-act rule. CGEvent mouse coordinates must originate from the current observation: Chrome DOM boxes, native AX bounds, or observed window bounds for a specific window target. Hard-coded offsets and guessed browser geometry are outside the accepted design.

## Consequences

- Target sites should not see WebDriver/headless/browser-internal action markers from the default runtime.
- JXA DOM observation can still be detected in theory by page scripts that instrument DOM APIs. It is lower risk than WebDriver/CDP/DOM actions, not undetectable.
- Extension permission friction is removed from the default path.
- OS-level desktop automation is allowed for local context management, such as opening Chrome, activating Chrome, taking startup screenshots, or temporarily selecting a Latin input source for typing, but it does not grant permission for browser-internal page actions.
- Chrome DOM data is treated as semantic grounding, not as an action route.
- Browser-internal click/type/value-setting routes are forbidden unless a future ADR explicitly approves a separate debug mode.
- `src/observation/` remains only as reference code for semantic observation contracts. MV3 extension and Playwright browser-use paths are removed from the repository because they do not match the current computer-use boundary.

## Alternatives Considered

### MV3 Extension Observer as Default

Rejected as the default because it adds installation and permission prompts. It remains useful as a legacy experiment.

### CDP or Playwright as Default

Rejected. These provide strong inspection and automation capabilities, but they expand the debugger/automation surface and can introduce observable automation indicators.

### Raw HTTP Fetching

Rejected. It violates CareerDeepSeek's visible-browser policy and cannot corroborate human-visible layout.

### Browser DOM Action Routing

Rejected for the default runtime. Chrome DOM may identify targets, but clicking and typing must go through the computer-use action layer.
