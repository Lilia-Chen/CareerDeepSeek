# P2 Feature 1: AUV-Shaped Atomic CLI Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `cds invoke` regular UI commands that follow AUV command boundaries: text/row/window commands, AX focus/press commands, active-control keyboard commands, and self-contained region scroll.

**Architecture:** Keep the existing programmatic session API intact. Add a separate CLI command-adapter path with lightweight primitives that resolve managed Chrome on every invocation and never depend on handler closure state. OCR commands capture once and OCR once; AX commands capture AX once; keyboard commands act on the active control.

**Tech Stack:** TypeScript ESM, Vitest, existing macOS Swift helpers, `captureChromeWindow`, `recognizeTextInImage`, `produceOcrRows`, `captureAXTree`, `executeMoveAndClick`, `executeTypeText`, `executePressKeys`, `executeWindowTargetedScroll`.

---

## AUV Alignment Contract

The implementation must preserve these invariants:

- `chrome.findText`: 1 window capture + 1 OCR + return matches. No promote. No command failure for no match.
- `chrome.clickText`: 1 window capture + 1 OCR + 1 click. Fresh capture/OCR is liveness. No `driver.click()`.
- `chrome.findRows`: 1 window capture + 1 OCR + row grouping.
- `chrome.clickRow`: 1 window capture + 1 OCR + row grouping + 1 click.
- `chrome.focusText`: 1 AX capture + pointer focus.
- `chrome.axFocusText`: 1 AX capture + AX focus attribute.
- `chrome.pressButton`: 1 AX capture + pointer click.
- `chrome.axPressButton`: 1 AX capture + AX press, no pointer fallback.
- `chrome.typeText`: type into active control only. It does not locate/focus.
- `chrome.key`: press key in active app.
- `chrome.scrollRegion`: resolve Chrome window and region on every call. No scroll lease.

The CLI path must not call these programmatic/session methods:

```txt
driver.observe()
driver.recognizeFromCapture()
driver.promoteCandidate()
driver.click()
driver.focusTextInput()
driver.typeText()
driver.pressKey()
driver.scroll()
```

The pure matcher from `recognition.ts` may be refactored and reused, but AX-only recognition must not pass `null as any` for `ChromeCaptureContract`.

---

## File Map

| File | Action |
|------|--------|
| `src/computer-use/macos-chrome-driver/atomic-types.ts` | Create — atomic command result/input types |
| `src/computer-use/macos-chrome-driver/atomic-recognition.ts` | Create — source-specific matching helpers that do not require fake capture contracts |
| `src/computer-use/macos-chrome-driver/atomic-commands.ts` | Create — lightweight AUV-shaped command primitives |
| `src/computer-use/macos-chrome-driver/driver.ts` | Modify — expose `traceSink` and either delegate atomic methods or instantiate adapter |
| `src/computer-use/macos-chrome-driver/invoke-handlers.ts` | Modify — extend interface and add CLI handler registry |
| `src/computer-use/macos-chrome-driver/invoke-catalog.ts` | Modify — add AUV-shaped CLI command specs and allowlist |
| `src/computer-use/macos-chrome-driver/invoke-entry.ts` | Modify — choose CLI handlers when `mode: 'cli'` |
| `src/computer-use/macos-chrome-driver/invoke-runtime.ts` | Modify — add command allowlist gate before resolution/dry-run |
| `src/cli.ts` | Create — `cds invoke` flat-arg CLI |
| `package.json` | Modify — no `bin` unless build output exists; current `tsconfig.json` has `noEmit`, so use documented `pnpm tsx` command in Feature 1 |
| `docs/cds-cli-guide.md` | Create — agent-facing command reference |
| `test/macos-chrome-driver/atomic-recognition.test.ts` | Create — pure matching/unit tests |
| `test/macos-chrome-driver/invoke-cli-handlers.test.ts` | Create — handler behavior tests with fake driver |
| `test/macos-chrome-driver/invoke-runtime-allowlist.test.ts` | Create — allowlist/dry-run tests |
| `test/cli-parse.test.ts` | Create — CLI parser tests |

---

## Task 1: Atomic Types

**Files:**
- Create: `src/computer-use/macos-chrome-driver/atomic-types.ts`
- Test: `test/macos-chrome-driver/atomic-recognition.test.ts`

- [ ] **Step 1: Add atomic type definitions**

Create `src/computer-use/macos-chrome-driver/atomic-types.ts`:

```ts
import type { ArtifactRef, RecognitionBox } from './types.js'

export interface AtomicMatch {
  kind: string
  text: string
  box: RecognitionBox
  confidence: number
  logicalPoint: { x: number, y: number }
  matchIndex: number
  detail?: Record<string, unknown>
}

export interface AtomicFindResult {
  found: boolean
  recognitionId: string
  matchCount: number
  best?: AtomicMatch
  matches: AtomicMatch[]
  evidence: ArtifactRef[]
  knownLimits: string[]
}

export interface AtomicClickResult {
  clicked: AtomicMatch & {
    anchorOffset: { x: number, y: number }
  }
  evidence: ArtifactRef[]
  knownLimits: string[]
}

export interface AtomicRowsResult {
  found: boolean
  recognitionId: string
  rowCount: number
  rows: AtomicMatch[]
  evidence: ArtifactRef[]
  knownLimits: string[]
}

export interface AtomicTypeTextResult {
  typed: {
    textLength: number
    submitKey: string | null
  }
  evidence: ArtifactRef[]
  knownLimits: string[]
}

export interface AtomicKeyResult {
  pressed: {
    key: string
    modifiers: string[]
  }
  evidence: ArtifactRef[]
  knownLimits: string[]
}

export interface AtomicScrollRegionResult {
  scrolled: {
    direction: string
    amount: number
    logicalPoint: { x: number, y: number }
    region: { left: number, top: number, right: number, bottom: number }
  }
  evidence: ArtifactRef[]
  knownLimits: string[]
}
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm run typecheck
```

Expected: pass, or fail only on missing exports introduced by later tasks.

---

## Task 2: Source-Specific Recognition Helpers

**Files:**
- Create: `src/computer-use/macos-chrome-driver/atomic-recognition.ts`
- Modify: `src/computer-use/macos-chrome-driver/recognition.ts`
- Test: `test/macos-chrome-driver/atomic-recognition.test.ts`

- [ ] **Step 1: Write tests for no-match and coordinate projection**

Create `test/macos-chrome-driver/atomic-recognition.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { matchAtomicItems, projectPixelBoxToLogicalMatch } from '../../src/computer-use/macos-chrome-driver/atomic-recognition.js'
import type { ChromeCaptureContract, RecognizedItem } from '../../src/computer-use/macos-chrome-driver/types.js'

const contract: ChromeCaptureContract = {
  coordinateContractVersion: 1,
  captureSource: { kind: 'window', windowNumber: 10, ownerPid: 123, ownerBundleId: 'com.google.Chrome' },
  sourceGlobalLogicalBounds: { x: 100, y: 200, width: 500, height: 300 },
  screenshotPixelSize: { width: 1000, height: 600 },
  pixelToLogicalScale: { x: 0.5, y: 0.5 },
  logicalToPixelScale: { x: 2, y: 2 },
  capturedAt: '2026-06-20T00:00:00.000Z',
}

describe('atomic recognition helpers', () => {
  it('returns completed-style no-match data without throwing', () => {
    const items: RecognizedItem[] = [{
      item_id: 'ocr_0',
      kind: 'ocr_text',
      text: 'Other',
      box: { x: 1, y: 1, width: 10, height: 10 },
      provider_score: 0.9,
      detail: {},
    }]

    const result = matchAtomicItems(items, { kind: 'ocr_text', text: 'LangChain' })

    expect(result.found).toBe(false)
    expect(result.matchCount).toBe(0)
    expect(result.matches).toEqual([])
  })

  it('projects OCR pixel bounds to global logical coordinates exactly once', () => {
    const match = projectPixelBoxToLogicalMatch({
      kind: 'ocr_text',
      text: 'LangChain',
      confidence: 0.9,
      matchIndex: 0,
      pixelBox: { x: 20, y: 40, width: 100, height: 60 },
      contract,
    })

    expect(match.box).toEqual({ x: 110, y: 220, width: 50, height: 30 })
    expect(match.logicalPoint).toEqual({ x: 135, y: 235 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run test/macos-chrome-driver/atomic-recognition.test.ts
```

Expected: fail because `atomic-recognition.ts` does not exist.

- [ ] **Step 3: Implement pure helpers**

Create `src/computer-use/macos-chrome-driver/atomic-recognition.ts`:

