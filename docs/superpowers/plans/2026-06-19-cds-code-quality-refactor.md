# CDS Code Quality Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the semantic conflicts blocking live Chrome invoke QA, then reduce duplicate helpers without hiding behavior changes inside mechanical refactors.

**Architecture:** This plan deliberately fixes behavior first: `recognition -> promotion -> driver action/liveness` must agree on target kinds, grounding, and lease semantics before helper dedupe. Visual trace generation is preserved because it is part of the QA inspection loop, not executable workflow pollution.

**Tech Stack:** TypeScript, Vitest, Node.js, CareerDeepSeek macOS Chrome computer-use driver.

---

## Current Constraints

- No fixed executable research workflow may be introduced.
- QA code must remain separate from research workflow.
- Real browser actions must go through invoke/driver primitives.
- `trace-visual-report.ts` must not be deleted in this refactor; it supports visual trace inspection.
- Helper dedupe must not run before semantic fixes.
- Every phase must pass targeted tests before the next phase starts.

## Confirmed Source Facts

| Fact | Current location |
| --- | --- |
| `recognition.ts` has `isActionable()` meaning "structural interactive signal"; it excludes OCR sources. | `src/computer-use/macos-chrome-driver/recognition.ts` |
| `candidate-promotion.ts` has another `isActionable()` meaning "promotable action target"; it includes OCR/text-input kinds. | `src/computer-use/macos-chrome-driver/candidate-promotion.ts` |
| `candidate-promotion.ts` returns `coordinate` grounding for non-OCR/non-text-input candidates. | `src/computer-use/macos-chrome-driver/candidate-promotion.ts` |
| `driver.ts` click currently accepts only `ocr_anchor` and `visual_row`, so coordinate-grounded buttons/links are rejected. | `src/computer-use/macos-chrome-driver/driver.ts` |
| `driver.ts` currently clears `#scrollRegionLease` after click/focus/type/pressKey. | `src/computer-use/macos-chrome-driver/driver.ts` |
| `trace-visual-report.ts` is referenced by QA docs and tests. It is not executable workflow logic. | `docs/computer-use-testing-and-qa.md`, `test/computer-use/traceVisualReport.test.ts` |

## Non-Goals

- Do not add Chrome tab transition handling in this refactor.
- Do not add browser back/close/recovery behavior.
- Do not add structural overlay dismissal.
- Do not add a fixed company-search workflow.
- Do not delete visual trace reporting.
- Do not introduce MCP/server/CLI/public command catalog.

---

## File Map

| File | Phase A | Phase B | Phase C | Phase D | Phase E |
| --- | --- | --- | --- | --- | --- |
| `types.ts` | Export shared target kind sets and audit type | - | - | Host only helpers/types proven equivalent by Phase D1 | - |
| `recognition.ts` | Rename recognition-side action signal | - | - | Dedupe exact helpers only | - |
| `candidate-promotion.ts` | Rename promotion predicate, support button/link promotion | - | - | Dedupe exact helpers only | - |
| `driver.ts` | Accept coordinate click delivery and liveness for supported semantic targets | Fix scroll lease lifecycle | - | Dedupe exact helpers only | - |
| `invoke-handlers.ts` | No semantic change unless tests expose stale naming | - | - | Dedupe exact helpers only | - |
| `trace-visual-report.ts` | Preserve | Preserve | Preserve and test | Import shared helpers only after Phase D1 proves exact equivalence | - |
| `invoke-qa-report.ts` | Preserve until separate deletion decision | Preserve | Audit only | Import shared helpers only after Phase D1 proves exact equivalence | - |
| `agent-harness.ts` | Preserve until separate deletion decision | Preserve | Audit only | Import shared helpers only after Phase D1 proves exact equivalence | - |
| Tests | Add regression tests first | Add scroll lease regression | Keep visual trace tests | Add helper-equivalence tests where needed | Full and live QA |

---

## Phase A: Fix Target Semantics Before Helper Refactor

