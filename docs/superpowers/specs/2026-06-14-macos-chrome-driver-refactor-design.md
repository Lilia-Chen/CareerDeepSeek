# CareerDeepSeek macOS-Chrome Driver Refactor — Design Spec

**Date:** 2026-06-14
**Status:** Design complete, reviewed against AUV v0 contracts
**Reference:** AUV `contract.rs`, `candidate_promotion.rs`, `driver/macos/support/recognition.rs`, `driver/macos/support/ocr.rs`, `scroll_scan/observation.rs`, `trace.rs`

---

## 0. Adversarial Review Results

9 unnecessary AUV deviations found and FIXED in this spec:
1. ✅ `bounds` → `box` (match AUV wire format)
2. ✅ ObservationSnapshot uses `nodes: SurfaceNode[]` (not raw provider blobs)
3. ✅ SurfaceNode has all 12 AUV fields
4. ✅ Candidate promotion is typed refusal-first (not string throws)
5. ✅ Trace schema has Run/Span/Event/Artifact with api_version
6. ✅ OCR is PRIMARY recognition source, DOM/AX are AUXILIARY
7. ✅ CandidateRef carries full provenance chain
8. ✅ JSON wire format uses snake_case
9. ✅ Region hints use RatioRegion (ratios, not pixel Bounds)

5 necessary deviations (justified for web browser domain):
1. `RecognitionSource.chrome_dom` — browser-only source
2. `ObservationSource.chrome_dom` — browser-only source
3. `ChromeForegroundPolicy` — richer than AUV's simple bools
4. Browser safety gate — CAPTCHA/login/cookie don't exist in native apps
5. `center` field — needed for CGEvent click targeting

---

## 1. Architecture Overview

Two independent paths sharing capture artifacts:

```
                         capture artifact
                         (screenshot.png + CaptureContract)
                              │
               ┌──────────────┼──────────────┐
               ▼                              ▼
      Path 1: Observation            Path 2: Recognition
      ("What's on this page?")       ("Did I find X?")
               │                       (OCR-first, DOM/AX auxiliary)
               ▼                              │
      ObservationSnapshot                     ▼
      { nodes: SurfaceNode[],          RecognitionResult
        source, scope, evidence }      { best, filtered, all,
               │                         source, scope, evidence }
               │                              │
               ▼                              ▼
      Context / trace / replay     Path 3: Candidate Promotion
                                   (refusal-first gate)
                                             │
                              ┌──────────────┼──────────────┐
                              ▼                              ▼
                         Refused { reasons }       Promoted { candidate }
                                                           │
                                                           ▼
                                                 Path 4: Action
                                                 (click/type/scroll)
                                                 only PromotedCandidate
```

**Critical:** RecognitionResult does NOT embed ObservationSnapshot. ObservationSnapshot does NOT contain RecognitionResult. They are siblings, not parent-child.

---

## 2. Type Definitions (snake_case wire format, matching AUV)

### 2.1 RecognitionBox (≡ AUV contract.rs:225-232)

```typescript
export interface RecognitionBox {
  x: number
  y: number
  width: number
  height: number
}
// Wire: { "x": 100, "y": 200, "width": 640, "height": 96 }
```

### 2.2 RatioRegion (≡ AUV contract.rs:378-384)

```typescript
export interface RatioRegion {
  left: number    // 0.0..1.0
  top: number
  right: number
  bottom: number
}
```

### 2.3 RecognitionSource (≡ AUV contract.rs:247-256, + chrome_dom)

```typescript
export type RecognitionSource =
  | 'ocr_text'
  | 'ocr_row'
  | 'visual_row'
  | 'segmented_region'
  | 'icon_match'
  | 'custom'
  | 'chrome_dom'    // NECESSARY: browser-only source
```

### 2.4 RecognitionSurface (≡ AUV contract.rs:261-274)

```typescript
export type RecognitionSurface = 'screen' | 'display' | 'window' | 'region'
```

### 2.5 RecognitionScope (≡ AUV contract.rs:277-296)

