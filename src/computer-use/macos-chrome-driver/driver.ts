import type { ComputerUseConfig } from '../config.js'
import type { AXNode, AXSnapshot, Bounds, WindowDescriptor, WindowObservation } from '../types.js'
import type {
  ArtifactRef,
  ChromeContextLease,
  ChromeContextSnapshot,
  ChromeForegroundPolicy,
  ChromeWindowCapture,
  ChromeWindowRef,
  ObservationSnapshot,
  OcrRowSnapshot,
  OcrTextSnapshot,
  ProfileConfig,
  SafetyCheckResult,
} from './types.js'

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { resolveComputerUseConfig } from '../config.js'
import { captureAXTree } from '../ax-tree.js'
import { captureChromeDom } from '../chrome-dom.js'
import {
  executeOpenApp,
} from '../macos-actions.js'
import { observeWindows } from '../window-observation.js'
import { captureChromeWindow } from './capture.js'
import { produceOcrRows, recognizeTextInImage } from './ocr.js'
import {
  stringifyThrownValue,
  uniqueStrings,
} from './shared.js'
import { requireWindowNumber } from './types.js'
import { invokeMacOSChromeOperation } from './atomic-commands.js'
import type { MacOSChromeOperationCall, MacOSChromeOperationResponse } from './atomic-commands.js'

import { inferObservationSource, normalizeToSurfaceNodes } from './surface-node.js'
import { checkSafetyGate, detectHardStopSignals, loadProfileConfig } from './safety-gate.js'
import { TraceStore } from './trace-store.js'

export interface MacOSChromeDriverOptions {
  sessionId: string
  config?: Partial<ComputerUseConfig>
  foregroundPolicy?: ChromeForegroundPolicy
}

interface ManagedChromeProfileIdentity {
  profileDir: string
  profilePath: string
  profileName: string
  profileUserName?: string
  localStatePath: string
}

const NORMAL_CHROME_MIN_WIDTH = 480
const NORMAL_CHROME_MIN_HEIGHT = 300
const WINDOW_MATCH_TOLERANCE = 8
const MIN_VIEWPORT_WIDTH = 100
const MIN_VIEWPORT_HEIGHT = 100

export class MacOSChromeDriver {
  readonly #sessionId: string
  readonly #config: ComputerUseConfig
  readonly #foregroundPolicy: ChromeForegroundPolicy
  #nextObservationId = 1
  #lastCursorPosition?: { x: number, y: number }

  #traceStore?: TraceStore
  #profileConfig?: ProfileConfig
  #chromeContextLease?: ChromeContextLease
  #runId: string
  #spanId = 'session'
  #nextOperationId = 1

  constructor(options: MacOSChromeDriverOptions) {
    if (!options.sessionId?.trim()) {
      throw new TypeError('MacOSChromeDriver requires a non-empty sessionId.')
    }
    this.#sessionId = options.sessionId
    this.#config = { ...resolveComputerUseConfig(), ...options.config }
    this.#foregroundPolicy = options.foregroundPolicy ?? 'require_chrome'

    this.#runId = `run_${options.sessionId}_${Date.now()}`
    this.#traceStore = new TraceStore(this.#config.sessionRoot, options.sessionId)
    this.#traceStore.startRun(this.#runId, { intent: 'macos_chrome_driver' })
    this.#traceStore.startSpan(this.#spanId, undefined, 'session')
  }

  /**
   * Exposes the driver-level TraceStore so invoke-entry can wire it into the invoke runtime as the trace sink.
   * Without this, the invoke runtime's events.jsonl stays empty and command_count === 0.
   */
  get traceSink(): TraceStore | undefined {
    return this.#traceStore
  }

  finishRun(statusCode: 'ok' | 'error', summary?: string): void {
    this.#traceStore?.endRun(this.#runId, statusCode, summary)
  }

