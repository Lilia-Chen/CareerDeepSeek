import type {
  CandidatePromotion,
  ArtifactRef,
  CandidateGrounding,
  ChromeCaptureContract,
  ChromeRecognitionTarget,
  ChromeWindowRef,
  PromotedCandidate,
  PromotionRefusal,
  RecognitionBox,
  RecognitionResult,
  RecognizedItem,
} from './types.js'

export interface PromotionOptions {
  profile_verified: boolean
  chrome_foreground: boolean
  hard_stop_signals: string[]
  ttl_ms: number
  run_id: string
  span_id: string
  capture_artifact?: ArtifactRef
  recognition_artifact?: ArtifactRef
  target_kind?: ChromeRecognitionTarget['kind']
}

export function promoteCandidate(
  recognition: RecognitionResult,
  capture: ChromeCaptureContract,
  window: ChromeWindowRef,
  options: PromotionOptions,
): CandidatePromotion {
  const reasons: PromotionRefusal[] = []
  const crossSourceAudit = parseCrossSourceAudit(recognition.detail.cross_source_audit)
  const selectedAuditItem = recognition.best && crossSourceAudit
    ? crossSourceAudit.items.find(item => item.item_id === recognition.best?.item_id)
    : undefined
  const effectiveTargetKind = effectiveTargetKindFor(options.target_kind, recognition.best)
  const isTextInputPromotion = effectiveTargetKind === 'text_input'

  if (recognition.all.length === 0)
    reasons.push('empty_recognition')
  if (recognition.best === null)
    reasons.push('no_unambiguous_target')
  if (recognition.filtered.length !== 1)
    reasons.push('ambiguous_recognition')
  if (recognition.evidence.length === 0)
    reasons.push('no_runtime_evidence')
  const captureArtifact = options.capture_artifact ?? recognition.scope.capture_artifact
  const recognitionArtifact = options.recognition_artifact
  if (!captureArtifact)
    reasons.push('missing_capture_artifact')
  if (!recognitionArtifact)
    reasons.push('no_runtime_evidence')

  if (!isTextInputPromotion) {
    if (!crossSourceAudit) {
      reasons.push('audit_unavailable')
    }
    else if (recognition.best && !selectedAuditItem) {
      reasons.push('audit_unavailable')
    }
  }

  if (recognition.best && !isActionableForPromotion(recognition.best, effectiveTargetKind))
    reasons.push('item_not_actionable')
  if (recognition.best && !hasTrustworthyProjection(recognition.best, recognition, crossSourceAudit, selectedAuditItem))
    reasons.push('projection_unavailable')
  if (recognition.best && hasValidBox(recognition.best.box) && !pointInsideWindow(recognition.best.box, window.bounds))
    reasons.push('item_outside_viewport')

  const captureAge = Date.now() - new Date(capture.capturedAt).getTime()
  if (captureAge > options.ttl_ms)
    reasons.push('stale_capture')

  if (!options.profile_verified)
    reasons.push('profile_mismatch')
  if (!options.chrome_foreground)
    reasons.push('chrome_not_foreground')
  if (options.hard_stop_signals.length > 0)
    reasons.push('hard_stop_signal')

  const residualKnownLimits = residualKnownLimitsFor(recognition, crossSourceAudit, selectedAuditItem)

  if (reasons.length > 0)
    return { status: 'refused', reasons: uniquePromotionReasons(reasons), residual_known_limits: residualKnownLimits }

  const best = recognition.best!
  const audit = crossSourceAudit
  const auditItem = selectedAuditItem
  const anchorRecheckText = best.text
  const candidate: PromotedCandidate = {
    candidate_local_id: `${recognition.recognition_id}:${best.item_id}`,
    kind: best.kind,
    label: best.text,
    target_spec: { grounding: groundingFor(best), box: best.box, anchor_text: best.text },
    evidence: {
      capture_artifact: captureArtifact!,
      recognition_artifact: recognitionArtifact!,
      observation_blob: {
        recognition_scope: recognition.scope,
        best_item: best,
        filtered_item_ids: recognition.filtered.map(item => item.item_id),
        ...(audit
          ? {
              audit_rollup: {
                status: audit.status,
                known_limits: audit.known_limits,
              },
            }
          : {}),
        ...(auditItem ? { selected_audit_item: auditItem.raw } : {}),
        grounding: groundingObservationFor(best),
        evidence_refs: {
          capture_artifact: captureArtifact!,
          capture_contract_artifact: auditItem?.artifact_refs.capture_contract_artifact
            ?? audit?.artifact_refs.capture_contract_artifact
            ?? recognition.scope.capture_contract_artifact,
          recognition_artifact: recognitionArtifact!,
        },
        known_limits: residualKnownLimits,
      },
    },
    liveness: {
      preconditions: {
        window_ref: {
          app_bundle_id: window.ownerBundleId ?? 'com.google.Chrome',
          window_title_substring: window.title ?? undefined,
          window_number: window.windowNumber,
        },
        anchor_recheck: anchorRecheckText
          ? {
              text: anchorRecheckText,
              expected_min_confidence: 0.3,
              max_pixel_distance: 50,
            }
          : undefined,
      },
      ttl_hint_ms: options.ttl_ms,
    },
    control: { requires_app_frontmost: true, requires_window_focus: true },
    source_run_id: options.run_id,
    source_span_id: options.span_id,
    source_operation_id: recognition.recognition_id,
    source_artifact_id: recognitionArtifact!.artifact_id,
    known_limits: residualKnownLimits,
  }

  return { status: 'promoted', candidate, residual_known_limits: residualKnownLimits }
}

