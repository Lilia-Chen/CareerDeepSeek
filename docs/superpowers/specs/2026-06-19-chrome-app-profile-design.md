# Chrome App Profile — Design Spec

**Status:** Approved
**Date:** 2026-06-19
**Scope:** P2 kickoff feature — Chrome-specific spatial structure knowledge as a driver-level capability

---

## Goal

Add per-node region tagging (`chrome_tab_bar` / `chrome_address_bar` / `chrome_bookmark_bar` / `page_viewport`) to the observe pipeline, and optional region filtering to the recognize pipeline. Eliminate hardcoded pixel thresholds and role-based node deletion in favor of a unified Chrome app profile.

---

## Architecture

```
chrome-app-profile.ts          ← NEW: Chrome spatial structure knowledge
    ↓ exports: classifyRegion(), findViewport(), regionAllows()
driver.ts (observe)            ← MODIFIED: tags each SurfaceNode with region
driver.ts (recognizeFromCapture) ← MODIFIED: passes region to recognition
recognition.ts (matchesTarget) ← MODIFIED: optional region filter before text match
types.ts                       ← MODIFIED: extend RecognitionSurface, add region to target
invoke-handlers.ts             ← MODIFIED: forward region in parseRecognitionTarget
```

**Deleted:**
- `isBrowserChromeRole()` in surface-node.ts — replaced by region tag system (nodes preserved, not deleted)
- `windowContentFallbackBounds()` in driver.ts — replaced by known_limit fallback
- `BROWSER_CHROME_FALLBACK_TOP_INSET` constant — hardcoded 96px removed

**Untouched:**
- `findChromeViewportBounds()` — kept, used by chrome-app-profile.ts
- Scroll region lease — unchanged
- All action/delivery code — unchanged

---

## Components

### 1. `chrome-app-profile.ts` (NEW)

Three exports, all pure functions. Zero driver state dependency.

```typescript
export type ChromeRegion = 'chrome_tab_bar'
  | 'chrome_address_bar'
  | 'chrome_bookmark_bar'
  | 'page_viewport'

/** Map AX role to Chrome region. Falls back to page_viewport for unknown roles. */
export function classifyRegion(
  axRole: string,
  bounds: Bounds,
  viewportBounds: Bounds | null,
): ChromeRegion

/** Extract the web content viewport bounds from the AX tree. */
export function findViewport(
  axSnapshot: AXSnapshot,
  windowBounds: Bounds,
): { bounds: Bounds, confidence: 'ax_web_area' } | null

/** Whether the given target kind is allowed in the given region. */
export function regionAllows(
  region: ChromeRegion,
  targetKind: ChromeRecognitionTarget['kind'],
): boolean
```

**Internal mapping table** (only AX role → region, no pixels):

```
AXTabGroup, AXRadioGroup → chrome_tab_bar
AXToolbar               → chrome_address_bar
AXMenuBar, AXMenuBarItem → chrome_tab_bar
(all others)            → page_viewport (default)
```

**Viewport extraction**: find matching AXWindow → find largest AXWebArea → intersect with windowBounds → require ≥100x100. Returns null if unavailable (caller marks known_limit, no pixel guess).

**Region permissions**: tab_bar and bookmark_bar reject all target kinds. address_bar accepts text_input and ocr_text only. page_viewport accepts everything.

---

### 2. `types.ts` (MODIFIED)

- Extend `RecognitionSurface` union with `'chrome_tab_bar' | 'chrome_address_bar' | 'chrome_bookmark_bar' | 'page_viewport'`
- Add optional `region?: RecognitionSurface` to each variant of `ChromeRecognitionTarget`

---

### 3. `surface-node.ts` (MODIFIED)

`normalizeToSurfaceNodes` receives a new input: `axViewportBounds?: Bounds` (the AX-derived viewport, separate from the DOM projection viewportBounds).

**AX branch:**
- REMOVE `if (isBrowserChromeRole(axNode.role)) return` — stop deleting chrome nodes
- ADD: `recognition_surface = classifyRegion(axNode.role, axNode.bounds, axViewportBounds)`
- Nodes with known chrome roles get their region. Others get `page_viewport` with bounds-check against viewport

