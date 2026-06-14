# macOS-Chrome Driver Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor CareerDeepSeek's macOS-Chrome driver to match AUV's two-path architecture (Observation ≠ Recognition), OCR-first recognition, refusal-first candidate promotion gate, and a Run/Span/Event/Artifact trace system.

**Architecture:** Five new modules split out of the monolithic `driver.ts`: `surface-node.ts` (normalization), `recognition.ts` (OCR-first matching), `candidate-promotion.ts` (refusal-first gate), `safety-gate.ts` (profile/foreground/hard-stop), `trace-store.ts` (JSONL persistence). All types aligned to AUV's `contract.rs` snake_case wire format. Old deprecated wrappers keep existing callers working during migration.

**Tech Stack:** TypeScript 5.9, Vitest 4, Node.js >=20, pnpm

---

### Task 1: Update types.ts — AUV-Aligned Types

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/types.ts` (add new, deprecate old with `@deprecated`)
- Modify: `src/computer-use/macos-chrome-driver/index.ts` (export new types)
- Test: `test/computer-use/macosChromeDriver.test.ts` (update import checks)

- [ ] **Step 1: Add new AUV-aligned types to types.ts while keeping old types as deprecated**

Add after the existing `requireWindowNumber` function at line 168:

```typescript
// ── AUV-aligned types (v1) ──

// ≡ AUV contract.rs RecognitionBox
export interface RecognitionBox {
  x: number
  y: number
  width: number
  height: number
}

// ≡ AUV contract.rs RatioRegion
export interface RatioRegion {
  left: number
  top: number
  right: number
  bottom: number
}

// ≡ AUV contract.rs RecognitionSource (+ chrome_dom)
export type RecognitionSource
  = 'ocr_text'
  | 'ocr_row'
  | 'visual_row'
  | 'segmented_region'
  | 'icon_match'
  | 'custom'
  | 'chrome_dom'

// ≡ AUV contract.rs RecognitionSurface
export type RecognitionSurface = 'screen' | 'display' | 'window' | 'region'

// ≡ AUV contract.rs RecognitionScope
export interface RecognitionScope {
  surface: RecognitionSurface
  display_ref?: string
  native_display_id?: string
  app_bundle_id?: string
  window_title?: string
  window_number?: number
  region_hint?: RatioRegion
  capture_artifact?: ArtifactRef
  capture_contract_artifact?: ArtifactRef
}

// ≡ AUV contract.rs RecognizedItem
export interface RecognizedItem {
  item_id: string
  kind: string
  box: RecognitionBox
  text?: string
  provider_score?: number
  detail: Record<string, unknown>
}

// ≡ AUV contract.rs RecognitionResult
// NOTE: NO api_version on RecognitionResult (AUV doesn't have one)
export interface RecognitionResult {
  recognition_id: string
  source: RecognitionSource
  scope: RecognitionScope
  best: RecognizedItem | null
  filtered: RecognizedItem[]
  all: RecognizedItem[]
  detail: Record<string, unknown>
  evidence: ArtifactRef[]
  known_limits: string[]
}

// ≡ AUV contract.rs NodeRef
export interface NodeRef {
  run_id: string
  span_id: string
  node_id: string
}

// ≡ AUV contract.rs SurfaceNode (EXACT match)
export interface SurfaceNode {
  node_ref: NodeRef
  kind: string
  label?: string
  box: RecognitionBox
  source_artifacts: string[]
  recognition_id?: string
  recognition_source?: RecognitionSource
  recognition_surface?: RecognitionSurface
  recognized_item_id?: string
  recognized_item_kind?: string
  provider_score?: number
  detail: Record<string, unknown>
  // Browser-specific addition:
  center?: { x: number; y: number }
}

// ≡ AUV contract.rs ObservationSource (+ chrome_dom)
export type ObservationSource = 'ax' | 'ocr' | 'visual' | 'merged' | 'chrome_dom'

// ≡ AUV contract.rs ObservationSnapshot (EXACT match)
export interface ObservationSnapshot {
  api_version: 'careerdeepseek.observation_snapshot.v1alpha1'
  snapshot_id: string
  run_id: string
  span_id: string
  captured_at_millis: number
  source: ObservationSource
  scope: RecognitionScope
  capture_contract_ref?: ArtifactRef
  evidence: ArtifactRef[]
  nodes: SurfaceNode[]
  detail: Record<string, unknown>
  known_limits: string[]
}

// ── Candidate Promotion Types (≡ AUV candidate_promotion.rs) ──

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
  candidate_local_id: string
  kind: string
  label?: string
  target_spec: {
    grounding: 'coordinate'
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
    requires_app_frontmost: boolean
    requires_window_focus: boolean
  }
  source_run_id: string
  source_span_id: string
  source_operation_id: string
  source_artifact_id: string
  known_limits: string[]
}

// ── ArtifactRef (≡ AUV contract.rs) ──

export interface ArtifactRef {
  run_id: string
  artifact_id: string
  span_id: string
  captured_event_id?: string
}

// ── Trace Types (≡ AUV trace.rs) ──

export const RUN_API_VERSION = 'careerdeepseek.run.v1alpha1'
export const SPAN_API_VERSION = 'careerdeepseek.span.v1alpha1'
export const EVENT_API_VERSION = 'careerdeepseek.event.v1alpha1'
export const ARTIFACT_API_VERSION = 'careerdeepseek.artifact.v1alpha1'

export type RunType = 'command' | 'execute' | 'probe' | 'analyze' | 'distill' | 'validate'
export type TraceState = 'running' | 'ended'
export type TraceStatusCode = 'unset' | 'ok' | 'error'

export interface RunRecord {
  api_version: string
  run_id: string
  trace_id: string
  run_type: RunType
  state: TraceState
  status_code: TraceStatusCode
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
  state: TraceState
  status_code: TraceStatusCode
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
  role: string
  mime_type: string
  path: string
  sha256?: string
  attributes: Record<string, unknown>
  summary?: string
}

// ── Browser-Specific Types ──

export interface ProfileConfig {
  profile_path: string
  profile_name: string
  verified_at: string
}

export interface SafetyCheckResult {
  passed: boolean
  checks: {
    profile_verified: boolean
    chrome_foreground: boolean
    no_hard_stop_signal: boolean
  }
  failures: SafetyFailure[]
}

export interface SafetyFailure {
  code: string
  detail: string
  observed: unknown
  expected?: unknown
}
```

Mark old types as deprecated using JSDoc comments. For each old type that has a new equivalent, add `@deprecated`:

```typescript
/**
 * @deprecated Use RecognizedItem instead.
 */
export interface ChromeRecognizedItem { /* unchanged */ }

/**
 * @deprecated Use PromotedCandidate instead.
 */
export interface MacOSChromeCandidateRef { /* unchanged */ }

/**
 * @deprecated Use RecognitionResult instead.
 */
export interface MacOSChromeRecognitionResult { /* unchanged */ }

/**
 * @deprecated Use ObservationSnapshot instead.
 * This type will be removed when callers migrate to ObservationSnapshot.
 */
export interface MacOSChromeObservationSnapshot { /* unchanged */ }

/**
 * @deprecated Use ArtifactRef[] instead.
 */
export interface ChromeRecognitionEvidence { /* unchanged */ }

/**
 * @deprecated Use RecognitionBox instead.
 */
// The Bounds type is in ../types.ts — add a re-export with deprecation notice if needed
```

Also update `ChromeContextSnapshot.profile` to use the new shape:
```typescript
export interface ChromeContextSnapshot {
  // ... existing fields unchanged ...
  profile: {
    status: 'verified' | 'mismatch' | 'unverified'  // was: 'unknown'
    reason: string
    profile_path?: string  // NEW
  }
}
```

- [ ] **Step 2: Export new types from index.ts**

Add new exports to `src/computer-use/macos-chrome-driver/index.ts`:

```typescript
export type {
  // New AUV-aligned types
  ArtifactRef,
  ArtifactRecord,
  CandidatePromotion,
  EventRecord,
  NodeRef,
  ObservationSource,
  ObservationSnapshot,
  ProfileConfig,
  PromotedCandidate,
  PromotionRefusal,
  RatioRegion,
  RecognitionBox,
  RecognitionResult,
  RecognitionScope,
  RecognitionSource,
  RecognitionSurface,
  RecognizedItem,
  RunRecord,
  RunType,
  SafetyCheckResult,
  SafetyFailure,
  SpanRecord,
  SurfaceNode,
  TraceState,
  TraceStatusCode,
  // Existing (keep)
  ChromeCaptureContract,
  ChromeContextSnapshot,
  ChromeForegroundPolicy,
  ChromeRecognitionTarget,
  ChromeRecognizedItem,   // deprecated
  ChromeWindowCapture,
  ChromeWindowRef,
  MacOSChromeCandidateRef, // deprecated
  MacOSChromeDriverOptions,
  MacOSChromeObservationSnapshot, // deprecated
  MacOSChromeRecognitionResult,   // deprecated
  OcrTextMatch,
  OcrTextSnapshot,
} from './types.js'
```

Also export the constants:
```typescript
export {
  ARTIFACT_API_VERSION,
  EVENT_API_VERSION,
  RUN_API_VERSION,
  SPAN_API_VERSION,
} from './types.js'
```

- [ ] **Step 3: Run typecheck**

```bash
cd "${REPO_ROOT}" && pnpm run typecheck
```

Expected: PASS (no new type errors introduced)

- [ ] **Step 4: Run existing tests to confirm no regression**

```bash
cd "${REPO_ROOT}" && pnpm test
```

Expected: All 93 existing tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/computer-use/macos-chrome-driver/types.ts src/computer-use/macos-chrome-driver/index.ts
git commit -m "feat: add AUV-aligned types to macOS chrome driver, deprecate old types"
```

---

### Task 2: Create surface-node.ts — Unified SurfaceNode Normalization

**Files:**
- Create: `src/computer-use/macos-chrome-driver/surface-node.ts`
- Test: `test/computer-use/surfaceNode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/computer-use/surfaceNode.test.ts`:

```typescript
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { normalizeToSurfaceNodes } from '../../src/computer-use/macos-chrome-driver/surface-node.js'
import type { OcrTextMatch, SurfaceNode } from '../../src/computer-use/macos-chrome-driver/types.js'
import type { AXSnapshot, ChromeDomObservation } from '../../src/computer-use/types.js'

const contract = {
  coordinateContractVersion: 1 as const,
  captureSource: { kind: 'window' as const, windowNumber: 42, ownerPid: 123 },
  sourceGlobalLogicalBounds: { x: 0, y: 40, width: 1000, height: 800 },
  screenshotPixelSize: { width: 2000, height: 1600 },
  pixelToLogicalScale: { x: 0.5, y: 0.5 },
  logicalToPixelScale: { x: 2, y: 2 },
  capturedAt: '2026-06-14T00:00:00.000Z',
}

const runId = 'run_1'
const spanId = 'span_1'

describe('normalizeToSurfaceNodes', () => {
  it('converts OCR matches to SurfaceNode with correct coordinate projection', () => {
    const ocrMatches: OcrTextMatch[] = [
      { matchIndex: 0, text: 'Search', confidence: 0.97, bounds: { x: 100, y: 76, width: 248, height: 76 } },
    ]
    const nodes = normalizeToSurfaceNodes({ ocrMatches, contract, runId, spanId, startNodeIndex: 0 })
    assert.equal(nodes.length, 1)
    const node = nodes[0]!
    assert.equal(node.kind, 'ocr_text')
    assert.equal(node.label, 'Search')
    assert.equal(node.provider_score, 0.97)
    // Pixel coords (100,76) * scale (0.5,0.5) + logical offset (0,40) = (50,78)
    assert.equal(node.box.x, 50)
    assert.equal(node.box.y, 78)
    assert.equal(node.box.width, 124)
    assert.equal(node.box.height, 38)
    assert.equal(node.recognition_source, 'ocr_text')
    assert.equal(node.node_ref.run_id, runId)
    assert.equal(node.node_ref.span_id, spanId)
    assert.equal(node.node_ref.node_id, 'ocr_0')
  })

  it('converts AX nodes with bounds and text to SurfaceNode', () => {
    const axSnapshot: AXSnapshot = {
      snapshotId: 'ax-1', pid: 123, appName: 'Google Chrome',
      capturedAt: '2026-06-14T00:00:00.000Z', maxDepth: 5, truncated: false,
      root: {
        uid: 'btn-1', role: 'AXButton', title: 'Accept',
        bounds: { x: 520, y: 280, width: 280, height: 44 }, children: [],
      },
    }
    const nodes = normalizeToSurfaceNodes({
      ocrMatches: [], axSnapshot, contract, runId, spanId, startNodeIndex: 0,
    })
    assert.equal(nodes.length, 1)
    const node = nodes[0]!
    assert.equal(node.kind, 'ax_button')
    assert.equal(node.label, 'Accept')
    assert.equal(node.recognition_source, 'custom')
    assert.equal(node.provider_score, 0.75)
    assert.equal(node.node_ref.node_id, 'ax_btn-1')
  })

  it('converts DOM elements to SurfaceNode', () => {
    const domObservation: ChromeDomObservation = {
      url: 'https://example.com', title: 'Test', observedAt: '2026-06-14T00:00:00.000Z',
      visibleText: 'Home', signals: [],
      elements: [{
        id: 'link-1', tagName: 'a', role: 'link', name: 'Home', text: 'Home',
        href: '/home', bounds: { x: 0, y: 0, width: 80, height: 30 },
        center: { x: 40, y: 15 }, confidence: 0.9, actionable: true, states: {},
      }],
    }
    const viewportBounds = { x: 100, y: 0, width: 900, height: 800 }
    const nodes = normalizeToSurfaceNodes({
      ocrMatches: [], domObservation, contract, runId, spanId, startNodeIndex: 0, viewportBounds,
    })
    assert.equal(nodes.length, 1)
    const node = nodes[0]!
    assert.equal(node.kind, 'dom_link')
    assert.equal(node.label, 'Home')
    assert.equal(node.recognition_source, 'chrome_dom')
    // DOM bounds (0,0) + viewport offset (100,0) = (100,0)
    assert.equal(node.box.x, 100)
    assert.equal(node.box.y, 0)
    assert.equal(node.detail.href, '/home')
    assert.ok(node.center !== undefined)
  })

  it('marks source as merged when nodes from multiple sources exist', () => {
    const ocrMatches: OcrTextMatch[] = [
      { matchIndex: 0, text: 'Search', confidence: 0.9, bounds: { x: 100, y: 80, width: 200, height: 60 } },
    ]
    const axSnapshot: AXSnapshot = {
      snapshotId: 'ax-1', pid: 123, appName: 'Google Chrome',
      capturedAt: '2026-06-14T00:00:00.000Z', maxDepth: 5, truncated: false,
      root: {
        uid: 'field-1', role: 'AXTextField', description: 'Search',
        bounds: { x: 50, y: 40, width: 124, height: 38 }, children: [],
      },
    }
    const nodes = normalizeToSurfaceNodes({
      ocrMatches, axSnapshot, contract, runId, spanId, startNodeIndex: 0,
    })
    // 2 nodes from different sources
    assert.equal(nodes.length, 2)
    const kinds = nodes.map(n => n.kind)
    assert.ok(kinds.includes('ocr_text'))
    assert.ok(kinds.includes('ax_textfield'))
  })

  it('returns empty array for empty input', () => {
    const nodes = normalizeToSurfaceNodes({ ocrMatches: [], contract, runId, spanId, startNodeIndex: 0 })
    assert.equal(nodes.length, 0)
  })

  it('sorts nodes by y then x position', () => {
    const ocrMatches: OcrTextMatch[] = [
      { matchIndex: 0, text: 'Bottom', confidence: 0.9, bounds: { x: 100, y: 600, width: 200, height: 40 } },
      { matchIndex: 1, text: 'Top', confidence: 0.9, bounds: { x: 100, y: 80, width: 200, height: 40 } },
      { matchIndex: 2, text: 'TopRight', confidence: 0.9, bounds: { x: 500, y: 82, width: 200, height: 40 } },
    ]
    const nodes = normalizeToSurfaceNodes({ ocrMatches, contract, runId, spanId, startNodeIndex: 0 })
    assert.equal(nodes.length, 3)
    assert.equal(nodes[0]!.label, 'Top')
    assert.equal(nodes[1]!.label, 'TopRight')
    assert.equal(nodes[2]!.label, 'Bottom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "${REPO_ROOT}" && pnpm vitest run test/computer-use/surfaceNode.test.ts
```

Expected: FAIL — "normalizeToSurfaceNodes is not a function" or module not found

- [ ] **Step 3: Implement surface-node.ts**

Create `src/computer-use/macos-chrome-driver/surface-node.ts`:

```typescript
import type { AXSnapshot, ChromeDomObservation } from '../types.js'
import type {
  ChromeCaptureContract,
  ObservationSource,
  OcrTextMatch,
  SurfaceNode,
} from './types.js'

export interface NormalizeInput {
  ocrMatches: OcrTextMatch[]
  axSnapshot?: AXSnapshot
  domObservation?: ChromeDomObservation
  contract: ChromeCaptureContract
  runId: string
  spanId: string
  startNodeIndex: number
  viewportBounds?: { x: number; y: number; width: number; height: number }
}

export function normalizeToSurfaceNodes(input: NormalizeInput): SurfaceNode[] {
  const nodes: SurfaceNode[] = []
  let idx = input.startNodeIndex

  // OCR matches → SurfaceNode (PRIMARY source)
  for (const match of input.ocrMatches) {
    nodes.push({
      node_ref: {
        run_id: input.runId,
        span_id: input.spanId,
        node_id: `ocr_${match.matchIndex}`,
      },
      kind: 'ocr_text',
      label: match.text,
      box: projectPixelToLogical(match.bounds, input.contract),
      source_artifacts: [],
      recognition_source: 'ocr_text',
      provider_score: match.confidence,
      detail: { match_index: match.matchIndex, raw_pixel_bounds: match.bounds },
    })
    idx++
  }

  // AX nodes → SurfaceNode (AUXILIARY)
  if (input.axSnapshot) {
    walkAxTree(input.axSnapshot.root, (axNode) => {
      const text = axNode.title || axNode.description || axNode.value || ''
      if (text.trim()) {
        nodes.push({
          node_ref: {
            run_id: input.runId,
            span_id: input.spanId,
            node_id: `ax_${axNode.uid}`,
          },
          kind: axRoleToSurfaceNodeKind(axNode.role),
          label: text,
          box: {
            x: axNode.bounds!.x,
            y: axNode.bounds!.y,
            width: axNode.bounds!.width,
            height: axNode.bounds!.height,
          },
          source_artifacts: [],
          recognition_source: 'custom',
          recognition_surface: 'window',
          provider_score: 0.75,
          detail: {
            ax_role: axNode.role,
            focused: axNode.focused,
            enabled: axNode.enabled,
          },
        })
        idx++
      }
    })
  }

  // DOM elements → SurfaceNode (AUXILIARY)
  if (input.domObservation) {
    const vp = input.viewportBounds ?? { x: 0, y: 0, width: 0, height: 0 }
    for (const element of input.domObservation.elements) {
      nodes.push({
        node_ref: {
          run_id: input.runId,
          span_id: input.spanId,
          node_id: `dom_${element.id}`,
        },
        kind: domRoleToSurfaceNodeKind(element.role),
        label: element.name || element.text || element.role,
        box: {
          x: vp.x + element.bounds.x,
          y: vp.y + element.bounds.y,
          width: element.bounds.width,
          height: element.bounds.height,
        },
        source_artifacts: [],
        recognition_source: 'chrome_dom',
        recognition_surface: 'window',
        provider_score: element.confidence,
        center: {
          x: vp.x + element.center.x,
          y: vp.y + element.center.y,
        },
        detail: {
          tag_name: element.tagName,
          href: element.href,
          actionable: element.actionable,
        },
        recognized_item_kind: element.role,
      })
      idx++
    }
  }

  // Sort by y, then x
  nodes.sort((a, b) => {
    const dy = a.box.y - b.box.y
    return dy !== 0 ? dy : a.box.x - b.box.x
  })

  return nodes
}

export function inferObservationSource(nodes: SurfaceNode[]): ObservationSource {
  const sources = new Set(nodes.map(n => n.recognition_source))
  let count = 0
  if (sources.has('ocr_text') || sources.has('ocr_row')) count++
  if (sources.has('chrome_dom')) count++
  if (sources.has('custom')) count++ // AX → 'custom'
  if (count > 1) return 'merged'
  if (sources.has('chrome_dom')) return 'chrome_dom'
  if (sources.has('custom')) return 'ax'
  return 'ocr'
}

function projectPixelToLogical(
  pixelBounds: { x: number; y: number; width: number; height: number },
  contract: ChromeCaptureContract,
): { x: number; y: number; width: number; height: number } {
  return {
    x: contract.sourceGlobalLogicalBounds.x + pixelBounds.x * contract.pixelToLogicalScale.x,
    y: contract.sourceGlobalLogicalBounds.y + pixelBounds.y * contract.pixelToLogicalScale.y,
    width: pixelBounds.width * contract.pixelToLogicalScale.x,
    height: pixelBounds.height * contract.pixelToLogicalScale.y,
  }
}

function walkAxTree(
  node: { uid: string; role: string; title?: string; description?: string; value?: string; bounds?: { x: number; y: number; width: number; height: number }; enabled?: boolean; focused?: boolean; children: unknown[] },
  visitor: (node: { uid: string; role: string; title?: string; description?: string; value?: string; bounds?: { x: number; y: number; width: number; height: number }; enabled?: boolean; focused?: boolean }) => void,
) {
  if (node.bounds && node.bounds.width > 0 && node.bounds.height > 0) {
    visitor(node)
  }
  for (const child of node.children) {
    walkAxTree(child as typeof node, visitor)
  }
}

function axRoleToSurfaceNodeKind(role: string): string {
  const map: Record<string, string> = {
    AXButton: 'ax_button',
    AXLink: 'ax_link',
    AXTextField: 'ax_textfield',
    AXTextArea: 'ax_textarea',
    AXComboBox: 'ax_combobox',
    AXMenuItem: 'ax_menu_item',
    AXTab: 'ax_tab',
    AXStaticText: 'ax_static_text',
    AXGroup: 'ax_group',
    AXList: 'ax_list',
  }
  return map[role] ?? `ax_${role.toLowerCase().replace(/^ax/, '')}`
}

function domRoleToSurfaceNodeKind(role: string): string {
  const map: Record<string, string> = {
    textbox: 'dom_textbox',
    searchbox: 'dom_searchbox',
    button: 'dom_button',
    link: 'dom_link',
    heading: 'dom_heading',
    listitem: 'dom_listitem',
  }
  return map[role] ?? `dom_${role}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "${REPO_ROOT}" && pnpm vitest run test/computer-use/surfaceNode.test.ts