```ts
import type { AtomicFindResult, AtomicMatch } from './atomic-types.js'
import type { Bounds } from '../types.js'
import type { ChromeCaptureContract, ChromeRecognitionTarget, RecognizedItem, RecognitionBox } from './types.js'

export function matchAtomicItems(
  items: RecognizedItem[],
  target: ChromeRecognitionTarget,
  evidence = [],
  knownLimits: string[] = [],
): AtomicFindResult {
  const matches = items
    .filter(item => itemMatchesTarget(item, target))
    .sort(compareAtomicItem)
    .map((item, matchIndex): AtomicMatch => {
      const point = centerOf(item.box)
      return {
        kind: item.kind,
        text: item.text ?? '',
        box: item.box,
        confidence: item.provider_score ?? 0,
        logicalPoint: point,
        matchIndex,
        detail: item.detail,
      }
    })

  return {
    found: matches.length > 0,
    recognitionId: `atomic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    matchCount: matches.length,
    best: matches[0],
    matches,
    evidence,
    knownLimits,
  }
}

export function projectPixelBoxToLogicalMatch(input: {
  kind: string
  text: string
  confidence: number
  matchIndex: number
  pixelBox: Bounds
  contract: ChromeCaptureContract
  detail?: Record<string, unknown>
}): AtomicMatch {
  const box = projectPixelBoxToLogical(input.pixelBox, input.contract)
  return {
    kind: input.kind,
    text: input.text,
    box,
    confidence: input.confidence,
    logicalPoint: centerOf(box),
    matchIndex: input.matchIndex,
    detail: {
      ...input.detail,
      rawPixelBox: input.pixelBox,
    },
  }
}

export function projectPixelBoxToLogical(
  box: Bounds,
  contract: ChromeCaptureContract,
): RecognitionBox {
  return {
    x: contract.sourceGlobalLogicalBounds.x + box.x * contract.pixelToLogicalScale.x,
    y: contract.sourceGlobalLogicalBounds.y + box.y * contract.pixelToLogicalScale.y,
    width: box.width * contract.pixelToLogicalScale.x,
    height: box.height * contract.pixelToLogicalScale.y,
  }
}

function centerOf(box: RecognitionBox): { x: number, y: number } {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  }
}

function itemMatchesTarget(item: RecognizedItem, target: ChromeRecognitionTarget): boolean {
  const text = item.text ?? ''
  const query = 'name' in target ? target.name : target.text
  const kindOk = target.kind === 'visible_text'
    ? item.kind === 'ocr_text'
    : target.kind === 'ocr_row'
      ? item.kind === 'ocr_row'
      : target.kind === 'ocr_text'
        ? item.kind === 'ocr_text'
        : target.kind === 'text_input'
          ? item.kind.includes('textbox') || item.kind.includes('textfield') || item.kind.includes('textarea') || item.kind.includes('searchbox')
          : target.kind === 'button'
            ? item.kind.includes('button')
            : target.kind === 'link'
              ? item.kind.includes('link')
              : false
  if (!kindOk)
    return false
  if (query instanceof RegExp)
    return query.test(text)
  return text.toLowerCase().includes(String(query).toLowerCase())
}

function compareAtomicItem(a: RecognizedItem, b: RecognizedItem): number {
  const score = (b.provider_score ?? 0) - (a.provider_score ?? 0)
  if (score !== 0)
    return score
  const dy = a.box.y - b.box.y
  return dy !== 0 ? dy : a.box.x - b.box.x
}
```

- [ ] **Step 4: Run test**

Run:

```bash
pnpm vitest run test/macos-chrome-driver/atomic-recognition.test.ts
```

Expected: pass.

---

## Task 3: Atomic Command Adapter

**Files:**
- Create: `src/computer-use/macos-chrome-driver/atomic-commands.ts`
- Modify: `src/computer-use/macos-chrome-driver/driver.ts`
- Test: `test/macos-chrome-driver/invoke-cli-handlers.test.ts`

- [ ] **Step 1: Add command adapter interface**

Create `src/computer-use/macos-chrome-driver/atomic-commands.ts` with the exported interface. The method names intentionally match AUV command boundaries:

```ts
import type {
  AtomicClickResult,
  AtomicFindResult,
  AtomicKeyResult,
  AtomicRowsResult,
  AtomicScrollRegionResult,
  AtomicTypeTextResult,
} from './atomic-types.js'

