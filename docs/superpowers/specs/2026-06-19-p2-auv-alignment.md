# P2 AUV Alignment — Design Spec

**Status:** Current architecture spec
**Date:** 2026-06-19
**Updated:** 2026-06-20 — Feature 1 now follows AUV-shaped regular UI command boundaries.

---

## Mode Decision

AUV has two invoke modes:

1. **Regular UI commands** — `window.findText`, `window.clickText`, `window.findRows`, `window.clickRow`, `input.focusText`, `input.axFocusText`, `input.typeText`, `input.key`, `window.scrollRegion`, `input.pressButton`, `input.axPressButton`. Each command is self-contained. The agent bridges calls by passing the target description again, such as `--query "Search"` or `--match_index 1`.
2. **Typed/domain commands** — `music.search.results -> music.result.play` and `recognition.read.ratio`. These consume `CandidateRef` / `recognition_ref` JSON and read `.auv/runs/<run_id>/artifacts.jsonl` plus artifact files. This is an explicit typed contract, not the bridge used by regular UI commands.

**Feature 1 implements mode 1 only.** Mode 2 is out of scope for P2.

Critical architectural point: AUV regular UI commands run lightweight single-purpose paths. `window.findText` captures once and OCRs once. `window.clickText` captures once, OCRs once, resolves the requested match, then clicks. `input.typeText` types into the active control and does not locate/focus the target. CDS must mirror those command boundaries. The CLI path must not compose the existing programmatic session workflow API (`observe() -> recognizeFromCapture() -> promoteCandidate() -> driver.click()`), because those methods carry full-observe overhead, handler closure state, and internal re-OCR/re-capture loops that do not exist in AUV regular commands.

Reference files:

- `auv/src/cli.rs:945-1013` — `parse_invoke()`: flat `--key value` grammar, `--target` is app id.
- `auv/src/runtime.rs:300-459` — `Runtime::invoke`: each invoke creates an independent run and calls one command handler.
- `auv/src/catalog.rs:485-492` — `window.findText`: observe command.
- `auv/src/catalog.rs:503-510` — `window.findRows`: observe command.
- `auv/src/catalog.rs:540-548` — `window.scrollRegion`: self-contained action command.
- `auv/src/catalog.rs:603-638` — `input.focusText`, `input.pressButton`, `input.axFocusText`: AX-based action commands.
- `auv/src/catalog.rs:657-683` — `input.typeText`, `input.key`: active-control keyboard commands.
- `auv/src/catalog.rs:729-745` — `window.clickText`, `window.clickRow`: self-contained pointer action commands.
- `auv/src/driver/macos/control/window_ocr.rs:86-146` — `find_window_text`: capture -> OCR -> matches, no promote.
- `auv/src/driver/macos/control/window_ocr.rs:239-426` — `click_window_text`: capture -> OCR -> `match_index` -> project -> click.
- `auv/src/driver/macos/control/window_ocr.rs:606-698` — `find_window_rows`: capture -> row detection.
- `auv/src/driver/macos/control/window_ocr.rs:839-957` — `click_window_row`: capture -> row detection -> `row_index` -> click.
- `auv/src/driver/macos/control/ax.rs:43-148` — `focus_text_input`: AX capture -> query/candidate resolve -> pointer focus.
- `auv/src/driver/macos/control/ax.rs:473-695` — `ax_focus_text_input`: AX capture -> AX focused attribute.
- `auv/src/driver/macos/control/text.rs:55-128` — `type_text`: type into active control only.
- `auv/src/driver/macos/control/region.rs:251-410` — `scroll_window_region`: resolve window/region on every invocation.
- `auv/src/driver/macos/control/music.rs:90-756` and `recognition_read.rs:38-115` — typed/domain artifact consumers, out of scope for Feature 1.

---

## Implementation Order

1. **Atomic Invoke Commands + CLI** — add AUV-shaped command handlers and lightweight driver primitives.
2. **Trace Inspection** — align with AUV inspect/inspect_server for command self-diagnosis.
3. **Chrome App Profile** — region tagging and filtering for managed Chrome.

---

## Feature 1: Atomic Invoke Commands + CLI

### Goal

