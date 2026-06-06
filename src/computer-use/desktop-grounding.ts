/**
 * Desktop grounding — unified observation aggregation.
 *
 * Runs screenshot, window observation, AX tree, and Chrome DOM capture in
 * parallel, then merges everything into a single DesktopGroundingSnapshot
 * with deduplicated, ranked target candidates.
 *
 * Deduplication priority: chrome_dom > ax > vision > raw
 */

import type { ComputerUseConfig } from './config.js'
import type {
  AXNode,
  AXSnapshot,
  Bounds,
  ChromeDomElement,
  ChromeDomObservation,
  DesktopGroundingSnapshot,
  DesktopTargetCandidate,
  ScreenshotArtifact,
  WindowObservation,
} from './types.js'

import { captureScreenshot } from './screenshot.js'
import { observeWindows } from './window-observation.js'
import { captureAXTree } from './ax-tree.js'
import { captureChromeDom } from './chrome-dom.js'
import { buildChromeContext, classifyBrowserPage } from './page-context.js'

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_MS = 3000

let nextSnapshotId = 1

export async function captureDesktopGrounding(
  config: ComputerUseConfig,
): Promise<DesktopGroundingSnapshot> {
  const assemblyStart = Date.now()

  // Phase 1: parallel capture of all observation sources
  const [screenshotResult, windowsResult, axResult, chromeDomResult]
    = await Promise.allSettled([
      captureScreenshot(config, 'desktop_observe'),
      observeWindows(config, { limit: 120 }),
      captureAXTree(config, { maxDepth: 15, maxNodes: 2000 }),
      captureChromeDom(config),
    ])

  const screenshot: ScreenshotArtifact
    = screenshotResult.status === 'fulfilled'
      ? screenshotResult.value
      : placeholderScreenshot()

  const windowObs: WindowObservation
    = windowsResult.status === 'fulfilled'
      ? windowsResult.value
      : emptyWindowObservation()

  const axSnapshot: AXSnapshot | undefined
    = axResult.status === 'fulfilled' ? axResult.value : undefined

  const chromeDomObs: ChromeDomObservation | null
    = chromeDomResult.status === 'fulfilled' && chromeDomResult.value !== null
      ? chromeDomResult.value
      : null

  const foregroundApp
    = windowObs.frontmostAppName || axSnapshot?.appName || 'unknown'

  // Phase 2: Find Chrome viewport bounds for DOM coordinate offset.
  // Chrome DOM getBoundingClientRect() is relative to the page viewport,
  // not the outer Chrome window. Prefer AXWebArea when available.
  const chromeWindowBounds = findChromeWindowBounds(windowObs)
  const chromeViewportBounds = findChromeViewportBounds(axSnapshot) ?? chromeWindowBounds

  // Phase 3: Build target candidates
  const isChromeFront = foregroundApp.toLowerCase().includes('chrome')
  const chromeContext = buildChromeContext({
    windowObs,
    foregroundApp,
    chromeDomObs,
  })
  const pageContext = classifyBrowserPage({
    url: chromeDomObs?.url ?? null,
    title: chromeDomObs?.title ?? null,
    domAvailable: chromeContext.domAvailable,
    signals: chromeDomObs?.signals ?? [],
  })

  const candidates = buildTargetCandidates({
    axSnapshot,
    chromeDomObs: isChromeFront ? chromeDomObs : null,
    chromeViewportBounds: isChromeFront ? chromeViewportBounds : undefined,
    foregroundApp,
  })

  // Phase 4: Compute staleness
  const now = Date.now()
  const staleFlags = {
    screenshot: screenshot.placeholder === true
      || (now - new Date(screenshot.capturedAt).getTime()) > STALE_THRESHOLD_MS,
    ax: !axSnapshot
      || (now - new Date(axSnapshot.capturedAt).getTime()) > STALE_THRESHOLD_MS,
    chromeSemantic: !chromeDomObs,
    windows: windowObs.windows.length === 0,
  }

  return {
    snapshotId: `dg_${nextSnapshotId++}`,
    capturedAt: new Date(assemblyStart).toISOString(),
    foregroundApp,
    windows: windowObs.windows,
    screenshot,
    axSnapshot,
    chromeContext,
    pageContext,
    chromeDomObservation: chromeDomObs ?? undefined,
    targetCandidates: candidates,
    staleFlags,
  }
}

// ---------------------------------------------------------------------------
// Candidate building
// ---------------------------------------------------------------------------

function buildTargetCandidates(params: {
  axSnapshot?: AXSnapshot
  chromeDomObs?: ChromeDomObservation | null
  chromeViewportBounds?: Bounds
  foregroundApp: string
}): DesktopTargetCandidate[] {
  const { axSnapshot, chromeDomObs, chromeViewportBounds, foregroundApp } = params

  // 1. Build Chrome DOM candidates (viewport coords → global coords)
  let chromeCandidates: DesktopTargetCandidate[] = []
  if (chromeDomObs && chromeViewportBounds) {
    chromeCandidates = chromeDomElementsToCandidates(
      chromeDomObs.elements,
      chromeViewportBounds,
      foregroundApp,
    )
  }

  // 2. Build AX candidates (already in global screen coords)
  let axCandidates: DesktopTargetCandidate[] = []
  if (axSnapshot) {
    axCandidates = axNodesToCandidates(axSnapshot, foregroundApp)
  }

  // 3. Deduplicate: remove AX candidates whose bounds overlap >70% (IoU)
  //    with any Chrome candidate (Chrome DOM is richer and preferred).
  const DEDUP_IOU_THRESHOLD = 0.7
  if (chromeCandidates.length > 0 && axCandidates.length > 0) {
    axCandidates = axCandidates.filter(axCandidate =>
      !chromeCandidates.some(cc =>
        boundsIoU(cc.bounds, axCandidate.bounds) >= DEDUP_IOU_THRESHOLD,
      ),
    )
  }

  // 4. Merge and rank: chrome_dom first, then ax, then by confidence
  const merged = [...chromeCandidates, ...axCandidates]
  merged.sort((a, b) => {
    const order: Record<string, number> = { chrome_dom: 0, ax: 1, vision: 2, raw: 3 }
    const aOrder = order[a.source] ?? 3
    const bOrder = order[b.source] ?? 3
    if (aOrder !== bOrder)
      return aOrder - bOrder
    return b.confidence - a.confidence
  })

  // Assign stable ids
  for (let i = 0; i < merged.length; i++) {
    merged[i].id = `t_${i}`
  }

  // Limit to top 200
  return merged.slice(0, 200)
}