  async invokeOperation(call: MacOSChromeOperationCall): Promise<MacOSChromeOperationResponse> {
    return invokeMacOSChromeOperation({
      config: this.#config,
      sessionId: this.#sessionId,
      runId: this.#runId,
      parentSpanId: this.#spanId,
      traceSink: this.#traceStore,
      resolveChromeContext: async () => {
        await this.#ensureChromeContextLease()
        return this.#requireLeasedChromeContext()
      },
      getLastCursorPosition: () => this.#lastCursorPosition,
      setLastCursorPosition: (position) => {
        this.#lastCursorPosition = position
      },
      nextAtomicId: () => this.#nextOperationId++,
    }, call)
  }

  async checkSafetyGate(): Promise<SafetyCheckResult> {
    await this.#ensureChromeContextLease()
    const context = await this.#requireLeasedChromeContext()
    if (!this.#profileConfig)
      throw new Error('Profile config has not been loaded for the managed Chrome context.')
    return checkSafetyGate(context, '', this.#profileConfig)
  }

  async observe(): Promise<ObservationSnapshot> {
    await this.#ensureChromeContextLease()

    const snapshotId = `mco_${this.#nextObservationId++}`
    const spanId = `observe_${snapshotId}`

    this.#traceStore?.startSpan(spanId, this.#spanId, 'observe')

    const chromeContext = await this.#requireLeasedChromeContext()
    const capture = await captureChromeWindow({
      config: this.#config,
      sessionId: this.#sessionId,
      snapshotId,
      window: chromeContext.window,
    })

    // Record screenshot artifact
    const screenshotArtifactId = `screenshot_${snapshotId}`
    this.#traceStore?.recordArtifact({
      artifact_id: screenshotArtifactId,
      span_id: spanId,
      role: 'screenshot',
      mime_type: 'image/png',
      path: capture.screenshot.path,
      attributes: { width: capture.screenshot.width, height: capture.screenshot.height },
    })

    const captureArtifact: ArtifactRef = { run_id: this.#runId, artifact_id: screenshotArtifactId, span_id: spanId }
    const contractArtifactId = `capture_contract_${snapshotId}`
    const captureContractArtifact: ArtifactRef = { run_id: this.#runId, artifact_id: contractArtifactId, span_id: spanId }
    this.#traceStore?.writeJsonArtifact({
      artifact_id: contractArtifactId,
      span_id: spanId,
      role: 'capture-contract',
      payload: capture.contract,
      attributes: { coordinate_contract_version: capture.contract.coordinateContractVersion },
    })

    // Parallel observation: AX, DOM, OCR
    const [axResult, domResult, ocrResult] = await Promise.allSettled([
      captureAXTree(this.#config, {
        pid: chromeContext.window.ownerPid,
        maxDepth: 15,
        maxNodes: 3000,
      }),
      captureChromeDom(this.#config, chromeDomTargetFromWindow(chromeContext.window)),
      recognizeTextInImage(this.#config, {
        imagePath: capture.screenshot.path,
        maxObservations: 256,
      }),
    ])

