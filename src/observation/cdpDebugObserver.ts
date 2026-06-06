import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import type { BrowserObservationScreenshot } from './browserObservation.js'

export type CdpDebugCommand
  = | 'Accessibility.getFullAXTree'
    | 'DOMSnapshot.captureSnapshot'
    | 'Page.captureScreenshot'

export const CDP_DEBUG_OBSERVER_ALLOWED_COMMANDS = new Set<CdpDebugCommand>([
  // Official CDP Accessibility domain: https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/
  'Accessibility.getFullAXTree',
  // Official CDP DOMSnapshot domain: https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/
  'DOMSnapshot.captureSnapshot',
  // Official CDP Page domain: https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot
  'Page.captureScreenshot',
])

export interface CdpSessionLike {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
}

export interface CdpDebugObservationOptions {
  session: CdpSessionLike
  maxAxDepth?: number
  maxAxNodes?: number
  includeDomSnapshot?: boolean
  includeScreenshot?: boolean
}

export interface CompactAXNode {
  nodeId: string
  role: string
  name: string
  value: string
  ignored: boolean
  childIds: string[]
  backendDOMNodeId: number | null
}

export interface CdpDebugObservation {
  schemaVersion: 'browser-observation-debug/v1'
  source: 'cdp_debug'
  observedAt: string
  commands: CdpDebugCommand[]
  axTree: {
    native: true
    nodeCount: number
    returnedNodeCount: number
    maxDepth: number
    nodes: CompactAXNode[]
  }
  domSnapshot: {
    captured: boolean
    documentCount: number
    nodeCount: number
    layoutNodeCount: number
  }
  screenshot: BrowserObservationScreenshot | null
  warnings: string[]
}

const DEFAULT_MAX_AX_DEPTH = 6
const DEFAULT_MAX_AX_NODES = 160

export async function sendAllowedCdpCommand<T = unknown>(
  session: CdpSessionLike,
  method: CdpDebugCommand,
  params?: Record<string, unknown>,
): Promise<T> {
  if (!CDP_DEBUG_OBSERVER_ALLOWED_COMMANDS.has(method)) {
    throw new Error(`CDP debug observer command is not allowed: ${method}`)
  }

  return await session.send(method, params) as T
}

export async function captureCdpDebugObservation({
  session,
  maxAxDepth = DEFAULT_MAX_AX_DEPTH,
  maxAxNodes = DEFAULT_MAX_AX_NODES,
  includeDomSnapshot = true,
  includeScreenshot = true,
}: CdpDebugObservationOptions): Promise<CdpDebugObservation> {
  const commands: CdpDebugCommand[] = ['Accessibility.getFullAXTree']
  const warnings = [
    'CDP debug observation is native AX/DOMSnapshot corroboration, not the default low-footprint observation path.',
    'Do not store raw AX, DOMSnapshot, or screenshots from real browsing sessions in the public repository.',
  ]
  const axTree = await sendAllowedCdpCommand<CdpAxTreeResult>(
    session,
    'Accessibility.getFullAXTree',
    { depth: maxAxDepth },
  )
  const domSnapshot = includeDomSnapshot
    ? await captureDomSnapshotSummary(session, commands)
    : {
        captured: false,
        documentCount: 0,
        nodeCount: 0,
        layoutNodeCount: 0,
      }
  const screenshot = includeScreenshot
    ? await captureScreenshotMetadata(session, commands)
    : null

  return {
    schemaVersion: 'browser-observation-debug/v1',
    source: 'cdp_debug',
    observedAt: new Date().toISOString(),
    commands,
    axTree: {
      native: true,
      nodeCount: Array.isArray(axTree.nodes) ? axTree.nodes.length : 0,
      returnedNodeCount: compactAxNodes(axTree.nodes, maxAxNodes).length,
      maxDepth: maxAxDepth,
      nodes: compactAxNodes(axTree.nodes, maxAxNodes),
    },
    domSnapshot,
    screenshot,
    warnings,
  }
}

async function captureDomSnapshotSummary(
  session: CdpSessionLike,
  commands: CdpDebugCommand[],
): Promise<CdpDebugObservation['domSnapshot']> {
  commands.push('DOMSnapshot.captureSnapshot')

  const snapshot = await sendAllowedCdpCommand<CdpDomSnapshotResult>(
    session,
    'DOMSnapshot.captureSnapshot',
    {
      computedStyles: [],
      includeDOMRects: true,
      includePaintOrder: true,
    },
  )
  const documents = Array.isArray(snapshot.documents) ? snapshot.documents : []

  return {
    captured: true,
    documentCount: documents.length,
    nodeCount: documents.reduce((sum, document) => sum + arrayLength(document.nodes?.nodeName), 0),
    layoutNodeCount: documents.reduce((sum, document) => sum + arrayLength(document.layout?.nodeIndex), 0),
  }
}

async function captureScreenshotMetadata(
  session: CdpSessionLike,
  commands: CdpDebugCommand[],
): Promise<BrowserObservationScreenshot> {
  commands.push('Page.captureScreenshot')

  const screenshot = await sendAllowedCdpCommand<CdpScreenshotResult>(
    session,
    'Page.captureScreenshot',
    { format: 'png' },
  )
  const data = typeof screenshot.data === 'string' ? screenshot.data : ''
  const bytes = Buffer.from(data, 'base64')

  return {
    source: 'cdp_Page.captureScreenshot',
    format: 'png',
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
  }
}

function compactAxNodes(nodes: unknown, limit: number): CompactAXNode[] {
  if (!Array.isArray(nodes)) {
    return []
  }

  return nodes.slice(0, limit).map((node) => {
    const record = asObject(node)

    return {
      nodeId: stringValue(record.nodeId),
      role: axValue(record.role),
      name: axValue(record.name),
      value: axValue(record.value),
      ignored: Boolean(record.ignored),
      childIds: Array.isArray(record.childIds) ? record.childIds.filter(isString) : [],
      backendDOMNodeId: Number.isFinite(record.backendDOMNodeId) ? record.backendDOMNodeId as number : null,
    }
  })
}

function axValue(value: unknown): string {
  const record = asObject(value)
  return typeof record.value === 'string' || typeof record.value === 'number' || typeof record.value === 'boolean'
    ? String(record.value)
    : ''
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

interface CdpAxTreeResult {
  nodes?: unknown[]
}

interface CdpDomSnapshotResult {
  documents?: Array<{
    nodes?: {
      nodeName?: unknown[]
    }
    layout?: {
      nodeIndex?: unknown[]
    }
  }>
}

interface CdpScreenshotResult {
  data?: string
}