```typescript
export interface RecognitionScope {
  surface: RecognitionSurface
  display_ref?: string
  native_display_id?: string
  app_bundle_id?: string
  window_title?: string
  window_number?: number
  region_hint?: RatioRegion                // ratios, NOT pixel bounds
  capture_artifact?: ArtifactRef
  capture_contract_artifact?: ArtifactRef
}
```

### 2.6 RecognizedItem (≡ AUV contract.rs:215-224)

```typescript
export interface RecognizedItem {
  item_id: string                          // wire: "item_id"
  kind: string                             // e.g. 'ocr_text', 'ax_button', 'dom_link'
  box: RecognitionBox                      // wire: "box" (NOT "bounds")
  text?: string
  provider_score?: number                  // wire: "provider_score" (NOT "confidence")
  detail: Record<string, unknown>
}
```

### 2.7 RecognitionResult (≡ AUV contract.rs:178-189)

```typescript
// NOTE: NO api_version on RecognitionResult (AUV doesn't have one — it's an intermediate artifact)
export interface RecognitionResult {
  recognition_id: string                   // wire: "recognition_id"
  source: RecognitionSource                // wire: "source"
  scope: RecognitionScope                  // wire: "scope"
  best: RecognizedItem | null              // wire: "best"
  filtered: RecognizedItem[]               // wire: "filtered"
  all: RecognizedItem[]                    // wire: "all"
  detail: Record<string, unknown>          // wire: "detail" — provider-specific (strategy, raw_match_count, etc.)
  evidence: ArtifactRef[]                  // wire: "evidence"
  known_limits: string[]                   // wire: "known_limits"
}
// DOES NOT embed observation — AUV pattern, confirmed
```

### 2.8 NodeRef (≡ AUV contract.rs:192-196)

```typescript
export interface NodeRef {
  run_id: string
  span_id: string
  node_id: string
}
```

### 2.9 SurfaceNode (≡ AUV contract.rs:198-213, EXACT match)

```typescript
export interface SurfaceNode {
  node_ref: NodeRef                        // wire: "node_ref"
  kind: string                             // wire: "kind"
  label?: string                           // wire: "label"
  box: RecognitionBox                      // wire: "box" (NOT "bounds")
  source_artifacts: string[]               // wire: "source_artifacts"
  recognition_id?: string                  // wire: "recognition_id"
  recognition_source?: RecognitionSource   // wire: "recognition_source"
  recognition_surface?: RecognitionSurface // wire: "recognition_surface"
  recognized_item_id?: string             // wire: "recognized_item_id"
  recognized_item_kind?: string           // wire: "recognized_item_kind"
  provider_score?: number                  // wire: "provider_score"
  detail: Record<string, unknown>          // wire: "detail"
  // NECESSARY browser addition:
  center?: { x: number; y: number }       // pre-computed click point (not in AUV)
}
```

### 2.10 ObservationSource (≡ AUV contract.rs:535-547, + chrome_dom)

```typescript
export type ObservationSource = 'ax' | 'ocr' | 'visual' | 'merged' | 'chrome_dom'
```

### 2.11 ObservationSnapshot (≡ AUV contract.rs:578-614, EXACT match)

```typescript
export interface ObservationSnapshot {
  api_version: 'careerdeepseek.observation_snapshot.v1alpha1'
  snapshot_id: string
  run_id: string
  span_id: string
  captured_at_millis: number
  source: ObservationSource                // 'merged' when multiple providers contributed
  scope: RecognitionScope
  capture_contract_ref?: ArtifactRef
  evidence: ArtifactRef[]
  nodes: SurfaceNode[]                     // Unified projection (NOT raw provider blobs)
  detail: Record<string, unknown>
  known_limits: string[]
}
// Raw provider outputs (AX snapshot, DOM elements, OCR raw) go into evidence artifacts,
// NOT as top-level fields. The nodes array IS the canonical access point.
```

### 2.12 Candidate Types (≡ AUV candidate_promotion.rs)

