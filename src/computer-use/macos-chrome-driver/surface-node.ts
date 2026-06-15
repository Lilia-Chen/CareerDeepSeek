import type { AXSnapshot, ChromeDomObservation } from '../types.js'
import type {
  ArtifactRef,
  ChromeCaptureContract,
  ObservationSource,
  OcrRowEvidence,
  OcrTextMatch,
  RecognitionBox,
  SurfaceNode,
} from './types.js'

export interface NormalizeInput {
  ocrMatches: OcrTextMatch[]
  ocrRows?: OcrRowEvidence[]
  axSnapshot?: AXSnapshot
  domObservation?: ChromeDomObservation
  contract: ChromeCaptureContract
  runId: string
  spanId: string
  viewportBounds?: { x: number, y: number, width: number, height: number }
  captureArtifact?: ArtifactRef
  captureContractArtifact?: ArtifactRef
}

export function normalizeToSurfaceNodes(input: NormalizeInput): SurfaceNode[] {
  const nodes: SurfaceNode[] = []
  const sourceArtifacts = sourceArtifactIds(input)

  // OCR matches → SurfaceNode (PRIMARY source)
  for (const match of input.ocrMatches) {
    const projectedBox = projectPixelToLogical(match.bounds, input.contract)
    nodes.push({
      node_ref: {
        run_id: input.runId,
        span_id: input.spanId,
        node_id: `ocr_${match.matchIndex}`,
      },
      kind: 'ocr_text',
      label: match.text,
      box: projectedBox,
      source_artifacts: sourceArtifacts,
      recognition_source: 'ocr_text',
      provider_score: match.confidence,
      detail: {
        match_index: match.matchIndex,
        text: match.text,
        confidence: match.confidence,
        raw_pixel_bounds: match.bounds,
        coordinate_spaces: coordinateSpaces(),
        bounds: evidenceBounds(match.bounds, projectedBox),
        projection: projectionDetail(input.contract),
        source_artifacts: sourceArtifactDetail(input),
        known_limits: confidenceKnownLimits(match.confidence),
      },
    })
  }

  for (const row of input.ocrRows ?? []) {
    const projectedBox = projectPixelToLogical(row.bounds, input.contract)
    const rowKnownLimits = uniqueStrings([
      ...(Number.isFinite(row.confidence) ? [] : ['row confidence unavailable from provider']),
      ...(row.textFragments.length === 0 ? ['row text fragments empty'] : []),
      ...(row.knownLimits ?? []),
    ])
    nodes.push({
      node_ref: {
        run_id: input.runId,
        span_id: input.spanId,
        node_id: `${row.source}_${row.rowIndex}`,
      },
      kind: row.source,
      label: row.textFragments.map(fragment => fragment.text).join(' ').trim() || undefined,
      box: projectedBox,
      source_artifacts: sourceArtifacts,
      recognition_source: row.source,
      recognition_surface: 'window',
      provider_score: row.confidence,
      detail: {
        row_index: row.rowIndex,
        source: row.source,
        confidence: row.confidence,
        coordinate_spaces: coordinateSpaces(),
        row_bounds: evidenceBounds(row.bounds, projectedBox),
        projection: projectionDetail(input.contract),
        text_fragments: row.textFragments.map(fragment => fragment.text),
        fragment_evidence: row.textFragments.map(fragment => fragmentEvidence(fragment, input.contract)),
        source_artifacts: sourceArtifactDetail(input),
        known_limits: rowKnownLimits,
      },
    })
  }

  // AX nodes → SurfaceNode (AUXILIARY)
  if (input.axSnapshot) {
    walkAxTree(input.axSnapshot.root, (axNode) => {
      const text = axNode.title || axNode.description || axNode.value || ''
      if (text.trim()) {
        nodes.push({
          node_ref: {
            run_id: input.runId,
            span_id: input.spanId,
            node_id: `ax_${axNode.uid}`,
          },
          kind: axRoleToSurfaceNodeKind(axNode.role),
          label: text,
          box: {
            x: axNode.bounds!.x,
            y: axNode.bounds!.y,
            width: axNode.bounds!.width,
            height: axNode.bounds!.height,
          },
          source_artifacts: [],
          recognition_source: 'custom',
          recognition_surface: 'window',
          provider_score: 0.75,
          detail: {
            ax_role: axNode.role,
            focused: axNode.focused,
            enabled: axNode.enabled,
          },
        })
      }
    })
  }

  // DOM elements → SurfaceNode (AUXILIARY)
  if (input.domObservation) {
    const vp = input.viewportBounds ?? { x: 0, y: 0, width: 0, height: 0 }
    for (const element of input.domObservation.elements) {
      nodes.push({
        node_ref: {
          run_id: input.runId,
          span_id: input.spanId,
          node_id: `dom_${element.id}`,
        },
        kind: domRoleToSurfaceNodeKind(element.role),
        label: element.name || element.text || element.role,
        box: {
          x: vp.x + element.bounds.x,
          y: vp.y + element.bounds.y,
          width: element.bounds.width,
          height: element.bounds.height,
        },
        source_artifacts: [],
        recognition_source: 'chrome_dom',
        recognition_surface: 'window',
        provider_score: element.confidence,
        center: {
          x: vp.x + element.center.x,
          y: vp.y + element.center.y,
        },
        detail: {
          tag_name: element.tagName,
          href: element.href,
          actionable: element.actionable,
        },
        recognized_item_kind: element.role,
      })
    }
  }

  // Sort by y, then x
  nodes.sort((a, b) => {
    const dy = a.box.y - b.box.y
    return dy !== 0 ? dy : a.box.x - b.box.x
  })

  return nodes
}