export interface MacOSChromeAtomicCommands {
  findText: (input: { query: string }) => Promise<AtomicFindResult>
  clickText: (input: { query: string, matchIndex?: number, anchorOffsetX?: number, anchorOffsetY?: number }) => Promise<AtomicClickResult>
  findRows: (input: { query?: string }) => Promise<AtomicRowsResult>
  clickRow: (input: { query?: string, rowIndex: number }) => Promise<AtomicClickResult>
  focusText: (input: { query: string }) => Promise<AtomicClickResult>
  axFocusText: (input: { query: string }) => Promise<AtomicClickResult>
  pressButton: (input: { query: string }) => Promise<AtomicClickResult>
  axPressButton: (input: { query: string }) => Promise<AtomicClickResult>
  typeText: (input: { text: string, submitKey?: string }) => Promise<AtomicTypeTextResult>
  key: (input: { key: string, modifiers?: string[] }) => Promise<AtomicKeyResult>
  scrollRegion: (input: { direction?: string, amount?: number, region?: { left: number, top: number, right: number, bottom: number } }) => Promise<AtomicScrollRegionResult>
}
```

- [ ] **Step 2: Add live adapter construction point**

At the top of `atomic-commands.ts`, add the constructor input type that later tasks use when they add real methods:

```ts
import type { ComputerUseConfig } from '../config.js'

export interface LiveMacOSChromeAtomicCommandInput {
  config: ComputerUseConfig
  sessionId: string
  runId: string
}
```

Do not create a class with throwing methods. The live adapter class is introduced in Task 4 with `findText`, then extended by later tasks as each real method lands.

- [ ] **Step 3: Wire driver to expose atomic adapter after Task 4**

Add the `atomicCommands` getter after Task 4 creates `LiveMacOSChromeAtomicCommands`. Do not route the adapter through existing driver action methods.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm run typecheck
```

Expected: pass after the interface is added.

---

## Task 4: Text OCR Commands

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/atomic-commands.ts`
- Test: `test/macos-chrome-driver/atomic-recognition.test.ts`

- [ ] **Step 1: Implement `findText` using one capture and one OCR**

Implementation requirements:

- Resolve managed Chrome window with the same lower-level context logic used by the driver, not by calling `driver.observe()`.
- Capture with `captureChromeWindow`.
- Run `recognizeTextInImage` once with `query`.
- Convert OCR pixel bounds to logical bounds using `projectPixelBoxToLogicalMatch`.
- Record screenshot and capture contract artifacts when a trace sink is available.
- Return completed no-match results instead of throwing.
- Do not accept or consume `matchIndex`; `findText` returns all matches. `matchIndex` belongs to `clickText`.

The result must contain same-command evidence refs for screenshot and capture contract.

- [ ] **Step 2: Add test for no-match status at handler level**

In `test/macos-chrome-driver/invoke-cli-handlers.test.ts`, fake `findText` returns `found: false`. Assert `chrome.findText` handler returns `status: 'completed'`, `output.found === false`, and no `failure`.

- [ ] **Step 3: Run tests**

Run:

```bash
pnpm vitest run test/macos-chrome-driver/atomic-recognition.test.ts test/macos-chrome-driver/invoke-cli-handlers.test.ts
```

Expected: pass.

---

## Task 5: Text Click Command

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/atomic-commands.ts`
- Test: `test/macos-chrome-driver/invoke-cli-handlers.test.ts`

- [ ] **Step 1: Implement `clickText` without driver-level liveness**

Implementation requirements:

- Perform its own capture/OCR by using the same internal helper as `findText`.
- Select `matchIndex` from the fresh match list.
- Apply `anchorOffsetX` / `anchorOffsetY` in logical coordinate space.
- Check the click point is inside the resolved Chrome window from the same capture context.
- Click with `executeMoveAndClick`.
- Do not call `driver.click()`, `driver.observe()`, or driver-level `recognizeFromCapture()`.

- [ ] **Step 2: Add handler tests**

Fake driver behavior:

```ts
clickText: async input => ({
  clicked: {
    kind: 'ocr_text',
    text: input.query,
    box: { x: 10, y: 20, width: 30, height: 10 },
    confidence: 0.9,
    logicalPoint: { x: 25, y: 25 },
    matchIndex: input.matchIndex ?? 0,
    anchorOffset: { x: input.anchorOffsetX ?? 0, y: input.anchorOffsetY ?? 0 },
  },
  evidence: [{ run_id: 'run_test', artifact_id: 'artifact_screenshot', span_id: 'span_test' }],
  knownLimits: [],
})
```

