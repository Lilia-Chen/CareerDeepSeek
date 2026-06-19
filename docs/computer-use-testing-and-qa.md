# Computer-Use Testing and QA

CareerDeepSeek separates deterministic engineering tests from agent-in-the-loop QA.

## Deterministic Tests

Deterministic tests live under `test/` and verify code contracts. They may assert:

- Type-level interfaces and exported APIs.
- Primitive command contracts such as `observe -> recognize -> promote -> act -> observe`.
- Driver safety gates.
- Coordinate projection and candidate promotion rules.
- macOS event payload shape, including PID, window number, screen point, and window-local point.
- That forbidden action surfaces such as `open_url`, Playwright, CDP, or page-executed actions are not exposed.

Deterministic tests must not encode a company research workflow. They must not hardcode a Google or LinkedIn task and treat that as research quality. A passing unit test only proves the primitive contract is intact.

Deterministic tests for computer-use should cover:

- Chrome window capture contract payloads.
- `ArtifactRef` records whose paths exist and parse.
- Kebab-case artifact roles: `screenshot`, `capture-contract`, `observation-snapshot`, `recognition-result`, `promoted-candidate`, `action-execution`.
- `action-execution` JSON payloads with `action_id`, `action_type`, `run_id`, `span_id`, candidate/ref, precondition result, executed/refused status, timestamp, and known limits.
- Pointer click actions must consume a traced `promoted-candidate` artifact produced by `driver.promoteCandidate()`. Tests must reject `candidate_ref:null` click success, even when the Chrome lease/profile/foreground/hard-stop gate passes.
- Missing promoted-candidate artifact ref is a hard refusal for click/pointer actions. Tests should assert `action-execution` is still written with `executed:false`, `refused:true`, `candidate_ref:null`, and `missing_promoted_candidate_artifact`.
- For `typeText`, `pressKey`, and `scroll`, `action-execution.candidate_ref` can be `null` only as the candidate artifact field because they are not candidate-click artifact consumers. This does not allow targetless input: keyboard input requires audited target focus/selection, and scroll requires an observed Chrome scroll region lease.
- `ObservationSnapshot`, `RecognitionResult`, `SurfaceNode`, and `PromotedCandidate` shape and provenance.
- Chrome lease/profile/foreground/hard-stop action refusal.
- Harness sequencing: `observe -> recognize -> promote -> act -> observe`.

## Agent QA

Agent QA evaluates whether a workflow controller can use the primitives correctly on real pages. It is not a unit test.

Agent QA should check:

- The agent observes before acting.
- Primitive QA uses programmatic invoke command sequences directly.
- Browser actions use promoted visible candidates, not raw coordinates.
- Scroll decisions are made from current page semantics and visible evidence.
- Search result collection scrolls and re-observes until enough evidence is collected or a stop condition is reached.
- Research output answers the company-research objective instead of reporting only operation logs.

Agent QA may use a structured scenario brief and a human-readable rubric. It should produce a trace and a research result. It should not be implemented as a fixed script that bypasses the agent's semantic decisions.

## Primitive QA

Primitive QA is separate from research workflow QA.

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

Action sequence expectations:

- click consumes a promoted candidate.
- scroll consumes a latest observe-derived Chrome scroll region lease.
- `typeText` and `pressKey` follow audited promoted target focus/selection; for text inputs this means `chrome.focusTextInput` consumes a promoted text-input candidate before keyboard input.
- driver liveness recheck remains mandatory and is not replaced by caller pre-action observation.
- caller post-action observation is explicit; action commands do not hide automatic post-observe.

QA scripts must not encode a fixed Google, LinkedIn, `gov.uk`, civil-service, or company-research workflow and treat that as research quality.

## Boundary

Unit tests answer: "Is this primitive implemented correctly?"

Agent QA answers: "Did the agent use the primitives intelligently and safely to complete the research workflow?"

Both are required. They are not interchangeable.

## Boundary

`MacOSChromeDriver` is the low-level macOS Chrome primitive layer. It owns Chrome lease checks, capture, recognition, promotion, and OS-level input delivery.

Workflow code must not decide browser actions through fixed executable scripts. It should make semantic decisions from the current observation and then call primitives.