```typescript
export type CandidatePromotion =
  | { status: 'promoted'; candidate: PromotedCandidate; residual_known_limits: string[] }
  | { status: 'refused'; reasons: PromotionRefusal[] }

export type PromotionRefusal =
  | 'empty_recognition'
  | 'no_unambiguous_target'
  | 'no_runtime_evidence'
  | 'missing_capture_artifact'
  | 'item_not_actionable'
  | 'item_outside_viewport'
  | 'stale_capture'
  | 'profile_mismatch'
  | 'chrome_not_foreground'
  | 'hard_stop_signal'
  | 'projection_unavailable'

export interface PromotedCandidate {
  candidate_local_id: string               // wire: "candidate_local_id"
  kind: string
  label?: string
  target_spec: {
    grounding: 'coordinate'               // always coordinate for v0
    box: RecognitionBox
    anchor_text?: string
    region_hint?: RatioRegion
  }
  evidence: {
    capture_artifact: ArtifactRef
    recognition_artifact: ArtifactRef
    observation_blob: Record<string, unknown>
  }
  liveness: {
    preconditions: {
      window_ref: {
        app_bundle_id: string
        window_title_substring?: string
        window_number?: number
      }
      anchor_recheck?: {
        text: string
        region_hint?: RatioRegion
        expected_min_confidence: number
        max_pixel_distance: number
      }
    }
    ttl_hint_ms?: number
  }
  control: {
    requires_app_frontmost: boolean       // always true for CareerDeepSeek actions
    requires_window_focus: boolean
  }
  // Full provenance chain (≡ AUV CandidateRef)
  source_run_id: string
  source_span_id: string
  source_operation_id: string
  source_artifact_id: string
  known_limits: string[]
}
```

### 2.13 ArtifactRef (≡ AUV contract.rs)

```typescript
export interface ArtifactRef {
  run_id: string
  artifact_id: string
  span_id: string
  captured_event_id?: string
}
```

### 2.14 Trace Types (≡ AUV trace.rs, EXACT shape)

```typescript
export const RUN_API_VERSION = 'careerdeepseek.run.v1alpha1'
export const SPAN_API_VERSION = 'careerdeepseek.span.v1alpha1'
export const EVENT_API_VERSION = 'careerdeepseek.event.v1alpha1'
export const ARTIFACT_API_VERSION = 'careerdeepseek.artifact.v1alpha1'

export interface RunRecord {
  api_version: string
  run_id: string
  trace_id: string
  run_type: 'command' | 'execute' | 'probe' | 'analyze' | 'distill' | 'validate'
  state: 'running' | 'ended'
  status_code: 'unset' | 'ok' | 'error'
  started_at_millis: number
  finished_at_millis?: number
  root_span_id: string
  attributes: Record<string, unknown>
  summary?: string
  failure?: { message: string }
}

export interface SpanRecord {
  api_version: string
  span_id: string
  parent_span_id?: string
  name: string
  state: 'running' | 'ended'
  status_code: 'unset' | 'ok' | 'error'
  started_at_millis: number
  finished_at_millis?: number
  attributes: Record<string, unknown>
  summary?: string
  failure?: { message: string }
}

export interface EventRecord {
  api_version: string
  event_id: string
  span_id: string
  name: string
  timestamp_millis: number
  attributes: Record<string, unknown>
  message?: string
  artifact_ids: string[]
}

export interface ArtifactRecord {
  api_version: string
  artifact_id: string
  span_id: string
  event_id?: string
  role: string          // 'screenshot', 'ocr_raw', 'ax_snapshot', 'dom_snapshot', 'recognition_result', 'observation_snapshot'
  mime_type: string
  path: string
  sha256?: string
  attributes: Record<string, unknown>
  summary?: string
}
```

### 2.15 Browser-Specific Types (NECESSARY deviations)