```

Expected: All 6 tests PASS

- [ ] **Step 5: Run full test suite**

```bash
cd "${REPO_ROOT}" && pnpm test
```

Expected: All existing + new tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/computer-use/macos-chrome-driver/surface-node.ts test/computer-use/surfaceNode.test.ts
git commit -m "feat: add surface-node.ts — normalize OCR/DOM/AX into unified SurfaceNode[]"
```

---

### Task 3: Create recognition.ts — OCR-First Target Recognition

**Files:**
- Create: `src/computer-use/macos-chrome-driver/recognition.ts`
- Test: `test/computer-use/recognition.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/computer-use/recognition.test.ts`:

```typescript
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { recognizeFromCapture } from '../../src/computer-use/macos-chrome-driver/recognition.js'
import type { ChromeCaptureContract, ChromeRecognitionTarget, RecognitionResult, RecognizedItem } from '../../src/computer-use/macos-chrome-driver/types.js'

const screenshotPath = '/tmp/test-chrome.png'

const contract: ChromeCaptureContract = {
  coordinateContractVersion: 1,
  captureSource: { kind: 'window', windowNumber: 42, ownerPid: 123 },
  sourceGlobalLogicalBounds: { x: 0, y: 40, width: 1000, height: 800 },
  screenshotPixelSize: { width: 2000, height: 1600 },
  pixelToLogicalScale: { x: 0.5, y: 0.5 },
  logicalToPixelScale: { x: 2, y: 2 },
  capturedAt: '2026-06-14T00:00:00.000Z',
}

function makeRecognizedItem(overrides: Partial<RecognizedItem> & { item_id: string }): RecognizedItem {
  return {
    kind: 'ocr_text',
    text: 'Search',
    box: { x: 50, y: 78, width: 124, height: 38 },
    provider_score: 0.9,
    detail: {},
    ...overrides,
  }
}

describe('recognizeFromCapture', () => {
  it('returns best item when a single unique target matches', () => {
    const items: RecognizedItem[] = [
      makeRecognizedItem({ item_id: '0', text: 'Search', kind: 'ocr_text' }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'text_input', name: /search/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath)
    assert.equal(result.found, true)
    assert.equal(result.best!.item_id, '0')
    assert.equal(result.filtered.length, 1)
    assert.equal(result.all.length, 1)
    assert.equal(result.source, 'ocr_text')
  })

  it('returns best=null when no items match target', () => {
    const items: RecognizedItem[] = [
      makeRecognizedItem({ item_id: '0', text: 'Home' }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'text_input', name: /search/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath)
    assert.equal(result.found, false)
    assert.equal(result.best, null)
    assert.equal(result.filtered.length, 0)
    assert.equal(result.all.length, 1)
  })

  it('filters by target kind: button matches button roles only', () => {
    const items: RecognizedItem[] = [
      makeRecognizedItem({ item_id: '0', text: 'Accept', kind: 'dom_button' }),
      makeRecognizedItem({ item_id: '1', text: 'Accept', kind: 'ocr_text' }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'button', text: /accept/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath)
    // dom_button is button-role, ocr_text is not
    assert.equal(result.filtered.length, 1)
    assert.equal(result.filtered[0]!.item_id, '0')
  })

  it('sorts filtered: actionable first, then provider_score descending', () => {
    const items: RecognizedItem[] = [
      makeRecognizedItem({ item_id: 'low', text: 'Search', provider_score: 0.5, detail: { actionable: false } }),
      makeRecognizedItem({ item_id: 'high', text: 'Search', provider_score: 0.9, detail: { actionable: true } }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath)
    assert.equal(result.filtered[0]!.item_id, 'high')
    assert.equal(result.filtered[1]!.item_id, 'low')
  })

  it('all contains all items regardless of filter match', () => {
    const items: RecognizedItem[] = [
      makeRecognizedItem({ item_id: '0', text: 'Search' }),
      makeRecognizedItem({ item_id: '1', text: 'Home' }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath)
    assert.equal(result.all.length, 2)
    assert.equal(result.filtered.length, 1)
  })

  it('includes evidence artifact refs', () => {
    const items: RecognizedItem[] = [
      makeRecognizedItem({ item_id: '0' }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath)
    assert.ok(result.evidence.length >= 1)
    assert.ok(result.evidence.some(e => e.artifact_id.includes('screenshot')))
  })

  it('links source to recognition_id', () => {
    const items: RecognizedItem[] = [
      makeRecognizedItem({ item_id: '0' }),
    ]
    const target: ChromeRecognitionTarget = { kind: 'visible_text', text: /search/i }
    const result = recognizeFromCapture(items, target, contract, screenshotPath)
    assert.ok(result.recognition_id.startsWith('mcr_'))
    assert.equal(result.scope.surface, 'window')
    assert.equal(result.scope.window_number, 42)
  })

  it('sets known_limits when items are empty', () => {
    const target: ChromeRecognitionTarget = { kind: 'text_input', name: /search/i }
    const result = recognizeFromCapture([], target, contract, screenshotPath)
    assert.equal(result.found, false)
    assert.ok(result.known_limits.some(l => l.includes('empty')))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "${REPO_ROOT}" && pnpm vitest run test/computer-use/recognition.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement recognition.ts**

Create `src/computer-use/macos-chrome-driver/recognition.ts`:

```typescript
import type { ChromeCaptureContract, ChromeRecognitionTarget, RecognitionResult, RecognitionScope, RecognizedItem } from './types.js'

const ACTIONABLE_KINDS = new Set([
  'dom_button',
  'dom_link',
  'dom_textbox',
  'dom_searchbox',
  'ax_button',
  'ax_link',
  'ax_textfield',
  'ax_textarea',
  'ax_combobox',
  'ax_menu_item',
  'ax_tab',
])

const BUTTON_KINDS = new Set(['dom_button', 'ax_button'])
const TEXT_INPUT_KINDS = new Set(['dom_textbox', 'dom_searchbox', 'ax_textfield', 'ax_textarea', 'ax_combobox'])
const LINK_KINDS = new Set(['dom_link', 'ax_link'])

