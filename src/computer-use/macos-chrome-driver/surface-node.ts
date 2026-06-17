import type { AXSnapshot, Bounds, ChromeDomElement, ChromeDomObservation } from '../types.js'
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
    const axSnapshot = input.axSnapshot
    walkAxTree(axSnapshot.root, (axNode) => {
      if (axNode.role === 'AXWindow')
        return

      const text = axNode.title || axNode.description || axNode.value || ''
      if (text.trim()) {
        if (!validBounds(axNode.bounds))
          return
        const axBox = axNode.bounds
        const blockingLimits = axActionabilityBlockingLimits(axNode, input.contract.sourceGlobalLogicalBounds)
        const knownLimits = uniqueStrings([
          ...axEvidenceKnownLimits(axSnapshot),
          ...blockingLimits,
        ])
        nodes.push({
          node_ref: {
            run_id: input.runId,
            span_id: input.spanId,
            node_id: `ax_${axNode.uid}`,
          },
          kind: blockingLimits.length > 0 ? 'ax_evidence' : axRoleToSurfaceNodeKind(axNode.role),
          label: text,
          box: axBox,
          source_artifacts: sourceArtifacts,
          recognition_source: 'custom',
          recognition_surface: 'window',
          provider_score: 0.75,
          detail: {
            evidence_role: 'read_only_observation',
            ax_role: axNode.role,
            ax_title: axNode.title,
            ax_value: axNode.value,
            ax_description: axNode.description,
            focused: axNode.focused,
            enabled: axNode.enabled,
            coordinate_spaces: axCoordinateSpaces(),
            bounds: axBounds(axBox),
            ax_snapshot: axSnapshotDetail(axSnapshot),
            source_artifacts: sourceArtifactDetail(input),
            known_limits: knownLimits,
          },
          recognized_item_kind: axNode.role,
        })
      }
    })
  }

  // DOM elements → SurfaceNode (AUXILIARY)
  if (input.domObservation) {
    const vp = validBounds(input.viewportBounds) ? input.viewportBounds : { x: 0, y: 0, width: 0, height: 0 }
    for (const [index, element] of input.domObservation.elements.entries()) {
      if (!validBounds(element.bounds))
        continue
      const projectedBox = projectViewportLocalToSourceGlobal(element.bounds, vp)
      const projectedCenter = validPoint(element.center)
        ? projectViewportLocalPointToSourceGlobal(element.center, vp)
        : undefined
      const blockingLimits = domActionabilityBlockingLimits(element, input.viewportBounds)
      const knownLimits = uniqueStrings(blockingLimits)
      nodes.push({
        node_ref: {
          run_id: input.runId,
          span_id: input.spanId,
          node_id: `dom_${element.id ?? index}`,
        },
        kind: blockingLimits.length > 0 ? 'dom_evidence' : domRoleToSurfaceNodeKind(element.role ?? 'generic'),
        label: element.name || element.text || element.role,
        box: projectedBox,
        source_artifacts: sourceArtifacts,
        recognition_source: 'chrome_dom',
        recognition_surface: 'window',
        provider_score: element.confidence,
        center: projectedCenter,
        detail: {
          evidence_role: 'read_only_observation',
          dom_role: element.role,
          dom_name: element.name,
          dom_text: element.text,
          tag_name: element.tagName,
          href: element.href,
          states: element.states ?? {},
          provider_actionable: element.actionable,
          provider_confidence: element.confidence,
          coordinate_spaces: domCoordinateSpaces(),
          bounds: domBounds(element.bounds, vp, projectedBox),
          center: projectedCenter ? domCenter(element.center, projectedCenter) : undefined,
          source_artifacts: sourceArtifactDetail(input),
          known_limits: knownLimits,
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

function domCoordinateSpaces() {
  return {
    provider: 'dom_viewport_local_logical',
    projected: 'source_global_logical',
  }
}

function axCoordinateSpaces() {
  return {
    source: 'source_global_logical',
    note: 'AX bounds are provider source-global logical bounds, not OCR capture pixels',
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

function domBounds(
  domViewportLocal: Bounds,
  viewportBounds: Bounds,
  sourceGlobalLogical: RecognitionBox,
) {
  return {
    dom_viewport_local_logical: domViewportLocal,
    viewport_offset_logical: { x: viewportBounds.x, y: viewportBounds.y },
    source_global_logical: sourceGlobalLogical,
  }
}

function domCenter(
  domViewportLocal: { x: number, y: number },
  sourceGlobalLogical: { x: number, y: number },
) {
  return {
    dom_viewport_local_logical: domViewportLocal,
    source_global_logical: sourceGlobalLogical,
  }
}

function axBounds(sourceGlobalLogical: RecognitionBox) {
  return {
    source_global_logical: sourceGlobalLogical,
  }
}

function axSnapshotDetail(snapshot: AXSnapshot) {
  return {
    snapshot_id: snapshot.snapshotId,
    pid: snapshot.pid,
    app_name: snapshot.appName,
    captured_at: snapshot.capturedAt,
    max_depth: snapshot.maxDepth,
    truncated: snapshot.truncated,
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

function domActionabilityBlockingLimits(element: Partial<ChromeDomElement>, viewportBounds: Bounds | undefined): string[] {
  const limits: string[] = []
  const bounds = validBounds(element.bounds) ? element.bounds : undefined
  const center = validPoint(element.center) ? element.center : undefined
  if (!bounds)
    limits.push('DOM provider bounds missing or invalid')
  if (!center)
    limits.push('DOM provider center missing or invalid')
  if (!validConfidence(element.confidence))
    limits.push('DOM provider confidence invalid or outside 0..1')
  if (element.actionable === false)
    limits.push('DOM provider reports actionable=false; provider reports not actionable')
  else if (element.actionable !== true)
    limits.push('DOM provider actionability unavailable/uncertain')

  if (!viewportBounds || !validBounds(viewportBounds)) {
    limits.push('DOM viewport bounds unavailable; source-global projection assumes zero viewport offset')
  }
  else {
    const viewportLocalBounds = { x: 0, y: 0, width: viewportBounds.width, height: viewportBounds.height }
    if (bounds && !boundsIntersect(bounds, viewportLocalBounds))
      limits.push('DOM provider bounds do not intersect the reported viewport; visibility/actionability uncertain')
    if (center && ((bounds && !pointInsideBounds(center, bounds)) || !pointInsideBounds(center, viewportLocalBounds)))
      limits.push('DOM provider center outside bounds or viewport; visibility/actionability uncertain')
  }

  for (const limit of domStateKnownLimits(element.states))
    limits.push(limit)

  return uniqueStrings(limits)
}

function domStateKnownLimits(states: Record<string, unknown> | undefined): string[] {
  const observedStates = states ?? {}
  const limits: string[] = []
  if (truthyState(observedStates.hidden) || truthyState(observedStates['aria-hidden']) || truthyState(observedStates.ariaHidden) || observedStates.visible === false)
    limits.push('DOM provider state indicates hidden evidence')
  if (truthyState(observedStates.offscreen))
    limits.push('DOM provider state indicates offscreen evidence')
  if (truthyState(observedStates.covered))
    limits.push('DOM provider state indicates covered evidence')
  if (truthyState(observedStates.disabled))
    limits.push('DOM provider state indicates disabled evidence')
  return limits
}

function axEvidenceKnownLimits(snapshot: AXSnapshot): string[] {
  return snapshot.truncated
    ? ['AX snapshot truncated; descendant evidence may be incomplete']
    : []
}

function axActionabilityBlockingLimits(
  node: { enabled?: boolean, bounds?: Bounds },
  captureSourceBounds: Bounds,
): string[] {
  const limits: string[] = []
  if (node.enabled === false)
    limits.push('AX node reports enabled=false; provider actionability is not clean action truth')
  else if (node.enabled !== true)
    limits.push('AX provider enabled unavailable/uncertain')
  if (!validBounds(node.bounds))
    limits.push('AX provider bounds invalid')
  else if (!boundsIntersect(node.bounds, captureSourceBounds))
    limits.push('AX provider bounds do not intersect the capture source; visibility/actionability uncertain')
  return uniqueStrings(limits)
}

function validConfidence(confidence: number | undefined): boolean {
  return Number.isFinite(confidence) && confidence! >= 0 && confidence! <= 1
}

function validPoint(point: { x: number, y: number } | null | undefined): point is { x: number, y: number } {
  return typeof point === 'object'
    && point !== null
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
}

function validBounds(bounds: Bounds | null | undefined): bounds is Bounds {
  return typeof bounds === 'object'
    && bounds !== null
    && Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width > 0
    && bounds.height > 0
}

function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
}

function pointInsideBounds(point: { x: number, y: number }, bounds: Bounds): boolean {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height
}

function truthyState(value: unknown): boolean {
  return value === true || value === 'true'
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

function projectViewportLocalToSourceGlobal(
  viewportLocalBounds: Bounds,
  viewportBounds: Bounds,
): { x: number, y: number, width: number, height: number } {
  return {
    x: viewportBounds.x + viewportLocalBounds.x,
    y: viewportBounds.y + viewportLocalBounds.y,
    width: viewportLocalBounds.width,
    height: viewportLocalBounds.height,
  }
}

function projectViewportLocalPointToSourceGlobal(
  viewportLocalPoint: { x: number, y: number },
  viewportBounds: Bounds,
): { x: number, y: number } {
  return {
    x: viewportBounds.x + viewportLocalPoint.x,
    y: viewportBounds.y + viewportLocalPoint.y,
  }
}

function walkAxTree(
  node: { uid: string, role: string, title?: string, description?: string, value?: string, bounds?: { x: number, y: number, width: number, height: number }, enabled?: boolean, focused?: boolean, children: unknown[] },
  visitor: (node: { uid: string, role: string, title?: string, description?: string, value?: string, bounds?: { x: number, y: number, width: number, height: number }, enabled?: boolean, focused?: boolean }) => void,
) {
  if (node.bounds) {
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
