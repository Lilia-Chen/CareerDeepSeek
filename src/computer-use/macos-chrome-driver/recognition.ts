import type { ArtifactRef, ChromeCaptureContract, ChromeRecognitionTarget, RecognitionResult, RecognitionScope, RecognizedItem } from './types.js'

const BUTTON_KINDS = new Set(['dom_button', 'ax_button'])
const TEXT_INPUT_KINDS = new Set(['dom_textbox', 'dom_searchbox', 'dom_combobox', 'ax_textfield', 'ax_textarea', 'ax_combobox'])
const LINK_KINDS = new Set(['dom_link', 'ax_link'])

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
    },
    evidence,
    known_limits: knownLimits,
  }
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