```typescript
export interface ChromeWindowRef {
  id: string
  window_number: number
  app_name: string
  owner_pid: number
  owner_bundle_id?: string
  title: string | null
  bounds: RecognitionBox
  layer: number
}

export interface ChromeContextSnapshot {
  running: boolean
  is_frontmost: boolean
  frontmost_app_name?: string
  frontmost_app_bundle_id?: string
  active_tab_url: string | null
  active_tab_title: string | null
  profile: {
    status: 'verified' | 'mismatch' | 'unverified'
    reason: string
    profile_path?: string
  }
  window: ChromeWindowRef
}

export interface ChromeCaptureContract {
  coordinate_contract_version: 1
  capture_source: {
    kind: 'window'
    window_number: number
    owner_pid: number
    owner_bundle_id?: string
  }
  source_global_logical_bounds: RecognitionBox
  screenshot_pixel_size: { width: number; height: number }
  pixel_to_logical_scale: { x: number; y: number }
  logical_to_pixel_scale: { x: number; y: number }
  captured_at: string
}

export interface ChromeWindowCapture {
  snapshot_id: string
  screenshot: ScreenshotArtifact
  contract: ChromeCaptureContract
}

export type ChromeForegroundPolicy = 'require_chrome' | 'auto_focus_chrome'

export type ChromeRecognitionTarget =
  | { kind: 'text_input'; name: string | RegExp }
  | { kind: 'button'; text: string | RegExp }
  | { kind: 'link'; text: string | RegExp }
  | { kind: 'visible_text'; text: string | RegExp }

export interface ProfileConfig {
  profile_path: string
  profile_name: string
  verified_at: string
}
```

### 2.16 DELETED Types

- `MacOSChromeCandidateRef` → replaced by `PromotedCandidate`
- `ChromeRecognizedItem` → replaced by `RecognizedItem`
- `ChromeRecognitionEvidence` → replaced by `ArtifactRef[]`
- `ChromeRecognitionSource` → replaced by `RecognitionSource`
- `Bounds` → replaced by `RecognitionBox`
- `DesktopGroundingSnapshot` → if any references remain

---

## 3. Driver API

### Constructor

```typescript
constructor(options: {
  session_id: string
  config?: Partial<ComputerUseConfig>
  foreground_policy?: ChromeForegroundPolicy
})
// 1. Validates session_id is non-empty
// 2. Resolves config
// 3. Creates run record in trace store
// 4. Verifies Chrome profile (open chrome://version, OCR Profile Path,
//    compare against CareerDeepSeek-data/computer-use/profile.json)
// 5. If profile fails → driver in degraded mode (observe works, actions blocked)
```

### observe() — Path 1: "What's on this page?"

```typescript
async observe(): Promise<ObservationSnapshot>
```
1. Resolve Chrome context (foreground relaxed for observation)
2. Capture Chrome window → `ChromeWindowCapture` (always with `ChromeCaptureContract`)
3. OCR on screenshot (PRIMARY observation source)
4. AX tree + Chrome DOM (AUXILIARY, in parallel)
5. Normalize ALL sources → `SurfaceNode[]` via `normalizeToSurfaceNodes()`
6. Derive signals from node text
7. Record trace with before screenshot
8. Return `ObservationSnapshot` with `nodes` (NOT raw provider blobs)

### recognize() — Path 2: "Did I find X?"

```typescript
async recognize(
  capture: ChromeWindowCapture,
  target: ChromeRecognitionTarget,
  aux_sources?: { ax_snapshot?: AXSnapshot; dom_observation?: ChromeDomObservation }
): Promise<RecognitionResult>
```
1. **OCR-FIRST:** Run OCR on capture's screenshot → `RecognizedItem[]` with pixel-to-logical projection
2. Filter by min_confidence (default 0.3)
3. Apply target matching (text match + kind match) → `filtered`
4. **AUXILIARY verification:** cross-reference filtered items with DOM/AX:
   - DOM confirms href/role → boost provider_score
   - AX confirms interactability → update kind
5. Sort: actionable first, provider_score descending
6. `best` = filtered[0] | null; `all` = all OCR matches
7. Return `RecognitionResult` — does NOT call observe() internally

### promoteCandidate() — Path 3: Refusal-first gate

