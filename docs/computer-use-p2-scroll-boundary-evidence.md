# P2 Scroll Boundary Evidence

Status: P2 historical/reference design. It is not the current P1.5 action contract.

Scope: possible future CareerDeepSeek Chrome window observation and single-step scroll evidence.
This document does not define a full scroll-scan controller, pagination workflow,
or research-completeness policy.

P1.5 supersedes the old harness scroll behavior: `chrome.scroll` must consume a
same-sequence promoted candidate, and targetless `MacOSChromeAgentHarness`
scroll helpers are not approved P1.5 behavior.

## Design Decision

The driver must expose vertical scroll context on every ordinary
`MacOSChromeDriver.observe()` result:

```text
ObservationSnapshot.detail.scroll_boundary
```

The contract is deliberately simple:

- ordinary observe defaults both `top` and `bottom` to `not_at_boundary`;
- only OCR-backed single-step scroll evidence can update the side that was
  probed by a scroll action;
- `no_visible_change` after a scroll is the only current evidence that marks the
  probed side as `at_boundary`;
- `changed` and `unknown` after a scroll keep the probed side
  `not_at_boundary`;
- AX and DOM do not participate in the boundary decision.

The workflow agent owns the strategy decision. If it observes
`not_at_boundary`, it should understand that scroll context is incomplete and
may choose to continue scrolling. The driver does not decide whether research is
complete.

## AUV Reference

The relevant AUV behavior is the evidence discipline, not a direct AX boundary
implementation.

- AUV scroll scan treats no visual progress as heuristic boundary evidence, not
  a proof of full UI coverage.
- AUV macOS AX tree capture does not provide a complete, reliable top/bottom
  boundary signal for Chrome web content.
- AUV's `AxScroll` delivery path is not implemented in the referenced macOS
  slice.

CareerDeepSeek therefore uses OCR visible-content progress as the current
scroll-boundary signal and keeps DOM/AX out of the boundary decision.

## Non-goals

- Full AUV `scroll_scan`.
- Cross-page scan state.
- Multi-page trace.
- Pagination detection.
- Stop policy.
- Research sufficiency policy.
- DOM scroll metrics such as `scrollTop`, `scrollHeight`, `clientHeight`, or
  `window.scrollY`.
- AX scroll values as top/bottom truth.
- DOM action, AX action, Playwright, CDP, page-executed action, `open_url`, or
  raw external `screenPoint` action input.
- Boolean `reached_top` or `reached_bottom` fields.

## Contract Shape

```text
type ScrollBoundaryAxis = 'vertical'

type ScrollBoundarySide = 'top' | 'bottom'

type ScrollBoundaryState =
  | 'at_boundary'
  | 'not_at_boundary'

type ScrollBoundaryConfidence =
  | 'heuristic'

type ScrollBoundaryBasis =
  | 'ordinary_observe_default'
  | 'single_step_no_visible_change'
  | 'single_step_changed'
  | 'single_step_unknown'

interface ScrollBoundaryEvidenceRef {
  source:
    | 'observation_snapshot'
    | 'single_step_scroll_effect'
  basis: ScrollBoundaryBasis
  axis: ScrollBoundaryAxis
  side?: ScrollBoundarySide
  scroll_effect?: {
    direction: 'up' | 'down'
    effect: 'changed' | 'no_visible_change' | 'unknown'
    reason?: string
  }
  detail?: Record<string, unknown>
}

interface ScrollBoundarySideClaim {
  state: ScrollBoundaryState
  confidence: ScrollBoundaryConfidence
  basis: ScrollBoundaryBasis[]
  evidence: ScrollBoundaryEvidenceRef[]
  known_limits: string[]
}

interface ScrollBoundaryObservation {
  api_version: 'careerdeepseek.scroll_boundary.v1alpha1'
  axis: 'vertical'
  vertical: {
    top: ScrollBoundarySideClaim
    bottom: ScrollBoundarySideClaim
  }
  generated_at_millis: number
  capture_contract_ref?: ArtifactRef
  source_artifacts: ArtifactRef[]
  known_limits: string[]
}
```

The TypeScript implementation may temporarily keep backward-compatible union
members if other slices still reference them, but no current driver/harness path
may emit AX-backed `corroborated`, `possible_boundary`, or `unknown` boundary
claims.

## Ordinary Observe

Every ordinary observe emits:

```text
top.state = 'not_at_boundary'
top.confidence = 'heuristic'
top.basis = ['ordinary_observe_default']

bottom.state = 'not_at_boundary'
bottom.confidence = 'heuristic'
bottom.basis = ['ordinary_observe_default']
```

This is an operational default: unless OCR evidence proves that a scroll action
hit a boundary, the workflow should assume more scroll context may exist.

The default is not AX-derived and must not include `ax_tree`,
`ax_scrollbar_value`, or `corroborated` evidence.

## Single-step Scroll Evidence

A future invoke-level scroll-boundary primitive would observe before a scroll,
perform one promoted-target scroll, then observe after the scroll.

Comparable evidence is OCR-only:

- `ocr_text`
- `ocr_row`

The fingerprint must ignore DOM and AX nodes. DOM/AX may still support other
observation and candidate workflows, but they do not determine scroll boundary
state.

### Down Scroll

`changed`

```text
bottom.state = 'not_at_boundary'
bottom.confidence = 'heuristic'
bottom.basis = ['single_step_changed']
```

`no_visible_change`

```text
bottom.state = 'at_boundary'
bottom.confidence = 'heuristic'
bottom.basis = ['single_step_no_visible_change']
```

`unknown`

```text
bottom.state = 'not_at_boundary'
bottom.confidence = 'heuristic'
bottom.basis = ['single_step_unknown']
```

The non-target side remains the ordinary observe default.

### Up Scroll

The same mapping applies to `top`.

## Safety Rules

- Rebuild the after-scroll boundary object from the current snapshot contract and
  evidence refs.
- Do not preserve old `snapshot.detail.scroll_boundary` AX or DOM boundary
  claims.
- Do not emit `corroborated` boundary confidence.
- Do not emit `possible_boundary`.
- Do not emit `unknown` as a boundary state from current observe or scroll-effect
  mapping.
- Do not add `reached_top`, `reached_bottom`, or `scroll_scan`.
- Do not use DOM scroll metrics.
- Do not perform browser-internal actions.

## Workflow Implications

The workflow consumes `scroll_boundary` as context:

- `not_at_boundary / heuristic` means the context is still potentially
  incomplete in that direction.
- `at_boundary / heuristic` means one OCR-backed scroll probe did not visibly
  change the page in that direction.

The workflow remains responsible for deciding whether to:

- keep scrolling;
- change scroll anchor;
- inspect pagination UI;
- switch search strategy;
- stop because enough information has been collected.

## Testing Requirements

Deterministic tests must cover:

- ordinary `observe()` always emits `detail.scroll_boundary`;
- ordinary observe defaults both sides to `not_at_boundary / heuristic`;
- AX scroll values at min, max, middle, horizontal, partial, or conflicting do
  not override the ordinary observe default;
- down + `changed` marks bottom `not_at_boundary`;
- up + `changed` marks top `not_at_boundary`;
- down + `no_visible_change` marks bottom `at_boundary`;
- up + `no_visible_change` marks top `at_boundary`;
- `unknown` scroll effect keeps the probed side `not_at_boundary`;
- non-target side stays ordinary observe default;
- DOM-only visible changes do not produce scroll `changed`;
- old AX/corroborated claims from an input snapshot are not preserved after
  scroll-boundary cloning.

Default tests must use mocks and fixtures. Real browser QA can be run separately
but is not the merge gate for this contract.
