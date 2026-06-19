# Browser-Use Policy

This document exists because `opencode.json` loads `docs/browser-use-policy.md` as project instructions.

The executable workflow policy lives in `.opencode/skills/browser-use-policy/SKILL.md`. The P0 computer-use scope freeze lives in `docs/computer-use-auv-scope-freeze.md`.

Summary:

- CareerDeepSeek uses visible browser/computer-use only.
- The current P0 runtime target is the Chrome window driver, not a full AUV desktop driver.
- P1.5 programmatic invoke is the approved primitive entry point for new computer-use work. Top-level computer-use exports the invoke entry; direct driver submodule access is reserved for driver implementation and tests.
- Workflow code must not recreate legacy observation, recognition, candidate-promotion, click, targetless scroll, overlay dismissal, `open_url`, Playwright, CDP, direct HTTP, or page-executed action paths.
- Capability slices must not expand the frozen contract locally.
- Trace artifact roles use kebab-case: `screenshot`, `capture-contract`, `observation-snapshot`, `recognition-result`, `promoted-candidate`, `action-execution`.
- All frozen P0 roles are not metadata-only and must have real artifact paths.
- P0B must not mark any artifact referenced by the frozen contract as metadata-only; metadata-only roles can only be added by a later scope-freeze update.
- Artifacts referenced by `ArtifactRef` for frozen P0 roles must exist on disk and parse according to their MIME type.
- `action-execution` is JSON containing action id/type, run/span, optional grounding, candidate/ref, precondition result, executed/refused status, timestamp, and known limits.
- Click/pointer actions must consume a traced `promoted-candidate` artifact produced by `driver.promoteCandidate()`. Missing promoted-candidate artifact ref is a hard refusal, not metadata-only, and not a successful `action-execution` with `candidate_ref:null`.
- On that refusal, `action-execution` must still be written with `executed:false`, `refused:true`, `candidate_ref:null`, and `missing_promoted_candidate_artifact`.
- For `typeText`, `pressKey`, and `scroll`, `action-execution.candidate_ref` can be `null` only as the candidate artifact field because they are not candidate-click artifact consumers. This is not permission to act without target/focus provenance: P1.5 invoke requires `chrome.focusTextInput` to consume a promoted `ax_node` text input before keyboard input, and requires a latest observe-derived Chrome scroll region lease for scroll.
- P1.5 exposes hard-stop / safety signals only for overlays. Structural overlay detection and dismissible overlay dismissal primitives remain P2.
- Real browsing artifacts remain private and must stay outside the public repository; use `COMPUTER_USE_SESSION_ROOT` under `CareerDeepSeek-data`.