**OCR branch:**
- ADD: region classification by comparing projected bounds against AX viewport and known chrome AX element bounds
- In viewport intersection → `page_viewport`
- In address bar area → `chrome_address_bar`
- In tab bar area → `chrome_tab_bar`
- Unknown → `page_viewport` with `known_limit: 'ocr_region_unknown'`

**DOM branch:**
- Always `page_viewport` (DOM executes only in page context)

**DELETE:** `isBrowserChromeRole()` function

---

### 4. `recognition.ts` (MODIFIED)

`matchesTarget()`: if `target.region` is set, reject items whose `recognition_surface` does not match `target.region`. This is a gate before the existing kind + text matching.

No changes to `compareForBest` — region filtering happens at the filter step, not the sort step. Items outside the target region never reach sorting.

The `target.region` parameter is **optional**. When absent, behavior is unchanged (all nodes participate).

---

### 5. `driver.ts` (MODIFIED)

**`observe()`:**
- Pass `axViewportBounds?.bounds` to `normalizeToSurfaceNodes` as new `axViewportBounds` input
- Remove scroll lease dependency on `windowContentFallbackBounds` — when `findViewport` returns null, mark `known_limit: 'viewport_unavailable_from_ax_tree'` and set all nodes to `page_viewport`

**`recognizeFromCapture()`:**
- No changes needed — target passes through to `recognition.ts:recognizeFromCapture`

**DELETE:** `windowContentFallbackBounds()` function, `BROWSER_CHROME_FALLBACK_TOP_INSET` constant

---

### 6. `invoke-handlers.ts` (MODIFIED)

`parseRecognitionTarget()`: forward `value.region` when constructing the target object for all 6 target kinds. Currently extra fields are silently dropped.

Add import for `RatioRegion` from types.ts if region is passed as a RatioRegion, or use the `RecognitionSurface` type directly.

---

## Data Flow

```
observe()
  ├─ findViewport(axSnapshot, windowBounds) → axViewportBounds or null
  ├─ normalizeToSurfaceNodes({ ..., axViewportBounds })
  │   ├─ AX: classifyRegion(role, bounds, axViewportBounds) → tag
  │   ├─ OCR: compare bounds vs viewport/chrome regions → tag
  │   └─ DOM: always page_viewport
  └─ returns ObservationSnapshot with tagged SurfaceNode[]

recognize(target)
  └─ items.filter(matchesTarget)
       └─ if target.region: reject non-matching region
       └─ then: kind + text matching (unchanged)
```

---

## Non-Goals

- Do not change action delivery (click, type, scroll)
- Do not change candidate promotion gate
- Do not add tab management or tab switching
- Do not add overlay detection or dismissal
- Do not change scroll region lease
- Do not add a fixed company-search workflow

---

## Design Principles

1. **AX is the primary structural source.** Pixel thresholds are not structural knowledge.
2. **OCR is full-window, not viewport-only.** Tab text, address bar text are legitimate observations that need region tags, not deletion.
3. **Region filter is opt-in.** Default behavior unchanged — all nodes participate unless caller specifies `region`.
4. **No node deletion.** `isBrowserChromeRole` skipped nodes entirely. Region tags preserve them so tab management can consume them in P2.
5. **Known limits over false confidence.** When AX can't determine viewport bounds, mark `known_limit` rather than guessing 96px.

---

## Test Expectations

- AX nodes with chrome roles (AXTabGroup, AXToolbar) get correct region tag, not deleted
- OCR nodes in tab area get `chrome_tab_bar` tag
- DOM nodes always get `page_viewport`
- `recognize({ target: { kind: 'ocr_text', text: 'LangChain' } })` — no region, matches all nodes (backward compatible)
- `recognize({ target: { kind: 'ocr_text', text: 'LangChain', region: 'page_viewport' } })` — excludes tab bar matches
- `recognize({ target: { kind: 'text_input', region: 'chrome_address_bar' } })` — only address bar text fields
- When AXWebArea unavailable, all nodes tagged `page_viewport` with known_limit
- `isBrowserChromeRole` and `windowContentFallbackBounds` removed