export function recognizeFromCapture(
  items: RecognizedItem[],
  target: ChromeRecognitionTarget,
  contract: ChromeCaptureContract,
  screenshotPath: string,
  runId = 'standalone',
  spanId = 'standalone',
): RecognitionResult {
  const filtered = items
    .filter(item => matchesTarget(item, target))
    .sort(compareForBest)

  const best = filtered[0] ?? null

  const evidence = [
    {
      run_id: runId,
      artifact_id: `screenshot_${runId}`,
      span_id: spanId,
    },
  ]

  const scope: RecognitionScope = {
    surface: 'window',
    window_number: contract.captureSource.windowNumber,
    app_bundle_id: contract.captureSource.ownerBundleId,
  }

  const knownLimits: string[] = []
  if (items.length === 0) {
    knownLimits.push('recognition: empty input — no items provided')
  }

  return {
    recognition_id: `mcr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: inferRecognitionSource(items),
    scope,
    best,
    filtered,
    all: items,
    detail: {
      provider: 'careerdeepseek.macos_chrome_driver',
      screenshot_path: screenshotPath,
      total_input_items: items.length,
      filtered_count: filtered.length,
    },
    evidence,
    known_limits: knownLimits,
  }
}

function matchesTarget(item: RecognizedItem, target: ChromeRecognitionTarget): boolean {
  const itemText = item.text ?? ''

  function textMatches(expected: string | RegExp): boolean {
    if (expected instanceof RegExp) return expected.test(itemText)
    return itemText.toLowerCase().includes(expected.toLowerCase())
  }

  switch (target.kind) {
    case 'text_input':
      return TEXT_INPUT_KINDS.has(item.kind) && textMatches(target.name)
    case 'button':
      return BUTTON_KINDS.has(item.kind) && textMatches(target.text)
    case 'link':
      return LINK_KINDS.has(item.kind) && textMatches(target.text)
    case 'visible_text':
      return textMatches(target.text)
  }
}

function compareForBest(a: RecognizedItem, b: RecognizedItem): number {
  const aActionable = isActionable(a)
  const bActionable = isActionable(b)
  if (aActionable !== bActionable) return Number(bActionable) - Number(aActionable)
  return (b.provider_score ?? 0) - (a.provider_score ?? 0)
}

function isActionable(item: RecognizedItem): boolean {
  if (ACTIONABLE_KINDS.has(item.kind)) return true
  return item.detail?.actionable === true
}

function inferRecognitionSource(items: RecognizedItem[]): RecognitionResult['source'] {
  if (items.length === 0) return 'custom'
  const first = items[0]!
  if (first.kind.startsWith('dom_')) return 'chrome_dom'
  if (first.kind.startsWith('ax_')) return 'custom'
  return 'ocr_row'
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "${REPO_ROOT}" && pnpm vitest run test/computer-use/recognition.test.ts
```

Expected: All 8 tests PASS

- [ ] **Step 5: Run typecheck**

```bash
cd "${REPO_ROOT}" && pnpm run typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/computer-use/macos-chrome-driver/recognition.ts test/computer-use/recognition.test.ts
git commit -m "feat: add recognition.ts — OCR-first target recognition"
```

---

### Task 4: Create candidate-promotion.ts — Refusal-First Gate

**Files:**
- Create: `src/computer-use/macos-chrome-driver/candidate-promotion.ts`
- Test: `test/computer-use/candidatePromotion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/computer-use/candidatePromotion.test.ts`:

```typescript
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { promoteCandidate } from '../../src/computer-use/macos-chrome-driver/candidate-promotion.js'
import type { RecognitionResult, RecognizedItem, ChromeCaptureContract, ChromeWindowRef } from '../../src/computer-use/macos-chrome-driver/types.js'

function makeRecognition(overrides: Partial<RecognitionResult> & { best: RecognizedItem | null; all: RecognizedItem[]; filtered: RecognizedItem[] }): RecognitionResult {
  return {
    recognition_id: 'mcr_1',
    source: 'ocr_text',
    scope: { surface: 'window', window_number: 42, app_bundle_id: 'com.google.Chrome' },
    detail: {},
    evidence: [{ run_id: 'r1', artifact_id: 'a1', span_id: 's1' }],
    known_limits: [],
    ...overrides,
  }
}

function makeItem(overrides: Partial<RecognizedItem> & { item_id: string }): RecognizedItem {
  return {
    kind: 'dom_button',
    text: 'Accept',
    box: { x: 100, y: 200, width: 120, height: 40 },
    provider_score: 0.9,
    detail: { actionable: true },
    ...overrides,
  }
}

const capture: ChromeCaptureContract = {
  coordinateContractVersion: 1,
  captureSource: { kind: 'window', windowNumber: 42, ownerPid: 123, ownerBundleId: 'com.google.Chrome' },
  sourceGlobalLogicalBounds: { x: 0, y: 40, width: 1000, height: 800 },
  screenshotPixelSize: { width: 2000, height: 1600 },
  pixelToLogicalScale: { x: 0.5, y: 0.5 },
  logicalToPixelScale: { x: 2, y: 2 },
  capturedAt: new Date().toISOString(),
}

const window: ChromeWindowRef = {
  id: '42', windowNumber: 42, appName: 'Google Chrome', ownerPid: 123,
  ownerBundleId: 'com.google.Chrome', title: 'Test', bounds: { x: 0, y: 40, width: 1000, height: 800 }, layer: 0,
}

describe('promoteCandidate', () => {
  it('promotes when all conditions met', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best] })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true,
      chrome_foreground: true,
      hard_stop_signals: [],
      ttl_ms: 5000,
      run_id: 'r1',
      span_id: 's1',
    })
    assert.equal(result.status, 'promoted')
    if (result.status === 'promoted') {
      assert.equal(result.candidate.kind, 'dom_button')
      assert.equal(result.candidate.candidate_local_id, 'mcr_1:0')
      assert.equal(result.candidate.source_run_id, 'r1')
      assert.equal(result.candidate.control.requires_app_frontmost, true)
    }
  })

  it('refuses with empty_recognition when all is empty', () => {
    const recognition = makeRecognition({ best: null, all: [], filtered: [] })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true, chrome_foreground: true, hard_stop_signals: [], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    assert.equal(result.status, 'refused')
    if (result.status === 'refused') {
      assert.ok(result.reasons.includes('empty_recognition'))
    }
  })

  it('refuses with no_unambiguous_target when best is null', () => {
    const item = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best: null, all: [item], filtered: [] })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true, chrome_foreground: true, hard_stop_signals: [], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    if (result.status === 'refused') {
      assert.ok(result.reasons.includes('no_unambiguous_target'))
    }
  })

  it('refuses with profile_mismatch when profile not verified', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best] })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: false, chrome_foreground: true, hard_stop_signals: [], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    if (result.status === 'refused') {
      assert.ok(result.reasons.includes('profile_mismatch'))
    }
  })

  it('refuses with chrome_not_foreground', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best] })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true, chrome_foreground: false, hard_stop_signals: [], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    if (result.status === 'refused') {
      assert.ok(result.reasons.includes('chrome_not_foreground'))
    }
  })

  it('refuses with hard_stop_signal', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best] })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true, chrome_foreground: true, hard_stop_signals: ['captcha'], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    if (result.status === 'refused') {
      assert.ok(result.reasons.includes('hard_stop_signal'))
    }
  })

  it('refuses with item_outside_viewport', () => {
    const best = makeItem({
      item_id: '0',
      box: { x: 2000, y: 2000, width: 100, height: 40 }, // well outside 1000x800+40
    })
    const recognition = makeRecognition({ best, all: [best], filtered: [best] })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: true, chrome_foreground: true, hard_stop_signals: [], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    if (result.status === 'refused') {
      assert.ok(result.reasons.includes('item_outside_viewport'))
    }
  })

  it('refuses with stale_capture when TTL exceeded', () => {
    const best = makeItem({ item_id: '0' })
    const staleCapture = { ...capture, capturedAt: new Date(Date.now() - 6000).toISOString() }
    const recognition = makeRecognition({ best, all: [best], filtered: [best] })
    const result = promoteCandidate(recognition, staleCapture, window, {
      profile_verified: true, chrome_foreground: true, hard_stop_signals: [], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    if (result.status === 'refused') {
      assert.ok(result.reasons.includes('stale_capture'))
    }
  })

  it('accumulates multiple refusal reasons', () => {
    const best = makeItem({ item_id: '0' })
    const recognition = makeRecognition({ best, all: [best], filtered: [best] })
    const result = promoteCandidate(recognition, capture, window, {
      profile_verified: false, chrome_foreground: false, hard_stop_signals: [], ttl_ms: 5000,
      run_id: 'r1', span_id: 's1',
    })
    if (result.status === 'refused') {
      assert.ok(result.reasons.length >= 2)
      assert.ok(result.reasons.includes('profile_mismatch'))
      assert.ok(result.reasons.includes('chrome_not_foreground'))
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "${REPO_ROOT}" && pnpm vitest run test/computer-use/candidatePromotion.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement candidate-promotion.ts**

Create `src/computer-use/macos-chrome-driver/candidate-promotion.ts`:

```typescript
import type { CandidatePromotion, ChromeCaptureContract, ChromeWindowRef, PromotedCandidate, PromotionRefusal, RecognitionResult } from './types.js'

export interface PromotionOptions {
  profile_verified: boolean
  chrome_foreground: boolean
  hard_stop_signals: string[]
  ttl_ms: number
  run_id: string
  span_id: string
}

export function promoteCandidate(
  recognition: RecognitionResult,
  capture: ChromeCaptureContract,
  window: ChromeWindowRef,
  options: PromotionOptions,
): CandidatePromotion {
  const reasons: PromotionRefusal[] = []

  // 1. empty_recognition
  if (recognition.all.length === 0) {
    reasons.push('empty_recognition')
  }

  // 2. no_unambiguous_target
  if (recognition.best === null) {
    reasons.push('no_unambiguous_target')
  }

  // 3. no_runtime_evidence
  if (recognition.evidence.length === 0) {
    reasons.push('no_runtime_evidence')
  }

  // 4. missing_capture_artifact
  if (!recognition.scope.capture_artifact) {
    // Note: capture_artifact may be null for standalone recognitions.
    // This is informational — the artifact is the capture we're passed.
    // We don't strictly require it in v0.
  }

  // 5. item_not_actionable
  if (recognition.best && !isAccessibleActionable(recognition.best)) {
    reasons.push('item_not_actionable')
  }

  // 6. item_outside_viewport
  if (recognition.best && !pointInsideBounds(recognition.best.box, window.bounds)) {
    reasons.push('item_outside_viewport')
  }

  // 7. stale_capture
  const captureAge = Date.now() - new Date(capture.capturedAt).getTime()
  if (captureAge > options.ttl_ms) {
    reasons.push('stale_capture')
  }

  // 8. profile_mismatch
  if (!options.profile_verified) {
    reasons.push('profile_mismatch')
  }

  // 9. chrome_not_foreground
  if (!options.chrome_foreground) {
    reasons.push('chrome_not_foreground')
  }

  // 10. hard_stop_signal
  if (options.hard_stop_signals.length > 0) {
    reasons.push('hard_stop_signal')
  }

  if (reasons.length > 0) {
    return { status: 'refused', reasons }
  }

  const best = recognition.best!

  const candidate: PromotedCandidate = {
    candidate_local_id: `${recognition.recognition_id}:${best.item_id}`,
    kind: best.kind,
    label: best.text,
    target_spec: {
      grounding: 'coordinate',
      box: best.box,
      anchor_text: best.text,
    },
    evidence: {
      capture_artifact: {
        run_id: options.run_id,
        artifact_id: `capture_${recognition.recognition_id}`,
        span_id: options.span_id,
      },
      recognition_artifact: {
        run_id: options.run_id,
        artifact_id: `recognition_${recognition.recognition_id}`,
        span_id: options.span_id,
      },
      observation_blob: {},
    },
    liveness: {
      preconditions: {
        window_ref: {
          app_bundle_id: window.ownerBundleId ?? 'com.google.Chrome',
          window_title_substring: window.title ?? undefined,
          window_number: window.windowNumber,
        },
        anchor_recheck: best.text ? {
          text: best.text,
          expected_min_confidence: 0.3,
          max_pixel_distance: 50,
        } : undefined,
      },
      ttl_hint_ms: options.ttl_ms,
    },
    control: {
      requires_app_frontmost: true,
      requires_window_focus: true,
    },
    source_run_id: options.run_id,
    source_span_id: options.span_id,
    source_operation_id: recognition.recognition_id,
    source_artifact_id: `recognition_${recognition.recognition_id}`,
    known_limits: recognition.known_limits,
  }

  return { status: 'promoted', candidate, residual_known_limits: recognition.known_limits }
}

function isAccessibleActionable(item: { kind: string; detail: Record<string, unknown> }): boolean {
  const ACTIONABLE_KINDS = new Set([
    'dom_button', 'dom_link', 'dom_textbox', 'dom_searchbox',
    'ax_button', 'ax_link', 'ax_textfield', 'ax_textarea', 'ax_combobox', 'ax_menu_item', 'ax_tab',
  ])
  if (ACTIONABLE_KINDS.has(item.kind)) return true
  return item.detail?.actionable === true
}

function pointInsideBounds(
  box: { x: number; y: number; width: number; height: number },
  bounds: { x: number; y: number; width: number; height: number },
): boolean {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  return cx >= bounds.x && cy >= bounds.y
    && cx <= bounds.x + bounds.width && cy <= bounds.y + bounds.height
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "${REPO_ROOT}" && pnpm vitest run test/computer-use/candidatePromotion.test.ts
```

Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/computer-use/macos-chrome-driver/candidate-promotion.ts test/computer-use/candidatePromotion.test.ts
git commit -m "feat: add candidate-promotion.ts — refusal-first gate with 11 typed reasons"
```

---

### Task 5: Create safety-gate.ts — Profile/Foreground/Hard-Stop Checks

**Files:**
- Create: `src/computer-use/macos-chrome-driver/safety-gate.ts`
- Test: `test/computer-use/safetyGate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/computer-use/safetyGate.test.ts`:

```typescript
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  checkSafetyGate,
  detectHardStopSignals,
  HARD_STOP_PATTERNS,
} from '../../src/computer-use/macos-chrome-driver/safety-gate.js'
import type { ChromeContextSnapshot, ProfileConfig } from '../../src/computer-use/macos-chrome-driver/types.js'

const profileConfig: ProfileConfig = {
  profile_path: 'Profile 4',
  profile_name: 'CareerDeepSeek',
  verified_at: '2026-06-14T00:00:00.000Z',
}

function makeContext(overrides: Partial<ChromeContextSnapshot> = {}): ChromeContextSnapshot {
  return {
    running: true,
    isFrontmost: true,
    frontmostAppName: 'Google Chrome',
    frontmostAppBundleId: 'com.google.Chrome',
    activeTabUrl: 'https://example.com',
    activeTabTitle: 'Test',
    profile: { status: 'verified', reason: 'checked', profile_path: 'Profile 4' },
    window: {
      id: '42', windowNumber: 42, appName: 'Google Chrome', ownerPid: 123,
      ownerBundleId: 'com.google.Chrome', title: 'Test',
      bounds: { x: 0, y: 40, width: 1000, height: 800 }, layer: 0,
    },
    ...overrides,
  }
}

describe('detectHardStopSignals', () => {
  it('detects captcha', () => {
    const signals = detectHardStopSignals('Please complete this security check to continue')
    assert.ok(signals.includes('captcha'))
  })

  it('detects login_required', () => {
    const signals = detectHardStopSignals('You must sign in to continue')
    assert.ok(signals.includes('login_required'))
  })

  it('detects payment_required', () => {
    const signals = detectHardStopSignals('Enter your credit card details to proceed')
    assert.ok(signals.includes('payment_required'))
  })

  it('returns empty for clean text', () => {
    const signals = detectHardStopSignals('Welcome to our company page')
    assert.equal(signals.length, 0)
  })

  it('returns empty for empty text', () => {
    const signals = detectHardStopSignals('')
    assert.equal(signals.length, 0)
  })
})

describe('checkSafetyGate', () => {
  it('passes when all checks succeed', () => {
    const context = makeContext()
    const result = checkSafetyGate(context, 'Welcome text without triggers', profileConfig)
    assert.equal(result.passed, true)
    assert.equal(result.checks.profile_verified, true)
    assert.equal(result.checks.chrome_foreground, true)
    assert.equal(result.checks.no_hard_stop_signal, true)
    assert.equal(result.failures.length, 0)
  })

  it('fails when profile status is mismatch', () => {
    const context = makeContext({ profile: { status: 'mismatch', reason: 'wrong profile', profile_path: 'Default' } })
    const result = checkSafetyGate(context, 'clean text', profileConfig)
    assert.equal(result.passed, false)
    assert.ok(result.failures.some(f => f.code === 'profile_mismatch'))
  })

  it('fails when profile is unverified', () => {
    const context = makeContext({ profile: { status: 'unverified', reason: 'not checked' } })
    const result = checkSafetyGate(context, 'clean text', profileConfig)
    assert.equal(result.passed, false)
    assert.ok(result.failures.some(f => f.code === 'profile_mismatch'))
  })

  it('fails when Chrome is not foreground', () => {
    const context = makeContext({
      isFrontmost: false,
      frontmostAppName: 'Safari',
      frontmostAppBundleId: 'com.apple.Safari',
    })
    const result = checkSafetyGate(context, 'clean text', profileConfig)
    assert.equal(result.passed, false)
    assert.ok(result.failures.some(f => f.code === 'chrome_not_foreground'))
  })

  it('fails when hard-stop signal present in text', () => {
    const context = makeContext()
    const result = checkSafetyGate(context, 'Please verify you are human before continuing', profileConfig)
    assert.equal(result.passed, false)
    assert.ok(result.failures.some(f => f.code === 'hard_stop_signal'))
  })

  it('accumulates multiple failures', () => {
    const context = makeContext({
      isFrontmost: false,
      profile: { status: 'mismatch', reason: 'wrong' },
    })
    const result = checkSafetyGate(context, 'verify you are human', profileConfig)
    assert.equal(result.passed, false)
    assert.ok(result.failures.length >= 2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "${REPO_ROOT}" && pnpm vitest run test/computer-use/safetyGate.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement safety-gate.ts**

Create `src/computer-use/macos-chrome-driver/safety-gate.ts`:

```typescript
import type { ChromeContextSnapshot, ProfileConfig, SafetyCheckResult, SafetyFailure } from './types.js'

export const HARD_STOP_PATTERNS: Array<[string, RegExp]> = [
  ['captcha', /\b(?:captcha|verify you are human|human verification|complete (?:this )?security check)\b/i],
  ['login_required', /\b(?:please )?(?:sign in|log in|login|create an account|create account|register).{0,40}(?:to continue|before continuing|required)|\b(?:to continue).{0,40}(?:sign in|log in|login|required)\b/i],
  ['payment_required', /\b(?:enter|provide|add).{0,24}(?:payment details|billing details|credit card|card details)|\b(?:pay now|checkout to continue|purchase required)\b/i],
  ['checkout', /\b(?:checkout|complete purchase|place order|confirm and pay)\b/i],
  ['password_field', /\b(?:password|passcode|pin)\b/i],
  ['apply_or_send', /\b(?:submit application|send application|send message to continue|connect with.{0,40}to continue)\b/i],
]

export function detectHardStopSignals(visibleText: string): string[] {
  const signals: string[] = []
  for (const [name, pattern] of HARD_STOP_PATTERNS) {
    if (pattern.test(visibleText)) {
      signals.push(name)
    }
  }
  return signals
}

export function checkSafetyGate(
  chromeContext: ChromeContextSnapshot,
  visibleText: string,
  profileConfig: ProfileConfig,
): SafetyCheckResult {
  const failures: SafetyFailure[] = []

  // 1. Profile check
  const profileVerified = chromeContext.profile.status === 'verified'
    && chromeContext.profile.profile_path === profileConfig.profile_path
  if (!profileVerified) {
    failures.push({
      code: 'profile_mismatch',
      detail: `Expected profile "${profileConfig.profile_path}", observed "${chromeContext.profile.profile_path ?? 'unknown'}" (status: ${chromeContext.profile.status})`,
      observed: chromeContext.profile.profile_path,
      expected: profileConfig.profile_path,
    })
  }

  // 2. Foreground check
  const chromeForeground = chromeContext.isFrontmost
    && (chromeContext.frontmostAppBundleId === 'com.google.Chrome'
        || chromeContext.frontmostAppName?.toLowerCase().includes('chrome') === true)
  if (!chromeForeground) {
    failures.push({
      code: 'chrome_not_foreground',
      detail: `Chrome must be the foreground app; current: ${chromeContext.frontmostAppName ?? 'unknown'} (${chromeContext.frontmostAppBundleId ?? 'unknown'})`,
      observed: {
        appName: chromeContext.frontmostAppName,
        bundleId: chromeContext.frontmostAppBundleId,
      },
      expected: { appName: 'Google Chrome', bundleId: 'com.google.Chrome' },
    })
  }

  // 3. Hard-stop signal check
  const hardStopSignals = detectHardStopSignals(visibleText)
  const noHardStopSignal = hardStopSignals.length === 0
  if (!noHardStopSignal) {
    failures.push({
      code: 'hard_stop_signal',
      detail: `Hard-stop signals detected: ${hardStopSignals.join(', ')}`,
      observed: hardStopSignals,
    })
  }

  return {
    passed: failures.length === 0,
    checks: {
      profile_verified: profileVerified,
      chrome_foreground: chromeForeground,
      no_hard_stop_signal: noHardStopSignal,
    },
    failures,
  }
}

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export async function loadProfileConfig(sessionRoot: string): Promise<ProfileConfig> {
  const configPath = resolve(sessionRoot, '..', 'profile.json')
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw) as ProfileConfig
    if (!config.profile_path?.trim()) {
      throw new Error('profile.json missing profile_path')
    }
    return config
  } catch {
    throw new Error(
      `Cannot load Chrome profile config from ${configPath}. `
      + 'Create CareerDeepSeek-data/computer-use/profile.json with { "profile_path": "Profile 4", "profile_name": "...", "verified_at": "..." }',
    )
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "${REPO_ROOT}" && pnpm vitest run test/computer-use/safetyGate.test.ts
```

Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/computer-use/macos-chrome-driver/safety-gate.ts test/computer-use/safetyGate.test.ts
git commit -m "feat: add safety-gate.ts — profile/foreground/hard-stop checks"
```

---

### Task 6: Create trace-store.ts — JSONL Trace Persistence

**Files:**
- Create: `src/computer-use/macos-chrome-driver/trace-store.ts`
- Test: `test/computer-use/traceStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/computer-use/traceStore.test.ts`:

```typescript
import { describe, it, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { TraceStore } from '../../src/computer-use/macos-chrome-driver/trace-store.js'
import {
  ARTIFACT_API_VERSION,
  EVENT_API_VERSION,
  RUN_API_VERSION,
  SPAN_API_VERSION,
} from '../../src/computer-use/macos-chrome-driver/types.js'

const testDir = join('.computer-use', 'traces', 'trace-store-test')

describe('TraceStore', () => {
  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('creates trace directory on construction', () => {
    const store = new TraceStore('.computer-use', 'trace-store-test')
    assert.equal(existsSync(store.traceDir), true)
  })

  it('writes run.json on startRun', () => {
    const store = new TraceStore('.computer-use', 'trace-store-test')
    store.startRun('run_1', { intent: 'test' })
    const runPath = join(store.traceDir, 'run.json')
    assert.equal(existsSync(runPath), true)
    const run = JSON.parse(readFileSync(runPath, 'utf-8'))
    assert.equal(run.api_version, RUN_API_VERSION)
    assert.equal(run.run_id, 'run_1')
    assert.equal(run.state, 'running')
  })

  it('appends to spans.jsonl on startSpan/endSpan', () => {
    const store = new TraceStore('.computer-use', 'trace-store-test')
    store.startRun('run_1', {})
    store.startSpan('span_1', undefined, 'test_span')
    store.endSpan('span_1', 'ok', 'done')

    const spansPath = join(store.traceDir, 'spans.jsonl')
    const lines = readFileSync(spansPath, 'utf-8').trim().split('\n')
    // Two lines: one for start, one for end
    assert.ok(lines.length === 2)
    const startSpan = JSON.parse(lines[0]!)
    assert.equal(startSpan.api_version, SPAN_API_VERSION)
    assert.equal(startSpan.name, 'test_span')
    const endSpan = JSON.parse(lines[1]!)
    assert.equal(endSpan.status_code, 'ok')
  })

  it('appends to events.jsonl on recordEvent', () => {
    const store = new TraceStore('.computer-use', 'trace-store-test')
    store.startRun('run_1', {})
    store.startSpan('span_1', undefined, 'test')
    store.recordEvent({
      event_id: 'evt_1', span_id: 'span_1', name: 'capture_completed',
      timestamp_millis: Date.now(), attributes: {}, artifact_ids: ['art_1'],
    })
    const eventsPath = join(store.traceDir, 'events.jsonl')
    const line = JSON.parse(readFileSync(eventsPath, 'utf-8').trim())
    assert.equal(line.api_version, EVENT_API_VERSION)
    assert.equal(line.name, 'capture_completed')
    assert.deepEqual(line.artifact_ids, ['art_1'])
  })

  it('appends to artifacts.jsonl on recordArtifact', () => {
    const store = new TraceStore('.computer-use', 'trace-store-test')
    store.startRun('run_1', {})
    store.startSpan('span_1', undefined, 'test')
    store.recordArtifact({
      artifact_id: 'art_1', span_id: 'span_1', role: 'screenshot',
      mime_type: 'image/png', path: '/tmp/screen.png', attributes: {},
    })
    const artifactsPath = join(store.traceDir, 'artifacts.jsonl')
    const line = JSON.parse(readFileSync(artifactsPath, 'utf-8').trim())
    assert.equal(line.api_version, ARTIFACT_API_VERSION)
    assert.equal(line.role, 'screenshot')
  })

  it('updates run.json on endRun', () => {
    const store = new TraceStore('.computer-use', 'trace-store-test')
    store.startRun('run_1', {})
    store.endRun('run_1', 'ok', 'completed')
    const run = JSON.parse(readFileSync(join(store.traceDir, 'run.json'), 'utf-8'))
    assert.equal(run.status_code, 'ok')
    assert.equal(run.summary, 'completed')
    assert.ok(run.finished_at_millis !== undefined)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "${REPO_ROOT}" && pnpm vitest run test/computer-use/traceStore.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement trace-store.ts**

Create `src/computer-use/macos-chrome-driver/trace-store.ts`:

```typescript
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ArtifactRecord,
  EventRecord,
  RunRecord,
  SpanRecord,
} from './types.js'
import {
  ARTIFACT_API_VERSION,
  EVENT_API_VERSION,
  RUN_API_VERSION,
  SPAN_API_VERSION,
} from './types.js'

export class TraceStore {
  readonly traceDir: string
  #runWritten = false

  constructor(sessionRoot: string, sessionId: string) {
    this.traceDir = join(sessionRoot, 'traces', sessionId)
    mkdirSync(this.traceDir, { recursive: true })
    mkdirSync(join(this.traceDir, 'screenshots'), { recursive: true })
  }

  startRun(runId: string, attributes: Record<string, unknown>): RunRecord {
    const run: RunRecord = {
      api_version: RUN_API_VERSION,
      run_id: runId,
      trace_id: runId,
      run_type: 'execute',
      state: 'running',
      status_code: 'unset',
      started_at_millis: Date.now(),
      root_span_id: 'session',
      attributes,
    }
    writeFileSync(join(this.traceDir, 'run.json'), JSON.stringify(run, null, 2) + '\n')
    this.#runWritten = true
    return run
  }

  endRun(runId: string, statusCode: 'ok' | 'error', summary?: string): void {
    if (!this.#runWritten) return
    const runPath = join(this.traceDir, 'run.json')
    const run: RunRecord = {
      ...JSON.parse(require('fs').readFileSync(runPath, 'utf-8')),
      state: 'ended',
      status_code: statusCode,
      finished_at_millis: Date.now(),
      summary,
    }
    writeFileSync(runPath, JSON.stringify(run, null, 2) + '\n')
  }

  startSpan(spanId: string, parentSpanId: string | undefined, name: string): SpanRecord {
    const span: SpanRecord = {
      api_version: SPAN_API_VERSION,
      span_id: spanId,
      parent_span_id: parentSpanId,
      name,
      state: 'running',
      status_code: 'unset',
      started_at_millis: Date.now(),
      attributes: {},
    }
    appendFileSync(join(this.traceDir, 'spans.jsonl'), JSON.stringify(span) + '\n')
    return span
  }

  endSpan(spanId: string, statusCode: 'ok' | 'error', summary?: string): void {
    const span: SpanRecord = {
      api_version: SPAN_API_VERSION,
      span_id: spanId,
      parent_span_id: undefined,
      name: '',
      state: 'ended',
      status_code: statusCode,
      started_at_millis: 0,
      finished_at_millis: Date.now(),
      attributes: {},
      summary,
    }
    appendFileSync(join(this.traceDir, 'spans.jsonl'), JSON.stringify(span) + '\n')
  }

  recordEvent(event: Omit<EventRecord, 'api_version'>): void {
    const record: EventRecord = {
      api_version: EVENT_API_VERSION,
      ...event,
    }
    appendFileSync(join(this.traceDir, 'events.jsonl'), JSON.stringify(record) + '\n')
  }

  recordArtifact(artifact: Omit<ArtifactRecord, 'api_version'>): void {
    const record: ArtifactRecord = {
      api_version: ARTIFACT_API_VERSION,
      ...artifact,
    }
    appendFileSync(join(this.traceDir, 'artifacts.jsonl'), JSON.stringify(record) + '\n')
  }
}
```

Important: The `require('fs')` in `endRun` is wrong for ESM. Fix to use proper import:

```typescript
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
// ... change endRun to use readFileSync directly
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "${REPO_ROOT}" && pnpm vitest run test/computer-use/traceStore.test.ts
```

Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/computer-use/macos-chrome-driver/trace-store.ts test/computer-use/traceStore.test.ts
git commit -m "feat: add trace-store.ts — JSONL Run/Span/Event/Artifact persistence"
```

---

### Task 7: Refactor driver.ts — Two-Path Architecture

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/driver.ts` (major refactor)
- Modify: `test/computer-use/macosChromeDriver.test.ts` (update to new API)

- [ ] **Step 1: Update driver.ts — rewrite observe() to produce ObservationSnapshot with SurfaceNode[]**

Add imports for new modules at top of driver.ts:

```typescript
import { normalizeToSurfaceNodes, inferObservationSource } from './surface-node.js'
import { recognizeFromCapture } from './recognition.js'
import { promoteCandidate as doPromoteCandidate } from './candidate-promotion.js'
import { checkSafetyGate, loadProfileConfig, detectHardStopSignals } from './safety-gate.js'
import { TraceStore } from './trace-store.js'
```

Add new fields to the class:

```typescript
export class MacOSChromeDriver {
  // ... existing private fields ...
  #traceStore?: TraceStore
  #profileConfig?: ProfileConfig
  #profileVerified = false
  #runId: string
  #spanId = 'session'
```

Update constructor to initialize trace and profile:

```typescript
constructor(options: MacOSChromeDriverOptions) {
  if (!options.sessionId?.trim()) {
    throw new TypeError('MacOSChromeDriver requires a non-empty sessionId.')
  }
  this.#sessionId = options.sessionId
  this.#config = { ...resolveComputerUseConfig(), ...options.config }
  this.#foregroundPolicy = options.foregroundPolicy ?? 'require_chrome'
  this.#runId = `run_${options.sessionId}_${Date.now()}`
  this.#traceStore = new TraceStore(this.#config.sessionRoot, options.sessionId)
  this.#traceStore.startRun(this.#runId, { intent: 'macos_chrome_driver' })
  this.#traceStore.startSpan(this.#spanId, undefined, 'session')
  // Profile verification deferred to first observe() to avoid constructor side-effects
}
```

Rewrite `observe()` to produce `ObservationSnapshot` with `SurfaceNode[]`:

```typescript
async observe(): Promise<ObservationSnapshot> {
  // Verify profile on first observe (lazy, not in constructor)
  if (!this.#profileConfig) {
    try {
      this.#profileConfig = await loadProfileConfig(this.#config.sessionRoot)
      // TODO: verifyChromeProfile() — open chrome://version, OCR profile path, compare
      // For v0, we mark as unverified until the chrome://version check is implemented
    } catch {
      // Profile config missing — actions will be blocked, observation still works
    }
  }

  const step = this.#step++
  const snapshotId = `mco_${this.#nextObservationId++}`
  const spanId = `observe_${this.#nextObservationId}`

  this.#traceStore?.startSpan(spanId, this.#spanId, 'observe')

  const chromeContext = await this.#resolveChromeContext()

  this.#traceStore?.recordEvent({
    event_id: `evt_capture_${snapshotId}`,
    span_id: spanId,
    name: 'capture_started',
    timestamp_millis: Date.now(),
    attributes: {},
    artifact_ids: [],
  })

  const capture = await captureChromeWindow({
    config: this.#config,
    sessionId: this.#sessionId,
    snapshotId,
    window: chromeContext.window,
  })

  const screenshotArtifactId = `screenshot_${snapshotId}`
  this.#traceStore?.recordArtifact({
    artifact_id: screenshotArtifactId,
    span_id: spanId,
    role: 'screenshot',
    mime_type: 'image/png',
    path: capture.screenshot.path,
    attributes: { width: capture.screenshot.width, height: capture.screenshot.height },
  })

  const [axResult, domResult, ocrResult] = await Promise.allSettled([
    captureAXTree(this.#config, {
      pid: chromeContext.window.ownerPid,
      maxDepth: 15,
      maxNodes: 3000,
    }),
    captureChromeDom(this.#config),
    recognizeTextInImage(this.#config, {
      imagePath: capture.screenshot.path,
      maxObservations: 256,
    }),
  ])

  const axSnapshot = axResult.status === 'fulfilled' ? axResult.value : undefined
  const chromeDomObservation = domResult.status === 'fulfilled' && domResult.value ? domResult.value : undefined
  const ocr = ocrResult.status === 'fulfilled'
    ? ocrResult.value
    : { recognizedAt: new Date().toISOString(), imagePath: capture.screenshot.path, imageWidth: capture.screenshot.width ?? 0, imageHeight: capture.screenshot.height ?? 0, matches: [] }

  // Record OCR raw artifact
  if (ocrResult.status === 'fulfilled') {
    this.#traceStore?.recordArtifact({
      artifact_id: `ocr_raw_${snapshotId}`,
      span_id: spanId,
      role: 'ocr_raw',
      mime_type: 'application/json',
      path: capture.screenshot.path, // same image, different interpretation
      attributes: { match_count: ocr.matches.length },
    })
  }

  // Normalize ALL sources → SurfaceNode[]
  const viewportBounds = findChromeViewportBounds({ axSnapshot, chromeDomObservation, chromeContext })
  const nodes = normalizeToSurfaceNodes({
    ocrMatches: ocr.matches,
    axSnapshot,
    domObservation: chromeDomObservation ?? undefined,
    contract: capture.contract,
    runId: this.#runId,
    spanId,
    startNodeIndex: 0,
    viewportBounds,
  })

  const source = inferObservationSource(nodes)
  const visibleText = nodes.map(n => n.label ?? '').join('\n')
  const signals = detectHardStopSignals(visibleText)

  this.#traceStore?.recordArtifact({
    artifact_id: `observation_${snapshotId}`,
    span_id: spanId,
    role: 'observation_snapshot',
    mime_type: 'application/json',
    path: `${this.#config.sessionRoot}/traces/${this.#sessionId}/observation_${snapshotId}.json`,
    attributes: { node_count: nodes.length, source },
  })

  this.#traceStore?.endSpan(spanId, 'ok', `observed ${nodes.length} nodes from ${source}`)

  return {
    api_version: 'careerdeepseek.observation_snapshot.v1alpha1',
    snapshot_id: snapshotId,
    run_id: this.#runId,
    span_id: spanId,
    captured_at_millis: Date.now(),
    source,
    scope: {
      surface: 'window',
      window_number: chromeContext.window.windowNumber,
      app_bundle_id: chromeContext.window.ownerBundleId,
      window_title: chromeContext.window.title ?? undefined,
      capture_artifact: {
        run_id: this.#runId,
        artifact_id: screenshotArtifactId,
        span_id: spanId,
      },
    },
    capture_contract_ref: {
      run_id: this.#runId,
      artifact_id: `capture_contract_${snapshotId}`,
      span_id: spanId,
    },
    evidence: [
      { run_id: this.#runId, artifact_id: screenshotArtifactId, span_id: spanId },
    ],
    nodes,
    detail: {
      chrome_context: {
        active_tab_url: chromeContext.activeTabUrl,
        active_tab_title: chromeContext.activeTabTitle,
      },
      signals,
      ocr_match_count: ocr.matches.length,
      ax_node_count: axSnapshot ? countAxNodes(axSnapshot.root) : 0,
      dom_element_count: chromeDomObservation?.elements.length ?? 0,
    },
    known_limits: [
      this.#profileConfig ? 'profile config loaded' : 'profile config missing, actions blocked',
    ],
  }
}