const PROMOTABLE_OCR_KINDS = new Set([
  'ocr_text',
  'ocr_row',
])

const PROMOTABLE_TEXT_INPUT_KINDS = new Set([
  'dom_textbox',
  'dom_searchbox',
  'dom_combobox',
  'ax_textfield',
  'ax_textarea',
  'ax_combobox',
])

function effectiveTargetKindFor(
  targetKind: ChromeRecognitionTarget['kind'] | undefined,
  best: RecognizedItem | null,
): ChromeRecognitionTarget['kind'] | undefined {
  if (targetKind)
    return targetKind
  if (best && PROMOTABLE_TEXT_INPUT_KINDS.has(best.kind))
    return 'text_input'
  return undefined
}

function isActionableForPromotion(
  item: { kind: string, detail: Record<string, unknown> },
  targetKind: ChromeRecognitionTarget['kind'] | undefined,
): boolean {
  if (targetKind === 'text_input')
    return PROMOTABLE_TEXT_INPUT_KINDS.has(item.kind)
  if (targetKind && PROMOTABLE_TEXT_INPUT_KINDS.has(item.kind))
    return false
  return isActionable(item)
}

function isActionable(item: { kind: string, detail: Record<string, unknown> }): boolean {
  if (item.kind === 'ocr_row')
    return hasOcrRowEvidence(item)
  return PROMOTABLE_OCR_KINDS.has(item.kind) || PROMOTABLE_TEXT_INPUT_KINDS.has(item.kind)
}

function groundingFor(item: RecognizedItem): CandidateGrounding {
  if (item.kind === 'ocr_text')
    return 'ocr_anchor'
  if (item.kind === 'ocr_row')
    return 'visual_row'
  if (PROMOTABLE_TEXT_INPUT_KINDS.has(item.kind))
    return 'ax_node'
  return 'coordinate'
}

function groundingObservationFor(item: RecognizedItem): Record<string, unknown> {
  if (item.kind === 'ocr_text') {
    return {
      item_id: item.item_id,
      source: 'ocr_text',
      text: item.text,
      confidence: item.provider_score,
    }
  }
  if (item.kind === 'ocr_row') {
    return {
      item_id: item.item_id,
      source: 'ocr_row',
      row_index: numberDetail(item.detail, 'row_index'),
      text: item.text,
      confidence: item.provider_score,
    }
  }
  if (PROMOTABLE_TEXT_INPUT_KINDS.has(item.kind)) {
    return {
      item_id: item.item_id,
      source: item.kind.startsWith('dom_') ? 'chrome_dom' : 'ax',
      node_kind: item.kind,
      name: item.text,
    }
  }
  return { item_id: item.item_id, source: 'coordinate' }
}

