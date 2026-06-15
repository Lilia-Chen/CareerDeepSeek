/**
 * Computer-use observation and action types.
 *
 * These extend CareerDeepSeek's visual-automation types with
 * macOS-specific desktop observation structures.
 */

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayDescriptor {
  displayId: number
  isMain: boolean
  isBuiltIn: boolean
  bounds: Bounds
  visibleBounds: Bounds
  scaleFactor: number
  pixelWidth: number
  pixelHeight: number
}

export interface WindowDescriptor {
  id: string
  windowNumber?: number
  appName: string
  ownerBundleId?: string
  title: string | null
  bounds: Bounds
  ownerPid: number
  layer: number
  isOnScreen: boolean
}

export interface WindowObservation {
  frontmostAppName?: string
  frontmostAppBundleId?: string
  frontmostWindowTitle?: string | null
  windows: WindowDescriptor[]
  observedAt: string
}

export interface ScreenshotArtifact {
  dataBase64: string
  mimeType: 'image/png'
  path: string
  width?: number
  height?: number
  capturedAt: string
  placeholder?: boolean
  note?: string
}

// ---------------------------------------------------------------------------
// AX Tree
// ---------------------------------------------------------------------------

export interface AXNode {
  uid: string
  role: string
  title?: string
  value?: string
  description?: string
  enabled?: boolean
  focused?: boolean
  bounds?: Bounds
  children: AXNode[]
}

export interface AXSnapshot {
  snapshotId: string
  pid: number
  appName: string
  root: AXNode
  capturedAt: string
  maxDepth: number
  truncated: boolean
}

// ---------------------------------------------------------------------------
// Chrome DOM observation via AppleScript execute JS
// ---------------------------------------------------------------------------

export interface ChromeDomElement {
  id: string
  tagName: string
  role: string
  name: string
  text: string
  href: string | null
  bounds: Bounds
  center: { x: number, y: number }
  confidence: number
  actionable: boolean
  states: Record<string, unknown>
}

export interface ChromeDomObservation {
  url: string
  title: string
  observedAt: string
  visibleText: string
  elements: ChromeDomElement[]
  signals: string[]
}

export type BrowserPageClass
  = | 'empty_tab'
    | 'google_home'
    | 'google_results'
    | 'linkedin_feed'
    | 'linkedin_search_results'
    | 'linkedin_company_page'
    | 'linkedin_jobs_results'
    | 'linkedin_job_page'
    | 'company_site'
    | 'unknown'

export interface ChromeContext {
  running: boolean
  isFrontmost: boolean
  visibleWindowCount: number
  activeTabUrl: string | null
  activeTabTitle: string | null
  domAvailable: boolean
  domElementCount: number
  domVisibleTextLength: number
}

export interface BrowserPageContext {
  className: BrowserPageClass
  url: string | null
  title: string | null
  host: string | null
  source: 'chrome_dom' | 'window_title' | 'unknown'
  domAvailable: boolean
  signals: string[]
}

// ---------------------------------------------------------------------------
// Pointer trace
// ---------------------------------------------------------------------------

export interface PointerTracePoint {
  x: number
  y: number
  delayMs: number
}

// ---------------------------------------------------------------------------
// Swift script input payloads
// ---------------------------------------------------------------------------

export interface EnumerateWindowsInput {
  limit?: number
  app?: string
}

export interface CaptureAXTreeInput {
  pid?: number
  maxDepth?: number
  maxNodes?: number
  verbose?: boolean
}

export interface MoveAndClickInput {
  pointerTrace: PointerTracePoint[]
  button?: number
  clickCount?: number
}

export interface TypeTextInput {
  pointerTrace?: PointerTracePoint[]
  text: string
  pressEnter?: boolean
}

export interface PressKeysInput {
  keys: string[]
  modifiers?: string[]
}

export interface ScrollInput {
  pointerTrace?: PointerTracePoint[]
  deltaX?: number
  deltaY?: number
  settleMs?: number
}

export interface WindowTargetedScrollInput {
  pid: number
  windowNumber: number
  screenPoint: {
    x: number
    y: number
  }
  windowLocalPoint: {
    x: number
    y: number
  }
  deltaX: number
  deltaY: number
  settleMs?: number
}