Replace CDS's sequence-state-dependent invoke model with AUV-style self-contained regular UI commands. Each CLI command must complete one operation internally and must not depend on handler closure state from a previous command.

### Current CDS Problem

CDS's current programmatic invoke model depends on closure state:

```txt
chrome.recognize -> latestRecognition
chrome.promote -> promotedCandidates
chrome.clickCandidate -> promotedCandidates
chrome.focusTextInput -> promotedCandidates
chrome.typeText -> latestFocusedTarget
chrome.pressKey -> latestFocusedTarget
chrome.scroll -> latestObservation
```

Those variables are in `src/computer-use/macos-chrome-driver/invoke-handlers.ts`. They break CLI usage because each CLI invocation creates a new process/entry and therefore a new handler registry.

The existing driver methods are also too coarse for AUV-style atomic commands:

- `driver.observe()` captures screenshot + AX + DOM + OCR + OCR rows.
- `driver.recognizeFromCapture()` re-runs OCR and OCR rows, then reads `#lastObservation.nodes` for DOM/AX items.
- `driver.click()` calls `#recheckCandidateLiveness()`, which performs another full observe and recognition pass.
- `driver.focusTextInput()` has the same promoted-candidate liveness path.
- `driver.scroll()` depends on a scroll region lease created by `observe()`.

These methods remain valid for the backward-compatible programmatic API. They are not the implementation substrate for CLI regular UI commands.

### CLI Public Surface

Feature 1 exposes AUV-shaped command IDs:

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

Do not expose these stateful programmatic commands in CLI help or dry-run:

```txt
chrome.recognize
chrome.promote
chrome.clickCandidate
chrome.focusTextInput
chrome.pressKey
chrome.scroll
```

### Command Contracts

#### `chrome.findText`

```bash
cds invoke chrome.findText --query "LangChain"
```

Operation: resolve managed Chrome window -> capture screenshot -> OCR once -> filter matches. No promotion. No state stored.

No-match behavior: `status: "completed"` with `found: false`, `matchCount: 0`, and empty `matches`. Missing input, capture failure, or OCR failure are command failures.

Output includes:

```json
{
  "found": true,
  "matchCount": 2,
  "best": {
    "text": "LangChain",
    "box": { "x": 10, "y": 20, "width": 100, "height": 30 },
    "confidence": 0.93,
    "logicalPoint": { "x": 160.5, "y": 244.5 },
    "matchIndex": 0
  },
  "matches": []
}
```

Coordinates in output are global logical coordinates. Raw OCR pixel bounds may appear under `detail.rawPixelBox`, but must not be used as `box`.

#### `chrome.clickText`

```bash
cds invoke chrome.clickText --query "LangChain"
cds invoke chrome.clickText --query "LangChain" --match_index 1
cds invoke chrome.clickText --query "LangChain" --anchor_offset_x 8 --anchor_offset_y 0
```

Operation: resolve managed Chrome window -> capture screenshot -> OCR once -> select `match_index` -> project once -> apply optional anchor offset -> click.

`--anchor_offset_x` and `--anchor_offset_y` are capture-pixel offsets from the OCR match center. CDS projects the offset point to global logical screen coordinates inside the command.

The fresh capture and OCR pass are the liveness check. Do not promote. Do not call `driver.click()`. Do not call `driver.observe()` or driver-level `recognizeFromCapture()`.

#### `chrome.findRows`

```bash
cds invoke chrome.findRows
cds invoke chrome.findRows --query "Result"
```

Operation: resolve managed Chrome window -> capture screenshot -> OCR once -> group OCR text into rows. Zero rows is a completed observation.

`--query` is a CDS extension over AUV. AUV `find_window_rows` returns all rows; CDS may optionally filter rows containing the text for agent ergonomics.

#### `chrome.clickRow`

```bash
cds invoke chrome.clickRow --row_index 1
cds invoke chrome.clickRow --query "Result" --row_index 2
```

Operation: resolve managed Chrome window -> capture screenshot -> OCR once -> group rows -> optional text filter -> select `row_index` (1-based, aligned with AUV user-facing row index) -> click row anchor.

#### `chrome.focusText`