Assert:

- `--match_index 1` is parsed as number `1`.
- `--anchor_offset_x 8` and `--anchor_offset_y -2` are parsed as numbers.
- command output includes `clicked.matchIndex === 1`.

- [ ] **Step 3: Run tests**

Run:

```bash
pnpm vitest run test/macos-chrome-driver/invoke-cli-handlers.test.ts
```

Expected: pass.

---

## Task 6: Row Commands

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/atomic-commands.ts`
- Test: `test/macos-chrome-driver/invoke-cli-handlers.test.ts`

- [ ] **Step 1: Implement `findRows`**

Implementation requirements:

- Capture Chrome window once.
- OCR once.
- Call `produceOcrRows({ textSnapshot: ocr })`.
- Convert row pixel bounds to logical boxes.
- Optional `query` filters rows whose joined fragments contain the query. This is a CDS extension; AUV `find_window_rows` returns all rows.
- No rows is `status: completed` at handler level.

- [ ] **Step 2: Implement `clickRow`**

Implementation requirements:

- Capture once.
- OCR once.
- Produce rows from the same OCR snapshot.
- Apply optional text filter. This is a CDS extension over AUV row commands.
- Use 1-based `rowIndex`, matching AUV user-facing behavior.
- Click row center with `executeMoveAndClick`.

- [ ] **Step 3: Add row handler tests**

Assert:

- `chrome.findRows` no rows returns `completed`.
- `chrome.clickRow --row_index 2` passes `rowIndex: 2`.
- `row_index` values below 1 return invalid input.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm vitest run test/macos-chrome-driver/invoke-cli-handlers.test.ts
```

Expected: pass.

---

## Task 7: Text Focus Commands

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/atomic-commands.ts`
- Test: `test/macos-chrome-driver/invoke-cli-handlers.test.ts`

- [ ] **Step 1: Implement `focusText`**

Implementation requirements:

- Resolve managed Chrome.
- Capture AX tree once with `captureAXTree`.
- Match text-input AX nodes by query.
- Click center with `executeMoveAndClick`.
- Return AX report evidence.

- [ ] **Step 2: Implement `axFocusText`**

Implementation requirements:

- Resolve managed Chrome.
- Capture AX tree once.
- Match text-input AX nodes by query.
- Use an AX-focused-attribute helper. If no existing helper exists in CDS, add a narrow Swift helper for setting AX focus by PID/path/role.
- Do not click pointer in `axFocusText`.
- Return whether focus was set and whether the target was already focused.

- [ ] **Step 3: Add handler tests**

Assert:

- Missing `--query` is invalid input.
- `chrome.focusText --query Search` calls `atomic.focusText({ query: 'Search' })`.
- `chrome.axFocusText --query Search` calls `atomic.axFocusText({ query: 'Search' })`.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm vitest run test/macos-chrome-driver/invoke-cli-handlers.test.ts
```

Expected: pass.

---

## Task 8: Button Commands

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/atomic-commands.ts`
- Test: `test/macos-chrome-driver/invoke-cli-handlers.test.ts`

- [ ] **Step 1: Implement `pressButton`**

Implementation requirements:

- Resolve managed Chrome.
- Capture AX tree once.
- Match button-like AX node by query.
- Pointer click center.

- [ ] **Step 2: Implement `axPressButton`**

Implementation requirements:

- Resolve managed Chrome.
- Capture AX tree once.
- Match button-like AX node by query.
- Use AX press action.
- If AX press is not supported, fail with code `ax_press_unavailable`. Do not fall back to pointer click.

- [ ] **Step 3: Add handler tests**

Assert:

- Missing `--query` is invalid.
- `chrome.pressButton` calls pointer command adapter.
- `chrome.axPressButton` reports action failure when fake adapter throws `ax_press_unavailable`.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm vitest run test/macos-chrome-driver/invoke-cli-handlers.test.ts
```

Expected: pass.

---

