# Computer-Use P1 Evidence-to-Action Scope

Status: P1 evidence-to-action scope freeze for implementation.

## Purpose

P1 is not a simple click/scroll phase. It is the evidence-to-action scope for the first practical layer above the P0 Chrome window driver foundation.

P1 adds or strengthens only the first layer of visible evidence -> multi-source audit -> promotion/liveness -> text/OCR-row-block click -> single-step scroll effect. It does not copy the full AUV desktop schema, does not add a public command catalog, and does not reopen legacy action paths. P1-1 uses AUV OCR concepts as reference material, but the required design target is a web computer-use evidence contract: OCR text and OCR-derived row/block evidence aligned with existing read-only DOM/AX evidence inside the Chrome window driver.

P1 implementation must preserve the separation between:

- Recognition evidence: what the current visible Chrome window observation found.
- Promoted candidate evidence: why one short-lived target is eligible for action now.
- Action evidence: what action was attempted, refused, executed, and observed after the attempt.

## P0 Baseline Inherited by P1

P1 inherits the P0 scope freeze in `docs/computer-use-auv-scope-freeze.md`.

P0 remains the active foundation for:

- Chrome window capture contract.
- `ObservationSnapshot`.
- `RecognitionResult`.
- `SurfaceNode`.
- `PromotedCandidate`.
- `ArtifactRef`.
- `TraceStore` payload rule.
- Frozen P0 artifact roles: `screenshot`, `capture-contract`, `observation-snapshot`, `recognition-result`, `promoted-candidate`, `action-execution`.
- Chrome lease/profile/foreground/hard-stop action gate.
- Agent-facing path through `MacOSChromeDriver` and `MacOSChromeAgentHarness`.

P1 must not weaken P0:

- Frozen P0 artifact roles remain non metadata-only.
- Pointer click actions still require a real `promoted-candidate` artifact.
- A missing promoted-candidate artifact is a hard refusal, not a successful `action-execution` with `candidate_ref:null`.
- `typeText`, `pressKey`, and `scroll` may keep `candidate_ref:null` because they are not candidate-click actions.
- New fields, new artifact roles, new public exports, new public APIs, and action gate changes require this P1 scope document, or a later scope update, to explicitly authorize them first.

## P1 Goal and Hard Boundaries

P1 goal: on top of the P0 Chrome window driver foundation, complete the first practical layer of visible evidence -> multi-source audit -> promotion/liveness -> text/OCR-row-block click -> single-step scroll effect.

Hard boundaries:

- Only Chrome window driver work is in scope. Full AUV desktop driver work is out of scope.
- Only `MacOSChromeDriver` and `MacOSChromeAgentHarness` are in scope.
- DOM and AX are read-only evidence sources. They may support observation, audit, role/name/bounds/actionability evidence, and liveness checks. They must not become an action path.
- Actions are allowed only against the foreground visible Chrome window under the managed Chrome context.
- Click must go through `PromotedCandidate`. Raw coordinate action paths are forbidden.
- Scroll must not accept an external `screenPoint`; the driver derives any screen coordinate from the leased Chrome window and an internal/default window-local anchor.
- P1 must not add a public command catalog.
- P1 must not restore legacy observation, recognition, candidate-promotion, click, `open_url`, Playwright, CDP, page-executed action, or raw browser automation paths.
- P1 must not change the P0 action gate unless this document is updated to authorize the specific change.

## P1 Slice Plan

### 1. P1-0 Scope + Evidence Contract

Goal:

- Create this scope freeze as the implementation contract for P1.
- Define the evidence-to-action boundary before code changes.
- Keep P0 frozen artifact roles, action gate rules, and Chrome window scope active.

Allowed files:

- `docs/computer-use-p1-evidence-action-scope.md`.

AUV reference points:

- `ArtifactRef` is an evidence reference, not the data body.
- `RecognitionResult` is an observation result with `source`, `scope`, `best`, `filtered`, `all`, `detail`, `evidence`, and `known_limits`.
- `Candidate` is a short-lived action target promoted from observation, not a retained UI node runtime.
- `CandidateEvidence` must reference artifacts and preserve the observation blob.
- `CandidateLiveness` combines window preconditions, anchor recheck, and TTL hint.
- AUV single-step scroll and `scroll_scan` are separate layers.

Acceptance criteria:

- The document has the required status line and all required sections.
- The slice plan uses the required P1 slice names and order.
- The document states that P1 is evidence-to-action scope, not only click/scroll.
- The document separates recognition evidence, promoted candidate evidence, and action evidence.
- The document freezes raw coordinate, DOM/AX action, external `screenPoint`, legacy path, and full AUV desktop/catalog parity as out of scope.

Explicit forbidden items:

- Code implementation.
- Public API, schema, artifact role, or action gate changes.
- Edits outside this file.

### 2. P1-1 OCR/Text Row Evidence + Minimal DOM/AX Alignment Contract

Goal:

- Supersede the previous P1-1R visual-row parity direction. AUV visual-bands, `visual_row` runtime production, image-pixel row segmentation, and TypeScript PNG decoding are no longer P1-1 target requirements.
- Strengthen the Chrome window evidence contract for web computer-use: raw OCR text evidence, OCR-derived text row/block grouping, and a minimal alignment contract against existing read-only DOM/AX evidence.
- Keep the scope bounded to the managed, foreground, visible Chrome window. This is not full AUV desktop/catalog/list/region parity.
- Preserve capture projection, capture artifact refs, capture-contract refs, source artifacts, report/detail payloads, and `known_limits` in runtime artifacts.
- Treat OCR `row_index` or block index only as an index inside the current visible capture/observation.
- Leave action-time liveness, re-observation, and re-match as required inputs for later promotion/action slices. P1-1 defines the evidence those later gates must consume; it does not implement click or action behavior.
- Delete the current TypeScript PNG reader old code and remove driver dependency on screenshot PNG decoding for visual-row production before P1-1 can be re-accepted. It must not be isolated as a live runtime dependency.
- If any `visual_row` type or concept remains for future P2/R&D discussion, it must not exist in the P1-1 runtime path and must not count as P1-1 completion evidence.