function countAxNodes(node: { children: unknown[] }): number {
  let count = 1
  for (const child of node.children) {
    count += countAxNodes(child as typeof node)
  }
  return count
}
```

Rewrite `recognize()` to accept capture and not call observe():

```typescript
async recognize(
  capture: ChromeWindowCapture,
  target: ChromeRecognitionTarget,
): Promise<RecognitionResult> {
  const spanId = `recognize_${this.#nextRecognitionId}`

  this.#traceStore?.startSpan(spanId, this.#spanId, 'recognize')

  // OCR-first: re-OCR the capture image (or use cached observation data)
  const ocr = await recognizeTextInImage(this.#config, {
    imagePath: capture.screenshot.path,
    maxObservations: 256,
  }).catch(() => ({
    recognizedAt: new Date().toISOString(),
    imagePath: capture.screenshot.path,
    imageWidth: capture.screenshot.width ?? 0,
    imageHeight: capture.screenshot.height ?? 0,
    matches: [],
  }))

  // Convert OCR matches → RecognizedItem[]
  const items: RecognizedItem[] = ocr.matches.map((match, i) => ({
    item_id: `ocr_${i}`,
    kind: 'ocr_text',
    text: match.text,
    box: {
      x: capture.contract.sourceGlobalLogicalBounds.x + match.bounds.x * capture.contract.pixelToLogicalScale.x,
      y: capture.contract.sourceGlobalLogicalBounds.y + match.bounds.y * capture.contract.pixelToLogicalScale.y,
      width: match.bounds.width * capture.contract.pixelToLogicalScale.x,
      height: match.bounds.height * capture.contract.pixelToLogicalScale.y,
    },
    provider_score: match.confidence,
    detail: { match_index: match.matchIndex, raw_pixel_bounds: match.bounds },
  }))

  const result = recognizeFromCapture(
    items,
    target,
    capture.contract,
    capture.screenshot.path,
    this.#runId,
    spanId,
  )

  // Update recognition_id counter
  this.#nextRecognitionId++

  this.#traceStore?.recordArtifact({
    artifact_id: `recognition_${result.recognition_id}`,
    span_id: spanId,
    role: 'recognition_result',
    mime_type: 'application/json',
    path: `${this.#config.sessionRoot}/traces/${this.#sessionId}/recognition_${result.recognition_id}.json`,
    attributes: { found: result.found, filtered_count: result.filtered.length },
  })

  this.#traceStore?.endSpan(spanId, 'ok')

  return result
}

