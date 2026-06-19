# CDS P1.6 Helper Contract Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename local helper functions whose current names hide different contracts, while preserving runtime behavior exactly.

**Architecture:** P1.6 is a contract-naming refactor, not a helper dedupe pass. Each rename must be preceded by characterization tests that prove the existing behavior and followed by targeted tests and `pnpm run ci:public`. Helpers with unresolved domain-specific contracts stay local and are documented as deferred.

**Tech Stack:** TypeScript, Vitest, Node.js, CareerDeepSeek macOS Chrome computer-use driver.

---

## Implementation Status

Status: completed on 2026-06-19.

P1.6 intentionally renamed only the proven helper contract collisions:

- object-like vs non-array record checks,
- stringifying vs safe error-message formatting.

Deferred helpers:

- `isArtifactRef` variants,
- bounds validators,
- sanitize helpers.

These are not safe to unify or rename in P1.6 because they depend on artifact schema, local visual geometry semantics, or ID/path length constraints.

---

## Current Constraints

- Do not add fixed executable research workflow.
- Do not add CLI/MCP/public command catalog.
- Do not move remaining helpers into `shared.ts`.
- Do not change runtime behavior.
- Do not normalize contracts that are currently different.
- Do not touch browser tab transition, overlay dismissal, trace store lifecycle, or visual trace UI behavior in this plan.
- Each phase requires implementation plus independent review before the next phase starts.

## Confirmed Source Facts

| Helper | Current files | Confirmed contract |
| --- | --- | --- |
| `isRecord` | `recognition.ts`, `candidate-promotion.ts`, `invoke-handlers.ts`, `driver.ts` | Object-like record check: accepts arrays because it checks `typeof value === 'object' && value !== null`. |
| `isRecord` | `agent-harness.ts`, `invoke-entry.ts` | Non-array record check: rejects arrays. |
| `errorMessage` | `driver.ts`, `agent-harness.ts` | Stringifying thrown value: `Error.message`, otherwise `String(error)`. |
| `errorMessage` | `invoke-handlers.ts`, `trace-visual-report.ts` | Safe error message: `Error.message`, string as-is, otherwise `'unknown error'`. |
| `isArtifactRef` | `recognition.ts`, `candidate-promotion.ts`, `invoke-handlers.ts`, `trace-visual-report.ts` | Similar names but different `captured_event_id` handling and local ref types. Deferred. |
| `validBox` / `hasValidBox` / `validRecognitionBox` / `validBounds` | multiple files | Similar numeric bounds checks with different parameter types and domain names. Deferred. |
| `sanitizeArtifactId` / `sanitizeTraceIdPart` | multiple files | Same regex but different maximum lengths and ID/span/path use cases. Deferred. |

## Non-Goals

- Do not reduce helper count for its own sake.
- Do not create a generic `isRecord` in `shared.ts`.
- Do not create a generic `errorMessage` in `shared.ts`.
- Do not rename `isArtifactRef`, bounds validators, or sanitize helpers unless a later plan proves the local contracts.

---

## File Map

| File | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
| --- | --- | --- | --- | --- |
| `test/computer-use/helperContracts.test.ts` | Create characterization tests | Extend if needed | Extend if needed | Preserve |
| `src/computer-use/macos-chrome-driver/recognition.ts` | Export test-only contract helpers or use existing public behavior | Rename object-like record helper | - | - |
| `src/computer-use/macos-chrome-driver/candidate-promotion.ts` | Export test-only contract helpers or use existing public behavior | Rename object-like record helper | - | - |
| `src/computer-use/macos-chrome-driver/invoke-handlers.ts` | Export test-only contract helpers or use existing public behavior | Rename object-like record helper | Rename safe error helper | - |
| `src/computer-use/macos-chrome-driver/driver.ts` | Export test-only contract helpers or use existing public behavior | Rename object-like record helper | Rename stringify helper | - |
| `src/computer-use/macos-chrome-driver/agent-harness.ts` | Export test-only contract helpers or use existing public behavior | Rename non-array record helper | Rename stringify helper | - |
| `src/computer-use/macos-chrome-driver/invoke-entry.ts` | Export test-only contract helpers or use existing public behavior | Rename non-array record helper | - | - |
| `src/computer-use/macos-chrome-driver/trace-visual-report.ts` | Export test-only contract helpers or use existing public behavior | - | Rename safe error helper | - |
| `docs/superpowers/plans/2026-06-19-cds-p16-helper-contract-naming.md` | - | - | - | Record final status and deferred helper rationale |