Allowed files:

- `src/computer-use/macos-chrome-driver/ocr.ts`
- `src/computer-use/macos-chrome-driver/driver.ts`
- `src/computer-use/macos-chrome-driver/surface-node.ts`
- `src/computer-use/macos-chrome-driver/recognition.ts`
- `src/computer-use/macos-chrome-driver/types.ts`
- `src/computer-use/macos-chrome-driver/trace-store.ts`, only if bounded OCR/text-row report artifact writing cannot use existing TraceStore APIs.
- `test/computer-use/ocr.test.ts`
- `test/computer-use/surfaceNode.test.ts`
- `test/computer-use/recognition.test.ts`
- `test/computer-use/macosChromeDriver.test.ts`
- DOM/AX focused tests under `test/computer-use/**`, only to prove P1-1 consumes existing read-only DOM/AX evidence through the minimal alignment contract. P1-1 must not strengthen DOM/AX capture quality.
- `test/computer-use/traceStore.test.ts`, only for OCR/text-row artifact payload/ref parseability assertions.
- Documentation updates to this file only when a scope gap is identified before implementation.

AUV reference points:

- AUV `src/driver/macos/support/ocr_commands.rs` runs raw OCR text matching with `query`, `exact`, `case_sensitive`, `max_observations`, `min_confidence`, OCR region constraints, raw/filtered counts, and logical-point projection.
- AUV `src/driver/macos/control/window_ocr.rs` provides window-scoped text and row observation paths: `find_window_text`, `wait_for_window_text`, `find_window_rows`, `wait_for_window_rows`, and pre-action OCR/row evidence used by click commands.
- AUV `src/driver/macos/support/ocr.rs` contains OCR text grouping and fragment attachment mechanisms that are relevant to text row/block evidence.
- AUV visual-bands / native visual row detection / row-crop OCR from image-pixel row segmentation are P2/R&D candidates only. They are not P1-1 acceptance requirements. If a later slice reintroduces this direction, it must be designed in the Swift/native macOS layer rather than as a TypeScript hand-written PNG reader.
- AUV `src/driver/macos/support/recognition.rs` emits row `RecognitionResult` artifacts with strategy, raw/filtered counts, screenshot metadata, capture contract detail, capture refs, row bounds, text fragments, and `known_limits`.
- AUV `src/driver/macos/control/region.rs` contains region/list-like row and segmented-region behavior. P1-1 may use OCR region constraints inside the current Chrome window capture, but must not implement generic region/list semantics in this slice.
- Existing CareerDeepSeek DOM/AX observation is a read-only evidence source for minimal role/name/bounds/actionability alignment. P1-1 may consume that existing evidence but must not expand DOM/AX capture quality; P1-2 owns DOM/AX evidence fidelity.
- `ArtifactRef` points to evidence artifacts; it is not an embedded payload.
- `RecognitionResult` carries source/scope/best/filtered/all/detail/evidence/known_limits.
- `row_index` belongs only to the current visible observation.

Acceptance criteria:

- Raw OCR text runtime supports and tests `query`, `exact`, `case_sensitive`, `min_confidence`, `max_observations`, and Chrome-window-local OCR region constraints.
- OCR runtime records raw match count, filtered match count, recognized text, confidence, raw capture-pixel bounds, projected source-global-logical bounds, screenshot pixel size, and capture contract projection detail.
- `observe()` injects screenshot and capture-contract `ArtifactRef`s into OCR `SurfaceNode.source_artifacts` and OCR node detail. Runtime observation nodes must not be less informative than helper output.
- `recognizeFromCapture()` uses the same OCR evidence construction as observation, or an equivalent shared path, and no longer hand-builds OCR items with only `match_index` and `raw_pixel_bounds`.
- Runtime recognition artifacts preserve enough detail to audit each recognized OCR text item against the current capture, including capture refs and projection detail.
- Runtime text row/block grouping produces OCR-derived `ocr_row` or equivalent text-block evidence from OCR matches, with grouping strategy, bounds, text fragments, fragment evidence, raw/filtered counts, and `known_limits`.
- `row_index` and any block index are tested as capture-local only. Row/block evidence must not claim cross-scroll, retained-node, list, section, or stable UI identity.
- Existing DOM/AX bounds, role/name, and actionability may be consumed as read-only alignment evidence against OCR row/block and screenshot/capture coordinates. Agreement, conflict, unavailable, or unknown states must be explicit; P1-1 must not force a fused truth.
- P1-1 must not add or strengthen DOM/AX collection fields, visibility heuristics, or actionability heuristics. That work belongs to P1-2.
- Screenshot/capture visibility evidence remains first-class: every OCR row/block or existing DOM/AX alignment claim must be traceable to capture refs, capture-contract refs, source artifacts, projection detail, and `known_limits`.
- OCR/row/block recognition result/report payloads are parseable and replay-auditable from trace artifacts. If new report artifact roles are introduced, they must be kebab-case and limited to OCR/text-row evidence/report payloads, such as `ocr-text-report` and `ocr-row-report`.
- Tests must prove P1-1 does not require `visual_row`, TypeScript PNG decoding, or image-pixel row segmentation to satisfy the evidence contract.
- Tests must prove the driver no longer depends on screenshot PNG decode to produce P1-1 row/block runtime evidence.
- `known_limits` propagates when OCR text, row/block grouping, confidence, projection, visibility alignment, OCR provider failure, missing artifact refs, missing capture-contract refs, or DOM/AX evidence conflict/unavailability is uncertain.
- Recognition evidence remains separate from promotion and action evidence.

