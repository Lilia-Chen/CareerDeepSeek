# Computer-Use AUV Scope Freeze

Status: P0A/P0B freeze candidate for final P0 review.

CareerDeepSeek's P0 target is a Chrome window driver. It is not a full AUV desktop driver, not a public command catalog, and not a general desktop automation product.

## Source Baseline

Reviewed AUV sources:

- `auv/src/catalog.rs`
- `auv/src/driver/macos/dispatch.rs`
- `auv/src/contract.rs`
- `auv/src/driver/macos/capture/commands.rs`
- `auv/crates/auv-driver-macos/src/capture/types.rs`
- `auv/crates/auv-driver-macos/src/capture/artifact.rs`
- `auv/src/driver/macos/support/recognition.rs`
- `auv/src/driver/macos/control/window_ocr.rs`
- `auv/src/driver/macos/control/region.rs`
- `auv/src/driver/macos/control/ax.rs`
- `auv/src/scroll_scan/mod.rs`
- `auv/src/scroll_scan/observation.rs`
- `auv/crates/auv-driver/src/input.rs`

Reviewed CareerDeepSeek sources:

- `README.md`
- `docs/privacy-model.md`
- `docs/computer-use-testing-and-qa.md`
- `.opencode/skills/browser-use-policy/SKILL.md`
- `src/computer-use/macos-chrome-driver/*`

## Scope Freeze

### In Scope for P0

- Chrome window capture contract.
- `ObservationSnapshot`.
- `RecognitionResult`.
- `SurfaceNode`.
- `PromotedCandidate`.
- `ArtifactRef`.
- `TraceStore` payload rule.
- Chrome lease/profile/foreground/hard-stop action gate.
- Agent-facing Chrome workflow path through `MacOSChromeDriver` and `MacOSChromeAgentHarness`.

### Out of Scope for P0

- Public command catalog parity with AUV.
- Legacy API preservation or compatibility wrappers.
- Full AUV desktop driver.
- Domain/media/overlay productization.
- OCR, AX, or scroll business implementation beyond the contract slices listed below.
- AUV recipe runtime, public CLI, display/region/screen command namespace, media domain commands, overlay cursor system, or generalized scroll-scan controller.

### Deferred

- Human-readable capture contract text report.
- Full AUV reader-side artifact API-version rejection.
- General display and region capture.
- Generic list/section segmentation.
- AX press/focus productization.
- Scroll-scan completeness claims and boundary heuristics.
- Domain workflows that consume candidates, such as media/music examples.

## Capability Matrix

Status vocabulary is fixed: `already-present`, `missing`, `deferred`, `out-of-scope`, `in-scope`.