function hasOcrRowEvidence(item: { detail: Record<string, unknown> }): boolean {
  return numberDetail(item.detail, 'row_index') !== undefined
    && isRecord(item.detail.row_bounds)
}

function pointInsideWindow(
  box: { x: number, y: number, width: number, height: number },
  bounds: { x: number, y: number, width: number, height: number },
): boolean {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  return cx >= bounds.x && cy >= bounds.y && cx <= bounds.x + bounds.width && cy <= bounds.y + bounds.height
}

type AuditStatus = 'agreement' | 'conflict' | 'unknown'

interface ParsedCrossSourceAudit {
  status: AuditStatus
  artifact_refs: {
    capture_artifact?: ArtifactRef
    capture_contract_artifact?: ArtifactRef
  }
  source_groups: string[]
  sources: ParsedAuditSource[]
  items: ParsedAuditItem[]
  known_limits: string[]
}

interface ParsedAuditSource {
  source: string
  status: AuditStatus
  item_ids: string[]
  artifact_ids: string[]
  known_limits: string[]
}

interface ParsedAuditItem {
  item_id: string
  kind: string
  source_group: string
  status: AuditStatus
  compared_item_ids: string[]
  compared_items: ParsedComparedAuditItem[]
  reasons: string[]
  artifact_refs: {
    capture_artifact?: ArtifactRef
    capture_contract_artifact?: ArtifactRef
  }
  known_limits: string[]
  raw: Record<string, unknown>
}

interface ParsedComparedAuditItem {
  item_id: string
  kind: string
  source_group: string
  status: AuditStatus
  reasons: string[]
  known_limits: string[]
}

function parseCrossSourceAudit(value: unknown): ParsedCrossSourceAudit | null {
  if (!isRecord(value))
    return null
  if (!isAuditStatus(value.status))
    return null
  const sourceGroups = parseStringArray(value.source_groups)
  if (!sourceGroups)
    return null
  if (!Array.isArray(value.sources))
    return null
  const sources: ParsedAuditSource[] = []
  for (const source of value.sources) {
    const parsed = parseAuditSource(source)
    if (!parsed)
      return null
    sources.push(parsed)
  }
  if (!Array.isArray(value.items))
    return null
  const knownLimits = parseStringArray(value.known_limits)
  if (!knownLimits)
    return null

  const artifactRefs = isRecord(value.artifact_refs) ? value.artifact_refs : {}
  if (!isRecord(value.artifact_refs))
    return null
  const items: ParsedAuditItem[] = []
  for (const item of value.items) {
    const parsed = parseAuditItem(item)
    if (!parsed)
      return null
    items.push(parsed)
  }
  if (!auditShapeIsConsistent({ sourceGroups, sources, items }))
    return null

  return {
    status: value.status,
    artifact_refs: {
      capture_artifact: isArtifactRef(artifactRefs.capture_artifact) ? artifactRefs.capture_artifact : undefined,
      capture_contract_artifact: isArtifactRef(artifactRefs.capture_contract_artifact) ? artifactRefs.capture_contract_artifact : undefined,
    },
    source_groups: sourceGroups,
    sources,
    items,
    known_limits: knownLimits,
  }
}

function parseAuditSource(value: unknown): ParsedAuditSource | null {
  if (!isRecord(value) || typeof value.source !== 'string' || !isAuditStatus(value.status))
    return null
  const itemIds = parseStringArray(value.item_ids)
  const artifactIds = parseStringArray(value.artifact_ids)
  const knownLimits = parseStringArray(value.known_limits)
  if (!itemIds || !artifactIds || !knownLimits)
    return null
  return {
    source: value.source,
    status: value.status,
    item_ids: itemIds,
    artifact_ids: artifactIds,
    known_limits: knownLimits,
  }
}