Explicit forbidden items:

- Treating OCR rows as stable retained UI nodes.
- Treating `row_index` as a cross-scroll identity.
- Promoting OCR directly to action without the P1 promotion gate.
- Claiming P1-1 complete because `visual_row` runtime production exists.
- Requiring, accepting, or designing around AUV visual-bands, `visual_row` runtime production, Swift native `find_visual_rows`, TypeScript PNG decoding, or image-pixel row segmentation as P1-1 requirements.
- Keeping the TypeScript PNG reader as a live runtime dependency of `MacOSChromeDriver`.
- Replacing deletion of the PNG reader path with a guardrail test while leaving driver runtime dependent on screenshot PNG decoding.
- Strengthening DOM/AX collection quality in P1-1 instead of leaving that to P1-2.
- Leaving OCR row/block evidence as helper-only while claiming P1-1 complete.
- Letting `driver.ts` bypass P1-1 evidence construction with a reduced manual OCR item shape.
- Adding full AUV OCR business commands or public command catalog entries.
- Adding display/screen/generic region driver behavior. OCR region constraints are allowed only inside the current captured Chrome window.
- Adding AUV region/list segmentation, item-candidate, segmented-region, or scroll_scan behavior.
- Adding click action, candidate promotion, action gate changes, DOM/AX action, or OCR-to-AX action in this slice.
- Adding Playwright, CDP, page-executed action, or direct DOM action paths.

### 3. P1-2 DOM/AX Read-only Evidence Fidelity

Goal:

- Strengthen DOM/AX read-only evidence for visible role/name/bounds/actionability audit.
- Use DOM/AX only to explain current visible observation and support cross-source audit/liveness.
- Own DOM/AX capture-quality improvements that P1-1 intentionally does not do. P1-1 may consume existing DOM/AX evidence; P1-2 may improve that evidence.
- Keep OS-level action delivery inside the Chrome window driver path.

Allowed files:

- `src/computer-use/macos-chrome-driver/surface-node.ts`
- `src/computer-use/macos-chrome-driver/types.ts`
- `test/computer-use/surfaceNode.test.ts`
- DOM/AX focused tests under `test/computer-use/**`.
- Documentation updates to this file only when a scope gap is identified before implementation.

AUV reference points:

- AUV DOM/AX may provide role, name, bounds, and actionability evidence.
- DOM/AX evidence can participate in recognition, audit, and liveness.
- P1 forbids DOM/AX action paths.

Actionability normalization contract:

- DOM provider `actionable` is read-only actionability evidence, not action truth.
- While downstream recognition and promotion still consume kind allowlists, normalization must prevent DOM nodes with negative or uncertain actionability from emitting downstream-actionable kinds.
- DOM nodes may keep provider actionable kinds such as `dom_button`, `dom_link`, `dom_textbox`, `dom_searchbox`, or `dom_combobox` only when `actionable === true` and bounds, center, confidence, viewport mapping, and state evidence are all clean.
- DOM `actionable === false` must emit `dom_evidence` and carry a `known_limits` entry that the provider reports the element is not actionable.
- DOM `actionable !== true`, including missing actionability evidence, must emit `dom_evidence` and carry a `known_limits` entry that provider actionability is unavailable or uncertain.
- AX provider `enabled` is optional read-only actionability evidence, not action truth.
- AX nodes may keep provider actionable kinds such as `ax_button`, `ax_link`, `ax_textfield`, `ax_textarea`, `ax_combobox`, `ax_menu_item`, or `ax_tab` only when `enabled === true` and bounds/capture visibility evidence is clean.
- AX `enabled === false` must emit `ax_evidence` and carry a disabled `known_limits` entry.
- AX `enabled === undefined` must emit `ax_evidence` and carry an enabled-unavailable or enabled-uncertain `known_limits` entry.
- AX snapshot truncation alone is evidence uncertainty, not an actionability-blocking condition. A node with `enabled === true` and otherwise clean bounds/capture visibility may keep its provider actionable kind while carrying the truncation `known_limits` entry.
- Downgraded DOM/AX evidence must preserve provider role, text/name/title/value/description, bounds, states where available, source artifacts, coordinate spaces, original provider role in detail, and `known_limits`.
- This contract is limited to `SurfaceNode` normalization. It is not P1-3 cross-source audit, P1-4 candidate promotion, or an action path.

Acceptance criteria:

- DOM/AX evidence is captured as read-only observation/audit evidence.
- DOM/AX hidden, offscreen, covered, or non-visible items cannot become action targets merely because DOM/AX reports them.
- Any uncertainty in DOM/AX visibility, bounds, actionability, or mapping to the screenshot is carried in `known_limits`.
- DOM nodes with provider actionability `false`, missing, or uncertain cannot emit downstream-actionable DOM kinds; they must be downgraded to `dom_evidence` with provider role and actionability retained as detail evidence.
- AX nodes with `enabled === false` or missing enabled evidence cannot emit downstream-actionable AX kinds; they must be downgraded to `ax_evidence` with provider role and enabled state retained as detail evidence.
- AX snapshot truncation-only evidence does not force downgrade when `enabled === true` and bounds/capture visibility are clean, but truncation must remain visible in `known_limits`.
- Tests assert that DOM/CDP/Playwright/page-executed action routes remain unavailable.