## Task 9: Active-Control Keyboard Commands

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/atomic-commands.ts`
- Test: `test/macos-chrome-driver/invoke-cli-handlers.test.ts`

- [ ] **Step 1: Implement `typeText`**

Implementation requirements:

- Required input: `--text`.
- Optional input: `--submit_key`.
- Activate managed Chrome if needed, then call `executeTypeText` with empty pointer trace.
- If `submit_key` exists, call `executePressKeys` after text entry.
- Do not locate or focus any target.

- [ ] **Step 2: Implement `key`**

Implementation requirements:

- Required input: `--key`.
- Optional input: `--modifiers`, comma-separated.
- Activate managed Chrome if needed, then call `executePressKeys`.

- [ ] **Step 3: Add handler tests**

Assert:

- `chrome.typeText --text abc --submit_key return` calls `atomic.typeText({ text: 'abc', submitKey: 'return' })`.
- `chrome.typeText` does not accept `--query`; if supplied, handler returns invalid input explaining focus must be done by `chrome.focusText`.
- `chrome.key --key l --modifiers command,shift` parses modifiers as `['command', 'shift']`.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm vitest run test/macos-chrome-driver/invoke-cli-handlers.test.ts
```

Expected: pass.

---

## Task 10: Self-Contained Scroll Region

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/atomic-commands.ts`
- Test: `test/macos-chrome-driver/invoke-cli-handlers.test.ts`

- [ ] **Step 1: Implement `scrollRegion`**

Implementation requirements:

- Resolve managed Chrome window on every invocation.
- Parse `direction` as one of `up`, `down`, `left`, `right`; default `down`.
- Parse `amount`; default `6`.
- Parse region ratios `region_left`, `region_top`, `region_right`, `region_bottom`; default full window `{ left: 0, top: 0, right: 1, bottom: 1 }`.
- Compute region center from current window bounds.
- Use `executeWindowTargetedScroll` first if available; if it fails, use foreground HID scroll fallback and record fallback reason.
- Do not use `#scrollRegionLease` or `driver.scroll()`.

- [ ] **Step 2: Add handler tests**

Assert:

- Defaults are direction `down`, amount `6`, full region.
- Invalid direction returns invalid input.
- Region ratio outside `[0, 1]` returns invalid input.
- `left < right` and `top < bottom` are enforced.

- [ ] **Step 3: Run tests**

Run:

```bash
pnpm vitest run test/macos-chrome-driver/invoke-cli-handlers.test.ts
```

Expected: pass.

---

## Task 11: CLI Command Specs and Allowlist

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/invoke-catalog.ts`
- Test: `test/macos-chrome-driver/invoke-runtime-allowlist.test.ts`

- [ ] **Step 1: Add command specs**

Add command specs for:

```txt
chrome.findText
chrome.clickText
chrome.findRows
chrome.clickRow
chrome.focusText
chrome.axFocusText
chrome.pressButton
chrome.axPressButton
chrome.typeText
chrome.key
chrome.scrollRegion
```

Set namespaces and disturbance:

- `findText`, `findRows`: `namespace: 'observe'`, no page mutation, may activate Chrome.
- `clickText`, `clickRow`, `focusText`, `pressButton`, `scrollRegion`: `namespace: 'action'`, pointer disturbance.
- `axFocusText`, `axPressButton`: `namespace: 'action'`, keyboard/accessibility disturbance, no pointer disturbance.
- `typeText`, `key`: `namespace: 'action'`, keyboard disturbance.

- [ ] **Step 2: Export CLI allowlist**

```ts
export const CLI_COMPUTER_USE_COMMAND_IDS = Object.freeze([
  'chrome.observe',
  'chrome.checkSafetyGate',
  'chrome.findText',
  'chrome.clickText',
  'chrome.findRows',
  'chrome.clickRow',
  'chrome.focusText',
  'chrome.axFocusText',
  'chrome.pressButton',
  'chrome.axPressButton',
  'chrome.typeText',
  'chrome.key',
  'chrome.scrollRegion',
] as const)
```

- [ ] **Step 3: Add allowlist test**

Create `test/macos-chrome-driver/invoke-runtime-allowlist.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { invoke } from '../../src/computer-use/macos-chrome-driver/invoke-runtime.js'

describe('invoke runtime allowlist', () => {
  it('rejects non-CLI commands before dry-run succeeds', async () => {
    const result = await invoke(
      { commandId: 'chrome.promote', inputs: {}, dryRun: true },
      { allowedCommandIds: new Set(['chrome.findText']) },
    )

    expect(result.status).toBe('failed')
    expect(result.failure?.code).toBe('command_not_in_cli_surface')
  })
})
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm vitest run test/macos-chrome-driver/invoke-runtime-allowlist.test.ts
```

Expected: pass.

---

## Task 12: CLI Handlers

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/invoke-handlers.ts`
- Test: `test/macos-chrome-driver/invoke-cli-handlers.test.ts`