    const axSnapshot = axResult.status === 'fulfilled' ? axResult.value : undefined
    const chromeDomObservation
      = domResult.status === 'fulfilled' && domResult.value ? domResult.value : undefined
    const ocr = ocrResult.status === 'fulfilled'
      ? ocrResult.value
      : emptyOcrTextSnapshot(capture, ocrResult.reason)
    const ocrRows = await produceOcrRows({
      textSnapshot: ocr,
    })
      .catch(error => emptyOcrRowSnapshot(ocr, error))
    const ocrRowReportArtifact = this.#traceStore?.writeJsonArtifact({
      artifact_id: `ocr_row_report_${snapshotId}`,
      span_id: spanId,
      role: 'ocr-row-report',
      payload: ocrRows,
      attributes: {
        strategy: ocrRows.strategy,
        row_count: ocrRows.rowCount,
        raw_match_count: ocrRows.rawMatchCount,
        filtered_match_count: ocrRows.filteredMatchCount,
      },
    })
    const ocrRowReportRef = ocrRowReportArtifact
      ? { run_id: this.#runId, artifact_id: ocrRowReportArtifact.artifact_id, span_id: ocrRowReportArtifact.span_id }
      : undefined

    // Compute viewport bounds from the leased Chrome AXWindow when possible.
    const viewportBounds = findChromeViewportBounds(axSnapshot, chromeContext.window.bounds) ?? chromeContext.window.bounds

    // Normalize ALL sources → SurfaceNode[]
    const nodes = normalizeToSurfaceNodes({
      ocrMatches: ocr.matches,
      ocrRows: ocrRows.rows,
      axSnapshot,
      domObservation: chromeDomObservation ?? undefined,
      contract: capture.contract,
      runId: this.#runId,
      spanId,
      viewportBounds,
      captureArtifact,
      captureContractArtifact,
    })

    const source = inferObservationSource(nodes)
    const visibleText = nodes.map(n => n.label ?? '').join('\n')
    const signals = detectHardStopSignals(visibleText)
    const capturedAtMillis = Date.now()

    const result: ObservationSnapshot = {
      api_version: 'careerdeepseek.observation_snapshot.v1alpha1',
      snapshot_id: snapshotId,
      run_id: this.#runId,
      span_id: spanId,
      captured_at_millis: capturedAtMillis,
      source,
      scope: {
        surface: 'window',
        window_number: chromeContext.window.windowNumber,
        app_bundle_id: chromeContext.window.ownerBundleId,
        window_title: chromeContext.window.title ?? undefined,
        capture_artifact: captureArtifact,
      },
      capture_contract_ref: captureContractArtifact,
      evidence: [
        captureArtifact,
        captureContractArtifact,
        ...(ocrRowReportRef ? [ocrRowReportRef] : []),
      ],
      nodes,
      detail: {
        chrome_context: {
          active_tab_url: chromeContext.activeTabUrl,
          active_tab_title: chromeContext.activeTabTitle,
          lease: chromeContext.lease,
        },
        signals,
        ocr_match_count: ocr.matches.length,
        ocr_known_limits: ocr.knownLimits ?? [],
        ocr_rows: ocrRowSummary(ocrRows),
      },
      known_limits: uniqueStrings([
        this.#chromeContextLease ? 'managed Chrome context lease established' : 'Chrome context lease missing, actions blocked',
        ...(ocr.knownLimits ?? []),
        ...ocrRows.knownLimits,
      ]),
    }

    this.#traceStore?.writeJsonArtifact({
      artifact_id: `observation_${snapshotId}`,
      span_id: spanId,
      role: 'observation-snapshot',
      payload: result,
      attributes: { node_count: nodes.length, source },
    })
    this.#traceStore?.endSpan(spanId, 'ok', `observed ${nodes.length} nodes`)

    return result
  }

  async #ensureChromeContextLease(): Promise<void> {
    if (this.#chromeContextLease) {
      return
    }

    this.#profileConfig = await loadProfileConfig(this.#config.sessionRoot)
    const profileIdentity = resolveManagedChromeProfileIdentity(this.#profileConfig)
    await executeOpenApp(this.#config, 'Google Chrome', {
      args: [`--profile-directory=${profileIdentity.profileDir}`],
    })
    await sleep(500)

    const chromeContext = await this.#resolveChromeContext({
      activateIfNeeded: true,
      profileIdentity,
    })
    const now = new Date().toISOString()
    this.#chromeContextLease = {
      leaseId: `lease_${this.#runId}_${chromeContext.window.windowNumber}`,
      sessionId: this.#sessionId,
      runId: this.#runId,
      profileMode: 'managed',
      profileDir: profileIdentity.profileDir,
      profilePath: profileIdentity.profilePath,
      profileName: profileIdentity.profileName,
      profileUserName: profileIdentity.profileUserName,
      ownerPid: chromeContext.window.ownerPid,
      windowNumber: chromeContext.window.windowNumber,
      ownerBundleId: chromeContext.window.ownerBundleId,
      appBundleId: chromeContext.window.ownerBundleId,
      createdAt: now,
      verifiedAt: now,
    }

    this.#traceStore?.recordEvent({
      event_id: `evt_chrome_context_lease_${Date.now()}`,
      span_id: this.#spanId,
      name: 'chrome_context_lease_established',
      timestamp_millis: Date.now(),
      attributes: {
        lease_id: this.#chromeContextLease.leaseId,
        profile_path: this.#chromeContextLease.profilePath,
        profile_name: this.#chromeContextLease.profileName,
        profile_user_name: this.#chromeContextLease.profileUserName,
        window_number: this.#chromeContextLease.windowNumber,
        owner_pid: this.#chromeContextLease.ownerPid,
        owner_bundle_id: this.#chromeContextLease.ownerBundleId,
      },
      message: `Managed Chrome context lease established for window ${this.#chromeContextLease.windowNumber}.`,
      artifact_ids: [],
    })
  }

  async #requireLeasedChromeContext(): Promise<ChromeContextSnapshot> {
    const lease = this.#chromeContextLease
    if (!lease) {
      throw new Error('Chrome context lease has not been established. Run observe() to bootstrap the managed Chrome context.')
    }

    let observation = await observeWindows(this.#config, { limit: 120 })
    if (!isChromeApp(observation.frontmostAppName) && this.#foregroundPolicy === 'auto_focus_chrome') {
      await executeOpenApp(this.#config, 'Google Chrome')
      await sleep(500)
      observation = await observeWindows(this.#config, { limit: 120 })
    }

    const chromeWindow = findLeasedChromeWindow(observation, lease)
    if (!chromeWindow) {
      throw new Error('Chrome context lease is no longer valid. Run observe() in a new driver session to bootstrap the managed Chrome context again.')
    }
    if (!isChromeApp(observation.frontmostAppName)) {
      throw new Error(
        `Google Chrome must be the foreground app for the active lease; current frontmost app is ${observation.frontmostAppName ?? 'unknown'}.`,
      )
    }

    lease.verifiedAt = new Date().toISOString()
    return this.#chromeContextFromWindowObservation(observation, chromeWindow, lease)
  }

  async #resolveChromeContext(options: {
    activateIfNeeded?: boolean
    profileIdentity?: ManagedChromeProfileIdentity
  } = {}): Promise<ChromeContextSnapshot> {
    let observation = await observeWindows(this.#config, { limit: 120 })
    let chromeWindow = await this.#findChromeWindow(observation, options.profileIdentity)
    if (!isChromeApp(observation.frontmostAppName) || !chromeWindow) {
      if (options.activateIfNeeded || this.#foregroundPolicy === 'auto_focus_chrome') {
        await executeOpenApp(this.#config, 'Google Chrome')
        await sleep(500)
        observation = await observeWindows(this.#config, { limit: 120 })
        chromeWindow = await this.#findChromeWindow(observation, options.profileIdentity)
      }
    }

    if (!chromeWindow) {
      throw new Error('No visible Google Chrome window found for macOS Chrome driver.')
    }
    if (!isChromeApp(observation.frontmostAppName)) {
      throw new Error(
        `Google Chrome must be the foreground app; current frontmost app is ${observation.frontmostAppName ?? 'unknown'}.`,
      )
    }

    return this.#chromeContextFromWindowObservation(observation, chromeWindow)
  }

  async #findChromeWindow(
    observation: WindowObservation,
    profileIdentity?: ManagedChromeProfileIdentity,
  ): Promise<WindowDescriptor | undefined> {
    if (!profileIdentity)
      return findChromeWindow(observation)

    const chromePid = findChromePid(observation)
    if (chromePid === undefined)
      return undefined

    const axSnapshot = await captureAXTree(this.#config, {
      pid: chromePid,
      maxDepth: 8,
      maxNodes: 1200,
    }).catch(() => undefined)
    const profileWindow = axSnapshot
      ? findChromeWindowByProfileAX(observation, axSnapshot, profileIdentity.profileName)
      : undefined
    if (profileWindow)
      return profileWindow

    throw new Error(
      `Could not verify a visible Google Chrome window for managed profile "${profileIdentity.profileName}" (${profileIdentity.profilePath}).`,
    )
  }

  async #chromeContextFromWindowObservation(
    observation: WindowObservation,
    chromeWindow: WindowDescriptor,
    lease?: ChromeContextLease,
  ): Promise<ChromeContextSnapshot> {
    const window = chromeWindowRef(chromeWindow)
    const tab = await captureChromeDom(this.#config, chromeDomTargetFromWindow(window)).catch(() => null)
    return {
      running: true,
      isFrontmost: true,
      frontmostAppName: observation.frontmostAppName,
      frontmostAppBundleId: observation.frontmostAppBundleId,
      activeTabUrl: tab?.url ?? null,
      activeTabTitle: tab?.title ?? observation.frontmostWindowTitle ?? null,
      profile: {
        status: lease ? 'verified' : 'unverified',
        reason: lease
          ? 'Managed Chrome context lease is valid for the observed OS window; profile identity was verified against Chrome Local State and AXWindow title evidence during bootstrap.'
          : 'Chrome profile identity is not verified by tab inspection.',
        profile_path: lease?.profilePath,
        profile_name: lease?.profileName,
        profile_user_name: lease?.profileUserName,
      },
      window,
      lease,
    }
  }
}

