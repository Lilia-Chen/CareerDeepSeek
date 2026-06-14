import type { AXSnapshot, ChromeDomObservation } from '../types.js'
import type {
  ChromeCaptureContract,
  ObservationSource,
  OcrTextMatch,
  SurfaceNode,
} from './types.js'

export interface NormalizeInput {
  ocrMatches: OcrTextMatch[]
  axSnapshot?: AXSnapshot
  domObservation?: ChromeDomObservation
  contract: ChromeCaptureContract
  runId: string
  spanId: string
  startNodeIndex: number
  viewportBounds?: { x: number; y: number; width: number; height: number }
}

export function normalizeToSurfaceNodes(input: NormalizeInput): SurfaceNode[] {
  const nodes: SurfaceNode[] = []
  let idx = input.startNodeIndex

  // OCR matches → SurfaceNode (PRIMARY source)
  for (const match of input.ocrMatches) {
    nodes.push({
      node_ref: {
        run_id: input.runId,
        span_id: input.spanId,
        node_id: `ocr_${match.matchIndex}`,
      },
      kind: 'ocr_text',
      label: match.text,
      box: projectPixelToLogical(match.bounds, input.contract),
      source_artifacts: [],
      recognition_source: 'ocr_text',
      provider_score: match.confidence,
      detail: { match_index: match.matchIndex, raw_pixel_bounds: match.bounds },
    })
    idx++
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
        idx++
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
      idx++
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
  if (sources.has('ocr_text') || sources.has('ocr_row')) count++
  if (sources.has('chrome_dom')) count++
  if (sources.has('custom')) count++ // AX → 'custom'
  if (count > 1) return 'merged'
  if (sources.has('chrome_dom')) return 'chrome_dom'
  if (sources.has('custom')) return 'ax'
  return 'ocr'
}

function projectPixelToLogical(
  pixelBounds: { x: number; y: number; width: number; height: number },
  contract: ChromeCaptureContract,
): { x: number; y: number; width: number; height: number } {
  return {
    x: contract.sourceGlobalLogicalBounds.x + pixelBounds.x * contract.pixelToLogicalScale.x,
    y: contract.sourceGlobalLogicalBounds.y + pixelBounds.y * contract.pixelToLogicalScale.y,
    width: pixelBounds.width * contract.pixelToLogicalScale.x,
    height: pixelBounds.height * contract.pixelToLogicalScale.y,
  }
}

function walkAxTree(
  node: { uid: string; role: string; title?: string; description?: string; value?: string; bounds?: { x: number; y: number; width: number; height: number }; enabled?: boolean; focused?: boolean; children: unknown[] },
  visitor: (node: { uid: string; role: string; title?: string; description?: string; value?: string; bounds?: { x: number; y: number; width: number; height: number }; enabled?: boolean; focused?: boolean }) => void,
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