- [ ] **Step 1: Extend invoke driver interface**

Add:

```ts
import type { MacOSChromeAtomicCommands } from './atomic-commands.js'

export interface MacOSChromeInvokeDriver {
  readonly atomicCommands: MacOSChromeAtomicCommands
  // existing programmatic methods stay unchanged
}
```

- [ ] **Step 2: Add CLI handler registry**

Add `createMacOSChromeCLIHandlers(driver)` that registers only:

```txt
chrome.observe
chrome.checkSafetyGate
chrome.findText
chrome.clickText
chrome.findRows
chrome.clickRow
chrome.focusText
chrome.axFocusText
chrome.pressButton
chrome.axPressButton
chrome.typeText
chrome.key
chrome.scrollRegion
```

Handlers call `driver.atomicCommands.*` only for the new AUV-shaped commands.

- [ ] **Step 3: Input parsing rules**

Implement parser helpers:

- `requiredString(inputs, key)`
- `optionalInteger(inputs, key, defaultValue)`
- `optionalNumber(inputs, key, defaultValue)`
- `optionalRegion(inputs)`
- `optionalModifiers(inputs)`

Validation must produce `ComputerUseInvokeResult` with `status: 'failed'`, `failure.class: 'invalid_input'`, and a command-specific code.

- [ ] **Step 4: Handler result rules**

Use these status rules:

- `findText` no match: `completed`.
- `findRows` zero rows: `completed`.
- action target not found: `failed` with class `recognition` or `grounding`.
- safety refusal: `refused`.
- thrown driver/Swift errors: `failed`.

- [ ] **Step 5: Run handler tests**

Run:

```bash
pnpm vitest run test/macos-chrome-driver/invoke-cli-handlers.test.ts
```

Expected: pass.

---

## Task 13: Invoke Entry and Runtime Allowlist

**Files:**
- Modify: `src/computer-use/macos-chrome-driver/invoke-entry.ts`
- Modify: `src/computer-use/macos-chrome-driver/invoke-runtime.ts`
- Test: `test/macos-chrome-driver/invoke-runtime-allowlist.test.ts`

- [ ] **Step 1: Add `mode` to invoke entry options**

```ts
export interface MacOSChromeInvokeEntryOptions {
  driver?: MacOSChromeInvokeDriver
  driverOptions?: MacOSChromeDriverOptions
  mode?: 'cli' | 'programmatic'
  trace?: ComputerUseInvokeOptions['trace']
  now?: ComputerUseInvokeOptions['now']
}
```

When `mode === 'cli'`, use `createMacOSChromeCLIHandlers(driver)` and pass `allowedCommandIds: new Set(CLI_COMPUTER_USE_COMMAND_IDS)` to runtime.

- [ ] **Step 2: Add runtime allowlist gate**

In `invoke-runtime.ts`, check allowlist before `resolveComputerUseCommandSpec`:

```ts
if (options.allowedCommandIds && !options.allowedCommandIds.has(request.commandId)) {
  const result = runtimeFailureResult({
    commandId: request.commandId,
    summary: `Command ${request.commandId} is not exposed on the CLI surface.`,
    failureClass: 'invalid_input',
    code: 'command_not_in_cli_surface',
    message: `Command ${request.commandId} is not exposed on the CLI surface.`,
    signals: ['command_not_in_cli_surface'],
    knownLimits: ['cli_allowlist_rejected_command_before_resolution'],
  })
  trace?.endSpan(spanId, 'error', result.summary)
  return result
}
```

- [ ] **Step 3: Run tests**

Run:

```bash
pnpm vitest run test/macos-chrome-driver/invoke-runtime-allowlist.test.ts
```

Expected: pass.

---

## Task 14: CLI Entry

**Files:**
- Create: `src/cli.ts`
- Modify: `package.json`
- Test: `test/cli-parse.test.ts`

- [ ] **Step 1: Export parser for tests**

Create `src/cli.ts` with a pure `parseCliArgs(argv)` export and a `main()` runner. The parser must:

- require first arg `invoke`.
- support `cds invoke --help`.
- support `cds invoke <command-id> --help`.
- parse `--dry-run` as boolean.
- parse `--target managed`.
- reject any dotted key containing `.`.
- store all other flags in `inputs`.