export function inferObservationSource(nodes: SurfaceNode[]): ObservationSource {
  const sources = new Set(nodes.map(n => n.recognition_source))
  let count = 0
  const hasOcr = sources.has('ocr_text') || sources.has('ocr_row')
  if (hasOcr)
    count++
  if (sources.has('chrome_dom'))
    count++
  if (sources.has('custom'))
    count++ // AX → 'custom'
  if (count > 1)
    return 'merged'
  if (sources.has('chrome_dom'))
    return 'chrome_dom'
  if (sources.has('custom'))
    return 'ax'
  return 'ocr'
}

function sourceArtifactIds(input: NormalizeInput): string[] {
  return [
    input.captureArtifact?.artifact_id,
    input.captureContractArtifact?.artifact_id,
  ].filter((artifactId): artifactId is string => typeof artifactId === 'string')
}

function sourceArtifactDetail(input: NormalizeInput): Record<string, ArtifactRef> {
  const detail: Record<string, ArtifactRef> = {}
  if (input.captureArtifact)
    detail.capture_artifact = input.captureArtifact
  if (input.captureContractArtifact)
    detail.capture_contract_artifact = input.captureContractArtifact
  return detail
}

function coordinateSpaces() {
  return {
    raw: 'capture_pixel',
    projected: 'source_global_logical',
  }
}

function evidenceBounds(
  capturePixel: { x: number, y: number, width: number, height: number },
  sourceGlobalLogical: RecognitionBox,
) {
  return {
    capture_pixel: capturePixel,
    source_global_logical: sourceGlobalLogical,
  }
}

function projectionDetail(contract: ChromeCaptureContract) {
  return {
    contract_version: contract.coordinateContractVersion,
    pixel_to_logical_scale: contract.pixelToLogicalScale,
    source_global_logical_bounds: contract.sourceGlobalLogicalBounds,
  }
}

function fragmentEvidence(fragment: OcrRowEvidence['textFragments'][number], contract: ChromeCaptureContract) {
  const projected = fragment.bounds ? projectPixelToLogical(fragment.bounds, contract) : undefined
  return {
    match_index: fragment.matchIndex,
    text: fragment.text,
    confidence: fragment.confidence,
    bounds: fragment.bounds && projected ? evidenceBounds(fragment.bounds, projected) : undefined,
    known_limits: fragment.knownLimits ?? [],
  }
}

function confidenceKnownLimits(confidence: number | undefined): string[] {
  return Number.isFinite(confidence) && confidence! >= 0 && confidence! <= 1
    ? []
    : ['invalid or missing confidence']
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function projectPixelToLogical(
  pixelBounds: { x: number, y: number, width: number, height: number },
  contract: ChromeCaptureContract,
): { x: number, y: number, width: number, height: number } {
  return {
    x: contract.sourceGlobalLogicalBounds.x + pixelBounds.x * contract.pixelToLogicalScale.x,
    y: contract.sourceGlobalLogicalBounds.y + pixelBounds.y * contract.pixelToLogicalScale.y,
    width: pixelBounds.width * contract.pixelToLogicalScale.x,
    height: pixelBounds.height * contract.pixelToLogicalScale.y,
  }
}

function walkAxTree(
  node: { uid: string, role: string, title?: string, description?: string, value?: string, bounds?: { x: number, y: number, width: number, height: number }, enabled?: boolean, focused?: boolean, children: unknown[] },
  visitor: (node: { uid: string, role: string, title?: string, description?: string, value?: string, bounds?: { x: number, y: number, width: number, height: number }, enabled?: boolean, focused?: boolean }) => void,
) {
  if (node.bounds && node.bounds.width > 0 && node.bounds.height > 0) {
    visitor(node)
  }
  for (const child of node.children) {
    walkAxTree(child as typeof node, visitor)
  }
}

function axRoleToSurfaceNodeKind(role: string): string {
  const map: Record<string, string> = {
    AXButton: 'ax_button',
    AXLink: 'ax_link',
    AXTextField: 'ax_textfield',
    AXTextArea: 'ax_textarea',
    AXComboBox: 'ax_combobox',
    AXMenuItem: 'ax_menu_item',
    AXTab: 'ax_tab',
    AXStaticText: 'ax_static_text',
    AXGroup: 'ax_group',
    AXList: 'ax_list',
  }
  return map[role] ?? `ax_${role.toLowerCase().replace(/^ax/, '')}`
}

function domRoleToSurfaceNodeKind(role: string): string {
  const map: Record<string, string> = {
    textbox: 'dom_textbox',
    searchbox: 'dom_searchbox',
    button: 'dom_button',
    link: 'dom_link',
    heading: 'dom_heading',
    listitem: 'dom_listitem',
  }
  return map[role] ?? `dom_${role}`
}
