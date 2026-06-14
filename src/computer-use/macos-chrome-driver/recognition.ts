import type { ChromeCaptureContract, ChromeRecognitionTarget, RecognitionResult, RecognitionScope, RecognizedItem } from './types.js'

const BUTTON_KINDS = new Set(['dom_button', 'ax_button'])
const TEXT_INPUT_KINDS = new Set(['dom_textbox', 'dom_searchbox', 'ax_textfield', 'ax_textarea', 'ax_combobox'])
const LINK_KINDS = new Set(['dom_link', 'ax_link'])

export function recognizeFromCapture(
  items: RecognizedItem[],
  target: ChromeRecognitionTarget,
  contract: ChromeCaptureContract,
  screenshotPath: string,
  runId = 'standalone',
  spanId = 'standalone',
): RecognitionResult {
  const filtered = items
    .filter(item => matchesTarget(item, target))
    .sort(compareForBest)

  const best = filtered[0] ?? null

  const evidence = [
    { run_id: runId, artifact_id: `screenshot_${runId}`, span_id: spanId },
  ]

  const scope: RecognitionScope = {
    surface: 'window',
    window_number: contract.captureSource.windowNumber,
    app_bundle_id: contract.captureSource.ownerBundleId,
  }

  const knownLimits: string[] = []
  if (items.length === 0) {
    knownLimits.push('recognition: empty input — no items provided')
  }

  return {
    found: best !== null,
    recognition_id: `mcr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: inferRecognitionSource(items),
    scope,
    best,
    filtered,
    all: items,
    detail: {
      provider: 'careerdeepseek.macos_chrome_driver',
      screenshot_path: screenshotPath,
      total_input_items: items.length,
      filtered_count: filtered.length,
    },
    evidence,
    known_limits: knownLimits,
  }
}

function matchesTarget(item: RecognizedItem, target: ChromeRecognitionTarget): boolean {
  const itemText = item.text ?? ''
  function textMatches(expected: string | RegExp): boolean {
    if (expected instanceof RegExp) return expected.test(itemText)
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
  if (aActionable !== bActionable) return Number(bActionable) - Number(aActionable)
  return (b.provider_score ?? 0) - (a.provider_score ?? 0)
}

const ACTIONABLE_KINDS = new Set([
  'dom_button', 'dom_link', 'dom_textbox', 'dom_searchbox',
  'ax_button', 'ax_link', 'ax_textfield', 'ax_textarea', 'ax_combobox', 'ax_menu_item', 'ax_tab',
])

function isActionable(item: RecognizedItem): boolean {
  if (ACTIONABLE_KINDS.has(item.kind)) return true
  return item.detail?.actionable === true
}

function inferRecognitionSource(items: RecognizedItem[]): RecognitionResult['source'] {
  if (items.length === 0) return 'custom'
  const first = items[0]!
  if (first.kind.startsWith('dom_')) return 'chrome_dom'
  if (first.kind.startsWith('ax_')) return 'custom'
  return 'ocr_row'
}