---

## Phase 1: Characterize Current Helper Contracts

### Task 1.1: Add characterization tests before renaming

**Purpose:** Prove the current contracts before any rename. These tests are intentionally about contract categories, not about sharing helpers.

**Files:**

- Create: `test/computer-use/helperContracts.test.ts`
- Modify only if necessary: source files listed in the file map

- [ ] **Step 1: Inspect whether local helpers can be exercised through existing exported behavior**

Run:

```bash
rg -n "function isRecord|function errorMessage|unknownErrorMessage|asObject" src/computer-use/macos-chrome-driver
```

Expected: all helper variants are visible in the source tree and no new shared helper is introduced.

- [ ] **Step 2: Add characterization tests**

Create `test/computer-use/helperContracts.test.ts` with tests that lock the contract names used by P1.6.

If local helpers cannot be imported without widening production exports, use tiny local characterization functions in the test file with a comment that mirrors the current source contracts. Do not export production-only helpers just for tests unless a reviewer confirms the export is safe.

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

describe('P1.6 helper contract characterization', () => {
  it('object-like record contract accepts arrays', () => {
    const isObjectLikeRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null

    assert.equal(isObjectLikeRecord({}), true)
    assert.equal(isObjectLikeRecord([]), true)
    assert.equal(isObjectLikeRecord(null), false)
    assert.equal(isObjectLikeRecord('value'), false)
  })

  it('non-array record contract rejects arrays', () => {
    const isNonArrayRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value)

    assert.equal(isNonArrayRecord({}), true)
    assert.equal(isNonArrayRecord([]), false)
    assert.equal(isNonArrayRecord(null), false)
    assert.equal(isNonArrayRecord('value'), false)
  })

  it('stringifying thrown value contract preserves String(error) fallback', () => {
    const stringifyThrownValue = (error: unknown): string =>
      error instanceof Error ? error.message : String(error)

    assert.equal(stringifyThrownValue(new Error('boom')), 'boom')
    assert.equal(stringifyThrownValue('plain'), 'plain')
    assert.equal(stringifyThrownValue({ code: 'E_TEST' }), '[object Object]')
    assert.equal(stringifyThrownValue(undefined), 'undefined')
  })

  it('safe error message contract hides non-string thrown values', () => {
    const safeErrorMessage = (error: unknown): string => {
      if (error instanceof Error)
        return error.message
      if (typeof error === 'string')
        return error
      return 'unknown error'
    }

    assert.equal(safeErrorMessage(new Error('boom')), 'boom')
    assert.equal(safeErrorMessage('plain'), 'plain')
    assert.equal(safeErrorMessage({ code: 'E_TEST' }), 'unknown error')
    assert.equal(safeErrorMessage(undefined), 'unknown error')
  })
})
```

- [ ] **Step 3: Run characterization tests**

Run:

```bash
pnpm vitest run test/computer-use/helperContracts.test.ts
```

Expected: tests pass and document the contract categories.

---

## Phase 2: Rename Record Contract Helpers

### Task 2.1: Rename object-like and non-array record helpers

**Purpose:** Remove misleading same-name helpers without changing their local behavior.

**Files:**

- Modify: `src/computer-use/macos-chrome-driver/recognition.ts`
- Modify: `src/computer-use/macos-chrome-driver/candidate-promotion.ts`
- Modify: `src/computer-use/macos-chrome-driver/invoke-handlers.ts`
- Modify: `src/computer-use/macos-chrome-driver/driver.ts`
- Modify: `src/computer-use/macos-chrome-driver/agent-harness.ts`
- Modify: `src/computer-use/macos-chrome-driver/invoke-entry.ts`

- [ ] **Step 1: Rename object-like record helpers**

In these files, rename local `isRecord` to `isObjectLikeRecord` and update same-file callers only:

- `recognition.ts`
- `candidate-promotion.ts`
- `invoke-handlers.ts`
- `driver.ts`

The function body must remain:

```ts
function isObjectLikeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
```

- [ ] **Step 2: Rename non-array record helpers**

In `agent-harness.ts`, rename local `isRecord` to `isNonArrayRecord` and update same-file callers only.

The function body must remain equivalent to the current truthy non-array contract:

```ts
function isNonArrayRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
```

In `invoke-entry.ts`, rename local `isRecord` to `isNonArrayRecord` and update same-file callers only.

The function body must remain:

```ts
function isNonArrayRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