| Capability | AUV source | CareerDeepSeek target/current source | Inventory status | P0 scope |
| --- | --- | --- | --- | --- |
| Public command catalog | `src/catalog.rs` | No target | `missing` | `out-of-scope` |
| Legacy macOS desktop dispatch | `src/driver/macos/dispatch.rs` | No target | `missing` | `out-of-scope` |
| Capture contract JSON | `src/driver/macos/capture/commands.rs`, `crates/auv-driver-macos/src/capture/types.rs`, `crates/auv-driver-macos/src/capture/artifact.rs` | `src/computer-use/macos-chrome-driver/capture.ts`, `types.ts`, `driver.ts` | `already-present` | `in-scope` for Chrome window only |
| Capture contract text report | `crates/auv-driver-macos/src/capture/artifact.rs` | No P0 target | `missing` | `deferred` |
| Screenshot artifact role | `src/driver/macos/capture/commands.rs` | `src/computer-use/macos-chrome-driver/driver.ts` | `already-present` | `in-scope` |
| `ArtifactRef` | `src/contract.rs` | `src/computer-use/macos-chrome-driver/types.ts` | `already-present` | `in-scope` |
| `RecognitionResult` | `src/contract.rs`, `src/driver/macos/support/recognition.rs` | `src/computer-use/macos-chrome-driver/types.ts`, `recognition.ts` | `already-present` | `in-scope` |
| `SurfaceNode` | `src/contract.rs`, `src/scroll_scan/observation.rs` | `src/computer-use/macos-chrome-driver/types.ts`, `surface-node.ts` | `already-present` | `in-scope` |
| `ObservationSnapshot` | `src/contract.rs`, `src/scroll_scan/mod.rs`, `src/scroll_scan/observation.rs` | `src/computer-use/macos-chrome-driver/types.ts`, `driver.ts` | `already-present` | `in-scope` |
| Candidate promotion | `src/contract.rs`, `src/driver/macos/control/window_ocr.rs`, `src/driver/macos/control/ax.rs` | `src/computer-use/macos-chrome-driver/candidate-promotion.ts`, `types.ts`, `driver.ts` | `already-present` | `in-scope` |
| Input delivery result | `crates/auv-driver/src/input.rs` | No full-schema P0 target | `missing` | `deferred`; P0 uses hard-stop action gate only |
| AX action productization | `src/driver/macos/control/ax.rs` | No target | `missing` | `out-of-scope` |
| Chrome recognition primitives | `src/contract.rs`, `src/driver/macos/support/recognition.rs` | `src/computer-use/macos-chrome-driver/recognition.ts`, `driver.ts` | `already-present` | `in-scope` |
| AUV OCR row/window business commands | `src/driver/macos/control/window_ocr.rs`, `src/driver/macos/control/region.rs` | No target | `missing` | `out-of-scope` |
| Scroll scan controller | `src/scroll_scan/mod.rs`, `src/scroll_scan/observation.rs` | No P0 target | `missing` | `deferred` |
| Domain/media commands | `src/catalog.rs`, `src/driver/macos/dispatch.rs` | No target | `missing` | `out-of-scope` |
| Overlay cursor productization | `src/catalog.rs`, `src/driver/macos/control/window_ocr.rs` | No target | `missing` | `out-of-scope` |
| Chrome lease/profile/foreground gate | AUV input policy concepts in `crates/auv-driver/src/input.rs`; CareerDeepSeek-specific source in Chrome driver | `src/computer-use/macos-chrome-driver/driver.ts`, `safety-gate.ts` | `already-present` | `in-scope` |

## P0B Capability Slices

Each slice below is the only authorized P0B input. A slice must not expand its own contract. If implementation needs a new field, role, artifact type, runtime path, or workflow API, stop and revise this scope freeze first.

### Slice 1: Chrome Window Capture Contract

- AUV source: `src/driver/macos/capture/commands.rs`, `crates/auv-driver-macos/src/capture/types.rs`, `crates/auv-driver-macos/src/capture/artifact.rs`.
- CareerDeepSeek target file: `src/computer-use/macos-chrome-driver/capture.ts`, `src/computer-use/macos-chrome-driver/types.ts`, `src/computer-use/macos-chrome-driver/driver.ts`.
- Test entry: `test/computer-use/macosChromeDriver.test.ts`, plus a focused trace artifact test if needed.
- Depends on contract: `ChromeCaptureContract`, `ArtifactRef`, `TraceStore` payload rule.
- Boundary: window-only Chrome capture through `screencapture -x -o -l{windowNumber}`. No display, region, shadow, public catalog, or AUV CLI parity.

### Slice 2: Trace Artifact Payload Rule

- AUV source: capture artifact roles in `src/driver/macos/capture/commands.rs`, AUV `ArtifactRef` in `src/contract.rs`.
- CareerDeepSeek target file: `src/computer-use/macos-chrome-driver/trace-store.ts`, `src/computer-use/macos-chrome-driver/driver.ts`, `src/computer-use/macos-chrome-driver/types.ts`.
- Test entry: `test/computer-use/traceStore.test.ts`, `test/computer-use/macosChromeDriver.test.ts`.
- Depends on contract: `ArtifactRecord`, `ArtifactRef`, role naming in this document.
- Boundary: all P0 frozen roles are not metadata-only. Every artifact referenced by `ArtifactRef` for a P0 frozen role must exist at `path` and must be parseable according to `mime_type`. P0B must not mark any artifact used by the frozen contract as metadata-only. A screenshot path points to a real PNG. A capture-contract payload is JSON and includes coordinate system, window source, scale, and `capturedAt`. Human-readable txt reports are deferred.

### Slice 3: Observation Snapshot