Explicit forbidden items:

- DOM click, CDP click, Playwright click, page-executed click, or direct browser action.
- `AXPress`, AX focus, AX write, AX smartPress, or AX action productization.
- OCR-to-AX click.
- Background dispatch.
- Treating read-only DOM/AX evidence as an action path.
- Letting DOM `actionable === false`, missing DOM actionability, or uncertain DOM actionability emit `dom_button`, `dom_link`, `dom_textbox`, `dom_searchbox`, `dom_combobox`, or another downstream-actionable DOM kind.
- Letting AX `enabled === false` or missing AX enabled evidence emit `ax_button`, `ax_link`, `ax_textfield`, `ax_textarea`, `ax_combobox`, `ax_menu_item`, `ax_tab`, or another downstream-actionable AX kind.
- Treating AX snapshot truncation alone as an actionability-blocking condition when the node has `enabled === true` and otherwise clean bounds/capture visibility evidence.

### 4. P1-3 Cross-source Audit / Refinement

Goal:

- Add a recognition-level cross-source audit over OCR text, OCR row/block, screenshot/capture visibility, DOM evidence, and AX evidence.
- End this slice at `RecognitionResult`. P1-3 may refine recognition `best`/`filtered` ordering or eligibility only through explicit audit evidence; it must not promote a candidate or make liveness decisions.
- Output structured agreement, conflict, or unknown states rather than forcing a fused truth.
- Preserve every audited source, source artifact reference, capture/capture-contract reference, projection detail, and `known_limits` needed to replay why recognition was or was not trusted.

Allowed files:

- `src/computer-use/macos-chrome-driver/recognition.ts`
- `src/computer-use/macos-chrome-driver/recognition-audit.ts`, only if the slice first adds focused tests proving a dedicated recognition audit module is needed.
- `src/computer-use/macos-chrome-driver/driver.ts`, only for the narrow runtime integration point inside `MacOSChromeDriver.recognizeFromCapture()` where driver-level OCR/text-row producer `known_limits` are appended before writing the `recognition-result` artifact. The only authorized driver change is to pass, rebuild, or supplement recognition audit detail so `RecognitionResult.detail.cross_source_audit` reflects the final top-level `known_limits` written to the artifact.
- `src/computer-use/macos-chrome-driver/types.ts`, only if a named audit type is necessary. Prefer a parseable `RecognitionResult.detail.cross_source_audit` payload over public API expansion.
- `test/computer-use/recognition.test.ts`
- `test/computer-use/macosChromeDriver.test.ts`, only for parseable runtime `recognition-result` artifact payload/ref assertions, including the final driver-level `known_limits` synchronization into audit detail, that cannot be tested through `recognition.test.ts`.
- Documentation updates to this file only when a scope gap is identified before implementation.

AUV reference points:

- AUV `src/contract.rs` separates `RecognitionResult` from `Candidate`, `CandidateEvidence`, and `CandidateLiveness`; P1-3 follows that boundary.
- AUV recognition payloads preserve `source`, `scope`, `best`, `filtered`, `all`, `detail`, `evidence`, and `known_limits`; P1-3 audit must live inside that recognition evidence boundary.
- AUV artifact refs are replay links, not logs. Referenced screenshot/capture/capture-contract/report payloads must remain traceable from the `recognition-result` artifact.
- Cross-source audit should produce `agreement`, `conflict`, or `unknown`.
- Audit evidence remains evidence; it does not create an independent action path.
- `known_limits` must propagate when sources disagree, are missing, are not comparable, or have uncertainty from P1-1/P1-2 evidence.

Acceptance criteria:

- `RecognitionResult.detail.cross_source_audit` is a structured, parseable payload, not free-form logging.
- The audit records, at minimum, the audited item ids/kinds, participating source groups (`ocr_text`, `ocr_row`, `chrome_dom`, `ax`, and capture visibility when applicable), source artifact refs or artifact ids, and per-source status.
- Each audited match or candidate item has an audit status of `agreement`, `conflict`, or `unknown`, plus reasons and propagated `known_limits`.
- OCR text/row/block evidence, DOM evidence, and AX evidence are compared by current-capture text/name/role/bounds/projection evidence where available. Missing or non-comparable evidence must become `unknown`, not a forced match.
- Conflicting evidence remains visible in `RecognitionResult.detail.cross_source_audit` and `RecognitionResult.known_limits`; it must not be silently dropped from `filtered` or hidden by `best`.
- Unknown audit state prevents overconfident recognition detail. Later P1-4 promotion may consume this uncertainty, but P1-3 does not make promotion or liveness decisions.
- Refinement is limited to recognition ordering/eligibility and must be explainable in the audit payload. `all` must preserve the input evidence items needed for replay.
- Runtime `MacOSChromeDriver.recognizeFromCapture()` must ensure any OCR provider or OCR row producer `known_limits` appended after `recognizeFromCapture(...)` returns are also reflected in `RecognitionResult.detail.cross_source_audit` before the `recognition-result` artifact is written.
- The existing `recognition-result` artifact remains parseable and replay-auditable. P1-3 should not add a new artifact role unless this document is updated first.
- Tests cover agreement, conflict, unknown, missing artifact refs, missing capture-contract refs, DOM/AX uncertainty propagated from P1-2, and preservation of conflicting evidence.
- Tests prove P1-3 does not add candidate promotion, liveness, action, click, scroll, DOM/AX action, public catalog, or legacy paths.

