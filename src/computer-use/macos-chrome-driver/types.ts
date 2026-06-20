import type {
  Bounds,
  ScreenshotArtifact,
  WindowDescriptor,
} from '../types.js'

export type ChromeForegroundPolicy = 'require_chrome' | 'auto_focus_chrome'

export interface Size2D {
  width: number
  height: number
}

export interface Scale2D {
  x: number
  y: number
}

export interface ChromeWindowRef {
  id: string
  windowNumber: number
  appName: string
  ownerPid: number
  ownerBundleId?: string
  title: string | null
  bounds: Bounds
  layer: number
}

export interface ChromeContextLease {
  leaseId: string
  sessionId: string
  runId: string
  profileMode: 'managed'
  profileDir: string
  profilePath: string
  profileName?: string
  profileUserName?: string
  ownerPid: number
  windowNumber: number
  ownerBundleId?: string
  appBundleId?: string
  createdAt: string
  verifiedAt: string
}

export interface ChromeContextSnapshot {
  running: boolean
  isFrontmost: boolean
  frontmostAppName?: string
  frontmostAppBundleId?: string
  activeTabUrl: string | null
  activeTabTitle: string | null
  profile: {
    status: 'verified' | 'mismatch' | 'unverified'
    reason: string
    profile_path?: string
    profile_name?: string
    profile_user_name?: string
  }
  window: ChromeWindowRef
  lease?: ChromeContextLease
}

export interface ChromeCaptureContract {
  coordinateContractVersion: 1
  captureSource: {
    kind: 'window'
    windowNumber: number
    ownerPid: number
    ownerBundleId?: string
  }
  sourceGlobalLogicalBounds: Bounds
  screenshotPixelSize: Size2D
  pixelToLogicalScale: Scale2D
  logicalToPixelScale: Scale2D
  capturedAt: string
}

export interface ChromeWindowCapture {
  snapshotId: string
  screenshot: ScreenshotArtifact
  contract: ChromeCaptureContract
}

export interface OcrTextMatch {
  matchIndex: number
  text: string
  confidence: number
  bounds: Bounds
}

export type OcrRegionRatio = RatioRegion

export type OcrCropRect = Bounds

export interface OcrTextFragmentEvidence {
  matchIndex?: number
  text: string
  confidence?: number
  bounds?: Bounds
  knownLimits?: string[]
}

export interface OcrRowEvidence {
  rowIndex: number
  source: 'ocr_row'
  bounds: Bounds
  textFragments: OcrTextFragmentEvidence[]
  confidence?: number
  knownLimits?: string[]
  detail?: Record<string, unknown>
}

export type OcrRowProductionStrategy = 'ocr-text'

export interface OcrRowSnapshot {
  strategy: OcrRowProductionStrategy
  imagePath: string
  imageWidth: number
  imageHeight: number
  rawMatchCount: number
  filteredMatchCount: number
  rowCount: number
  rows: OcrRowEvidence[]
  providerDetail: Record<string, unknown>
  knownLimits: string[]
}

export interface OcrTextSnapshot {
  recognizedAt: string
  imagePath: string
  imageWidth: number
  imageHeight: number
  query: string
  exact: boolean
  caseSensitive: boolean
  normalizedQuery: string
  minConfidence?: number
  region?: OcrRegionRatio
  cropRect?: OcrCropRect
  ocrScaleFactor: number
  matches: OcrTextMatch[]
  rawMatchCount: number
  filteredMatchCount: number
  knownLimits?: string[]
}

export function requireWindowNumber(window: WindowDescriptor): number {
  const windowNumber = window.windowNumber
  if (typeof windowNumber !== 'number' || !Number.isInteger(windowNumber) || windowNumber <= 0) {
    throw new Error('Chrome window observation is missing a real kCGWindowNumber.')
  }
  return windowNumber
}

// ── AUV-aligned types (v1) ──

export interface RecognitionBox {
  x: number
  y: number
  width: number
  height: number
}

