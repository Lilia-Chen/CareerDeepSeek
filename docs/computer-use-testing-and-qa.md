# Computer-Use Testing and QA

CareerDeepSeek separates deterministic engineering tests from agent-in-the-loop QA.

P0 computer-use work is scoped by `docs/computer-use-auv-scope-freeze.md`. The current target is a Chrome window driver. It is not a full AUV desktop driver and tests must not imply public command catalog parity.

## Deterministic Tests

Deterministic tests live under `test/` and verify code contracts. They may assert:

- Type-level interfaces and exported APIs.
- Agent-facing harness contracts, such as `observe -> recognize -> promote -> act -> observe`.
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
- `typeText`, `pressKey`, and `scroll` may use `candidate_ref:null` because they are not candidate-click actions.
- `ObservationSnapshot`, `RecognitionResult`, `SurfaceNode`, and `PromotedCandidate` shape and provenance.
- Chrome lease/profile/foreground/hard-stop action refusal.
- Harness sequencing: `observe -> recognize -> promote -> act -> observe`.

## Agent QA

Agent QA evaluates whether a workflow controller can use the primitives correctly on real pages. It is not a unit test.

Agent QA should check:

- The agent observes before acting.
- Browser actions use `MacOSChromeAgentHarness` or equivalent registered semantic helpers, not ad hoc driver glue.
- Browser actions use promoted visible candidates, not raw coordinates.
- Scroll decisions are made from current page semantics and visible evidence.
- Search result collection scrolls and re-observes until enough evidence is collected or a stop condition is reached.
- Sponsored results, AI overview blocks, cookie prompts, and marketing overlays are handled according to policy.
- Research output answers the company-research objective instead of reporting only operation logs.

Agent QA may use a structured scenario brief and a human-readable rubric. It should produce a trace and a research result. It should not be implemented as a fixed script that bypasses the agent's semantic decisions.

## Boundary

Unit tests answer: "Is this primitive implemented correctly?"

Agent QA answers: "Did the agent use the primitives intelligently and safely to complete the research workflow?"

Both are required. They are not interchangeable.

## Harness Boundary

`MacOSChromeDriver` is the low-level macOS Chrome primitive layer. It owns Chrome lease checks, capture, recognition, promotion, and OS-level input delivery.

`MacOSChromeAgentHarness` is the agent-facing convenience layer. It owns repetitive glue only:

- `observePage()`
- `clickObservedButton()`
- `clickObservedLink()`
- `typeIntoObservedInput()`
- `pressEnter()`
- `scrollDown()` / `scrollUp()`
- `goBack()`
- `dismissKnownOverlay()`

Workflow code must use the AUV-aligned driver/harness path only. Legacy observation, legacy recognition, legacy candidate-promotion, and legacy click APIs are removed; tests and workflow code must not reintroduce compatibility wrappers for them.

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