Explicit forbidden items:

- Claiming a fused source of truth when sources conflict.
- Letting DOM/AX override visible OCR/screenshot evidence into an action target.
- Creating `PromotedCandidate`, `CandidateEvidence`, `CandidateLiveness`, TTL hints, anchor recheck, or action preconditions in P1-3.
- Editing `driver.ts` outside the single `MacOSChromeDriver.recognizeFromCapture()` audit/known_limits synchronization described in Allowed files.
- Changing driver capture, OCR execution, OCR row production, observation, promotion, liveness, action, trace-store behavior, or public behavior while making the authorized driver audit sync.
- Editing `candidate-promotion.ts`, `agent-harness.ts`, `safety-gate.ts`, action executors, `chrome-dom.ts`, `ax-tree.ts`, `ocr.ts`, capture, or trace-store code in this slice unless this document is updated before implementation.
- Adding `candidate-audit.ts` in P1-3. Candidate audit/promotion belongs to P1-4; P1-3 audit is recognition evidence audit.
- Treating audit output as permission to click.
- Emitting a new artifact role for audit without explicit scope update.
- Adding generic list semantics or section semantics.
- Adding new public command catalog entries.

### 5. P1-4 Promotion Decision & Liveness

Goal:

- Make promotion a refusal-capable decision gate, not a formatter.
- Require candidate evidence, current window preconditions, anchor recheck where available, TTL hint, and propagated `known_limits`.
- Keep Candidate short-lived and action-scoped.
- End this slice at `CandidatePromotion` / `PromotedCandidate` and the existing `promoted-candidate` artifact. P1-4 must not enter click, re-observe, re-match, action liveness recheck, or action execution.
- Consume P1-3 `RecognitionResult.detail.cross_source_audit` as required evidence for promotion. Promotion must never silently ignore missing, malformed, conflicting, or unmatched audit evidence.

Allowed files:

- `src/computer-use/macos-chrome-driver/candidate-promotion.ts`
- `src/computer-use/macos-chrome-driver/driver.ts`, only for `MacOSChromeDriver.promoteCandidate()` runtime integration and the existing `promoted-candidate` artifact payload.
- `src/computer-use/macos-chrome-driver/types.ts`
- `test/computer-use/candidatePromotion.test.ts`
- `test/computer-use/macosChromeDriver.test.ts`
- `test/computer-use/macosChromeAgentHarness.test.ts`, only for type-only harness fixture updates caused by the required refused `CandidatePromotion.residual_known_limits` contract. Harness behavior changes remain out of scope.
- Documentation updates to this file only when a scope gap is identified before implementation.

AUV reference points:

- `Candidate` is promoted from observation and is a short-lived action target.
- `CandidateEvidence` must reference the artifact and retain the observation blob.
- `CandidateLiveness` is window precondition + anchor recheck + TTL hint.
- Promotion decision can refuse.

Acceptance criteria:

- Promotion refuses ambiguous, stale, offscreen, ungrounded, unobservable, or unsafe candidates.
- Promoted candidate evidence references the capture and recognition artifacts and preserves relevant observation detail.
- Candidate liveness records window preconditions, anchor recheck when available, and TTL hint.
- `known_limits` from recognition and audit propagate into the promoted candidate or the refused `CandidatePromotion.residual_known_limits`.
- The promoted candidate observation blob preserves the relevant recognition scope, selected best item, filtered item ids, audit rollup, selected audit item, evidence refs, and residual `known_limits`.
- Promotion must defensively parse `recognition.detail.cross_source_audit`, find the audit item for `recognition.best.item_id`, and refuse when the audit is missing, malformed, rollup-conflicted, selected-item-conflicted, or missing the selected best item.
- Promotion must refuse when `recognition.filtered.length !== 1`.
- Promotion must refuse when capture or recognition artifact refs are missing.
- Promotion must refuse when capture-contract/projection evidence needed to trust coordinates is missing, or when the selected box is invalid, non-finite, non-positive, or outside the current leased Chrome window.
- Promotion must refuse non-actionable kinds. `visual_row` is not an actionable promotion kind.
- Promotion must refuse stale capture, profile mismatch, Chrome not foreground, and hard-stop signals.
- Promotion must not refuse solely because audit is `unknown` from no comparable source evidence, capture visibility is reference-only, OCR row grouping is heuristic/capture-local, or provider degradation `known_limits` exist without a conflict/refusal condition.

Explicit forbidden items:

- Retained UI node runtime.
- Externally forged candidate acceptance.
- Formatting a recognition result into a candidate without refusal logic.
- Bypassing the Chrome lease/profile/foreground/hard-stop gate.
- New action gate behavior not authorized by this document.
- New artifact roles for refusal or audit.
- New public command catalog entries.
- P1-5 click/re-observe/re-match/action execution behavior.
- Changes to OCR, DOM, AX, capture, recognition audit generation, or capture-contract generation.

### 6. P1-5 Text/OCR Row-Block Click via Promoted Candidate

Goal:

