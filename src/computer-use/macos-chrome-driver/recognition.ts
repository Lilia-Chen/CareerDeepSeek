import type { ArtifactRef, ChromeCaptureContract, ChromeRecognitionTarget, RecognitionResult, RecognitionScope, RecognizedItem } from './types.js'

const BUTTON_KINDS = new Set(['dom_button', 'ax_button'])
const TEXT_INPUT_KINDS = new Set(['dom_textbox', 'dom_searchbox', 'dom_combobox', 'ax_textfield', 'ax_textarea', 'ax_combobox'])
const LINK_KINDS = new Set(['dom_link', 'ax_link'])
const AUDIT_SOURCE_GROUPS = ['ocr_text', 'ocr_row', 'chrome_dom', 'ax', 'capture_visibility', 'custom'] as const
type AuditStatus = 'agreement' | 'conflict' | 'unknown'
type AuditSourceGroup = typeof AUDIT_SOURCE_GROUPS[number]

export function recognizeFromCapture(
  items: RecognizedItem[],
  target: ChromeRecognitionTarget,
  contract: ChromeCaptureContract,
  screenshotPath: string,
  runId = 'standalone',
  spanId = 'standalone',
  evidence: ArtifactRef[] = [],
): RecognitionResult {
  const filtered = items
    .filter(item => matchesTarget(item, target))
    .sort(compareForBest)

  const best = filtered[0] ?? null
  const source = inferRecognitionSource(best ?? items[0])
  const captureArtifact = evidence.find(ref => ref.artifact_id.startsWith('screenshot'))
  const captureContractArtifact = evidence.find(ref => ref.artifact_id.startsWith('capture_contract') || ref.artifact_id.startsWith('capture-contract'))

  const scope: RecognitionScope = {
    surface: 'window',
    window_number: contract.captureSource.windowNumber,
    app_bundle_id: contract.captureSource.ownerBundleId,
    capture_artifact: captureArtifact,
    capture_contract_artifact: captureContractArtifact,
  }

  const knownLimits: string[] = []
  if (items.length === 0) {
    knownLimits.push('recognition: empty input — no items provided')
  }
  if (!captureArtifact)
    knownLimits.push('recognition: missing capture artifact ref')
  if (!captureContractArtifact)
    knownLimits.push('recognition: missing capture contract artifact ref')
  if (filtered.length > 1)
    knownLimits.push(`recognition: multiple filtered candidates (${filtered.length}) remain ambiguous`)

  for (const item of items) {
    for (const limit of itemKnownLimits(item)) {
      if (!knownLimits.includes(limit))
        knownLimits.push(limit)
    }
  }

  const crossSourceAudit = buildCrossSourceAudit({
    all: items,
    filtered,
    captureArtifact,
    captureContractArtifact,
    recognitionKnownLimits: knownLimits,
  })
  for (const limit of crossSourceAudit.known_limits) {
    if (!knownLimits.includes(limit))
      knownLimits.push(limit)
  }

  return {
    found: best !== null,
    recognition_id: `mcr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source,
    scope,
    best,
    filtered,
    all: items,
    detail: {
      provider: 'careerdeepseek.macos_chrome_driver',
      run_id: runId,
      span_id: spanId,
      screenshot_path: screenshotPath,
      screenshot_pixel_size: contract.screenshotPixelSize,
      source,
      total_input_items: items.length,
      filtered_count: filtered.length,
      capture_artifact: captureArtifact,
      capture_contract_artifact: captureContractArtifact,
      cross_source_audit: crossSourceAudit,
    },
    evidence,
    known_limits: knownLimits,
  }
}

function buildCrossSourceAudit(input: {
  all: RecognizedItem[]
  filtered: RecognizedItem[]
  captureArtifact?: ArtifactRef
  captureContractArtifact?: ArtifactRef
  recognitionKnownLimits: string[]
}): Record<string, unknown> & { known_limits: string[] } {
  const sourceGroups = auditSourceGroups(input.all, input.captureArtifact, input.captureContractArtifact)
  const auditKnownLimits = auditRecognitionKnownLimits(input.recognitionKnownLimits)
  const items = input.filtered.map(item => auditItem(item, input.all, input.captureArtifact, input.captureContractArtifact))
  for (const item of items) {
    for (const limit of item.known_limits) {
      if (!auditKnownLimits.includes(limit))
        auditKnownLimits.push(limit)
    }
  }

  if (input.filtered.length === 0)
    pushUnique(auditKnownLimits, 'recognition audit: no filtered candidate to compare')

  const sources = sourceGroups.map(source => ({
    source,
    status: sourceStatus(source, items),
    item_ids: source === 'capture_visibility'
      ? []
      : input.all.filter(item => auditSourceGroup(item) === source).map(item => item.item_id),
    artifact_ids: source === 'capture_visibility'
      ? [input.captureArtifact?.artifact_id, input.captureContractArtifact?.artifact_id].filter((id): id is string => typeof id === 'string')
      : sourceArtifactIdsForGroup(input.all, source),
    known_limits: sourceKnownLimits(source, input.all, auditKnownLimits, items),
  }))
  const status = rollupStatus([
    ...items.map(item => item.status),
    ...sources.map(source => source.status),
  ], auditKnownLimits)

  return {
    status,
    source_groups: sourceGroups,
    sources,
    artifact_refs: {
      capture_artifact: input.captureArtifact,
      capture_contract_artifact: input.captureContractArtifact,
    },
    items,
    known_limits: auditKnownLimits,
  }
}

function auditItem(
  item: RecognizedItem,
  all: RecognizedItem[],
  captureArtifact: ArtifactRef | undefined,
  captureContractArtifact: ArtifactRef | undefined,
) {
  const sourceGroup = auditSourceGroup(item)
  const knownLimits = itemKnownLimits(item)
  const reasons: string[] = []
  const comparedItems = all
    .filter(other => other.item_id !== item.item_id)
    .filter(other => auditSourceGroup(other) !== sourceGroup)
    .map(other => compareAuditItems(item, other))
    .filter((comparison): comparison is NonNullable<typeof comparison> => comparison !== null)

  if (!captureArtifact) {
    reasons.push('missing capture artifact ref')
    pushUnique(knownLimits, 'recognition audit: missing capture artifact ref')
  }
  if (!captureContractArtifact) {
    reasons.push('missing capture contract artifact ref')
    pushUnique(knownLimits, 'recognition audit: missing capture contract artifact ref')
  }
  if (comparedItems.length === 0) {
    reasons.push('no comparable evidence from another source')
    pushUnique(knownLimits, `recognition audit: item ${item.item_id} has no comparable cross-source evidence`)
  }

  for (const comparison of comparedItems) {
    for (const limit of comparison.known_limits)
      pushUnique(knownLimits, limit)
  }

  const status: AuditStatus = comparedItems.some(comparison => comparison.status === 'conflict')
    ? 'conflict'
    : knownLimits.length > 0 || comparedItems.length === 0 || !captureArtifact || !captureContractArtifact
      ? 'unknown'
      : comparedItems.some(comparison => comparison.status === 'agreement')
        ? 'agreement'
        : 'unknown'

  if (status === 'conflict')
    pushUnique(knownLimits, `recognition audit: item ${item.item_id} has conflicting cross-source evidence`)

  return {
    item_id: item.item_id,
    kind: item.kind,
    source_group: sourceGroup,
    status,
    compared_item_ids: comparedItems.map(comparison => comparison.item_id),
    compared_items: comparedItems,
    reasons,
    artifact_refs: itemArtifactRefs(item, captureArtifact, captureContractArtifact),
    known_limits: knownLimits,
  }
}

function compareAuditItems(candidate: RecognizedItem, other: RecognizedItem) {
  if (!boundsOverlap(candidate.box, other.box))
    return null

  const knownLimits = itemKnownLimits(other)
  const candidateText = normalizedText(candidate.text)
  const otherText = normalizedText(other.text)
  if (!candidateText || !otherText) {
    pushUnique(knownLimits, `recognition audit: item ${other.item_id} has missing comparable text`)
    return {
      item_id: other.item_id,
      kind: other.kind,
      source_group: auditSourceGroup(other),
      status: 'unknown' as AuditStatus,
      reasons: ['missing comparable text'],
      known_limits: knownLimits,
    }
  }

  if (textsAgree(candidateText, otherText) && knownLimits.length === 0) {
    return {
      item_id: other.item_id,
      kind: other.kind,
      source_group: auditSourceGroup(other),
      status: 'agreement' as AuditStatus,
      reasons: ['text and bounds agree in current capture'],
      known_limits: knownLimits,
    }
  }

  if (textsAgree(candidateText, otherText)) {
    return {
      item_id: other.item_id,
      kind: other.kind,
      source_group: auditSourceGroup(other),
      status: 'unknown' as AuditStatus,
      reasons: ['matching evidence has known limits'],
      known_limits: knownLimits,
    }
  }

  pushUnique(knownLimits, `recognition audit: item ${candidate.item_id} text conflicts with ${other.item_id}`)
  return {
    item_id: other.item_id,
    kind: other.kind,
    source_group: auditSourceGroup(other),
    status: 'conflict' as AuditStatus,
    reasons: ['overlapping bounds but text differs'],
    known_limits: knownLimits,
  }
}

function auditSourceGroups(
  items: RecognizedItem[],
  captureArtifact: ArtifactRef | undefined,
  captureContractArtifact: ArtifactRef | undefined,
): AuditSourceGroup[] {
  const present = new Set<AuditSourceGroup>()
  for (const item of items)
    present.add(auditSourceGroup(item))
  if (items.length > 0 || captureArtifact || captureContractArtifact)
    present.add('capture_visibility')
  return AUDIT_SOURCE_GROUPS.filter(source => present.has(source))
}

function auditSourceGroup(item: RecognizedItem): AuditSourceGroup {
  if (item.kind === 'ocr_text')
    return 'ocr_text'
  if (item.kind === 'ocr_row')
    return 'ocr_row'
  if (item.kind.startsWith('dom_'))
    return 'chrome_dom'
  if (item.kind.startsWith('ax_'))
    return 'ax'
  return 'custom'
}

function sourceStatus(
  source: AuditSourceGroup,
  auditedItems: ReturnType<typeof auditItem>[],
): AuditStatus {
  if (source === 'capture_visibility')
    return 'unknown'

  const statuses = sourceComparisonStatuses(source, auditedItems)
  if (statuses.length === 0)
    return 'unknown'
  return rollupStatus(statuses, [])
}

function sourceKnownLimits(
  source: AuditSourceGroup,
  all: RecognizedItem[],
  auditKnownLimits: string[],
  auditedItems: ReturnType<typeof auditItem>[],
): string[] {
  if (source === 'capture_visibility') {
    return [
      ...auditKnownLimits.filter(limit => limit.includes('capture') || limit.includes('bounds') || limit.includes('visibility')),
      'recognition audit: capture visibility is reference evidence only; independent visibility verification unavailable',
    ]
  }

  const limits: string[] = []
  for (const item of all.filter(item => auditSourceGroup(item) === source)) {
    for (const limit of itemKnownLimits(item))
      pushUnique(limits, limit)
  }
  if (all.some(item => auditSourceGroup(item) === source) && sourceComparisonStatuses(source, auditedItems).length === 0)
    pushUnique(limits, `recognition audit: source ${source} present but not comparable to filtered candidates`)
  return limits
}

function sourceComparisonStatuses(source: AuditSourceGroup, auditedItems: ReturnType<typeof auditItem>[]): AuditStatus[] {
  return auditedItems.flatMap((item) => {
    const sourceStatuses: AuditStatus[] = []
    if (item.source_group === source)
      sourceStatuses.push(item.status)
    for (const comparison of item.compared_items) {
      if (comparison.source_group === source)
        sourceStatuses.push(comparison.status)
    }
    return sourceStatuses
  })
}

function sourceArtifactIdsForGroup(items: RecognizedItem[], source: AuditSourceGroup): string[] {
  const artifactIds: string[] = []
  for (const item of items.filter(item => auditSourceGroup(item) === source)) {
    const refs = itemArtifactRefs(item)
    for (const ref of Object.values(refs)) {
      if (ref && !artifactIds.includes(ref.artifact_id))
        artifactIds.push(ref.artifact_id)
    }
  }
  return artifactIds
}

function itemArtifactRefs(
  item: RecognizedItem,
  captureArtifact?: ArtifactRef,
  captureContractArtifact?: ArtifactRef,
): Record<string, ArtifactRef | undefined> {
  const refs = isRecord(item.detail?.source_artifacts) ? item.detail.source_artifacts : {}
  const itemCaptureArtifact = isArtifactRef(refs.capture_artifact) ? refs.capture_artifact : captureArtifact
  const itemCaptureContractArtifact = isArtifactRef(refs.capture_contract_artifact) ? refs.capture_contract_artifact : captureContractArtifact
  return {
    capture_artifact: itemCaptureArtifact,
    capture_contract_artifact: itemCaptureContractArtifact,
  }
}

function auditRecognitionKnownLimits(knownLimits: string[]): string[] {
  return knownLimits
    .filter(limit => limit.includes('missing capture')
      || limit.includes('invalid bounds')
      || limit.includes('projection')
      || limit.includes('visibility')
      || limit.includes('uncertain')
      || limit.includes('conflict')
      || limit.includes('multiple filtered candidates')
      || limit.includes('ambiguous'))
    .map(limit => limit.startsWith('recognition audit:') ? limit : `recognition audit: ${limit}`)
}

function rollupStatus(statuses: AuditStatus[], knownLimits: string[]): AuditStatus {
  if (statuses.includes('conflict'))
    return 'conflict'
  if (statuses.length === 0 || statuses.includes('unknown') || knownLimits.length > 0)
    return 'unknown'
  return 'agreement'
}

function boundsOverlap(a: RecognizedItem['box'], b: RecognizedItem['box']): boolean {
  return validBox(a)
    && validBox(b)
    && a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
}

function normalizedText(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function textsAgree(a: string, b: string): boolean {
  return a === b
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value))
    values.push(value)
}

function isArtifactRef(value: unknown): value is ArtifactRef {
  return isRecord(value)
    && typeof value.run_id === 'string'
    && typeof value.artifact_id === 'string'
    && typeof value.span_id === 'string'
}

function matchesTarget(item: RecognizedItem, target: ChromeRecognitionTarget): boolean {
  const itemText = item.text ?? ''
  function textMatches(expected: string | RegExp): boolean {
    if (expected instanceof RegExp)
      return expected.test(itemText)
    return itemText.toLowerCase().includes(expected.toLowerCase())
  }
  switch (target.kind) {
    case 'text_input': return TEXT_INPUT_KINDS.has(item.kind) && textMatches(target.name)
    case 'button': return BUTTON_KINDS.has(item.kind) && textMatches(target.text)
    case 'link': return LINK_KINDS.has(item.kind) && textMatches(target.text)
    case 'visible_text': return textMatches(target.text)
  }
}

function compareForBest(a: RecognizedItem, b: RecognizedItem): number {
  const aActionable = isActionable(a)
  const bActionable = isActionable(b)
  if (aActionable !== bActionable)
    return Number(bActionable) - Number(aActionable)
  return (b.provider_score ?? 0) - (a.provider_score ?? 0)
}

const ACTIONABLE_KINDS = new Set([
  'dom_button',
  'dom_link',
  'dom_textbox',
  'dom_searchbox',
  'ax_button',
  'ax_link',
  'ax_textfield',
  'ax_textarea',
  'ax_combobox',
  'ax_menu_item',
  'ax_tab',
])

function isActionable(item: RecognizedItem): boolean {
  if (ACTIONABLE_KINDS.has(item.kind))
    return true
  return item.detail?.actionable === true
}

function inferRecognitionSource(item: RecognizedItem | undefined): RecognitionResult['source'] {
  if (!item)
    return 'custom'
  if (item.kind === 'ocr_text')
    return 'ocr_text'
  if (item.kind === 'ocr_row')
    return 'ocr_row'
  if (item.kind === 'segmented_region')
    return 'segmented_region'
  if (item.kind === 'icon_match')
    return 'icon_match'
  if (item.kind.startsWith('dom_'))
    return 'chrome_dom'
  if (item.kind.startsWith('ax_'))
    return 'custom'
  return 'custom'
}

function itemKnownLimits(item: RecognizedItem): string[] {
  const limits: string[] = []

  if (isVisualEvidenceItem(item)) {
    if (isRowEvidenceItem(item) && item.provider_score === undefined)
      limits.push(`item ${item.item_id}: row confidence unavailable from provider`)
    else if (!validConfidence(item.provider_score))
      limits.push(`item ${item.item_id}: invalid or missing confidence`)
  }
  if (!validBox(item.box))
    limits.push(`item ${item.item_id}: invalid bounds or projection`)
  if (isVisualEvidenceItem(item) && !hasProjectedEvidence(item))
    limits.push(`item ${item.item_id}: invalid bounds or projection detail`)
  if (isRowEvidenceItem(item)) {
    limits.push(`item ${item.item_id}: heuristic row grouping is capture-local`)
    const fragments = item.detail?.text_fragments
    if (!Array.isArray(fragments) || fragments.length === 0)
      limits.push(`item ${item.item_id}: empty fragments`)
  }

  const itemLimits = item.detail?.known_limits
  if (Array.isArray(itemLimits)) {
    for (const limit of itemLimits) {
      if (typeof limit === 'string')
        limits.push(limit)
    }
  }

  return limits
}

function isVisualEvidenceItem(item: RecognizedItem): boolean {
  return item.kind === 'ocr_text' || isRowEvidenceItem(item)
}

function isRowEvidenceItem(item: RecognizedItem): boolean {
  return item.kind === 'ocr_row'
}

function validConfidence(confidence: number | undefined): boolean {
  return Number.isFinite(confidence) && confidence! >= 0 && confidence! <= 1
}

function validBox(box: RecognizedItem['box']): boolean {
  return Number.isFinite(box.x)
    && Number.isFinite(box.y)
    && Number.isFinite(box.width)
    && Number.isFinite(box.height)
    && box.width > 0
    && box.height > 0
}

function hasProjectedEvidence(item: RecognizedItem): boolean {
  if (hasCaptureAndProjectedBounds(item.detail?.bounds))
    return true
  if (hasCaptureAndProjectedBounds(item.detail?.row_bounds))
    return true
  return false
}

function hasCaptureAndProjectedBounds(value: unknown): boolean {
  return isRecord(value) && isRecord(value.capture_pixel) && isRecord(value.source_global_logical)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