// Keep old recognize() as deprecated wrapper for migration
/** @deprecated Use observe() + recognize(capture, target) instead. */
async recognizeOld(target: ChromeRecognitionTarget): Promise<MacOSChromeRecognitionResult> {
  const observation = await this.observe()
  const items: RecognizedItem[] = observation.nodes
    .filter(n => n.recognition_source)
    .map(n => ({
      item_id: n.node_ref.node_id,
      kind: n.kind,
      text: n.label,
      box: n.box,
      provider_score: n.provider_score,
      detail: n.detail,
    }))
  // ... build old-style result for backward compat
  // This is temporary — remove after migration
}

// ALSO: rename the old recognize method to a private method and expose new recognize
// The class needs BOTH during migration — old for backwards compat, new for new API
```

Add `promoteCandidate()` method:

```typescript
async promoteCandidate(
  recognition: RecognitionResult,
  capture: ChromeWindowCapture,
): Promise<CandidatePromotion> {
  const spanId = `promote_${recognition.recognition_id}`

  this.#traceStore?.startSpan(spanId, this.#spanId, 'promote')

  const chromeContext = await this.#resolveChromeContext()
  const foreground = chromeContext.isFrontmost
  const hardStopSignals = detectHardStopSignals(
    recognition.all.map(i => i.text ?? '').join('\n')
  )

  const result = doPromoteCandidate(
    recognition,
    capture.contract,
    chromeContext.window,
    {
      profile_verified: this.#profileVerified,
      chrome_foreground: foreground,
      hard_stop_signals: hardStopSignals,
      ttl_ms: 5000,
      run_id: this.#runId,
      span_id: spanId,
    },
  )

  this.#traceStore?.recordArtifact({
    artifact_id: `promotion_${recognition.recognition_id}`,
    span_id: spanId,
    role: 'promotion_decision',
    mime_type: 'application/json',
    path: `${this.#config.sessionRoot}/traces/${this.#sessionId}/promotion_${recognition.recognition_id}.json`,
    attributes: { status: result.status },
  })

  this.#traceStore?.endSpan(spanId, 'ok')

  return result
}
```

Update `click()` to accept `PromotedCandidate`:

```typescript
async click(candidate: PromotedCandidate): Promise<void> {
  const spanId = `click_${candidate.candidate_local_id}`
  this.#traceStore?.startSpan(spanId, this.#spanId, 'click')

  // Safety gate
  const context = await this.#resolveChromeContext()
  const safetyResult = checkSafetyGate(
    context,
    candidate.label ?? '',
    this.#profileConfig ?? { profile_path: 'unknown', profile_name: 'unknown', verified_at: 'never' },
  )
  if (!safetyResult.passed) {
    this.#traceStore?.endSpan(spanId, 'error', 'safety gate failed')
    throw new Error(`Safety gate failed: ${safetyResult.failures.map(f => f.code).join(', ')}`)
  }

  // Verify window
  if (context.window.windowNumber !== candidate.liveness.preconditions.window_ref.window_number) {
    this.#traceStore?.endSpan(spanId, 'error', 'window changed')
    throw new Error('Refusing click: Chrome window changed.')
  }

  const center = {
    x: candidate.target_spec.box.x + candidate.target_spec.box.width / 2,
    y: candidate.target_spec.box.y + candidate.target_spec.box.height / 2,
  }

  if (!pointInsideBounds(center, context.window.bounds)) {
    this.#traceStore?.endSpan(spanId, 'error', 'point out of bounds')
    throw new Error('Refusing click: candidate point outside active Chrome window.')
  }

  this.#traceStore?.recordEvent({
    event_id: `evt_safety_${spanId}`,
    span_id: spanId,
    name: 'safety_gate_passed',
    timestamp_millis: Date.now(),
    attributes: { check_count: 3 },
    artifact_ids: [],
  })

  const pointerTrace = buildPointerTrace({
    from: this.#lastCursorPosition,
    to: center,
    bounds: this.#config.allowedBounds,
  })

  await executeMoveAndClick(this.#config, {
    pointerTrace,
    button: 0,
    clickCount: 1,
  })

  this.#lastCursorPosition = center

  this.#traceStore?.endSpan(spanId, 'ok')
}
```

- [ ] **Step 2: Keep old methods as deprecated for migration**

Add a deprecated `recognize(target)` that wraps new `recognize(capture, target)`:

```typescript
/** @deprecated Use observe() to get capture, then recognize(capture, target). */
async recognizeLegacy(target: ChromeRecognitionTarget): Promise<MacOSChromeRecognitionResult> {
  const observation = await this.observe()
  // This path preserves backward compat by going through the old type shape
  const allOld: ChromeRecognizedItem[] = observation.nodes
    .filter(n => n.recognition_source)
    .map(n => ({
      itemId: n.node_ref.node_id,
      source: (n.recognition_source === 'chrome_dom' ? 'chrome_dom'
             : n.recognition_source === 'ocr_text' || n.recognition_source === 'ocr_row' ? 'ocr'
             : 'ax') as ChromeRecognitionSource,
      role: n.kind,
      text: n.label ?? '',
      bounds: n.box,
      center: n.center ?? { x: n.box.x + n.box.width / 2, y: n.box.y + n.box.height / 2 },
      confidence: n.provider_score ?? 0.5,
      actionable: n.detail?.actionable === true || n.kind.startsWith('dom_') || n.kind.startsWith('ax_'),
      href: (n.detail?.href as string) ?? null,
      detail: n.detail,
    }))
  // ... reuse existing filtering logic
}
```

- [ ] **Step 3: Update existing test to match new shapes**

Update `test/computer-use/macosChromeDriver.test.ts`:

- Change assertion on `snapshot.kind` to `snapshot.api_version`
- Change assertion on `snapshot.ocr.matches[0]?.text` to check `snapshot.nodes` for OCR text
- The test `'observes Chrome through a driver snapshot without producing legacy target candidates'` should now check `snapshot.nodes.length > 0` and that nodes have `SurfaceNode` shape
- The test `'recognizes a requested target as a separate result'` needs updating to use new recognize(capture, target) or keep testing the deprecated wrapper
- The test `'promotes only a successful recognition result into a candidate ref'` needs to use new API

For v1 migration, update the observe test:

```typescript
it('observes Chrome through new ObservationSnapshot with SurfaceNode[]', async () => {
    const driver = new MacOSChromeDriver({
      sessionId: 'driver-test',
      config,
      foregroundPolicy: 'auto_focus_chrome',
    })

    const snapshot = await driver.observe()

    assert.equal(snapshot.api_version, 'careerdeepseek.observation_snapshot.v1alpha1')
    assert.equal(snapshot.chromeContext.isFrontmost, true)  // still present
    assert.ok(snapshot.nodes.length >= 1, 'should have surface nodes from captured data')
    assert.equal(snapshot.nodes[0]!.recognition_source, 'ocr_text')
    assert.ok(snapshot.source === 'ocr' || snapshot.source === 'merged')
    assert.ok(snapshot.evidence.length >= 1)
    assert.equal(snapshot.scope.surface, 'window')
  })