- [ ] **Step 3: Verify no local `isRecord` remains in the macOS Chrome driver**

Run:

```bash
rg -n "function isRecord|\\bisRecord\\(" src/computer-use/macos-chrome-driver
```

Expected: no matches.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
pnpm vitest run test/computer-use/helperContracts.test.ts test/computer-use/recognition.test.ts test/computer-use/candidatePromotion.test.ts test/computer-use/invokeActionCommands.test.ts test/computer-use/invokeEntry.test.ts test/computer-use/macosChromeAgentHarness.test.ts test/computer-use/macosChromeDriver.test.ts
```

Expected: all targeted tests pass.

---

## Phase 3: Rename Error Message Contract Helpers

### Task 3.1: Rename stringifying and safe error helpers

**Purpose:** Make error helper names reflect their fallback behavior.

**Files:**

- Modify: `src/computer-use/macos-chrome-driver/driver.ts`
- Modify: `src/computer-use/macos-chrome-driver/agent-harness.ts`
- Modify: `src/computer-use/macos-chrome-driver/invoke-handlers.ts`
- Modify: `src/computer-use/macos-chrome-driver/trace-visual-report.ts`

- [ ] **Step 1: Rename stringifying helpers**

In `driver.ts` and `agent-harness.ts`, rename local `errorMessage` to `stringifyThrownValue` and update same-file callers only.

The function body must remain:

```ts
function stringifyThrownValue(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
```

- [ ] **Step 2: Rename safe message helpers**

In `invoke-handlers.ts` and `trace-visual-report.ts`, rename local `errorMessage` to `safeErrorMessage` and update same-file callers only.

The function body must remain:

```ts
function safeErrorMessage(error: unknown): string {
  if (error instanceof Error)
    return error.message
  if (typeof error === 'string')
    return error
  return 'unknown error'
}
```

- [ ] **Step 3: Verify no local `errorMessage` remains in the macOS Chrome driver**

Run:

```bash
rg -n "function errorMessage|\\berrorMessage\\(" src/computer-use/macos-chrome-driver
```

Expected: no matches.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
pnpm vitest run test/computer-use/helperContracts.test.ts test/computer-use/invokeActionCommands.test.ts test/computer-use/invokeReadOnlyCommands.test.ts test/computer-use/macosChromeAgentHarness.test.ts test/computer-use/macosChromeDriver.test.ts test/computer-use/traceVisualReport.test.ts
```

Expected: all targeted tests pass.

---

## Phase 4: Record Deferred Helpers and Run Final Verification

### Task 4.1: Document deferred non-equivalent helpers

**Purpose:** Prevent future agents from treating unresolved helpers as accidental duplication.

**Files:**

- Modify: `docs/superpowers/plans/2026-06-19-cds-p16-helper-contract-naming.md`

- [ ] **Step 1: Add implementation status section**

Add a short implementation status section near the top of this file after completion:

```txt
Status: completed on 2026-06-19.

P1.6 intentionally renamed only the proven helper contract collisions:
- object-like vs non-array record checks,
- stringifying vs safe error-message formatting.

Deferred helpers:
- isArtifactRef variants,
- bounds validators,
- sanitize helpers.

These are not safe to unify or rename in P1.6 because they depend on artifact schema, local visual geometry semantics, or ID/path length constraints.
```

- [ ] **Step 2: Final grep checks**

Run:

```bash
rg -n "function isRecord|\\bisRecord\\(|function errorMessage|\\berrorMessage\\(" src/computer-use/macos-chrome-driver
```

Expected: no matches.

Run:

```bash
rg -n "function isArtifactRef|validBox|hasValidBox|validRecognitionBox|validBounds|sanitizeArtifactId|sanitizeTraceIdPart" src/computer-use/macos-chrome-driver
```

Expected: matches remain. They are deferred by design.

- [ ] **Step 3: Run public CI**

Run:

```bash
pnpm run ci:public
```

Expected: lint, typecheck, and tests all pass.

- [ ] **Step 4: Run diff hygiene check**

Run:

```bash
git diff --check
```

Expected: no output.

---

## Execution Order

```txt
Phase 1: characterize current helper contracts
  -> Phase 2: rename record contract helpers
    -> Phase 3: rename error message contract helpers
      -> Phase 4: document deferred helpers and final verification
```

Do not move to the next phase until the current phase has implementation and independent review approval.

Do not claim completion until `pnpm run ci:public` passes.
