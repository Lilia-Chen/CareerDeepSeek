# P2 AUV Alignment — Design Spec

**Status:** Draft
**Date:** 2026-06-19
**Scope:** Four features to close the remaining AUV alignment gap

---

## Implementation Order

1. **CLI Encapsulation** — smallest scope, blocks nothing, immediately prevents script-based workflows
2. **CLI User Guide** — ships with CLI so agents understand it's a tool, not a workflow
3. **Trace Inspection** — must align with AUV's inspect/inspect_server for self-diagnosis
4. **Chrome App Profile** — region tagging and filtering, depends on solid CLI + trace foundation

---

## Feature 1: CLI Encapsulation

### Goal

Add a CLI entry point `cds invoke <command-id> [--input key=value ...] [--dry-run]` that executes one command, prints JSON result to stdout, and exits. No workflow composition. Aligned with AUV's `auv-cli invoke <command-id>`.

### Problem

CDS has only programmatic invoke (`createMacOSChromeInvokeEntry().invoke()`). Coding agents import the API and write scripts, hardcoding workflows into TypeScript loops.

### Architecture

```
src/cli.ts                      ← NEW: CLI entry point
package.json                    ← MODIFIED: add "cds" bin entry
```

### CLI Contract

```
cds invoke <command-id> [--input key=value ...] [--dry-run] [--profile path]

Exit codes:
  0 — command completed
  1 — command failed or refused
  2 — invalid input

stdout: JSON result { commandId, status, summary, output?, failure?, knownLimits }
```

### Examples

```bash
cds invoke chrome.observe
cds invoke chrome.recognize --input target.kind=text_input --input target.name=Search
cds invoke chrome.promote
cds invoke chrome.clickCandidate --input candidateLocalId=mcr_xxx
cds invoke chrome.scroll --input deltaY=-600
cds invoke chrome.typeText --input text="AI agent London"
```

### Key Decisions

1. One command per invocation — composition is the agent's responsibility
2. JSON on stdout — machine-parseable
3. Profile as optional flag — defaults to `./.computer-use/profile.json`
4. All inputs via `--input key=value` — no positional arguments
5. `--dry-run` validates command resolution without executing

### Non-Goals

- No shell scripting support
- No workflow composition (no `cds workflow run`)
- No interactive mode
- No multi-command batching

### AUV Reference

`auv/src/cli.rs` — `parse_invoke()` parses `invoke <command-id> [--target ...] [--dry-run]`.  
`auv/src/main.rs` — `CliCommand::Invoke { request, inspect }` constructs `Runtime::invoke(request)`.

---

## Feature 2: CLI User Guide

### Goal

A single document that tells any agent: CDS is a tool, one command per invocation, follow the action loop, don't script.

### Format

`docs/cds-cli-guide.md` — covers command reference, common patterns, anti-patterns, trace reading.

### Content Outline

```markdown
# CDS CLI — Computer-Use Tool Reference

## What CDS Is
cds is a single-command tool for browser computer-use. Each invocation does
exactly one thing. cds is NOT a workflow engine. Do NOT write scripts.

## The Action Loop
observe → recognize → promote → action → observe
Each command returns JSON. Read output before deciding next command.

## Command Reference
chrome.observe | chrome.recognize | chrome.promote |
chrome.clickCandidate | chrome.scroll | chrome.focusTextInput |
chrome.typeText | chrome.pressKey | chrome.checkSafetyGate

## Common Patterns
- Search on Google
- Click a search result
- Scroll to see more content

## Anti-Patterns
- Do NOT script cds in loops
- Do NOT hardcode URLs or search queries
- Do NOT skip observe between actions
- Do NOT assume scroll succeeded without observing
- Do NOT promote before recognize

## Reading Trace Output
How to use `cds inspect <run-id>` to debug failures.
```

---

## Feature 3: Trace Inspection

### Goal

Replace `trace-visual-report.ts` with an inspect system that produces structured lineage records per artifact role, validates artifact completeness on read, automatically flags common failure patterns, and serves an interactive web viewer. Aligned with AUV's `inspect` + `inspect_server`.

### Problem

CDS's `trace-visual-report.ts` generates static HTML showing command_count and artifact counts. It cannot answer: "why did scroll not move the page?", "what item was refused by promotion?", "which action clicked the address bar instead of the page?"