export interface RatioRegion {
  left: number
  top: number
  right: number
  bottom: number
}

export type RecognitionSource
  = 'ocr_text'
    | 'ocr_row'
    | 'segmented_region'
    | 'icon_match'
    | 'custom'
    | 'chrome_dom'

export type RecognitionSurface = 'screen' | 'display' | 'window' | 'region'

export interface RecognitionScope {
  surface: RecognitionSurface
  display_ref?: string
  native_display_id?: string
  app_bundle_id?: string
  window_title?: string
  window_number?: number
  region_hint?: RatioRegion
  capture_artifact?: ArtifactRef
  capture_contract_artifact?: ArtifactRef
}

export interface NodeRef {
  run_id: string
  span_id: string
  node_id: string
}

export interface SurfaceNode {
  node_ref: NodeRef
  kind: string
  label?: string
  box: RecognitionBox
  source_artifacts: string[]
  recognition_id?: string
  recognition_source?: RecognitionSource
  recognition_surface?: RecognitionSurface
  recognized_item_id?: string
  recognized_item_kind?: string
  provider_score?: number
  detail: Record<string, unknown>
  center?: { x: number, y: number }
}

export type ObservationSource = 'ax' | 'ocr' | 'merged' | 'chrome_dom'

export interface ObservationSnapshot {
  api_version: 'careerdeepseek.observation_snapshot.v1alpha1'
  snapshot_id: string
  run_id: string
  span_id: string
  captured_at_millis: number
  source: ObservationSource
  scope: RecognitionScope
  capture_contract_ref?: ArtifactRef
  evidence: ArtifactRef[]
  nodes: SurfaceNode[]
  detail: Record<string, unknown>
  known_limits: string[]
}

export interface ArtifactRef {
  run_id: string
  artifact_id: string
  span_id: string
  captured_event_id?: string
}

export const RUN_API_VERSION = 'careerdeepseek.run.v1alpha1'
export const SPAN_API_VERSION = 'careerdeepseek.span.v1alpha1'
export const EVENT_API_VERSION = 'careerdeepseek.event.v1alpha1'
export const ARTIFACT_API_VERSION = 'careerdeepseek.artifact.v1alpha1'

export type RunType = 'command' | 'execute' | 'probe' | 'analyze' | 'distill' | 'validate'
export type TraceState = 'running' | 'ended'
export type TraceStatusCode = 'unset' | 'ok' | 'error'

export interface RunRecord {
  api_version: string
  run_id: string
  trace_id: string
  run_type: RunType
  state: TraceState
  status_code: TraceStatusCode
  started_at_millis: number
  finished_at_millis?: number
  root_span_id: string
  attributes: Record<string, unknown>
  summary?: string
  failure?: { message: string }
}

export interface SpanRecord {
  api_version: string
  span_id: string
  parent_span_id?: string
  name: string
  state: TraceState
  status_code: TraceStatusCode
  started_at_millis: number
  finished_at_millis?: number
  attributes: Record<string, unknown>
  summary?: string
  failure?: { message: string }
}

export interface EventRecord {
  api_version: string
  event_id: string
  span_id: string
  name: string
  timestamp_millis: number
  attributes: Record<string, unknown>
  message?: string
  artifact_ids: string[]
}

export interface ArtifactRecord {
  api_version: string
  artifact_id: string
  span_id: string
  event_id?: string
  role: string
  mime_type: string
  path: string
  sha256?: string
  attributes: Record<string, unknown>
  summary?: string
}

export interface ProfileConfig {
  profile_path: string
  profile_name: string
  verified_at: string
}

export interface SafetyCheckResult {
  passed: boolean
  checks: {
    profile_verified: boolean
    chrome_foreground: boolean
    no_hard_stop_signal: boolean
  }
  failures: SafetyFailure[]
}

export interface SafetyFailure {
  code: string
  detail: string
  observed: unknown
  expected?: unknown
}