- Support visible text or OCR-derived capture-local row/block click only through a promoted, live candidate.
- `MacOSChromeDriver.click()` is the mandatory re-observe, re-match, and liveness boundary before any macOS click dispatch. The harness may expose semantic helpers, but it must not become the only safety/liveness boundary.
- Re-observe the current Chrome window, re-match the promoted candidate against current capture evidence, and use current capture projection before action.
- The final click point must come from the fresh current-capture match, not from a stale promoted-candidate box or raw coordinate.
- Target API boundary:
  - `visible_text` targets remain broad recognition/audit targets for visible text evidence. They may include read-only DOM/AX evidence and are not the P1 click target path.
  - `ocr_text` targets match only OCR text evidence by text for P1 driver/harness click promotion and liveness. `ocr_text` is an internal driver/harness target shape and is not a public command catalog expansion.
  - `ocr_row` targets match OCR-derived capture-local row/block evidence by text/fragments.
  - `ocr_row` is an internal driver/harness target shape for P1 click semantics. It is not a public command catalog expansion.
- `action-execution` remains the existing artifact role for the click result. P1-5 may extend its JSON payload with liveness recheck details, fresh match refs, refusal reasons, and known limits, but must not add a new artifact role.
- In this slice, "row" means OCR-derived capture-local row/block evidence only. It does not mean `visual_row`, DOM list row, generic list item, section row, or retained row index.
- `row_index` is valid only within the current visible capture/observation. It must never be used as a stable identity across re-observation, scroll, or later actions.

Allowed files:

- `src/computer-use/macos-chrome-driver/agent-harness.ts`
- `src/computer-use/macos-chrome-driver/driver.ts`
- `src/computer-use/macos-chrome-driver/recognition.ts`
- `src/computer-use/macos-chrome-driver/candidate-promotion.ts`
- `src/computer-use/macos-chrome-driver/types.ts`
- `test/computer-use/macosChromeAgentHarness.test.ts`
- `test/computer-use/macosChromeDriver.test.ts`
- `test/computer-use/candidatePromotion.test.ts`
- `test/computer-use/recognition.test.ts`, only for P1-5 target matcher contract tests proving `{ kind: 'ocr_text' }` matches OCR text evidence while preserving DOM/AX as audit-only evidence, and `{ kind: 'ocr_row' }` matches OCR-derived row/block evidence and excludes `visual_row`, DOM/AX rows, and raw OCR text.
- Documentation updates to this file only when a scope gap is identified before implementation.

AUV reference points:

- Text/OCR-row-block click should re-observe, re-match, check window precondition, project from current capture, and carry evidence before dispatch.
- `PromotedCandidate` remains the click action target.
- Candidate liveness must be rechecked against the current capture evidence before the executor is called.
- `row_index` is valid only inside the current capture/visible observation.
- Action evidence stays separate from recognition and candidate evidence; liveness recheck detail belongs in the existing `action-execution` payload.

Acceptance criteria:

- `driver.click()` refuses to dispatch unless it can load a traced `PromotedCandidate` artifact produced by the current driver session.
- `driver.click()` performs re-observation and re-match before any executor call for visible text and OCR row/block clicks.
- The click point is derived from the current matched `ocr_text` or `ocr_row` evidence box and current capture projection, not from stale coordinates.
- `visible_text`, `ocr_text`, and `ocr_row` target handling are explicit and tested separately. P1 click promotion/liveness uses `ocr_text` or `ocr_row`; `visible_text` remains available for broad recognition/audit only.
- Click consumes a `PromotedCandidate` artifact produced by the driver session.
- `row_index` is never treated as stable identity across scroll or later observations.
- Row/block click candidates must come from OCR-derived capture-local row/block evidence, not `visual_row`, DOM list rows, generic list semantics, or retained UI node identity.
- Refusal paths are tested for at least forged/missing candidate artifact, missing current match, ambiguous current match, window mismatch, projection failure, and stale candidate distance beyond the configured liveness threshold.
- `action-execution` payload records the original candidate ref, fresh observation/recognition evidence refs when available, matched item identity/kind/box, liveness recheck status, refusal reason when refused, and known limits.
- P1-5 does not introduce any new artifact role.
- Action evidence remains separate from recognition and candidate evidence.

Explicit forbidden items:

- Raw coordinate click.
- Bare `{ x, y }` action target.
- Letting `agent-harness.ts` be the only re-observe/re-match/liveness boundary.
- Dispatching from stale promoted-candidate coordinates without a fresh current-capture match.
- OCR-to-AX click.
- DOM/CDP/Playwright/page-executed click.
- New public command catalog entries.
- New artifact roles for liveness recheck, click audit, or click refusal.
- Treating DOM list rows, generic list rows, `visual_row`, or retained row index as P1-5 row click targets.
- Clicking a row by retained `row_index` after scroll.
- Background dispatch.

### 7. P1-6 Single-step Scroll Effect Evidence

Goal:

- Record weak evidence for one scroll attempt and the immediately observed visible effect.
- Allow only `scroll_effect: changed | no_visible_change | unknown`.
- Keep single-step scroll effect separate from full `scroll_scan`.

Allowed files:

- `src/computer-use/macos-chrome-driver/agent-harness.ts`
- `src/computer-use/macos-chrome-driver/driver.ts`, only if the harness cannot express the effect evidence using existing driver results.
- `src/computer-use/macos-chrome-driver/types.ts`, only if this scope document is first updated to authorize a concrete result type.
- `test/computer-use/macosChromeAgentHarness.test.ts`
- `test/computer-use/macosChromeDriver.test.ts`
- Documentation updates to this file only when a scope gap is identified before implementation.

AUV reference points:

- AUV single-step scroll and `scroll_scan` are different capability layers.
- P1-6 may record only single-step effect evidence.
- `scroll_scan` controller behavior is out of scope.

Acceptance criteria:

- Scroll effect evidence can report only `changed`, `no_visible_change`, or `unknown`.
- `changed` means only that the current visible surface changed between the before and after evidence.
- `no_visible_change` means only that current evidence did not observe visible change.
- `unknown` is used when evidence is insufficient, failed, unstable, or not comparable.
- If `driver.scroll()` succeeds but the immediate after-observation fails, the harness may return a scroll result without comparable `after` evidence, must set `scroll_effect: unknown`, and must preserve a bounded failure reason such as `scroll_effect_reason: after_observe_failed` or a sanitized `after_observe_error`.
- If `driver.scroll()` fails or refuses, the harness must propagate the failure rather than convert it to `unknown`.
- Visible-surface fingerprint comparison must be stable against provider node ordering; reordering the same comparable visible nodes must not be reported as `changed`.
- Scroll action still uses the foreground visible Chrome window and must not accept an external `screenPoint`.

Explicit forbidden items:

- No-progress counter or limit.
- Reached top, bottom, or end claims.
- Boundary candidate.
- Completeness claim.
- List coverage claim.
- Section transition claim.
- Generic list semantics.
- Generic section semantics.
- Scroll-until controller.
- Full `scroll_scan`.

### 8. P1-7 Guardrail Review Gate

Goal:

- Review P1 implementation against this scope before treating P1 as complete.
- Confirm no slice expanded into forbidden AUV desktop/catalog parity, legacy paths, raw coordinates, DOM/AX actions, visual-band row detection, TypeScript PNG decoding, or full scroll scan. P1-1 is reviewed against its explicitly authorized web evidence contract.
- Confirm tests cover the evidence/action separation and guardrails.

Allowed files:

- `docs/computer-use-p1-evidence-action-scope.md`
- `docs/computer-use-testing-and-qa.md`, only if a later explicit scope update authorizes QA doc edits.
- Test files under `test/computer-use/**`, only for guardrail assertions authorized by prior P1 slices.
- No source files unless a prior P1 slice explicitly authorizes the relevant source change.

AUV reference points:

- P1 is a scoped subset of AUV concepts, not full AUV desktop/catalog parity.
- P1-1 uses AUV OCR/row concepts as reference material but does not require AUV visual-bands or full AUV OCR runtime parity.
- Promotion is a gate.
- DOM/AX evidence remains read-only.
- Single-step scroll effect is not `scroll_scan`.

Acceptance criteria:

- `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, and `git diff --check` pass before completion is claimed.
- Guardrail tests fail if raw coordinate click, external `screenPoint`, DOM/AX action, legacy path, public catalog expansion, or scroll_scan behavior is introduced.
- Any new artifact role, public export, schema field, action result shape, or action gate behavior is traceable to explicit scope authorization.

Explicit forbidden items:

- Treating passing tests as authorization for unscoped design changes.
- Adding guardrail exceptions locally in implementation files.
- Expanding P1 after implementation without updating this scope document first.

## Evidence Contract Rules

- `ArtifactRef` is an evidence reference. It points to an artifact record; it is not the artifact payload itself.
- `RecognitionResult` is an observation result. It must preserve `source`, `scope`, `best`, `filtered`, `all`, `detail`, `evidence`, and `known_limits`.
- Recognition evidence, promoted candidate evidence, and action evidence are separate records and must stay auditable independently.
- Candidate is a short-lived action target promoted from current observation evidence. It is not a retained UI node runtime.
- Candidate evidence must reference the capture/recognition artifacts and preserve the observation blob needed for audit.
- Candidate liveness must include window preconditions, anchor recheck when available, and TTL hint.
- `known_limits` must propagate through uncertain recognition, candidate promotion, liveness checks, and action evidence.
- Cross-source audit may state agreement, conflict, or unknown. It must not force a fused truth.
- Raw coordinate action paths are forbidden.
- DOM/AX are read-only evidence sources. They must not become action paths.
- Text/OCR-row-block click must re-observe and re-match before action.
- `row_index` is valid only within the current capture/visible observation and cannot be treated as stable identity across scroll.

## Single-step Scroll Effect Semantics

P1-6 allows only weak scroll effect evidence:

- `scroll_effect: changed`
- `scroll_effect: no_visible_change`
- `scroll_effect: unknown`

Meanings:

- `changed` means only that the current visible surface changed between comparable before/after evidence.
- `no_visible_change` means only that current evidence did not observe visible change.
- `unknown` means evidence was insufficient, failed, unstable, stale, incomparable, or otherwise unable to support either visible-change state.

Forbidden in P1-6:

- No-progress counter or limit.
- Reached top, bottom, end, or boundary claim.
- Boundary candidate.
- Completeness claim.
- List coverage claim.
- Section transition claim.
- Generic list semantics.
- Generic section semantics.
- Scroll-until controller.
- Full `scroll_scan`.

## AUV Reference Boundaries

P1 uses AUV as a reference for evidence and control boundaries and is not a full AUV desktop/catalog parity target. P1-1 is narrower and web-specific: it requires OCR/text row evidence plus a minimal alignment contract against existing DOM/AX evidence inside the Chrome window driver. It does not require AUV visual-bands, `visual_row` runtime production, native `find_visual_rows`, TypeScript PNG decoding, or image-pixel row segmentation.

Essential AUV references:

- `ArtifactRef` is evidence reference, not data body.
- `RecognitionResult` is observation result and includes source/scope/best/filtered/all/detail/evidence/known_limits.
- `Candidate` is promoted from recognition/observation into a short-lived action target.
- `CandidateEvidence` references artifacts and preserves the observation blob.
- `CandidateLiveness` is window precondition + anchor recheck + TTL hint.
- AUV OCR/row evidence records bounds, confidence, text fragments, coordinate space, projection, and capture refs.
- AUV OCR text matching supports query filtering, exact/case-sensitive options, min-confidence filtering, max-observation limits, OCR region constraints, raw/filtered counts, and logical-point projection.
- AUV row observation includes OCR text grouping, visual row detection, OCR fragment attachment, and row-crop OCR enrichment. P1-1 adopts OCR text grouping and fragment evidence only. Visual row detection and row-crop OCR from image-pixel segmentation are P2/R&D candidates and require a later Swift/native design if reintroduced.
- AUV row recognition artifacts preserve row strategy, raw/filtered counts, screenshot metadata, capture contract detail, capture refs, row bounds, text fragments, and known limits.
- AUV `row_index` belongs to the current visible observation.
- AUV DOM/AX can provide role/name/bounds/actionability evidence.
- AUV DOM/AX action capability is out of scope for P1.
- Cross-source audit should produce agreement/conflict/unknown, not fused truth.
- Promotion decision is a refusal-capable gate, not a formatter.
- Text/OCR-row-block click should re-observe, re-match, check window precondition, project against current capture, and retain evidence.
- AUV single-step scroll and `scroll_scan` are separate levels. P1-6 authorizes only single-step effect evidence.

## CareerDeepSeek File Boundaries

P1 implementation files must stay inside the file ranges authorized by the active slice. A later slice may not borrow files from another slice unless this document is updated first.

Maximum implementation area across P1, not per-slice permission:

- `src/computer-use/macos-chrome-driver/**`
- `src/computer-use/chrome-dom.ts`
- `src/computer-use/ax-tree.ts`
- `test/computer-use/**`
- This document, when scope gaps require an explicit update before implementation.

The maximum implementation area is not a blanket write authorization. Each slice may touch only the files listed in its own `Allowed files` block.

Files and areas not authorized by this P1-0 task:

- `README.md`
- `.opencode/skills/browser-use-policy/SKILL.md`
- `docs/browser-use-policy.md`
- `docs/computer-use-auv-scope-freeze.md`
- `docs/computer-use-testing-and-qa.md`
- `src/**`
- `test/**`
- Package, lock, and config files.

The second list is the P1-0 task boundary. Later P1 implementation slices may touch only the files explicitly listed in their slice after the user authorizes that slice.

## Explicit Non-Goals

- Full AUV desktop/catalog parity.
- Legacy wrappers.
- Raw coordinate click.
- External `screenPoint`.
- DOM/CDP/Playwright/page-executed action.
- `AXPress`, focus, write, or smartPress.
- OCR-to-AX click.
- Background dispatch.
- Full `scroll_scan`.
- No-progress limit, boundary, or completeness claim.
- Generic list or section semantics.
- Full `InputActionResult` parity.
- Display/screen/generic region driver. P1-1 may use OCR region constraints only inside the current captured Chrome window.
- AUV visual-bands, `visual_row` runtime producer, Swift native `find_visual_rows`, TypeScript PNG reader, or image-pixel row segmentation as P1-1 target behavior.
- Media/domain/workflow-specific commands.
- New artifact role, public export, or schema field without scope doc update.
- New public command catalog.
- Restored legacy path.
- Full retained UI node runtime.

## Agent Instructions

- Treat this document as the P1 implementation input.
- Before any P1 slice writes code, confirm the slice name, allowed files, acceptance criteria, and forbidden items.
- Do not treat technical feasibility as scope authorization.
- Do not introduce new artifact roles, public exports, schema fields, public APIs, action result shapes, action gates, or workflow helpers unless this document explicitly authorizes them.
- Keep DOM/AX read-only.
- Keep click behind promotion.
- Keep scroll inside the Chrome window driver and reject external `screenPoint`.
- Preserve `known_limits` across recognition, audit, promotion, liveness, and action evidence.
- Stop and update this scope document before implementing if a required design decision is not covered here.

## Acceptance Criteria

- This file exists at `docs/computer-use-p1-evidence-action-scope.md`.
- The status line is exactly: `Status: P1 evidence-to-action scope freeze for implementation.`
- The document includes the required sections: Purpose, P0 Baseline Inherited by P1, P1 Goal and Hard Boundaries, P1 Slice Plan, Evidence Contract Rules, Single-step Scroll Effect Semantics, AUV Reference Boundaries, CareerDeepSeek File Boundaries, Explicit Non-Goals, Agent Instructions, Acceptance Criteria, Verification Commands.
- The P1 slice plan uses the required slice order and names.
- Each slice includes Goal, Allowed files, AUV reference points, Acceptance criteria, and Explicit forbidden items.
- The document states that P1 is evidence-to-action scope, not just click/scroll.
- The document states that P1 adds/strengthens only the first layer of evidence-to-action capability and does not copy full AUV schema.
- The document states that P1-1 targets OCR/text row evidence plus a minimal alignment contract against existing DOM/AX evidence, not AUV visual-bands, TypeScript PNG reader, or full AUV OCR runtime parity.
- The document states that P1-2 must not start until P1-1 is reviewed complete.
- Recognition evidence, promoted candidate evidence, and action evidence are separated.
- Candidate is defined as a short-lived action target, not a retained UI node runtime.
- `known_limits` propagation is required for uncertain recognition/candidate/action states.
- Raw coordinate action path, DOM/AX action path, and external scroll `screenPoint` are forbidden.
- P1-5 requires re-observation and re-match before text/OCR-row-block click action.
- P1-6 permits only weak single-step scroll effect evidence and forbids scroll_scan semantics.

## Verification Commands

Run from the repository root:

```bash
pnpm run lint
pnpm run typecheck
pnpm test
git diff --check
```