// ---------------------------------------------------------------------------
// Chrome DOM candidates
// ---------------------------------------------------------------------------

function chromeDomElementsToCandidates(
  elements: ChromeDomElement[],
  chromeViewportBounds: Bounds,
  appName: string,
): DesktopTargetCandidate[] {
  return elements.map(el => ({
    id: '', // assigned later
    source: 'chrome_dom' as const,
    appName,
    role: el.role,
    label: el.name || el.text || el.role,
    href: el.href,
    bounds: {
      x: chromeViewportBounds.x + el.bounds.x,
      y: chromeViewportBounds.y + el.bounds.y,
      width: el.bounds.width,
      height: el.bounds.height,
    },
    center: {
      x: chromeViewportBounds.x + el.center.x,
      y: chromeViewportBounds.y + el.center.y,
    },
    confidence: el.confidence,
    interactable: el.actionable,
    chromeDomId: el.id,
  }))
}

// ---------------------------------------------------------------------------
// AX candidates
// ---------------------------------------------------------------------------

/** Interactive AX roles we care about for UI grounding. */
const INTERACTABLE_AX_ROLES = new Set([
  'AXButton',
  'AXLink',
  'AXTextField',
  'AXTextArea',
  'AXCheckBox',
  'AXRadioButton',
  'AXPopUpButton',
  'AXComboBox',
  'AXSlider',
  'AXMenuItem',
  'AXMenuBarItem',
  'AXTab',
  'AXTabGroup',
  'AXToolbar',
  'AXIncrementor',
  'AXColorWell',
  'AXDisclosureTriangle',
  'AXScrollBar',
  'AXScrollArea',
])

function axNodesToCandidates(
  snapshot: AXSnapshot,
  appName: string,
): DesktopTargetCandidate[] {
  const candidates: DesktopTargetCandidate[] = []

  function walk(node: AXNode) {
    if (
      node.bounds
      && node.bounds.width > 0
      && node.bounds.height > 0
      && INTERACTABLE_AX_ROLES.has(node.role)
    ) {
      const label = node.title || node.description || node.value || node.role
      candidates.push({
        id: '', // assigned later
        source: 'ax',
        appName,
        role: node.role,
        label: label.slice(0, 120),
        bounds: node.bounds,
        center: {
          x: node.bounds.x + node.bounds.width / 2,
          y: node.bounds.y + node.bounds.height / 2,
        },
        confidence: 0.8,
        interactable: node.enabled !== false,
        axUid: node.uid,
        focused: node.focused,
        enabled: node.enabled,
      })
    }
    for (const child of node.children) {
      walk(child)
    }
  }

  walk(snapshot.root)
  return candidates
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function boundsIoU(a: Bounds, b: Bounds): number {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)

  const interWidth = right - x
  const interHeight = bottom - y
  if (interWidth <= 0 || interHeight <= 0)
    return 0

  const interArea = interWidth * interHeight
  const areaA = a.width * a.height
  const areaB = b.width * b.height
  const unionArea = areaA + areaB - interArea

  return unionArea > 0 ? interArea / unionArea : 0
}

function findChromeWindowBounds(obs: WindowObservation): Bounds | undefined {
  const chromeWindow = obs.windows.find(
    w => isNormalChromeContentWindow(w),
  )
  return chromeWindow?.bounds
}

function findChromeViewportBounds(snapshot: AXSnapshot | undefined): Bounds | undefined {
  if (!snapshot)
    return undefined

  let webAreaBounds: Bounds | undefined

  function walk(node: AXNode) {
    if (webAreaBounds)
      return
    if (
      node.role === 'AXWebArea'
      && node.bounds
      && node.bounds.width > 0
      && node.bounds.height > 0
    ) {
      webAreaBounds = node.bounds
      return
    }
    for (const child of node.children) {
      walk(child)
    }
  }

  walk(snapshot.root)
  return webAreaBounds
}

function isNormalChromeContentWindow(window: WindowObservation['windows'][number]): boolean {
  return window.appName.toLowerCase().includes('chrome')
    && window.isOnScreen
    && window.bounds.width >= 480
    && window.bounds.height >= 300
}

function placeholderScreenshot(): ScreenshotArtifact {
  return {
    dataBase64: '',
    mimeType: 'image/png',
    path: '',
    capturedAt: new Date().toISOString(),
    placeholder: true,
    note: 'screenshot capture failed',
  }
}

function emptyWindowObservation(): WindowObservation {
  return {
    windows: [],
    observedAt: new Date().toISOString(),
  }
}