function parseAuditItem(value: unknown): ParsedAuditItem | null {
  if (!isRecord(value)
    || typeof value.item_id !== 'string'
    || typeof value.kind !== 'string'
    || typeof value.source_group !== 'string'
    || !isAuditStatus(value.status)
    || !isRecord(value.artifact_refs)) {
    return null
  }
  const comparedItemIds = parseStringArray(value.compared_item_ids)
  const reasons = parseStringArray(value.reasons)
  const knownLimits = parseStringArray(value.known_limits)
  if (!comparedItemIds || !reasons || !knownLimits)
    return null
  const comparedItems = parseComparedAuditItems(value.compared_items)
  if (!comparedItems)
    return null
  if (comparedItems.length > 0 && !sameStringSet(comparedItemIds, comparedItems.map(item => item.item_id)))
    return null
  return {
    item_id: value.item_id,
    kind: value.kind,
    source_group: value.source_group,
    status: value.status,
    compared_item_ids: comparedItemIds,
    compared_items: comparedItems,
    reasons,
    artifact_refs: {
      capture_artifact: isArtifactRef(value.artifact_refs.capture_artifact) ? value.artifact_refs.capture_artifact : undefined,
      capture_contract_artifact: isArtifactRef(value.artifact_refs.capture_contract_artifact) ? value.artifact_refs.capture_contract_artifact : undefined,
    },
    known_limits: knownLimits,
    raw: value,
  }
}

function parseComparedAuditItems(value: unknown): ParsedComparedAuditItem[] | null {
  if (value === undefined)
    return []
  if (!Array.isArray(value))
    return null
  const comparedItems: ParsedComparedAuditItem[] = []
  for (const item of value) {
    if (!isRecord(item)
      || typeof item.item_id !== 'string'
      || typeof item.kind !== 'string'
      || typeof item.source_group !== 'string'
      || !isAuditStatus(item.status)) {
      return null
    }
    const reasons = parseStringArray(item.reasons)
    const knownLimits = parseStringArray(item.known_limits)
    if (!reasons || !knownLimits)
      return null
    comparedItems.push({
      item_id: item.item_id,
      kind: item.kind,
      source_group: item.source_group,
      status: item.status,
      reasons,
      known_limits: knownLimits,
    })
  }
  return comparedItems
}

function auditShapeIsConsistent(input: {
  sourceGroups: string[]
  sources: ParsedAuditSource[]
  items: ParsedAuditItem[]
}): boolean {
  const sourceGroups = new Set(input.sourceGroups)
  const sourcesByGroup = new Map(input.sources.map(source => [source.source, source]))

  for (const source of input.sources) {
    if (!sourceGroups.has(source.source))
      return false
  }
  for (const item of input.items) {
    if (!sourceGroups.has(item.source_group))
      return false
    const itemSource = sourcesByGroup.get(item.source_group)
    if (!itemSource)
      return false
    if (itemSource.item_ids.length > 0 && !itemSource.item_ids.includes(item.item_id))
      return false
    for (const compared of item.compared_items) {
      if (!sourceGroups.has(compared.source_group))
        return false
      const comparedSource = sourcesByGroup.get(compared.source_group)
      if (!comparedSource)
        return false
      if (comparedSource.item_ids.length > 0 && !comparedSource.item_ids.includes(compared.item_id))
        return false
    }
  }
  return true
}

function auditContainsConflict(audit: ParsedCrossSourceAudit): boolean {
  return audit.status === 'conflict'
    || audit.sources.some(source => source.status === 'conflict')
    || audit.items.some(item => item.status === 'conflict'
      || item.compared_items.some(compared => compared.status === 'conflict'))
}

function residualKnownLimitsFor(
  recognition: RecognitionResult,
  audit: ParsedCrossSourceAudit | null,
  selectedAuditItem: ParsedAuditItem | undefined,
): string[] {
  return uniqueStrings([
    ...recognition.known_limits,
    ...(audit?.known_limits ?? []),
    ...(selectedAuditItem?.known_limits ?? []),
    ...auditConflictKnownLimits(audit),
  ])
}