- AUV source: `src/contract.rs`, `src/scroll_scan/mod.rs`, `src/scroll_scan/observation.rs`.
- CareerDeepSeek target file: `src/computer-use/macos-chrome-driver/types.ts`, `src/computer-use/macos-chrome-driver/driver.ts`, `src/computer-use/macos-chrome-driver/surface-node.ts`.
- Test entry: `test/computer-use/macosChromeDriver.test.ts`, `test/computer-use/surfaceNode.test.ts`.
- Depends on contract: `ObservationSnapshot`, `SurfaceNode`, `RecognitionScope`, `ArtifactRef`, capture contract ref.
- Boundary: P0 snapshot is Chrome-window scoped and may merge OCR, AX, and read-only Chrome DOM. It does not claim generic desktop coverage or scroll-scan completeness.

### Slice 4: Recognition Result

- AUV source: `src/contract.rs`, `src/driver/macos/support/recognition.rs`, `src/driver/macos/control/window_ocr.rs`.
- CareerDeepSeek target file: `src/computer-use/macos-chrome-driver/types.ts`, `src/computer-use/macos-chrome-driver/recognition.ts`, `src/computer-use/macos-chrome-driver/driver.ts`.
- Test entry: `test/computer-use/macosChromeDriver.test.ts`, `test/computer-use/recognition.test.ts`.
- Depends on contract: `RecognitionResult`, `RecognizedItem`, `RecognitionScope`, screenshot evidence.
- Boundary: P0 recognizes from the latest Chrome window capture and current observation nodes. It must not add full AUV OCR row command behavior, wait loops, or domain-specific result parsing.

### Slice 5: Candidate Promotion

- AUV source: `src/contract.rs`, `src/driver/macos/control/window_ocr.rs`, `src/driver/macos/control/ax.rs`.
- CareerDeepSeek target file: `src/computer-use/macos-chrome-driver/candidate-promotion.ts`, `src/computer-use/macos-chrome-driver/types.ts`, `src/computer-use/macos-chrome-driver/driver.ts`.
- Test entry: `test/computer-use/macosChromeDriver.test.ts`, `test/computer-use/safetyGate.test.ts`, `test/computer-use/candidatePromotion.test.ts`.
- Depends on contract: `PromotedCandidate`, `CandidatePromotion`, `PromotionRefusal`, `ArtifactRef`, Chrome lease/foreground/hard-stop state.
- Boundary: promotion produces a short-lived coordinate-grounded candidate for the active Chrome window and writes a `promoted-candidate` artifact. Pointer click actions must consume that traced artifact. They must not accept an externally forged `PromotedCandidate` as sufficient action evidence. Promotion does not introduce generic retained UI nodes, AX press candidates, or legacy candidate consumers.

### Slice 6: Chrome Action Gate

- AUV source: input policy and delivery evidence in `crates/auv-driver/src/input.rs`; disturbance concepts in `src/catalog.rs`.
- CareerDeepSeek target file: `src/computer-use/macos-chrome-driver/safety-gate.ts`, `src/computer-use/macos-chrome-driver/driver.ts`.
- Reference only: `src/computer-use/macos-actions.ts`.
- Test entry: `test/computer-use/safetyGate.test.ts`, `test/computer-use/macosChromeDriver.test.ts`.
- Depends on contract: managed Chrome lease, profile config, foreground check, hard-stop signals, promoted candidate liveness.
- Boundary: action calls are refused unless the managed Chrome profile/window lease is valid, Chrome is foreground, and no hard-stop signal is present. Pointer click actions also require a `promoted-candidate` artifact ref produced by `driver.promoteCandidate()`. Missing promoted-candidate artifact provenance is a hard refusal, even if every other safety gate passes. Full `InputActionResult` parity is deferred.

### Slice 7: Agent Harness Contract

- AUV source: AUV observe/action/verify separation in `src/contract.rs` and command disturbance classes in `src/catalog.rs`.
- CareerDeepSeek target file: `src/computer-use/macos-chrome-driver/agent-harness.ts`, `src/computer-use/macos-chrome-driver/index.ts`.
- Test entry: `test/computer-use/macosChromeAgentHarness.test.ts`.
- Depends on contract: `observe -> recognize -> promote -> act -> observe`, `ObservationSnapshot`, `RecognitionResult`, `PromotedCandidate`.
- Boundary: harness owns repetitive glue only. It must not decide research strategy, source value, page budgets, or stop criteria.

## Frozen Artifact Roles

Use kebab-case artifact roles. Do not introduce snake_case roles for new trace artifacts.

Frozen P0 roles:

- `screenshot`
- `capture-contract`
- `observation-snapshot`
- `recognition-result`
- `promoted-candidate`
- `action-execution`