```typescript
async promoteCandidate(
  recognition: RecognitionResult,
  capture: ChromeWindowCapture,
  options: {
    profile_verified: boolean
    chrome_foreground: boolean
    hard_stop_signals: string[]
    ttl_ms: number
    viewport_bounds: RecognitionBox
  }
): Promise<CandidatePromotion>
```
Pure function — all live state passed in by caller. Exhaustive refusal checks:
1. `empty_recognition` — all.length === 0
2. `no_unambiguous_target` — best === null
3. `no_runtime_evidence` — evidence.length === 0
4. `missing_capture_artifact` — scope.capture_artifact === null
5. `item_not_actionable` — best.kind not in actionable types
6. `item_outside_viewport` — best.box center outside viewport_bounds
7. `stale_capture` — capture age > ttl_ms
8. `profile_mismatch` — profile_verified === false
9. `chrome_not_foreground` — chrome_foreground === false
10. `hard_stop_signal` — hard_stop_signals.length > 0
11. `projection_unavailable` — cannot project coordinates

Returns `CandidatePromotion` (discriminated union), NEVER throws.

### Action Methods — Path 4 (only PromotedCandidate)

```typescript
async click(candidate: PromotedCandidate): Promise<void>
async typeText(text: string): Promise<void>
async pressKey(key: string, modifiers?: string[]): Promise<void>
async scroll(delta_y?: number, delta_x?: number): Promise<void>
```

Every action runs safety gate FIRST (no LLM judgment):
1. Profile verified
2. Chrome foreground
3. Window alive (window_number still in window list)
4. No hard-stop signals in visible text
5. Candidate within ttl
6. Click point within viewport bounds
7. App not in denyApps

---

## 4. Safety Gate Rules (Exhaustive)

### 4.1 Action Pre-Checks (driver layer, never delegated to LLM)

| # | Check | Failure Code |
|---|-------|-------------|
| 1 | Profile verified | `profile_mismatch` |
| 2 | Chrome foreground | `chrome_not_foreground` |
| 3 | Window alive | `window_changed` |
| 4 | No captcha | `captcha_detected` |
| 5 | No login required | `login_required` |
| 6 | No payment required | `payment_required` |
| 7 | No password field | `password_field` |
| 8 | Candidate not stale | `stale_candidate` |
| 9 | Point in bounds | `point_out_of_bounds` |
| 10 | Not denied app | `app_denied` |

### 4.2 Hard-Stop Signal Patterns

```typescript
const HARD_STOP_PATTERNS = [
  ['captcha', /\b(captcha|verify you are human|human verification|complete (this )?security check)\b/i],
  ['login_required', /\b(please )?(sign in|log in|login|create an account|create account|register).{0,40}(to continue|before continuing|required)|\b(to continue).{0,40}(sign in|log in|login|required)\b/i],
  ['payment_required', /\b(enter|provide|add).{0,24}(payment details|billing details|credit card|card details)|\b(pay now|checkout to continue|purchase required)\b/i],
  ['checkout', /\b(checkout|complete purchase|place order|confirm and pay)\b/i],
  ['password_field', /\b(password|passcode|pin)\b/i],
]
```

---

## 5. Trace Schema (≡ AUV trace.rs)

### 5.1 On-Disk Layout

```
<COMPUTER_USE_SESSION_ROOT>/traces/<session_id>/
  run.json              — single RunRecord
  spans.jsonl           — one SpanRecord per line
  events.jsonl          — one EventRecord per line
  artifacts.jsonl       — one ArtifactRecord per line
  screenshots/
    <step_id>_before.png
    <step_id>_after.png
```

### 5.2 Hierarchy

```
Run (one per session)
  └── Span: session
        ├── Event: session_started
        ├── Event: profile_verified | profile_verification_failed
        ├── Span: observe_N
        │     ├── Event: capture_completed → Artifact: screenshot
        │     ├── Event: ocr_completed → Artifact: ocr_raw
        │     └── Artifact: observation_snapshot
        ├── Span: recognize_N
        │     └── Artifact: recognition_result
        ├── Span: promote_N
        │     └── Artifact: promotion_decision
        ├── Span: click_N
        │     ├── Event: safety_gate_passed
        │     ├── Event: action_executed
        │     ├── Artifact: before_screenshot
        │     └── Artifact: after_screenshot
        └── Event: session_ended
```

---

## 6. File Change List

### NEW Files