function findChromeWindow(observation: WindowObservation): WindowDescriptor | undefined {
  return observation.windows.find(window =>
    isChromeApp(window.appName)
    && window.isOnScreen
    && window.bounds.width >= NORMAL_CHROME_MIN_WIDTH
    && window.bounds.height >= NORMAL_CHROME_MIN_HEIGHT
    && window.layer === 0,
  ) ?? observation.windows.find(window =>
    isChromeApp(window.appName)
    && window.isOnScreen
    && window.bounds.width >= NORMAL_CHROME_MIN_WIDTH
    && window.bounds.height >= NORMAL_CHROME_MIN_HEIGHT,
  )
}

function findChromePid(observation: WindowObservation): number | undefined {
  return chromeWindowCandidates(observation)[0]?.ownerPid
}

function chromeWindowCandidates(observation: WindowObservation): WindowDescriptor[] {
  const normal = observation.windows.filter(window =>
    isChromeApp(window.appName)
    && window.isOnScreen
    && window.bounds.width >= NORMAL_CHROME_MIN_WIDTH
    && window.bounds.height >= NORMAL_CHROME_MIN_HEIGHT
    && window.layer === 0,
  )
  if (normal.length > 0)
    return normal

  return observation.windows.filter(window =>
    isChromeApp(window.appName)
    && window.isOnScreen
    && window.bounds.width >= NORMAL_CHROME_MIN_WIDTH
    && window.bounds.height >= NORMAL_CHROME_MIN_HEIGHT,
  )
}