AUV precedent uses `capture-contract` and `capture-contract-report`. CareerDeepSeek P0B uses the kebab-case roles above in runtime code. Old snake_case role names such as `capture_contract` and `observation_snapshot` may appear only in negative tests that assert they are absent from trace artifacts.

Role rules:

- `screenshot`: PNG captured from the leased Chrome window.
- `capture-contract`: machine-readable JSON for the capture coordinate contract.
- `observation-snapshot`: machine-readable JSON for `ObservationSnapshot`.
- `recognition-result`: machine-readable JSON for `RecognitionResult`.
- `promoted-candidate`: machine-readable JSON for a promoted action candidate.
- `action-execution`: machine-readable JSON for an action attempt/result summary.
- `capture-contract-report`: reserved for a future human-readable txt report; deferred for P0.

All six frozen P0 roles are not metadata-only. Each must have a real artifact `path` and parseable payload. P0B must not mark any artifact referenced by the frozen P0 contract as metadata-only. Metadata-only roles can only be introduced by a later scope-freeze update.

Minimum `action-execution` JSON payload:

- `action_id`: stable action identifier within the run.
- `action_type`: action kind such as `click`, `type`, `press`, or `scroll`.
- `run_id`: source run id.
- `span_id`: source span id.
- `candidate_ref`: `ArtifactRef` for the consumed `promoted-candidate` artifact when `action_type` is `click` or another pointer-candidate action. It may be `null` only for non candidate-click actions such as `type`, `press`, or `scroll`.
- `precondition_result`: object recording Chrome lease/profile/foreground/hard-stop checks.
- `executed`: boolean.
- `refused`: boolean.
- `refusal_reasons`: array of refusal codes, empty when executed.
- `timestamp_millis`: action decision timestamp.
- `known_limits`: array of known limitations.

For pointer click actions, `candidate_ref:null` with `executed:true` is forbidden. If the promoted-candidate artifact ref is missing, the driver must refuse the click and still write an `action-execution` artifact with:

- `executed:false`
- `refused:true`
- `refusal_reasons` containing `missing_promoted_candidate_artifact`
- `candidate_ref:null`

## Trace Payload Rule

For P0 traces:

- All frozen P0 roles are not metadata-only: `screenshot`, `capture-contract`, `observation-snapshot`, `recognition-result`, `promoted-candidate`, and `action-execution`.
- Any artifact referenced by `ArtifactRef` for a frozen P0 role must have a real `path`.
- P0B must not mark any artifact referenced by the frozen contract as metadata-only.
- Metadata-only artifact roles can only be introduced by a later scope-freeze update.
- The file at `path` must exist by the time the artifact is recorded.
- The file must parse according to `mime_type`.
- `image/png` artifacts must point to real PNG files, not only base64 embedded in memory.
- `application/json` artifacts must contain valid JSON.
- Pointer click actions must consume a real `promoted-candidate` artifact. The `promoted-candidate` role is not metadata-only, and a missing promoted-candidate artifact ref is a hard refusal rather than a successful `action-execution` with `candidate_ref:null`.
- On that refusal, `action-execution` must still be written with `executed:false`, `refused:true`, `candidate_ref:null`, and a refusal reason such as `missing_promoted_candidate_artifact`.
- `typeText`, `pressKey`, and `scroll` actions may write `action-execution.candidate_ref:null` because they are not candidate-click actions.
- The `capture-contract` JSON payload must include:
  - `coordinateContractVersion`
  - `captureSource.kind = "window"`
  - Chrome window number and owner process identity
  - source global logical bounds
  - screenshot pixel size
  - pixel-to-logical and logical-to-pixel scale
  - `capturedAt`
- `capture-contract-report` txt output is deferred.

## Workflow Policy Freeze

- Workflow agents must not recreate legacy observation, recognition, candidate-promotion, click, or `open_url` paths.
- Workflow agents must not expand a capability slice's contract locally.
- Workflow agents must treat this P0A scope freeze and the P0B contract as the source of truth for browser-use workflow boundaries.
- Workflow agents may use `MacOSChromeAgentHarness` for registered semantic helpers. They remain responsible for research strategy and evidence judgment.
- Any request for public catalog parity, full desktop driver behavior, domain/media/overlay behavior, or OCR/AX/scroll productization is a new scope decision, not a P0 implementation detail.
