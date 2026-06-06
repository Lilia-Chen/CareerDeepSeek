# ADR-003: Use a Minimal Read-Only Browser Observer by Default

## Status

Superseded by [ADR-004](./ADR-004-use-local-computer-use-runtime.md)

## Date

2026-06-05

## Supersession Note

This decision described the pre-computer-use browser observation direction. CareerDeepSeek now defaults to local macOS computer-use: screenshot, window metadata, AX tree, read-only JXA Chrome DOM observation, and CGEvent-backed actions. The current decision is ADR-004.

## Context

CareerDeepSeek needs browser observation for public web research. The observation goal is to approximate how a human sees a page without turning the default runtime into a broad automation, scraper, or debugger surface.

Three signals matter:

- DOM-visible structure: current document nodes, text, attributes, styles, viewport boxes, and occlusion checks.
- Semantic approximation: role/name/state/relationship information derived from HTML and ARIA attributes.
- Screenshot corroboration: a visual snapshot of what is actually visible in the viewport.

Chrome does not expose the current page's native accessibility tree to a normal low-permission extension API. The native AX tree is available through Chrome DevTools Protocol, for example `Accessibility.getFullAXTree`, but CDP requires debugger/remote-debugging attachment and exposes a much larger capability surface.

Chrome's `activeTab` permission grants temporary current-tab access after a user gesture and can be paired with `scripting.executeScript`. `tabs.captureVisibleTab` can also be called with `activeTab`. This supports a low-permission one-shot observer extension.

## Decision

CareerDeepSeek's default browser observation layer is a minimal read-only Manifest V3 extension:

- `activeTab`
- `scripting`
- no `debugger`
- no `tabs`
- no `<all_urls>` host permission
- no manifest-declared persistent content scripts
- no target-page overlay, cursor, UI injection, DOM markers, or global element reference map

The default observer captures:

- DOM-visible semantic candidates.
- HTML/ARIA-derived role, name, state, and relationship approximations.
- computed style visibility.
- viewport bounding boxes.
- `document.elementFromPoint(center)` occlusion checks.
- screenshot preview and metadata from `chrome.tabs.captureVisibleTab`.

This default output must be named as DOM-visible plus ARIA/HTML semantic approximation. It must not be described as native AX tree observation.

CDP is retained only as an explicit high-fidelity debug mode. The initial debug observer allowlist is:

- `Accessibility.getFullAXTree`
- `DOMSnapshot.captureSnapshot`
- `Page.captureScreenshot`

The debug observer must not use CDP commands such as `Runtime.evaluate`, `Input.*`, DOM mutation commands, or network inspection commands.

## Alternatives Considered

### Default CDP or Playwright

Pros:

- Native AX tree access.
- DOMSnapshot and screenshot support.
- Strong debugging fidelity.

Cons:

- Debugger/remote-debugging surface is much broader than read-only observation.
- Chrome remote debugging has additional security restrictions and should use a non-default user data directory.
- Automation/debugger profile differences can become observable.
- Native AX collection can be slower or time out on deep pages and frames.

Rejected as default. Kept as debug mode.

### BrowserMCP, Playwright MCP, mcp-chrome, or similar plugins

Pros:

- Existing MCP tool surface.
- Some provide snapshots and screenshots.

Cons:

- Frequent manual connect/allow flows.
- Heavy permissions such as `debugger`, broad host access, or persistent content scripts.
- Some inject overlays, cursor UI, or page markers.

Rejected as the default CareerDeepSeek observation layer.

### Raw HTTP Fetching

Rejected. It violates CareerDeepSeek's visible-browser policy and cannot corroborate human-visible layout.

## Consequences

- The default observer cannot promise native accessibility tree fidelity.
- The semantic layer is an approximation derived from page-authored HTML and ARIA quality.
- Native AX disagreements are investigated through CDP debug experiments, not hidden inside the default runtime.
- This historical Playwright note is superseded by ADR-004. Playwright browser-use code has been removed from CareerDeepSeek because it does not match the current computer-use boundary.
- Real screenshots, raw DOM text, raw AX trees, and browsing evidence remain private data and must not be committed to this public repository.