### Task A1: Centralize target kind sets

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/types.ts`
- Modify: `src/computer-use/macos-chrome-driver/recognition.ts`
- Modify: `src/computer-use/macos-chrome-driver/candidate-promotion.ts`
- Modify: `src/computer-use/macos-chrome-driver/driver.ts`
- Test: `test/computer-use/recognition.test.ts`
- Test: `test/computer-use/candidatePromotion.test.ts`
- Test: `test/computer-use/macosChromeDriver.test.ts`

- [ ] **Step 1: Add target kind exports in `types.ts`**

Add these exports near `ChromeRecognitionTarget` / `RecognizedItem` definitions:

```ts
export const TEXT_INPUT_KINDS = new Set([
  'dom_textbox',
  'dom_searchbox',
  'dom_combobox',
  'ax_textfield',
  'ax_textarea',
  'ax_combobox',
] as const)

export const BUTTON_KINDS = new Set([
  'dom_button',
  'ax_button',
] as const)

export const LINK_KINDS = new Set([
  'dom_link',
  'ax_link',
] as const)

export const COORDINATE_CLICK_KINDS = new Set([
  'dom_button',
  'ax_button',
  'dom_link',
  'ax_link',
  'ax_menu_item',
  'ax_tab',
] as const)
```

- [ ] **Step 2: Replace local duplicate kind sets**

In `recognition.ts`, remove local `BUTTON_KINDS`, `TEXT_INPUT_KINDS`, and `LINK_KINDS`; import from `types.ts`.

In `candidate-promotion.ts`, remove local `PROMOTABLE_TEXT_INPUT_KINDS`; import `TEXT_INPUT_KINDS`, `BUTTON_KINDS`, `LINK_KINDS`.

In `driver.ts`, replace `SUPPORTED_AX_NODE_CLICK_KINDS` with `TEXT_INPUT_KINDS`, and import `COORDINATE_CLICK_KINDS`.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
pnpm vitest run test/computer-use/recognition.test.ts test/computer-use/candidatePromotion.test.ts test/computer-use/macosChromeDriver.test.ts
```

Expected: all pass. This task should be import/constant movement only.

### Task A2: Rename conflicting `isActionable` concepts

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/recognition.ts`
- Modify: `src/computer-use/macos-chrome-driver/candidate-promotion.ts`
- Test: `test/computer-use/recognition.test.ts`
- Test: `test/computer-use/candidatePromotion.test.ts`

- [ ] **Step 1: Rename recognition-side function**

In `recognition.ts`, rename:

```ts
function isActionable(item: RecognizedItem): boolean
```

to:

```ts
function hasStructuralInteractionSignal(item: RecognizedItem): boolean
```

Update `compareForBest()` to call `hasStructuralInteractionSignal()`.

Expected behavior remains unchanged: AX/DOM interactive elements outrank OCR when they represent the same visual target.

- [ ] **Step 2: Rename promotion-side function**

In `candidate-promotion.ts`, delete the standalone promotion-side `isActionable()` name and fold the logic into:

```ts
function isSupportedPromotionTarget(
  item: { kind: string, detail: Record<string, unknown> },
  targetKind: ChromeRecognitionTarget['kind'] | undefined,
): boolean
```

Update the existing caller:

```ts
if (recognition.best && !isSupportedPromotionTarget(recognition.best, effectiveTargetKind))
  reasons.push('item_not_actionable')
```

- [ ] **Step 3: Run targeted tests**

Run:

```bash
pnpm vitest run test/computer-use/recognition.test.ts test/computer-use/candidatePromotion.test.ts
```

Expected: all pass.

### Task A3: Promote semantic buttons and links without reintroducing OCR overfitting

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/candidate-promotion.ts`
- Test: `test/computer-use/candidatePromotion.test.ts`

- [ ] **Step 1: Add failing promotion tests first**

Add tests covering:

```ts
it('promotes DOM button recognition with coordinate grounding')
it('promotes AX button recognition with coordinate grounding')
it('promotes DOM link recognition with coordinate grounding')
it('promotes AX link recognition with coordinate grounding')
it('keeps text input promotion on ax_node grounding')
it('keeps OCR text promotion on ocr_anchor grounding')
it('keeps OCR row promotion on visual_row grounding')
```

Each semantic button/link test must assert:

```ts
assert.equal(result.status, 'promoted')
assert.equal(result.candidate.target_spec.grounding, 'coordinate')
```

- [ ] **Step 2: Extend promotion target support**

In `candidate-promotion.ts`, update `isSupportedPromotionTarget()`:

```ts
function isSupportedPromotionTarget(
  item: { kind: string, detail: Record<string, unknown> },
  targetKind: ChromeRecognitionTarget['kind'] | undefined,
): boolean {
  if (targetKind === 'text_input')
    return TEXT_INPUT_KINDS.has(item.kind)

  if (targetKind && TEXT_INPUT_KINDS.has(item.kind))
    return false

  if (BUTTON_KINDS.has(item.kind) || LINK_KINDS.has(item.kind))
    return true

  if (item.kind === 'ocr_row')
    return hasOcrRowEvidence(item)

  return PROMOTABLE_OCR_KINDS.has(item.kind)
}
```

Do not add character-level OCR correction or fuzzy text rules.

- [ ] **Step 3: Run promotion tests**

Run:

```bash
pnpm vitest run test/computer-use/candidatePromotion.test.ts
```

Expected: all pass.

### Task A4: Make driver click/liveness accept coordinate-grounded semantic targets

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/driver.ts`
- Test: `test/computer-use/macosChromeDriver.test.ts`
- Test: `test/computer-use/invokeActionCommands.test.ts`

- [ ] **Step 1: Add failing driver tests first**

Add regression tests covering:

```ts
it('accepts coordinate-grounded DOM button candidates for click')
it('accepts coordinate-grounded AX button candidates for click')
it('accepts coordinate-grounded DOM link candidates for click')
it('refuses unsupported coordinate candidate kinds')
```

The success tests must verify that the click precondition does not reject candidates with:

```ts
target_spec: {
  grounding: 'coordinate',
  box: { x: 100, y: 100, width: 80, height: 30 },
  anchor_text: 'Hide sponsored result',
}
kind: 'dom_button' // or ax_button/dom_link/ax_link
```

- [ ] **Step 2: Update click grounding predicate**

In `driver.ts`, replace `isSupportedClickCandidateGrounding()` with behavior equivalent to:

```ts
function isSupportedClickCandidateGrounding(candidate: PromotedCandidate): boolean {
  const grounding = candidate.target_spec.grounding
  return (grounding === 'ocr_anchor' && candidate.kind === 'ocr_text')
    || (grounding === 'visual_row' && candidate.kind === 'ocr_row')
    || (grounding === 'coordinate' && COORDINATE_CLICK_KINDS.has(candidate.kind))
}
```

Update the click precondition expected labels from:

```ts
['ocr_anchor', 'visual_row']
```

to:

```ts
['ocr_anchor', 'visual_row', 'coordinate']
```

- [ ] **Step 3: Update liveness compatibility**

In `driver.ts`, update `isFreshSourceCompatible()` so coordinate-grounded semantic candidates can pass liveness recheck:

```ts
if (grounding === 'coordinate')
  return selected.kind === candidate.kind && COORDINATE_CLICK_KINDS.has(candidate.kind)
```

Keep existing OCR/text-input checks unchanged.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
pnpm vitest run test/computer-use/macosChromeDriver.test.ts test/computer-use/invokeActionCommands.test.ts test/computer-use/candidatePromotion.test.ts
```

Expected: all pass.

---

## Phase B: Fix Scroll Region Lease Lifecycle