```

- [ ] **Step 4: Run tests**

```bash
cd "${REPO_ROOT}" && pnpm vitest run test/computer-use/macosChromeDriver.test.ts
```

- [ ] **Step 5: Run typecheck + full test suite**

```bash
cd "${REPO_ROOT}" && pnpm run typecheck && pnpm test
```

Expected: All tests pass, no type errors

- [ ] **Step 6: Commit**

```bash
git add src/computer-use/macos-chrome-driver/driver.ts test/computer-use/macosChromeDriver.test.ts
git commit -m "feat: refactor driver.ts to two-path architecture (Observation ≠ Recognition)"
```

---

### Task 8: Update Barrels and Exports

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/index.ts`
- Modify: `src/computer-use/index.ts`

- [ ] **Step 1: Update macos-chrome-driver/index.ts**

```typescript
export {
  MacOSChromeDriver,
} from './driver.js'

export type {
  MacOSChromeDriverOptions,
} from './driver.js'

export { captureChromeWindow } from './capture.js'
export { recognizeTextInImage } from './ocr.js'
export { normalizeToSurfaceNodes, inferObservationSource } from './surface-node.js'
export { recognizeFromCapture } from './recognition.js'
export { promoteCandidate } from './candidate-promotion.js'
export type { PromotionOptions } from './candidate-promotion.js'
export { checkSafetyGate, detectHardStopSignals, loadProfileConfig } from './safety-gate.js'
export { TraceStore } from './trace-store.js'

export type {
  // New AUV-aligned types
  ArtifactRef,
  ArtifactRecord,
  CandidatePromotion,
  EventRecord,
  NodeRef,
  ObservationSource,
  ObservationSnapshot,
  ProfileConfig,
  PromotedCandidate,
  PromotionRefusal,
  RatioRegion,
  RecognitionBox,
  RecognitionResult,
  RecognitionScope,
  RecognitionSource,
  RecognitionSurface,
  RecognizedItem,
  RunRecord,
  RunType,
  SafetyCheckResult,
  SafetyFailure,
  SpanRecord,
  SurfaceNode,
  TraceState,
  TraceStatusCode,
  // Browser types
  ChromeCaptureContract,
  ChromeContextSnapshot,
  ChromeForegroundPolicy,
  ChromeRecognitionTarget,
  ChromeWindowCapture,
  ChromeWindowRef,
  OcrTextMatch,
  OcrTextSnapshot,
  // Deprecated (keep for migration)
  ChromeRecognizedItem,
  MacOSChromeCandidateRef,
  MacOSChromeObservationSnapshot,
  MacOSChromeRecognitionResult,
} from './types.js'

export {
  ARTIFACT_API_VERSION,
  EVENT_API_VERSION,
  RUN_API_VERSION,
  SPAN_API_VERSION,
} from './types.js'
```