function auditConflictKnownLimits(audit: ParsedCrossSourceAudit | null): string[] {
  if (!audit || !auditContainsConflict(audit))
    return []

  const limits = ['cross_source_audit_conflict_observed']
  for (const source of audit.sources) {
    if (source.status === 'conflict')
      limits.push(`cross-source audit conflict: source ${source.source} reported conflict`)
    limits.push(...source.known_limits)
  }
  for (const item of audit.items) {
    if (item.status === 'conflict') {
      limits.push(`cross-source audit conflict: item ${item.item_id} reported conflict`)
      limits.push(...item.reasons)
    }
    limits.push(...item.known_limits)
    for (const compared of item.compared_items) {
      if (compared.status === 'conflict') {
        limits.push(`cross-source audit conflict: compared item ${compared.item_id} reported conflict`)
        limits.push(...compared.reasons)
      }
      limits.push(...compared.known_limits)
    }
  }
  return uniqueStrings(limits)
}

function hasTrustworthyProjection(
  item: RecognizedItem,
  recognition: RecognitionResult,
  audit: ParsedCrossSourceAudit | null,
  selectedAuditItem: ParsedAuditItem | undefined,
): boolean {
  if (!hasValidBox(item.box))
    return false
  const captureContractArtifact = selectedAuditItem?.artifact_refs.capture_contract_artifact
    ?? audit?.artifact_refs.capture_contract_artifact
    ?? recognition.scope.capture_contract_artifact
  if (!captureContractArtifact)
    return false
  return hasProjectedCoordinateEvidence(item)
}

function hasProjectedCoordinateEvidence(item: RecognizedItem): boolean {
  if (item.kind === 'ocr_text')
    return hasCaptureAndProjectedBounds(item.detail.bounds, item.box)
  if (item.kind === 'ocr_row')
    return hasCaptureAndProjectedBounds(item.detail.row_bounds, item.box)
  return hasProjectedLogicalBounds(item.detail.bounds, item.box) || hasProjectedLogicalBounds(item.detail.row_bounds, item.box)
}

function hasCaptureAndProjectedBounds(value: unknown, expectedBox: RecognitionBox): boolean {
  return isRecord(value)
    && hasValidBox(value.capture_pixel)
    && hasValidBox(value.source_global_logical)
    && boxesMatch(value.source_global_logical, expectedBox)
}

function hasProjectedLogicalBounds(value: unknown, expectedBox: RecognitionBox): boolean {
  return isRecord(value)
    && hasValidBox(value.source_global_logical)
    && boxesMatch(value.source_global_logical, expectedBox)
}

function hasValidBox(value: unknown): value is RecognitionBox {
  if (!isRecord(value))
    return false
  const { x, y, width, height } = value
  return Number.isFinite(x)
    && Number.isFinite(y)
    && Number.isFinite(width)
    && Number.isFinite(height)
    && typeof width === 'number'
    && typeof height === 'number'
    && width > 0
    && height > 0
}

function boxesMatch(a: RecognitionBox, b: RecognitionBox): boolean {
  const tolerance = 0.5
  return Math.abs(a.x - b.x) <= tolerance
    && Math.abs(a.y - b.y) <= tolerance
    && Math.abs(a.width - b.width) <= tolerance
    && Math.abs(a.height - b.height) <= tolerance
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value))
    return null
  return value.every(item => typeof item === 'string') ? value : null
}

function numberDetail(value: Record<string, unknown>, key: string): number | undefined {
  const detailValue = value[key]
  return typeof detailValue === 'number' && Number.isFinite(detailValue) ? detailValue : undefined
}

function sameStringSet(a: string[], b: string[]): boolean {
  const left = new Set(a)
  const right = new Set(b)
  if (left.size !== right.size)
    return false
  for (const value of left) {
    if (!right.has(value))
      return false
  }
  return true
}

function isArtifactRef(value: unknown): value is ArtifactRef {
  return isRecord(value)
    && typeof value.run_id === 'string'
    && typeof value.artifact_id === 'string'
    && typeof value.span_id === 'string'
}

function isAuditStatus(value: unknown): value is AuditStatus {
  return value === 'agreement' || value === 'conflict' || value === 'unknown'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function uniquePromotionReasons(values: PromotionRefusal[]): PromotionRefusal[] {
  return [...new Set(values)]
}