function findChromeWindowByProfileAX(
  observation: WindowObservation,
  axSnapshot: AXSnapshot,
  profileName: string,
): WindowDescriptor | undefined {
  const suffix = ` - Google Chrome - ${profileName}`
  const axWindows = collectAXWindows(axSnapshot)
    .filter(node => node.title?.endsWith(suffix))
  const candidates = chromeWindowCandidates(observation)

  for (const axWindow of axWindows) {
    const axTitle = axWindow.title ?? ''
    const windowTitle = axTitle.slice(0, axTitle.length - suffix.length)
    const matching = candidates
      .filter(window => window.title === windowTitle)
      .filter(window => !axWindow.bounds || boundsNear(window.bounds, axWindow.bounds))
    if (matching.length === 1)
      return matching[0]

    const boundsOnly = candidates.filter(window =>
      axWindow.bounds !== undefined && boundsNear(window.bounds, axWindow.bounds),
    )
    if (boundsOnly.length === 1)
      return boundsOnly[0]
  }

  return undefined
}

function collectAXWindows(snapshot: AXSnapshot): AXNode[] {
  const windows: AXNode[] = []
  function walk(node: AXNode): void {
    if (node.role === 'AXWindow')
      windows.push(node)
    for (const child of node.children)
      walk(child)
  }
  walk(snapshot.root)
  return windows
}