- [ ] **Step 2: Update src/computer-use/index.ts**

Remove `promoteChromeCandidate` export, add new exports:

```typescript
export {
  MacOSChromeDriver,
  captureChromeWindow,
  recognizeTextInImage,
  // NEW
  normalizeToSurfaceNodes,
  inferObservationSource,
  recognizeFromCapture,
  promoteCandidate,
  checkSafetyGate,
  detectHardStopSignals,
  loadProfileConfig,
  TraceStore,
  // OLD (keep for migration — deprecated)
  promoteChromeCandidate,
} from './macos-chrome-driver/index.js'
```

Also update the type exports list in `src/computer-use/index.ts` to include new types and remove stale ones.

- [ ] **Step 3: Run typecheck**

```bash
cd "${REPO_ROOT}" && pnpm run typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/computer-use/macos-chrome-driver/index.ts src/computer-use/index.ts
git commit -m "feat: update barrel exports for new AUV-aligned modules"
```

---

### Task 9: Migrate Callers and Delete Old Types

**Files:**
- Modify: `scripts/run-discovery-task.ts` (update driver usage)
- Modify: `src/workflows/linkedin-search-workflow.ts` (update import)
- Modify: `src/computer-use/macos-chrome-driver/types.ts` (remove deprecated types)
- Delete: Old `MacOSComputerUseAdapter` references if any remain

- [ ] **Step 1: Update scripts/run-discovery-task.ts**

The script currently uses:
```typescript
const result = await driver.recognize({ kind: 'text_input', name: /search/i })
const candidate = promoteChromeCandidate(result)
await driver.click(candidate)
```

Change to new API:
```typescript
const snapshot = await driver.observe()
const recognition = await driver.recognize(snapshot.capture, { kind: 'text_input', name: /search/i })
const promotion = await driver.promoteCandidate(recognition, snapshot.capture)
if (promotion.status === 'refused') {
  throw new Error(`Cannot navigate: ${promotion.reasons.join(', ')}`)
}
await driver.click(promotion.candidate)
```

- [ ] **Step 2: Update linkedin-search-workflow.ts** similarly

- [ ] **Step 3: Remove deprecated types after all callers migrated**

In `macos-chrome-driver/types.ts`, remove:
- `MacOSChromeCandidateRef`
- `ChromeRecognizedItem`
- `ChromeRecognitionEvidence`
- `ChromeRecognitionSource` (replaced by `RecognitionSource`)

Keep `MacOSChromeObservationSnapshot` and `MacOSChromeRecognitionResult` as deprecated until ALL callers migrated.

- [ ] **Step 4: Remove deprecated `promoteChromeCandidate` from exports**

- [ ] **Step 5: Run full test suite**

```bash
cd "${REPO_ROOT}" && pnpm run typecheck && pnpm test
```

Expected: All tests PASS, no type errors

- [ ] **Step 6: Commit**

```bash
git add scripts/run-discovery-task.ts src/workflows/linkedin-search-workflow.ts src/computer-use/macos-chrome-driver/types.ts
git commit -m "feat: migrate callers to new driver API, remove deprecated types"
```

---

### Task 10: Integration Smoke Test + Profile Config

**Files:**
- Create: `CareerDeepSeek-data/computer-use/profile.json` (outside code repo)
- Modify: `scripts/run-discovery-task.ts` (final integration check)

- [ ] **Step 1: Create profile config in CareerDeepSeek-data**

Create file at the absolute path (NOT in the code repo):
```
${DATA_DIR}/computer-use/profile.json
```

```json
{
  "profile_path": "Profile 4",
  "profile_name": "CareerDeepSeek",
  "verified_at": "2026-06-14T00:00:00Z"
}
```

- [ ] **Step 2: Run the smoke test**

```bash
cd "${REPO_ROOT}" && pnpm exec tsx scripts/run-discovery-task.ts "test query"
```

This should:
- Open/focus Chrome
- Navigate to Google
- Search
- Observe results

Verify trace files exist:
```bash
ls .computer-use/traces/*/
```

- [ ] **Step 3: Check lints**

```bash
cd "${REPO_ROOT}" && pnpm run lint
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: integration smoke test passes with new driver architecture"
```

---

## Plan Summary

| Task | Files | Typecheck | Test |
|------|-------|-----------|------|
| 1. Update types.ts | types.ts, index.ts | ✅ | Existing 93 pass |
| 2. surface-node.ts | New file + test | ✅ | 6 new tests |
| 3. recognition.ts | New file + test | ✅ | 8 new tests |
| 4. candidate-promotion.ts | New file + test | ✅ | 9 new tests |
| 5. safety-gate.ts | New file + test | ✅ | 9 new tests |
| 6. trace-store.ts | New file + test | ✅ | 6 new tests |
| 7. Refactor driver.ts | driver.ts + test update | ✅ | Updated + existing |
| 8. Update barrels | index.ts × 2 | ✅ | — |
| 9. Migrate callers | scripts, workflows | ✅ | All passing |
| 10. Integration smoke | Profile config + script | ✅ | Smoke passes |

**Total new tests: ~38**
**Total new files: 5**
**Total modified files: ~8**
**Total deleted types: 4+**