### Architecture

```
src/computer-use/macos-chrome-driver/inspect.ts       ← NEW: lineage extraction
src/computer-use/macos-chrome-driver/inspect-server.ts ← NEW: HTTP server
src/computer-use/macos-chrome-driver/inspect-viewer.html ← NEW: SPA viewer
src/computer-use/macos-chrome-driver/inspect-cli.ts    ← NEW: cds inspect CLI
```

Delete: `trace-visual-report.ts`

### Lineage Records

| Artifact Role | Lineage Type | Key Fields |
|---|---|---|
| `observation-snapshot` | ObservationLineage | snapshot_id, source, node_count, region_tag_counts, known_limits |
| `recognition-result` | RecognitionLineage | recognition_id, target_kind, target_text, best_item_kind, best_item_text, best_item_box, filtered_count, found |
| `promoted-candidate` | PromotionLineage | candidate_local_id, kind, label, grounding, box, refusal_reasons |
| `action-execution` | ActionLineage | action_type, executed, refused, refusal_reasons, click_point, liveness_recheck, scroll_region |

### Self-Diagnosis Flags

- `promotion_refused` — what item, what reason, what target
- `scroll_no_visible_change` — consecutive screenshots with near-identical viewport OCR text
- `clicked_browser_chrome` — click point in tab/address bar y-range
- `focus_on_address_bar` — focusTextInput on element matching address bar AX role/label

### Inspect Server

```
GET  /                 ← SPA viewer
GET  /runs             ← JSON list of all runs
GET  /runs/:run_id     ← JSON run + lineage records
GET  /runs/:run_id/events
GET  /runs/:run_id/artifacts/:id  ← raw artifact file
```

### Inspect CLI

```
cds inspect <run-id>         ← text dump to stdout
cds inspect serve [--port]   ← start web viewer
```

### Key Decisions

1. Lineage records are read-side only — no write-side changes to trace-store.ts
2. Self-diagnosis flags common failure patterns automatically
3. Interactive single-file HTML viewer, no build step
4. Screenshot bounding box overlays show where clicks/scrolls landed

### Non-Goals

- No live WebSocket streaming (AUV has this, can add later)
- No write endpoints (read-only viewer)
- No multi-run comparison

### AUV Reference

`auv/src/inspect.rs` — `inspect_run()` text dump with lineage records.  
`auv/src/inspect_server/mod.rs` — HTTP/WS server with SPA viewer (3508 lines).  
`auv/src/run_read.rs` — lineage extraction from artifact roles (2924 lines).  
`auv/src/recorded_operation.rs` — per-operation metadata capture.

---

## Feature 4: Chrome App Profile — Region Tagging

### Goal

Add per-node region tagging (`chrome_tab_bar` / `chrome_address_bar` / `chrome_bookmark_bar` / `page_viewport`) to observe, and optional region filtering to recognize. Eliminate hardcoded pixel thresholds and role-based node deletion.

### Architecture

```
chrome-app-profile.ts          ← NEW: Chrome spatial structure knowledge
driver.ts (observe)            ← MODIFIED: tags each SurfaceNode with region
recognition.ts (matchesTarget) ← MODIFIED: optional region filter
types.ts                       ← MODIFIED: extend RecognitionSurface
invoke-handlers.ts             ← MODIFIED: forward region in parseRecognitionTarget
```

### Deletions

- `isBrowserChromeRole()` — replaced by region tag system
- `windowContentFallbackBounds()` — replaced by known_limit fallback
- `BROWSER_CHROME_FALLBACK_TOP_INSET = 96` — removed

### Key Decisions

1. AX is the primary structural source; no pixel thresholds
2. OCR is full-window; tab/address bar text get region tags, not deleted
3. Region filter is opt-in; default behavior unchanged
4. No node deletion
5. Known limits over false confidence

---

## Non-Goals (All Features)

- No tab transition handling
- No browser back/close/recovery
- No structural overlay dismissal
- No fixed company-search workflow
- No MCP/server/public command catalog expansion
- No multi-frame stability assessment (separate P2 feature)
- No artifact staging pipeline changes (separate P2 feature)