function boundsNear(a: Bounds, b: Bounds): boolean {
  return Math.abs(a.x - b.x) <= WINDOW_MATCH_TOLERANCE
    && Math.abs(a.y - b.y) <= WINDOW_MATCH_TOLERANCE
    && Math.abs(a.width - b.width) <= WINDOW_MATCH_TOLERANCE
    && Math.abs(a.height - b.height) <= WINDOW_MATCH_TOLERANCE
}

function findLeasedChromeWindow(observation: WindowObservation, lease: ChromeContextLease): WindowDescriptor | undefined {
  return observation.windows.find(window =>
    window.isOnScreen
    && isChromeApp(window.appName)
    && requireWindowNumber(window) === lease.windowNumber
    && window.ownerPid === lease.ownerPid
    && (!lease.ownerBundleId || window.ownerBundleId === lease.ownerBundleId)
    && window.bounds.width >= NORMAL_CHROME_MIN_WIDTH
    && window.bounds.height >= NORMAL_CHROME_MIN_HEIGHT,
  )
}

function chromeWindowRef(window: WindowDescriptor): ChromeWindowRef {
  return {
    id: window.id,
    windowNumber: requireWindowNumber(window),
    appName: window.appName,
    ownerPid: window.ownerPid,
    ownerBundleId: window.ownerBundleId,
    title: window.title,
    bounds: window.bounds,
    layer: window.layer,
  }
}

function chromeDomTargetFromWindow(window: ChromeWindowRef) {
  return {
    windowNumber: window.windowNumber,
    ownerPid: window.ownerPid,
    ownerBundleId: window.ownerBundleId,
    title: window.title,
    bounds: window.bounds,
  }
}

function profileDirFromPath(profilePath: string): string {
  return profilePath.split('/').filter(Boolean).at(-1) ?? profilePath
}

function resolveManagedChromeProfileIdentity(profileConfig: ProfileConfig): ManagedChromeProfileIdentity {
  const profileDir = profileDirFromPath(profileConfig.profile_path)
  const localStatePath = chromeLocalStatePath()
  const info = readChromeLocalStateProfileInfo(localStatePath, profileDir)
  if (!info?.name?.trim()) {
    throw new Error(
      `Chrome profile "${profileConfig.profile_path}" was not found in Chrome Local State at ${localStatePath}.`,
    )
  }

  const configuredName = profileConfig.profile_name?.trim()
  const actualName = info.name.trim()
  if (configuredName && configuredName !== actualName) {
    throw new Error(
      `Chrome profile config mismatch: "${profileConfig.profile_path}" is "${actualName}" in Chrome Local State, not "${configuredName}".`,
    )
  }

  return {
    profileDir,
    profilePath: profileConfig.profile_path,
    profileName: actualName,
    profileUserName: info.user_name,
    localStatePath,
  }
}

function chromeLocalStatePath(): string {
  return process.env.COMPUTER_USE_CHROME_LOCAL_STATE_PATH?.trim()
    || join(homedir(), 'Library/Application Support/Google/Chrome/Local State')
}

function readChromeLocalStateProfileInfo(
  localStatePath: string,
  profileDir: string,
): { name?: string, user_name?: string } | undefined {
  const raw = readFileSync(localStatePath, 'utf-8')
  const parsed = JSON.parse(raw) as {
    profile?: {
      info_cache?: Record<string, { name?: string, user_name?: string }>
    }
  }
  return parsed.profile?.info_cache?.[profileDir]
}

