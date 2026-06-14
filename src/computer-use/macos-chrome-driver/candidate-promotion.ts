import type {
  CandidatePromotion,
  ChromeCaptureContract,
  ChromeWindowRef,
  PromotedCandidate,
  PromotionRefusal,
  RecognitionResult,
} from './types.js'

export interface PromotionOptions {
  profile_verified: boolean
  chrome_foreground: boolean
  hard_stop_signals: string[]
  ttl_ms: number
  run_id: string
  span_id: string
}

export function promoteCandidate(
  recognition: RecognitionResult,
  capture: ChromeCaptureContract,
  window: ChromeWindowRef,
  options: PromotionOptions,
): CandidatePromotion {
  const reasons: PromotionRefusal[] = []

  if (recognition.all.length === 0) reasons.push('empty_recognition')
  if (recognition.best === null) reasons.push('no_unambiguous_target')
  if (recognition.evidence.length === 0) reasons.push('no_runtime_evidence')

  if (recognition.best && !isActionable(recognition.best)) reasons.push('item_not_actionable')
  if (recognition.best && !pointInsideWindow(recognition.best.box, window.bounds)) reasons.push('item_outside_viewport')

  const captureAge = Date.now() - new Date(capture.capturedAt).getTime()
  if (captureAge > options.ttl_ms) reasons.push('stale_capture')

  if (!options.profile_verified) reasons.push('profile_mismatch')
  if (!options.chrome_foreground) reasons.push('chrome_not_foreground')
  if (options.hard_stop_signals.length > 0) reasons.push('hard_stop_signal')

  if (reasons.length > 0) return { status: 'refused', reasons }

  const best = recognition.best!
  const candidate: PromotedCandidate = {
    candidate_local_id: `${recognition.recognition_id}:${best.item_id}`,
    kind: best.kind,
    label: best.text,
    target_spec: { grounding: 'coordinate', box: best.box, anchor_text: best.text },
    evidence: {
      capture_artifact: { run_id: options.run_id, artifact_id: `capture_${recognition.recognition_id}`, span_id: options.span_id },
      recognition_artifact: { run_id: options.run_id, artifact_id: `recognition_${recognition.recognition_id}`, span_id: options.span_id },
      observation_blob: {},
    },
    liveness: {
      preconditions: {
        window_ref: {
          app_bundle_id: window.ownerBundleId ?? 'com.google.Chrome',
          window_title_substring: window.title ?? undefined,
          window_number: window.windowNumber,
        },
        anchor_recheck: best.text ? {
          text: best.text,
          expected_min_confidence: 0.3,
          max_pixel_distance: 50,
        } : undefined,
      },
      ttl_hint_ms: options.ttl_ms,
    },
    control: { requires_app_frontmost: true, requires_window_focus: true },
    source_run_id: options.run_id,
    source_span_id: options.span_id,
    source_operation_id: recognition.recognition_id,
    source_artifact_id: `recognition_${recognition.recognition_id}`,
    known_limits: recognition.known_limits,
  }

  return { status: 'promoted', candidate, residual_known_limits: recognition.known_limits }
}

const ACTIONABLE_KINDS = new Set([
  'dom_button', 'dom_link', 'dom_textbox', 'dom_searchbox', 'dom_combobox',
  'ax_button', 'ax_link', 'ax_textfield', 'ax_textarea', 'ax_combobox', 'ax_menu_item', 'ax_tab',
  'ocr_text', 'ocr_row', 'visual_row',
])

function isActionable(item: { kind: string; detail: Record<string, unknown> }): boolean {
  if (ACTIONABLE_KINDS.has(item.kind)) return true
  return item.detail?.actionable === true
}

function pointInsideWindow(
  box: { x: number; y: number; width: number; height: number },
  bounds: { x: number; y: number; width: number; height: number },
): boolean {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  return cx >= bounds.x && cy >= bounds.y && cx <= bounds.x + bounds.width && cy <= bounds.y + bounds.height
}