- [ ] **Step 2: Add parser tests**

Create `test/cli-parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../src/cli.js'

describe('parseCliArgs', () => {
  it('parses flat invoke inputs', () => {
    const parsed = parseCliArgs(['invoke', 'chrome.clickText', '--query', 'LangChain', '--match_index', '1'])

    expect(parsed).toEqual({
      commandId: 'chrome.clickText',
      target: undefined,
      inputs: { query: 'LangChain', match_index: '1' },
      dryRun: false,
      help: false,
    })
  })

  it('rejects dotted keys', () => {
    expect(() => parseCliArgs(['invoke', 'chrome.clickText', '--target.query', 'x'])).toThrow(/dotted/i)
  })
})
```

- [ ] **Step 3: Package script**

Current `tsconfig.json` has `"noEmit": true`, so do not add a `bin` field pointing to missing `dist/cli.js`. Add a script instead:

```json
{
  "scripts": {
    "cds": "tsx src/cli.ts"
  }
}
```

Users run:

```bash
pnpm cds invoke chrome.findText --query "LangChain"
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm vitest run test/cli-parse.test.ts
pnpm run typecheck
```

Expected: pass.

---

## Task 15: CLI Guide

**Files:**
- Create: `docs/cds-cli-guide.md`

- [ ] **Step 1: Write command guide**

Create `docs/cds-cli-guide.md` with:

````md
# CDS CLI — Computer-Use Tool Reference

`cds` is a one-command-per-invocation tool. Each action re-resolves the current managed Chrome window. Do not rely on hidden state from a prior invocation.

## Text

```bash
pnpm cds invoke chrome.findText --query "LangChain"
pnpm cds invoke chrome.clickText --query "LangChain" --match_index 0
```

## Rows

```bash
pnpm cds invoke chrome.findRows --query "Result"
pnpm cds invoke chrome.clickRow --query "Result" --row_index 1
```

## Text Input

```bash
pnpm cds invoke chrome.focusText --query "Search"
pnpm cds invoke chrome.typeText --text "AI agent London" --submit_key return
```

`chrome.typeText` types into the active control. It does not search for a target. Use `chrome.focusText` or `chrome.axFocusText` first when focus is needed.

## Buttons

```bash
pnpm cds invoke chrome.pressButton --query "Submit"
pnpm cds invoke chrome.axPressButton --query "Submit"
```

## Keyboard

```bash
pnpm cds invoke chrome.key --key return
pnpm cds invoke chrome.key --key l --modifiers command
```

## Scroll

```bash
pnpm cds invoke chrome.scrollRegion --direction down --amount 6
```

## Anti-Patterns

- Do not chain `chrome.recognize -> chrome.promote -> chrome.clickCandidate` through the CLI.
- Do not use `chrome.typeText --query ...`; focus and type are separate commands.
- Do not use dotted flags such as `--target.kind`.
- Do not assume `findText` stores anything for `clickText`.
````

- [ ] **Step 2: Commit docs**

Run:

```bash
git add docs/cds-cli-guide.md
git commit -m "docs: add CDS CLI user guide"
```

---

## Verification

Run all checks:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
```

Manual smoke tests on macOS with managed Chrome available:

```bash
pnpm cds invoke chrome.findText --query "Search"
pnpm cds invoke chrome.focusText --query "Search"
pnpm cds invoke chrome.typeText --text "AI agent London" --submit_key return
pnpm cds invoke chrome.scrollRegion --direction down --amount 6
```

Expected:

- `findText` returns completed even when no match exists.
- `clickText` and `clickRow` perform one fresh capture/OCR cycle each.
- `typeText` does not require a prior same-process focus lease.
- `scrollRegion` works without a prior `observe`.
- CLI help lists only the CLI allowlist commands.

---

## Self-Review Checklist

- [ ] No `chrome.find`, `chrome.click`, or `chrome.type` generic facade remains in Feature 1.
- [ ] No CLI handler calls stateful programmatic command methods.
- [ ] No OCR result is projected twice.
- [ ] No AX path uses `null as any` for a capture contract.
- [ ] `findText` and `findRows` no-match cases are completed observations.
- [ ] OCR/AX commands produce same-command evidence artifacts.
- [ ] `scrollRegion` does not consume `latestObservation` or `#scrollRegionLease`.
