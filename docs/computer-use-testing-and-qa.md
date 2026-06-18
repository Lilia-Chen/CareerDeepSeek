# Computer-Use Testing and QA

CareerDeepSeek separates deterministic engineering tests from agent-in-the-loop QA.

P0 computer-use work is scoped by `docs/computer-use-auv-scope-freeze.md`. The current target is a Chrome window driver. It is not a full AUV desktop driver and tests must not imply public command catalog parity.

P1.5.0 adds a planned internal programmatic invoke layer and primitive-first QA direction after scope reset. This does not mark invoke implementation complete, does not add a public command catalog, and does not weaken the P0/P1 frozen artifact and action contracts.

## Deterministic Tests

Deterministic tests live under `test/` and verify code contracts. They may assert:

- Type-level interfaces and exported APIs.
- P0/P1 harness transition contracts, such as `observe -> recognize -> promote -> act -> observe`, and P1.5 invoke contracts once implementation is authorized.
- Driver safety gates.
- Coordinate projection and candidate promotion rules.
- macOS event payload shape, including PID, window number, screen point, and window-local point.
- That forbidden action surfaces such as `open_url`, Playwright, CDP, or page-executed actions are not exposed.

Deterministic tests must not encode a company research workflow. They must not hardcode a Google or LinkedIn task and treat that as research quality. A passing unit test only proves the primitive contract is intact.

For P0B, deterministic tests should cover only the frozen contract slices:

- Chrome window capture contract payloads.
- `ArtifactRef` records for frozen P0 roles whose paths exist and parse.
- Kebab-case artifact roles: `screenshot`, `capture-contract`, `observation-snapshot`, `recognition-result`, `promoted-candidate`, `action-execution`.
- Frozen P0 roles are not metadata-only. P0B must not mark any artifact referenced by the frozen contract as metadata-only, and metadata-only roles can only be added by a later scope-freeze update.
- `action-execution` JSON payloads with `action_id`, `action_type`, `run_id`, `span_id`, candidate/ref, precondition result, executed/refused status, timestamp, and known limits.
- Pointer click actions must consume a traced `promoted-candidate` artifact produced by `driver.promoteCandidate()`. Tests must reject `candidate_ref:null` click success, even when the Chrome lease/profile/foreground/hard-stop gate passes.
- Missing promoted-candidate artifact ref is a hard refusal for click/pointer actions. Tests should assert `action-execution` is still written with `executed:false`, `refused:true`, `candidate_ref:null`, and `missing_promoted_candidate_artifact`.
- For `typeText`, `pressKey`, and `scroll`, `action-execution.candidate_ref` can be `null` only as the candidate artifact field because they are not candidate-click artifact consumers. This does not allow targetless input: P1.5 invoke requires audited promoted target focus/selection for `typeText` and `pressKey`, and a promoted scroll target / region for `scroll`.
- `ObservationSnapshot`, `RecognitionResult`, `SurfaceNode`, and `PromotedCandidate` shape and provenance.
- Chrome lease/profile/foreground/hard-stop action refusal.
- Harness sequencing: `observe -> recognize -> promote -> act -> observe`.

## Agent QA

Agent QA evaluates whether a workflow controller can use the primitives correctly on real pages. It is not a unit test.

Agent QA should check:

- The agent observes before acting.
- New primitive QA uses P1.5 programmatic invoke command sequences directly. Legacy harness tests cover adapter behavior only.
- Browser actions use promoted visible candidates, not raw coordinates.
- Scroll decisions are made from current page semantics and visible evidence.
- Search result collection scrolls and re-observes until enough evidence is collected or a stop condition is reached.
- Sponsored results and AI overview blocks are handled according to policy. Cookie and marketing dismissal remain legacy observed workflow behavior; P1.5 invoke productizes only hard-stop / safety signal exposure, not structural overlay detection or dismissal primitives.
- Research output answers the company-research objective instead of reporting only operation logs.

Agent QA may use a structured scenario brief and a human-readable rubric. It should produce a trace and a research result. It should not be implemented as a fixed script that bypasses the agent's semantic decisions.

## P1.5 Primitive QA

P1.5 QA is primitive-first and separate from research workflow QA.

Live primitive QA should output:

- command sequence, such as `chrome.observe -> chrome.recognize -> chrome.promote -> chrome.clickCandidate -> chrome.observe`
- trace root or run id
- relevant trace/artifact refs
- `visual_report` path, or an explicit reason when no report was generated
- status: `completed`, `failed`, or `refused`
- stable `failure_class` and `failure_code` when status is not `completed`
- known limits

The primitive QA report contract is:

```json
{
  "case_id": "primitive-click-candidate-delivery",
  "command_sequence": [
    "chrome.observe",
    "chrome.recognize",
    "chrome.promote",
    "chrome.clickCandidate",
    "chrome.observe"
  ],
  "trace_root": "path-or-run-id",
  "artifact_refs": [],
  "visual_report": "path-or-null",
  "visual_report_absent_reason": "reason-when-visual_report-is-null",
  "status": "completed|failed|refused",
  "failure_class": "candidate_provenance-or-null",
  "failure_code": "candidate_not_in_session-or-null",
  "known_limits": []
}
```

`failure_class` and `failure_code` must both be `null` when `status` is `completed`. They must both be stable non-empty values when `status` is `failed` or `refused`. When `visual_report` is `null`, `visual_report_absent_reason` is required.

The `visual_report` path is produced by the static visual trace report generator from an existing trace directory, for example `generateVisualTraceReport({ traceDir, outputDir })`. The generator writes QA files such as `visual-trace-report.json` and `visual-trace-report.html`; it does not append to `artifacts.jsonl`, does not create a trace artifact role, and does not define a workflow.

P1.5 action sequence expectations:

- click consumes a promoted candidate.
- scroll consumes a promoted scroll target / region.
- `typeText` and `pressKey` follow audited promoted target focus/selection in the same command sequence; for text inputs this means `chrome.focusTextInput` consumes a promoted `ax_node` candidate before keyboard input.
- driver liveness recheck remains mandatory and is not replaced by caller pre-action observation.
- caller post-action observation is explicit; action commands do not hide automatic post-observe.

QA scripts must not encode a fixed Google, LinkedIn, `gov.uk`, civil-service, or company-research workflow and treat that as research quality.

## Boundary

Unit tests answer: "Is this primitive implemented correctly?"

Agent QA answers: "Did the agent use the primitives intelligently and safely to complete the research workflow?"

Both are required. They are not interchangeable.

## Harness Boundary

`MacOSChromeDriver` is the low-level macOS Chrome primitive layer. It owns Chrome lease checks, capture, recognition, promotion, and OS-level input delivery.

`MacOSChromeAgentHarness` is a legacy / transition adapter under P1.5. It is not exported from the top-level computer-use entry and is not an approved primitive QA or workflow entry point. Remaining tests cover adapter behavior only:

- `observePage()`
- `clickObservedButton()`
- `clickObservedLink()`
- `typeIntoObservedInput()`
- `pressEnter()`
- `goBack()`

`pressEnter()` and `goBack()` refuse in P1.5. Browser recovery/back/close requires a P2 transition contract. Targetless scroll, structural overlay detection, and dismissible overlay dismissal primitives are P2 and are not harness helpers.

New primitive workflow and QA code must use the P1.5 programmatic invoke path. Legacy observation, legacy recognition, legacy candidate-promotion, legacy click, targetless scroll, and overlay dismissal APIs are removed from the approved entry surface; tests and workflow code must not reintroduce compatibility wrappers for them.

The harness must not decide research strategy. It must not hardcode Google, LinkedIn, or company-research workflows. The workflow controller still decides what page matters, which source to inspect, when evidence is enough, and what result to report.

## P0 Scope Boundary

The P0 testing target is contract correctness, not desktop feature breadth.

In scope:

- Chrome window capture and coordinate projection.
- Trace artifact role and payload discipline.
- Chrome-window `ObservationSnapshot` generation.
- Recognition and promotion against the latest Chrome capture.
- Action gate refusal when the Chrome lease/profile/foreground/hard-stop preconditions fail.
- Harness-level browser action sequencing.

Out of scope:

- AUV public command catalog parity.
- Legacy API compatibility tests.
- Full desktop display, screen, region, overlay, media, or domain workflows.
- OCR/AX/scroll business behavior beyond the frozen Chrome contract.
- Scroll-scan completeness, section detection, or generic list semantics.

Tests must fail if a workflow slice tries to add a legacy path or expand a frozen contract without updating the scope freeze first.