/**
 * Finds a usable AXWebArea viewport inside the leased Chrome window.
 * Falls back to undefined when no valid AXWebArea intersects the window.
 */
function findChromeViewportBounds(
  axSnapshot: AXSnapshot | undefined,
  windowBounds: Bounds,
): Bounds | undefined {
  if (!axSnapshot)
    return undefined

  const exactWindow = collectAXWindows(axSnapshot)
    .find(node => node.bounds && boundsNear(node.bounds, windowBounds))
  if (exactWindow) {
    const candidate = selectLargestValidWebArea(exactWindow, windowBounds)
    return candidate
  }

  return undefined
}

function selectLargestValidWebArea(root: AXNode, windowBounds: Bounds): Bounds | undefined {
  const candidates = collectAXWebAreas(root)
    .map(node => node.bounds ? intersectBounds(node.bounds, windowBounds) : undefined)
    .filter((bounds): bounds is Bounds => isValidViewportBounds(bounds))
    .sort((a, b) => areaOfBounds(b) - areaOfBounds(a))

  return candidates[0]
}

function collectAXWebAreas(root: AXNode): AXNode[] {
  const webAreas: AXNode[] = []
  function walk(node: AXNode): void {
    if (node.role === 'AXWebArea')
      webAreas.push(node)
    for (const child of node.children)
      walk(child)
  }
  walk(root)
  return webAreas
}

function intersectBounds(a: Bounds, b: Bounds): Bounds | undefined {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  if (x2 <= x1 || y2 <= y1)
    return undefined
  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  }
}

function isValidViewportBounds(bounds: Bounds | undefined): bounds is Bounds {
  return bounds !== undefined
    && bounds.width >= MIN_VIEWPORT_WIDTH
    && bounds.height >= MIN_VIEWPORT_HEIGHT
}

function areaOfBounds(bounds: Bounds): number {
  return bounds.width * bounds.height
}

function emptyOcrTextSnapshot(capture: ChromeWindowCapture, error?: unknown): OcrTextSnapshot {
  const knownLimits = error === undefined
    ? []
    : ['raw OCR failed', `raw OCR failed: ${stringifyThrownValue(error)}`]
  return {
    recognizedAt: new Date().toISOString(),
    imagePath: capture.screenshot.path,
    imageWidth: capture.screenshot.width ?? 0,
    imageHeight: capture.screenshot.height ?? 0,
    query: '',
    exact: false,
    caseSensitive: false,
    normalizedQuery: '',
    ocrScaleFactor: 1,
    matches: [],
    rawMatchCount: 0,
    filteredMatchCount: 0,
    knownLimits,
  }
}

function emptyOcrRowSnapshot(
  ocr: OcrTextSnapshot,
  error: unknown,
): OcrRowSnapshot {
  return {
    strategy: 'ocr-text',
    imagePath: ocr.imagePath,
    imageWidth: ocr.imageWidth,
    imageHeight: ocr.imageHeight,
    rawMatchCount: ocr.rawMatchCount,
    filteredMatchCount: ocr.filteredMatchCount,
    rowCount: 0,
    rows: [],
    providerDetail: {
      provider: 'careerdeepseek.macos_chrome_driver.ocr_rows',
      error: error instanceof Error ? error.message : String(error),
    },
    knownLimits: uniqueStrings([
      'ocr row production failed',
      `ocr row production failed: ${stringifyThrownValue(error)}`,
    ]),
  }
}

function ocrRowSummary(ocrRows: OcrRowSnapshot): Record<string, unknown> {
  return {
    strategy: ocrRows.strategy,
    row_count: ocrRows.rowCount,
    raw_match_count: ocrRows.rawMatchCount,
    filtered_match_count: ocrRows.filteredMatchCount,
    known_limits: ocrRows.knownLimits,
  }
}

function isChromeApp(appName: string | undefined): boolean {
  return typeof appName === 'string' && appName.toLowerCase().includes('chrome')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
