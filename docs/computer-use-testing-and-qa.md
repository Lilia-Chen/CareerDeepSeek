# Computer-Use Testing and QA

CareerDeepSeek separates deterministic engineering tests from agent-in-the-loop QA.

## Deterministic Tests

Deterministic tests live under `test/` and verify code contracts. They may assert:

- Type-level interfaces and exported APIs.
- Single-command invoke contracts such as `findText`, `clickTarget`, `typeInput`, `key`, and `scrollRegion`.
- Driver safety gates.
- Coordinate projection and self-contained target resolution rules.
- macOS event payload shape, including PID, window number, screen point, and window-local point.
- That forbidden action surfaces such as `open_url`, Playwright, CDP, or page-executed actions are not exposed.

Deterministic tests must not encode a company research workflow. They must not hardcode a Google or LinkedIn task and treat that as research quality. A passing unit test only proves the primitive contract is intact.

Deterministic tests for computer-use should cover:

- Chrome window capture contract payloads.
- `ArtifactRef` records whose paths exist and parse.
- Kebab-case artifact roles such as `screenshot`, `capture-contract`, and `observation-snapshot`.
- Atomic command outputs for match count, selected match, coordinates, confidence, refusal code, and known limits.
- `findText` outputs related `SurfaceNode` context and cross-source audit evidence when OCR/AX/DOM data is available.
- Click/focus actions re-resolve their target from the current page in the same command invocation.
- Semantic foreground click tests cover OCR, AXTree, and Chrome DOM target evidence through `clickTarget`.
- `clickTarget --kind any` tests cover source-tier behavior: interactive AX role over actionable DOM over OCR-only text, with ambiguity when the highest tier has multiple candidates.
- `typeInput` resolves the input target, replaces the current field value, and types inside the same command invocation.
- `waitForText` tests preserve lightweight polling: OCR-only inside the loop, with AX/DOM normalization and audit only for the final result.
- `key` operates on the currently active control and does not accept hidden target refs from prior calls.
- `scrollRegion` resolves the current Chrome region inside the same command invocation.
- `ObservationSnapshot` and `SurfaceNode` shape and provenance.
- Chrome lease/profile/foreground/hard-stop refusal.
- Harness sequencing: one command per process invocation; post-action observation is explicit.

## Agent QA

Agent QA evaluates whether a workflow controller can use the primitives correctly on real pages. It is not a unit test.

Agent QA should check:

- The agent observes before acting.
- Primitive QA uses `cds invoke` or the single TypeScript invoke entry.
- Browser actions use visible target descriptions, not raw coordinates.
- Scroll decisions are made from current page semantics and visible evidence.
- Search result collection scrolls and re-observes until enough evidence is collected or a stop condition is reached.
- Research output answers the company-research objective instead of reporting only operation logs.

Agent QA may use a structured scenario brief and a human-readable rubric. It should produce a trace and a research result. It should not be implemented as a fixed script that bypasses the agent's semantic decisions.

## Primitive QA

Primitive QA is separate from research workflow QA.

Live primitive QA should output:

- command sequence, such as `chrome.observe -> chrome.clickTarget -> chrome.observe`
- trace root or run id
- relevant trace/artifact refs
- `visual_report` path, or an explicit reason when no report was generated
- status: `completed`, `failed`, or `refused`
- stable `failure_class` and `failure_code` when status is not `completed`
- known limits

The primitive QA report contract is:

```json
{
  "case_id": "primitive-click-text-delivery",
  "command_sequence": [
    "chrome.observe",
    "chrome.clickTarget",
    "chrome.observe"
  ],
  "trace_root": "path-or-run-id",
  "artifact_refs": [],
  "visual_report": "path-or-null",
  "visual_report_absent_reason": "reason-when-visual_report-is-null",
  "status": "completed|failed|refused",
  "failure_class": "not_found-or-null",
  "failure_code": "text_not_found-or-null",
  "known_limits": []
}
```

`failure_class` and `failure_code` must both be `null` when `status` is `completed`. They must both be stable non-empty values when `status` is `failed` or `refused`. When `visual_report` is `null`, `visual_report_absent_reason` is required.

The `visual_report` path is produced by the static visual trace report generator from an existing trace directory, for example `generateVisualTraceReport({ traceDir, outputDir })`. The generator writes QA files such as `visual-trace-report.json` and `visual-trace-report.html`; it does not append to `artifacts.jsonl`, does not create a trace artifact role, and does not define a workflow.

Action sequence expectations:

- `findText` is observe-only but returns enough node/audit context for the caller to choose the next action.
- click commands re-resolve target text and semantic target evidence atomically.
- scroll resolves the current Chrome region atomically.
- `typeInput` resolves the input target, replaces the current field value, and types inside the same command invocation.
- `key` operates on the active control.
- caller post-action observation is explicit; action commands do not hide automatic post-observe.

QA scripts must not encode a fixed Google, LinkedIn, `gov.uk`, civil-service, or company-research workflow and treat that as research quality.

## Boundary

Unit tests answer: "Is this primitive implemented correctly?"

Agent QA answers: "Did the agent use the primitives intelligently and safely to complete the research workflow?"

Both are required. They are not interchangeable.

## Boundary

`MacOSChromeDriver` is an internal macOS Chrome primitive layer. Public callers use the invoke entry and command ids; they do not import driver workflow methods.

Workflow code must not decide browser actions through fixed executable scripts. It should make semantic decisions from the current observation and then call primitives.