```bash
cds invoke chrome.focusText --query "Search"
```

Operation: resolve managed Chrome app/window -> capture AX tree -> resolve text-input AX node by query -> pointer click center. This matches AUV `input.focusText`.

#### `chrome.axFocusText`

```bash
cds invoke chrome.axFocusText --query "Search"
```

Operation: resolve managed Chrome app/window -> capture AX tree -> resolve text-input AX node by query -> set AX focused attribute. This matches AUV `input.axFocusText`. It should report whether AX focus succeeded and whether the real cursor moved.

#### `chrome.pressButton`

```bash
cds invoke chrome.pressButton --query "Submit"
```

Operation: resolve managed Chrome app/window -> capture AX tree -> resolve button-like AX node by query -> pointer click center.

#### `chrome.axPressButton`

```bash
cds invoke chrome.axPressButton --query "Submit"
```

Operation: resolve managed Chrome app/window -> capture AX tree -> resolve button-like AX node by query -> AX press action. If AX press is unavailable, fail with an explicit code; do not silently fall back to pointer click in this command.

#### `chrome.typeText`

```bash
cds invoke chrome.typeText --text "AI agent London"
cds invoke chrome.typeText --text "AI agent London" --submit_key return
```

Operation: optionally activate managed Chrome -> type into the active control. This command does not locate or focus a target. Agents should call `chrome.focusText` or `chrome.axFocusText` first when target focus is needed.

#### `chrome.key`

```bash
cds invoke chrome.key --key return
cds invoke chrome.key --key l --modifiers command
```

Operation: optionally activate managed Chrome -> press a key/shortcut in the active app.

#### `chrome.scrollRegion`

```bash
cds invoke chrome.scrollRegion --direction down --amount 6
cds invoke chrome.scrollRegion --direction up --amount 4 --region_top 0.2 --region_bottom 0.8
```

Operation: resolve managed Chrome window every invocation -> compute region center -> scroll. This command must not consume `latestObservation` or any scroll lease.

### CLI Grammar

Aligned to AUV `parse_invoke()`:

```txt
cds invoke <command-id> [--target managed] [--<key> <value> ...] [--dry-run] [--help]
cds invoke --help
cds invoke <command-id> --help
```

Rules:

- The top-level subcommand is required: `cds invoke ...`.
- `--target` accepts only `managed` in Feature 1. Arbitrary app bundle IDs are out of scope until the Chrome profile work lands.
- All other flags become a flat `Record<string, string>`.
- No dotted nesting. Use `--query`, `--row_index`, `--submit_key`, not `--target.query`.
- Numeric inputs stay strings until the handler parses them.
- `--dry-run` resolves the command spec and validates command visibility, but does not invoke the driver.

### Driver Boundary

Add lightweight command primitives to `MacOSChromeDriver` or a sibling command-adapter module. These primitives may use low-level helpers such as `captureChromeWindow`, `recognizeTextInImage`, `produceOcrRows`, `captureAXTree`, `executeMoveAndClick`, `executeTypeText`, `executePressKeys`, and `executeWindowTargetedScroll`.

They must not call:

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

The pure matcher in `src/computer-use/macos-chrome-driver/recognition.ts` may be reused only after it is split so AX-only recognition does not require a fake `ChromeCaptureContract`. Do not use `null as any` to force AX items through a capture-backed API.

### Evidence and Trace

Feature 1 does not introduce cross-command artifact refs, but every command should still record same-command evidence for inspection:

- screenshot artifact for screenshot/OCR commands.
- capture contract artifact for screenshot/OCR commands.
- OCR text or row report artifact for OCR commands.
- AX report artifact for AX commands.
- action result artifact or trace event for action commands.

Empty `evidence: []` is only acceptable for commands that truly produce no observable evidence, such as a simple key press. Text/row/AX commands must attach evidence.

### Non-Goals

- No daemon.
- No cross-command state bridge.
- No generic `CandidateRef` / `recognition_ref` consumer in Feature 1.
- No `chrome.find` / `chrome.click` / `chrome.type` generic facade in Feature 1. If a future CDS facade is added, it must be documented as a CDS-specific layer over AUV-shaped primitives, not as AUV alignment.