| File | Purpose |
|------|---------|
| `src/computer-use/macos-chrome-driver/surface-node.ts` | `normalizeToSurfaceNodes()` — raw OCR/DOM/AX → unified `SurfaceNode[]` |
| `src/computer-use/macos-chrome-driver/recognition.ts` | `recognizeFromCapture()` — OCR-first target matching, DOM/AX auxiliary |
| `src/computer-use/macos-chrome-driver/candidate-promotion.ts` | `promoteCandidate()` — typed refusal-first gate, pure function |
| `src/computer-use/macos-chrome-driver/safety-gate.ts` | `loadProfileConfig()`, `verifyChromeProfile()`, `checkSafetyGate()` |
| `src/computer-use/macos-chrome-driver/trace-store.ts` | `TraceStore` class — JSONL trace persistence (≡ AUV trace.rs) |

### MODIFIED Files

| File | Changes |
|------|---------|
| `types.ts` | Add all AUV-aligned types (§2). Delete `MacOSChromeCandidateRef`, `ChromeRecognizedItem`, `ChromeRecognitionEvidence`, `Bounds`. Rename all fields to snake_case. |
| `driver.ts` | `observe()` → `ObservationSnapshot` with `SurfaceNode[]`. `recognize(capture, target)` → decoupled from observe. New `promoteCandidate()`. `click()` only accepts `PromotedCandidate`. Safety gate before all actions. Profile verification at construction. Trace recording. |
| `capture.ts` | No structural changes (already has `ChromeCaptureContract`). |
| `ocr.ts` | No changes (already OCR-first with macOS Vision). |
| `index.ts` | Update exports. |
| `src/computer-use/index.ts` | Update re-exports. |

### DELETED

- `MacOSChromeCandidateRef` type
- `ChromeRecognizedItem` type
- `ChromeRecognitionEvidence` type
- `Bounds` type (replaced by `RecognitionBox`)
- Old `promoteChromeCandidate()` standalone function

---

## 7. Test Plan

### 7.1 New Unit Tests

**surface-node.test.ts:** OCR-only nodes, AX-only nodes, DOM-only nodes, merged, empty input, coordinate projection via contract

**recognition.test.ts:** OCR-first source, best item selection, filtered vs all, empty result, DOM confidence boost, AX kind update, min_confidence filter

**candidate-promotion.test.ts:** Happy path, all 11 refusal reasons individually, multiple reasons accumulated, no throw

**safety-gate.test.ts:** Profile match/mismatch, foreground check, signal detection, combined aggregation

**trace-store.test.ts:** Directory creation, run.json write, JSONL append, screenshot copy

### 7.2 Updated Existing Tests

**driver.test.ts:** observe() returns nodes (not raw blobs), recognize() takes capture+target, promoteCandidate() returns discriminated union, click() only accepts PromotedCandidate

### 7.3 Integration Test

Full flow: create driver → observe → capture → recognize → promote → click → verify trace files exist

---

## 8. Migration Plan

### What Breaks
1. `recognize(target)` → `recognize(capture, target)` — callers must capture first
2. `promoteChromeCandidate()` removed → use `driver.promoteCandidate()`
3. `MacOSChromeCandidateRef` removed → use `PromotedCandidate`
4. `ObservationSnapshot` shape changes — `nodes: SurfaceNode[]` replaces raw provider fields
5. `RecognitionResult` no longer embeds `observation`

### Migration Steps
1. Create new files (additive, no breakage)
2. Update types.ts (add new types, deprecate old)
3. Update driver.ts (add new methods, old ones as deprecated wrappers)
4. Update index.ts exports
5. Migrate internal callers
6. Remove deprecated types and methods
7. Update tests

---

## 9. Configuration

Profile config lives in `CareerDeepSeek-data/computer-use/profile.json`:
```json
{
  "profile_path": "Profile 4",
  "profile_name": "CareerDeepSeek",
  "verified_at": "2026-06-14T00:00:00Z"
}
```
Code in `CareerDeepSeek/` references data path via `COMPUTER_USE_SESSION_ROOT` env var.
Profile verification at session start: open `chrome://version` → OCR Profile Path → compare.