### Task B1: Preserve scroll lease across non-scroll actions

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/driver.ts`
- Test: `test/computer-use/macosChromeDriver.test.ts`
- Test: `test/computer-use/invokeActionCommands.test.ts`

- [ ] **Step 1: Add failing lease lifecycle test first**

Add or update tests to cover this sequence:

```ts
await invoke('chrome.observe')
await invoke('chrome.recognize', { target: { kind: 'button', text: /hide sponsored/i } })
await invoke('chrome.promote')
await invoke('chrome.clickCandidate')
await invoke('chrome.scroll', { deltaY: 600 })
```

Expected: scroll must not fail with `scroll_region_not_observed` solely because a click happened after observe.

- [ ] **Step 2: Remove non-scroll lease clears**

In `driver.ts`, remove:

```ts
this.#scrollRegionLease = undefined
```

from the `finally` blocks of:

- `click()`
- `focusTextInput()`
- `typeText()`
- `pressKey()`

Do not change focus lease behavior in this task.

- [ ] **Step 3: Make scroll consume its own lease in a single finally**

In `scroll()`, clear the scroll lease exactly once after the scroll action attempt finishes:

```ts
try {
  await this.#executeAction('scroll', null, 'observed_scroll_region', async (context) => {
    // existing scroll delivery body stays here
  }, callerPreconditionFailure)
}
finally {
  this.#scrollRegionLease = undefined
}
```

Remove the branch-local clears inside the window-targeted path and HID fallback path.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
pnpm vitest run test/computer-use/macosChromeDriver.test.ts test/computer-use/invokeActionCommands.test.ts
```

Expected: all pass.

---

## Phase C: Preserve QA Visibility and Audit Legacy Files

### Task C1: Keep visual trace report

**Files:**
- Preserve: `src/computer-use/macos-chrome-driver/trace-visual-report.ts`
- Preserve: `test/computer-use/traceVisualReport.test.ts`
- Verify: `docs/computer-use-testing-and-qa.md`

- [ ] **Step 1: Verify visual trace references**

Run:

```bash
rg -n "generateVisualTraceReport|trace-visual-report|visual_report" src test docs -S
```

Expected: references exist in tests/docs. Do not delete the file.

- [ ] **Step 2: Run visual trace tests**

Run:

```bash
pnpm vitest run test/computer-use/traceVisualReport.test.ts
```

Expected: all pass.

### Task C2: Audit legacy files without deleting them in this refactor

**Files:**
- Audit: `src/computer-use/macos-chrome-driver/agent-harness.ts`
- Audit: `src/computer-use/macos-chrome-driver/invoke-qa-report.ts`
- Audit: `test/computer-use/macosChromeAgentHarness.test.ts`
- Audit: `test/computer-use/invokeQaReport.test.ts`

- [ ] **Step 1: Verify import graph**

Run:

```bash
rg -n "MacOSChromeAgentHarness|invoke-qa-report|generateInvokeQaReport|agent-harness" src test docs scripts -S
```

Expected: produce a list of references. This task is audit-only.

- [ ] **Step 2: Record deletion decision separately**

Do not delete these files in Phase C. If deletion is still desired, create a separate plan entry after confirming:

- no production import,
- no doc dependency,
- no QA inspection value,
- no user-facing transition risk.

---

## Phase D: Helper Dedupe After Semantics Are Fixed

### Task D1: Classify helper duplicates before extraction

**Files:**
- Inspect: `src/computer-use/macos-chrome-driver/*.ts`
- Modify only after classification: exact files identified by this task.

- [ ] **Step 1: Generate helper inventory**

Run:

```bash
rg -n "function (isRecord|isArtifactRef|uniqueStrings|errorMessage|validBox|hasValidBox|validRecognitionBox|validBounds|sanitizeArtifactId|sanitizeTraceIdPart|sanitizeTraceName)" src/computer-use/macos-chrome-driver -S
```

Expected: full list of duplicates.

- [ ] **Step 2: Classify by exact semantic equivalence**

For each duplicate group, write down one of:

- exact duplicate: safe to extract,
- same name but different behavior: rename or keep local,
- same shape but different contract: do not extract in this refactor.

Special rules:

- Do not unify `isRecord` unless array handling is identical for every call site.
- Do not unify `isArtifactRef` unless `captured_event_id` behavior is explicitly compatible.
- Do not unify sanitizers unless max length and ID/path use case are identical.

### Task D2: Extract only exact duplicates

**Files:**
- Create only if Task D1 proves exact duplicates: `src/computer-use/macos-chrome-driver/shared.ts`
- Modify: exact files identified by Task D1.

- [ ] **Step 1: Create a narrow shared helper module only for exact duplicates**

Allowed initial exports:

```ts
export function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error)
    return error.message
  return String(error)
}
```

Do not add `isRecord`, `isArtifactRef`, bounds validators, or sanitizers until Task D1 proves exact equivalence.

- [ ] **Step 2: Replace one duplicate group at a time**

For each helper group:

1. Replace imports in one file.
2. Run that file's targeted tests.
3. Continue only if tests pass.

Example command:

```bash
pnpm vitest run test/computer-use/candidatePromotion.test.ts
```

Expected: all pass after each file.

---

## Phase E: Verification and Live QA

### Task E1: Static verification

- [ ] **Step 1: Type check**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2: Public CI**

Run:

```bash
pnpm run ci:public
```

Expected: all tests pass.

### Task E2: Real Chrome invoke QA

**Purpose:** Prove the primitive loop works in real Chrome, not only unit tests.

- [ ] **Step 1: Run observe**

Use the P1.5 invoke API against real Chrome:

```txt
chrome.observe
```

Expected trace:

- Chrome foreground/profile/window context recorded,
- observation includes screenshot/OCR/AX/DOM evidence,
- scroll region lease exists.

- [ ] **Step 2: Run semantic button/link action loop**

Run:

```txt
chrome.recognize({ target: { kind: 'button', text: /hide sponsored/i } })
chrome.promote
chrome.clickCandidate
chrome.observe
```

Expected:

- AX/DOM button/link can be promoted,
- click candidate can use `coordinate` grounding,
- liveness recheck passes for the same semantic target kind,
- no `item_not_actionable` caused by semantic button/link targets.

- [ ] **Step 3: Run text input loop**

Run:

```txt
chrome.observe
chrome.recognize({ target: { kind: 'text_input', name: /search/i } })
chrome.promote
chrome.focusTextInput
chrome.typeText
chrome.pressKey
chrome.observe
```

Expected:

- text input uses AX/DOM identity,
- no OCR character correction is required,
- focus lease survives explicit observe boundary when intended.

- [ ] **Step 4: Run scroll loop**

Run:

```txt
chrome.observe
chrome.scroll({ deltaY: 600 })
chrome.observe
```

Expected:

- scroll does not require promoted candidate,
- scroll uses observed scroll region lease,
- scroll action emits `caller_must_post_scroll_observe`,
- next observe verifies page state.

- [ ] **Step 5: Produce trace visual report**

Run the visual trace report generator on the trace directory.

Expected:

- screenshots resolve,
- candidate boxes and click points are inspectable,
- failure reasons are visible when present.

### Task E3: Research-quality smoke requirement

- [ ] **Step 1: Use primitive loop to identify at least 3 candidate companies/opportunities**

The QA runner must not encode a fixed research workflow. The human/agent decision can use the invoke primitives to inspect pages, but the codebase must not gain a hardcoded executable company-search flow.

Expected output outside the public repo:

- at least 3 high-quality companies/opportunities,
- trace root paths,
- action sequence,
- visual report path,
- known driver issues.

---

## Execution Order

```txt
Phase A: target semantics and coordinate click closure
  -> Phase B: scroll lease lifecycle
    -> Phase C: preserve visual trace and audit legacy files
      -> Phase D: helper dedupe after behavior is stable
        -> Phase E: static verification and real Chrome invoke QA
```

Do not start Phase D until Phase A and Phase B pass targeted tests.

Do not delete `trace-visual-report.ts` in this plan.

Do not claim completion until Phase E live QA has produced trace evidence.
