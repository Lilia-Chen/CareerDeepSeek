import type { ComputerUseConfig } from '../config.js'
import type { AXNode } from '../types.js'
import { unlink } from 'node:fs/promises'
import type {
  AtomicClickResult,
  AtomicFindResult,
  AtomicMatch,
  AtomicKeyResult,
  AtomicRowsResult,
  AtomicScrollRegionResult,
  AtomicTypeTextResult,
  AtomicWaitForTextResult,
} from './atomic-types.js'
import type {
  ArtifactRef,
  ChromeContextSnapshot,
  ChromeWindowCapture,
  OcrRowEvidence,
  OcrTextSnapshot,
} from './types.js'
import { captureAXTree } from '../ax-tree.js'
import { executeAXQueryAction } from '../ax-actions.js'
import {
  executeMoveAndClick,
  executePressKeys,
  executeScroll,
  executeTypeText,
} from '../macos-actions.js'
import { captureChromeWindow } from './capture.js'
import { produceOcrRows, recognizeTextInImage } from './ocr.js'
import { centerOf, projectPixelBoxToLogical, projectPixelBoxToLogicalMatch, projectPixelPointToLogical } from './atomic-recognition.js'
import { safeErrorMessage, uniqueStrings } from './shared.js'

interface AtomicTraceSink {
  startSpan?: (spanId: string, parentSpanId: string | undefined, name: string) => unknown
  endSpan?: (spanId: string, statusCode: 'ok' | 'error', summary?: string) => void
  recordArtifact?: (artifact: {
    artifact_id: string
    span_id: string
    role: string
    mime_type: string
    path: string
    attributes: Record<string, unknown>
    summary?: string
  }) => void
  writeJsonArtifact?: (input: {
    artifact_id: string
    span_id: string
    role: string
    payload: unknown
    attributes?: Record<string, unknown>
    summary?: string
  }) => { artifact_id: string, span_id: string }
}

export interface LiveMacOSChromeAtomicCommandInput {
  config: ComputerUseConfig
  sessionId: string
  runId: string
  parentSpanId?: string
  traceSink?: AtomicTraceSink
  resolveChromeContext: () => Promise<ChromeContextSnapshot>
  getLastCursorPosition?: () => { x: number, y: number } | undefined
  setLastCursorPosition?: (position: { x: number, y: number }) => void
  nextAtomicId?: () => number
}

export interface MacOSChromeAtomicCommands {
  findText: (input: { query: string }) => Promise<AtomicFindResult>
  waitForText: (input: { query: string, timeoutMs?: number, pollIntervalMs?: number }) => Promise<AtomicWaitForTextResult>
  clickText: (input: { query: string, matchIndex?: number, anchorOffsetX?: number, anchorOffsetY?: number }) => Promise<AtomicClickResult>
  findRows: (input: { query?: string }) => Promise<AtomicRowsResult>
  clickRow: (input: { query?: string, rowIndex: number }) => Promise<AtomicClickResult>
  focusText: (input: { query: string }) => Promise<AtomicClickResult>
  axFocusText: (input: { query: string }) => Promise<AtomicClickResult>
  pressButton: (input: { query: string }) => Promise<AtomicClickResult>
  axPressButton: (input: { query: string }) => Promise<AtomicClickResult>
  typeText: (input: { text: string, submitKey?: string }) => Promise<AtomicTypeTextResult>
  key: (input: { key: string, modifiers?: string[] }) => Promise<AtomicKeyResult>
  scrollRegion: (input: {
    direction?: string
    amount?: number
    region?: { left: number, top: number, right: number, bottom: number }
  }) => Promise<AtomicScrollRegionResult>
}

interface CapturedWindowAtomicContext {
  context: ChromeContextSnapshot
  capture: ChromeWindowCapture
  spanId: string
  evidence: ArtifactRef[]
}

interface AtomicOcrContext extends CapturedWindowAtomicContext {
  ocr: OcrTextSnapshot
  matches: AtomicMatch[]
  knownLimits: string[]
}

export interface MacOSChromeOperationCall {
  commandId: string
  operation: string
  inputs: Record<string, unknown>
}

export type MacOSChromeOperationResponse
  = | AtomicFindResult
    | AtomicWaitForTextResult
    | AtomicClickResult
    | AtomicRowsResult
    | AtomicTypeTextResult
    | AtomicKeyResult
    | AtomicScrollRegionResult

const TEXT_INPUT_AX_ROLES = new Set(['AXTextField', 'AXTextArea', 'AXComboBox', 'AXSearchField'])
const BUTTON_AX_ROLES = new Set(['AXButton', 'AXPopUpButton', 'AXMenuButton', 'AXMenuItem', 'AXLink'])

export class LiveMacOSChromeAtomicCommands implements MacOSChromeAtomicCommands {
  readonly #config: ComputerUseConfig
  readonly #sessionId: string
  readonly #runId: string
  readonly #parentSpanId: string | undefined
  readonly #traceSink: AtomicTraceSink | undefined
  readonly #resolveChromeContext: () => Promise<ChromeContextSnapshot>
  readonly #getLastCursorPosition: (() => { x: number, y: number } | undefined) | undefined
  readonly #setLastCursorPosition: ((position: { x: number, y: number }) => void) | undefined
  readonly #nextExternalAtomicId: (() => number) | undefined
  #nextAtomicId = 1

  constructor(input: LiveMacOSChromeAtomicCommandInput) {
    this.#config = input.config
    this.#sessionId = input.sessionId
    this.#runId = input.runId
    this.#parentSpanId = input.parentSpanId
    this.#traceSink = input.traceSink
    this.#resolveChromeContext = input.resolveChromeContext
    this.#getLastCursorPosition = input.getLastCursorPosition
    this.#setLastCursorPosition = input.setLastCursorPosition
    this.#nextExternalAtomicId = input.nextAtomicId
  }

  async findText(input: { query: string }): Promise<AtomicFindResult> {
    const ocr = await this.#captureAndRecognizeText(input.query, 'find-text')
    return {
      found: ocr.matches.length > 0,
      recognitionId: this.#recognitionId('text'),
      matchCount: ocr.matches.length,
      best: ocr.matches[0],
      matches: ocr.matches,
      evidence: ocr.evidence,
      knownLimits: ocr.knownLimits,
    }
  }

  async waitForText(input: {
    query: string
    timeoutMs?: number
    pollIntervalMs?: number
  }): Promise<AtomicWaitForTextResult> {
    const timeoutMs = input.timeoutMs ?? 3000
    const pollIntervalMs = input.pollIntervalMs ?? 250
    const startedAt = Date.now()
    let pollCount = 0
    let previousScreenshotPath: string | undefined

    while (true) {
      pollCount += 1
      const ocr = await this.#captureAndRecognizeText(input.query, `wait-text-${pollCount}`)
      const elapsedMs = Date.now() - startedAt
      const timedOut = elapsedMs >= timeoutMs
      if (ocr.matches.length > 0 || timedOut) {
        await removeIfPresent(previousScreenshotPath)
        return {
          found: ocr.matches.length > 0,
          query: input.query,
          elapsedMs,
          pollCount,
          best: ocr.matches[0],
          matches: ocr.matches.length > 0 ? ocr.matches : [],
          evidence: ocr.evidence,
          knownLimits: ocr.knownLimits,
        }
      }

      await removeIfPresent(previousScreenshotPath)
      previousScreenshotPath = ocr.capture.screenshot.path
      await sleep(pollIntervalMs)
    }
  }

  async clickText(input: {
    query: string
    matchIndex?: number
    anchorOffsetX?: number
    anchorOffsetY?: number
  }): Promise<AtomicClickResult> {
    const ocr = await this.#captureAndRecognizeText(input.query, 'click-text')
    const matchIndex = input.matchIndex ?? 0
    const rawMatch = ocr.ocr.matches[matchIndex]
    const clicked = ocr.matches[matchIndex]
    if (!rawMatch || !clicked)
      throw atomicError(`No OCR text match at index ${matchIndex} for query ${input.query}.`, 'recognition_not_found', ocr.evidence)

    const anchorOffset = {
      x: input.anchorOffsetX ?? 0,
      y: input.anchorOffsetY ?? 0,
    }
    const pixelPoint = {
      x: rawMatch.bounds.x + rawMatch.bounds.width / 2 + anchorOffset.x,
      y: rawMatch.bounds.y + rawMatch.bounds.height / 2 + anchorOffset.y,
    }
    const logicalPoint = projectPixelPointToLogical(pixelPoint, ocr.capture.contract)
    if (!pointInsideBounds(logicalPoint, ocr.context.window.bounds))
      throw atomicError('Resolved OCR click point is outside the managed Chrome window.', 'target_outside_window', ocr.evidence)

    await this.#clickLogicalPoint(logicalPoint, ocr.evidence)
    const clickedWithPoint = { ...clicked, logicalPoint }

    const actionRef = this.#recordJsonArtifact(ocr.spanId, `action_click_text_${ocr.spanId}`, 'action-result', {
      query: input.query,
      match_index: matchIndex,
      clicked: clickedWithPoint,
    })

    return {
      clicked: { ...clickedWithPoint, anchorOffset },
      evidence: compactArtifactRefs([...ocr.evidence, actionRef]),
      knownLimits: ocr.knownLimits,
    }
  }

  async findRows(input: { query?: string }): Promise<AtomicRowsResult> {
    const rows = await this.#captureAndRecognizeRows(input.query, 'find-rows')
    return {
      found: rows.matches.length > 0,
      recognitionId: this.#recognitionId('rows'),
      rowCount: rows.matches.length,
      rows: rows.matches,
      evidence: rows.evidence,
      knownLimits: rows.knownLimits,
    }
  }

  async clickRow(input: { query?: string, rowIndex: number }): Promise<AtomicClickResult> {
    const rows = await this.#captureAndRecognizeRows(input.query, 'click-row')
    const index = Math.max(1, input.rowIndex) - 1
    const matched = rows.matches[index]
    if (!matched)
      throw atomicError(`No OCR row at 1-based index ${input.rowIndex}.`, 'recognition_not_found', rows.evidence)

    await this.#clickLogicalPoint(matched.logicalPoint, rows.evidence)
    const actionRef = this.#recordJsonArtifact(rows.spanId, `action_click_row_${rows.spanId}`, 'action-result', {
      query: input.query ?? null,
      row_index: input.rowIndex,
      clicked: matched,
    })
    return {
      clicked: { ...matched, anchorOffset: { x: 0, y: 0 } },
      evidence: compactArtifactRefs([...rows.evidence, actionRef]),
      knownLimits: rows.knownLimits,
    }
  }

  async focusText(input: { query: string }): Promise<AtomicClickResult> {
    return this.#pointerAXAction(input.query, TEXT_INPUT_AX_ROLES, 'focus-text')
  }

  async axFocusText(input: { query: string }): Promise<AtomicClickResult> {
    return this.#axAttributeAction(input.query, [...TEXT_INPUT_AX_ROLES], 'focus', 'ax-focus-text')
  }

  async pressButton(input: { query: string }): Promise<AtomicClickResult> {
    return this.#pointerAXAction(input.query, BUTTON_AX_ROLES, 'press-button')
  }

  async axPressButton(input: { query: string }): Promise<AtomicClickResult> {
    return this.#axAttributeAction(input.query, [...BUTTON_AX_ROLES], 'press', 'ax-press-button')
  }

  async typeText(input: { text: string, submitKey?: string }): Promise<AtomicTypeTextResult> {
    await this.#resolveChromeContext()
    const spanId = this.#startSpan('type-text')
    await executeTypeText(this.#config, { pointerTrace: [], text: input.text })
    if (input.submitKey)
      await executePressKeys(this.#config, { keys: [input.submitKey], modifiers: [] })
    const evidence = compactArtifactRefs([
      this.#recordJsonArtifact(spanId, `action_type_text_${spanId}`, 'action-result', {
        text_length: input.text.length,
        submit_key: input.submitKey ?? null,
      }),
    ])
    this.#endSpan(spanId, 'ok', 'typed text')
    return {
      typed: {
        textLength: input.text.length,
        submitKey: input.submitKey ?? null,
      },
      evidence,
      knownLimits: ['type_text_active_control_only'],
    }
  }

  async key(input: { key: string, modifiers?: string[] }): Promise<AtomicKeyResult> {
    await this.#resolveChromeContext()
    const spanId = this.#startSpan('key')
    const modifiers = input.modifiers ?? []
    await executePressKeys(this.#config, { keys: [input.key], modifiers })
    const evidence = compactArtifactRefs([
      this.#recordJsonArtifact(spanId, `action_key_${spanId}`, 'action-result', {
        key: input.key,
        modifiers,
      }),
    ])
    this.#endSpan(spanId, 'ok', 'pressed key')
    return {
      pressed: { key: input.key, modifiers },
      evidence,
      knownLimits: ['key_active_app_only'],
    }
  }

  async scrollRegion(input: {
    direction?: string
    amount?: number
    region?: { left: number, top: number, right: number, bottom: number }
  }): Promise<AtomicScrollRegionResult> {
    const context = await this.#resolveChromeContext()
    const spanId = this.#startSpan('scroll-region')
    const direction = input.direction ?? 'down'
    const amount = input.amount ?? 6
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error('chrome.scrollRegion amount must be greater than 0.')
    const region = input.region ?? { left: 0, top: 0, right: 1, bottom: 1 }
    const window = context.window
    const windowLocalPoint = {
      x: window.bounds.width * ((region.left + region.right) / 2),
      y: window.bounds.height * ((region.top + region.bottom) / 2),
    }
    const logicalPoint = {
      x: window.bounds.x + windowLocalPoint.x,
      y: window.bounds.y + windowLocalPoint.y,
    }
    const delta = atomicScrollDelta(direction, amount)
    const knownLimits: string[] = ['scroll_region_self_contained', 'foreground_hid_scroll_delivery']
    await executeScroll(this.#config, {
      pointerTrace: [{ ...logicalPoint, delayMs: 0 }],
      deltaX: delta.x,
      deltaY: delta.y,
      settleMs: 250,
    })

    const evidence = compactArtifactRefs([
      this.#recordJsonArtifact(spanId, `action_scroll_region_${spanId}`, 'action-result', {
        direction,
        amount,
        region,
        logical_point: logicalPoint,
        delta,
      }),
    ])
    this.#endSpan(spanId, 'ok', 'scrolled region')
    return {
      scrolled: {
        direction,
        amount,
        logicalPoint,
        region,
      },
      evidence,
      knownLimits: uniqueStrings(knownLimits),
    }
  }

  async #captureWindow(label: string): Promise<CapturedWindowAtomicContext> {
    const context = await this.#resolveChromeContext()
    const spanId = this.#startSpan(label)
    const snapshotId = `${spanId}_capture`
    const capture = await captureChromeWindow({
      config: this.#config,
      sessionId: this.#sessionId,
      snapshotId,
      window: context.window,
    })
    const evidence = compactArtifactRefs([
      this.#recordScreenshotArtifact(capture, spanId),
      this.#recordJsonArtifact(spanId, `capture_contract_${snapshotId}`, 'capture-contract', capture.contract, {
        coordinate_contract_version: capture.contract.coordinateContractVersion,
      }),
    ])
    return { context, capture, spanId, evidence }
  }

  async #captureAndRecognizeText(query: string, label: string): Promise<AtomicOcrContext> {
    const captured = await this.#captureWindow(label)
    const ocr = await recognizeTextInImage(this.#config, {
      imagePath: captured.capture.screenshot.path,
      query,
    })
    const ocrRef = this.#recordJsonArtifact(captured.spanId, `ocr_text_${captured.capture.snapshotId}`, 'ocr-text', ocr)
    const evidence = compactArtifactRefs([...captured.evidence, ocrRef])
    const matches = ocr.matches.map((match, matchIndex) =>
      projectPixelBoxToLogicalMatch({
        kind: 'ocr_text',
        text: match.text,
        confidence: match.confidence,
        matchIndex,
        pixelBox: match.bounds,
        contract: captured.capture.contract,
        detail: { source: 'ocr_text', matchIndex: match.matchIndex },
      }))

    this.#endSpan(captured.spanId, 'ok', `recognized ${matches.length} text match(es)`)
    return {
      ...captured,
      ocr,
      matches,
      evidence,
      knownLimits: ocr.knownLimits ?? [],
    }
  }

  async #captureAndRecognizeRows(query: string | undefined, label: string): Promise<AtomicOcrContext> {
    const captured = await this.#captureWindow(label)
    const ocr = await recognizeTextInImage(this.#config, {
      imagePath: captured.capture.screenshot.path,
      query: '',
    })
    const rows = await produceOcrRows({ textSnapshot: ocr })
    const normalizedQuery = query?.toLowerCase()
    const rowMatches = rows.rows
      .filter(row => !normalizedQuery || rowText(row).toLowerCase().includes(normalizedQuery))
      .map(row => rowToAtomicMatch(row, captured.capture))
    const rowRef = this.#recordJsonArtifact(captured.spanId, `ocr_rows_${captured.capture.snapshotId}`, 'ocr-rows', rows)
    const evidence = compactArtifactRefs([...captured.evidence, rowRef])
    this.#endSpan(captured.spanId, 'ok', `recognized ${rowMatches.length} row(s)`)
    return {
      ...captured,
      ocr,
      matches: rowMatches,
      evidence,
      knownLimits: uniqueStrings([
        ...(ocr.knownLimits ?? []),
        ...rows.knownLimits,
        'row_detection_uses_cds_ocr_text_grouping',
      ]),
    }
  }

  async #pointerAXAction(
    query: string,
    roles: ReadonlySet<string>,
    label: string,
  ): Promise<AtomicClickResult> {
    const context = await this.#resolveChromeContext()
    const spanId = this.#startSpan(label)
    const snapshot = await captureAXTree(this.#config, {
      pid: context.window.ownerPid,
      maxDepth: 15,
      maxNodes: 3000,
    })
    const evidence = compactArtifactRefs([
      this.#recordJsonArtifact(spanId, `ax_tree_${spanId}`, 'ax-tree', snapshot),
    ])
    const node = findBestAXNodeForAtomicAction(snapshot.root, query, roles, context.window.bounds)
    if (!node?.bounds)
      throw atomicError(`No matching AX node found for ${query}.`, 'recognition_not_found', evidence)

    const match = axNodeToAtomicMatch(node, query, label)
    await this.#clickLogicalPoint(match.logicalPoint, evidence)
    const actionRef = this.#recordJsonArtifact(spanId, `action_${sanitizeId(label)}_${spanId}`, 'action-result', {
      query,
      roles: [...roles],
      clicked: match,
    })
    this.#endSpan(spanId, 'ok', `${label} completed`)
    return {
      clicked: { ...match, anchorOffset: { x: 0, y: 0 } },
      evidence: compactArtifactRefs([...evidence, actionRef]),
      knownLimits: ['ax_capture_once'],
    }
  }

  async #axAttributeAction(
    query: string,
    roles: string[],
    action: 'focus' | 'press',
    label: string,
  ): Promise<AtomicClickResult> {
    const context = await this.#resolveChromeContext()
    const spanId = this.#startSpan(label)
    const result = await executeAXQueryAction(this.#config, {
      pid: context.window.ownerPid,
      query,
      roles,
      action,
      actionName: 'AXPress',
      windowBounds: context.window.bounds,
    }).catch((error) => {
      const code = action === 'press' ? 'ax_press_unavailable' : 'ax_focus_unavailable'
      throw Object.assign(new Error(safeErrorMessage(error)), { code })
    })
    const box = result.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
    const match: AtomicMatch = {
      kind: result.role,
      text: result.text || query,
      box,
      confidence: 1,
      logicalPoint: centerOf(box),
      matchIndex: 0,
      detail: {
        source: 'ax',
        action: result.action,
        focusedBefore: result.focusedBefore,
      },
    }
    const evidence = compactArtifactRefs([
      this.#recordJsonArtifact(spanId, `ax_action_${spanId}`, 'ax-action', result),
    ])
    this.#endSpan(spanId, 'ok', `${label} completed`)
    return {
      clicked: { ...match, anchorOffset: { x: 0, y: 0 } },
      evidence,
      knownLimits: action === 'press'
        ? ['ax_press_no_pointer_fallback']
        : ['ax_focus_attribute_no_pointer_click'],
    }
  }

  async #clickLogicalPoint(point: { x: number, y: number }, evidence: ArtifactRef[]): Promise<void> {
    try {
      await executeMoveAndClick(this.#config, {
        pointerTrace: [
          ...(this.#getLastCursorPosition?.()
            ? [{ ...this.#getLastCursorPosition()!, delayMs: 0 }]
            : []),
          { ...point, delayMs: 0 },
        ],
        button: 0,
        clickCount: 1,
      })
    }
    catch (error) {
      throw atomicError(safeErrorMessage(error), atomicErrorCode(error) ?? 'click_delivery_failed', evidence)
    }
    this.#setLastCursorPosition?.(point)
  }

  #startSpan(label: string): string {
    const ordinal = this.#nextExternalAtomicId?.() ?? this.#nextAtomicId++
    const spanId = `atomic_${ordinal}_${sanitizeId(label)}`
    this.#traceSink?.startSpan?.(spanId, this.#parentSpanId, label)
    return spanId
  }

  #endSpan(spanId: string, statusCode: 'ok' | 'error', summary: string): void {
    this.#traceSink?.endSpan?.(spanId, statusCode, summary)
  }

  #recordScreenshotArtifact(capture: ChromeWindowCapture, spanId: string): ArtifactRef | undefined {
    const artifactId = `screenshot_${capture.snapshotId}`
    this.#traceSink?.recordArtifact?.({
      artifact_id: artifactId,
      span_id: spanId,
      role: 'screenshot',
      mime_type: 'image/png',
      path: capture.screenshot.path,
      attributes: {
        width: capture.screenshot.width,
        height: capture.screenshot.height,
      },
    })
    return this.#traceSink ? { run_id: this.#runId, artifact_id: artifactId, span_id: spanId } : undefined
  }

  #recordJsonArtifact(
    spanId: string,
    artifactId: string,
    role: string,
    payload: unknown,
    attributes?: Record<string, unknown>,
  ): ArtifactRef | undefined {
    const artifact = this.#traceSink?.writeJsonArtifact?.({
      artifact_id: artifactId,
      span_id: spanId,
      role,
      payload,
      attributes,
    })
    return artifact ? { run_id: this.#runId, artifact_id: artifact.artifact_id, span_id: artifact.span_id } : undefined
  }

  #recognitionId(kind: string): string {
    return `atomic_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }
}

export async function invokeMacOSChromeOperation(
  context: LiveMacOSChromeAtomicCommandInput,
  call: MacOSChromeOperationCall,
): Promise<MacOSChromeOperationResponse> {
  const commands = new LiveMacOSChromeAtomicCommands(context)
  switch (call.operation) {
    case 'findText':
      return commands.findText({ query: stringInput(call, 'query') })
    case 'waitForText':
      return commands.waitForText({
        query: stringInput(call, 'query'),
        timeoutMs: optionalNumberInput(call, 'timeoutMs'),
        pollIntervalMs: optionalNumberInput(call, 'pollIntervalMs'),
      })
    case 'clickText':
      return commands.clickText({
        query: stringInput(call, 'query'),
        matchIndex: optionalNumberInput(call, 'matchIndex'),
        anchorOffsetX: optionalNumberInput(call, 'anchorOffsetX'),
        anchorOffsetY: optionalNumberInput(call, 'anchorOffsetY'),
      })
    case 'findRows': {
      const query = optionalStringInput(call, 'query')
      return commands.findRows(query === undefined ? {} : { query })
    }
    case 'clickRow':
      return commands.clickRow({
        query: optionalStringInput(call, 'query'),
        rowIndex: numberInput(call, 'rowIndex'),
      })
    case 'focusText':
      return commands.focusText({ query: stringInput(call, 'query') })
    case 'axFocusText':
      return commands.axFocusText({ query: stringInput(call, 'query') })
    case 'pressButton':
      return commands.pressButton({ query: stringInput(call, 'query') })
    case 'axPressButton':
      return commands.axPressButton({ query: stringInput(call, 'query') })
    case 'typeTextAtomic':
      return commands.typeText({
        text: stringInput(call, 'text'),
        submitKey: optionalStringInput(call, 'submitKey'),
      })
    case 'key':
      return commands.key({
        key: stringInput(call, 'key'),
        modifiers: optionalStringArrayInput(call, 'modifiers'),
      })
    case 'scrollRegion':
      return commands.scrollRegion({
        direction: optionalStringInput(call, 'direction'),
        amount: optionalNumberInput(call, 'amount'),
        region: optionalRegionInput(call, 'region'),
      })
    default:
      throw Object.assign(new Error(`Unsupported macOS Chrome operation ${call.operation}.`), { code: 'unsupported_operation' })
  }
}

function stringInput(call: MacOSChromeOperationCall, key: string): string {
  const value = call.inputs[key]
  if (typeof value !== 'string')
    throw Object.assign(new Error(`${call.commandId} operation input ${key} must be a string.`), { code: `invalid_${key}` })
  return value
}

function numberInput(call: MacOSChromeOperationCall, key: string): number {
  const value = call.inputs[key]
  if (typeof value !== 'number')
    throw Object.assign(new Error(`${call.commandId} operation input ${key} must be a number.`), { code: `invalid_${key}` })
  return value
}

function optionalStringInput(call: MacOSChromeOperationCall, key: string): string | undefined {
  const value = call.inputs[key]
  if (value === undefined)
    return undefined
  if (typeof value !== 'string')
    throw Object.assign(new Error(`${call.commandId} operation input ${key} must be a string.`), { code: `invalid_${key}` })
  return value
}

function optionalNumberInput(call: MacOSChromeOperationCall, key: string): number | undefined {
  const value = call.inputs[key]
  if (value === undefined)
    return undefined
  if (typeof value !== 'number')
    throw Object.assign(new Error(`${call.commandId} operation input ${key} must be a number.`), { code: `invalid_${key}` })
  return value
}

function optionalStringArrayInput(call: MacOSChromeOperationCall, key: string): string[] | undefined {
  const value = call.inputs[key]
  if (value === undefined)
    return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
    throw Object.assign(new Error(`${call.commandId} operation input ${key} must be a string array.`), { code: `invalid_${key}` })
  return value
}

function optionalRegionInput(
  call: MacOSChromeOperationCall,
  key: string,
): { left: number, top: number, right: number, bottom: number } | undefined {
  const value = call.inputs[key]
  if (value === undefined)
    return undefined
  if (!isAtomicRegionInput(value))
    throw Object.assign(new Error(`${call.commandId} operation input ${key} must be a region object.`), { code: `invalid_${key}` })
  return value
}

function isAtomicRegionInput(value: unknown): value is { left: number, top: number, right: number, bottom: number } {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && ['left', 'top', 'right', 'bottom'].every((key) => {
      const item = (value as Record<string, unknown>)[key]
      return typeof item === 'number' && Number.isFinite(item)
    })
}

function rowToAtomicMatch(row: OcrRowEvidence, capture: ChromeWindowCapture): AtomicMatch {
  const box = projectPixelBoxToLogical(row.bounds, capture.contract)
  return {
    kind: 'ocr_row',
    text: rowText(row),
    box,
    confidence: row.confidence ?? 0,
    logicalPoint: centerOf(box),
    matchIndex: row.rowIndex,
    detail: {
      source: 'ocr_row',
      rowIndex: row.rowIndex,
      rawPixelBox: row.bounds,
      fragments: row.textFragments,
    },
  }
}

function rowText(row: OcrRowEvidence): string {
  return row.textFragments.map(fragment => fragment.text).join(' ').trim()
}

export function findBestAXNodeForAtomicAction(
  root: AXNode,
  query: string,
  roles: ReadonlySet<string>,
  windowBounds: { x: number, y: number, width: number, height: number },
): AXNode | undefined {
  const normalizedQuery = query.toLowerCase()
  const matches: AXNode[] = []
  const walk = (node: AXNode): void => {
    if (node.bounds
      && roles.has(node.role)
      && pointInsideBounds(centerOf(node.bounds), windowBounds)
      && axNodeText(node).toLowerCase().includes(normalizedQuery)) {
      matches.push(node)
    }
    for (const child of node.children)
      walk(child)
  }
  walk(root)
  return matches
    .sort((a, b) => (a.bounds?.y ?? 0) - (b.bounds?.y ?? 0) || (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0))[0]
}

function axNodeToAtomicMatch(node: AXNode, query: string, source: string): AtomicMatch {
  const box = node.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
  return {
    kind: node.role,
    text: axNodeText(node) || query,
    box,
    confidence: 1,
    logicalPoint: centerOf(box),
    matchIndex: 0,
    detail: {
      source,
      uid: node.uid,
      role: node.role,
      focused: node.focused,
    },
  }
}

function axNodeText(node: AXNode): string {
  return [node.title, node.value, node.description]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
}

function pointInsideBounds(point: { x: number, y: number }, bounds: { x: number, y: number, width: number, height: number }): boolean {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height
}

export function atomicScrollDelta(direction: string, amount: number): { x: number, y: number } {
  const pixels = amount * 100
  // macOS CGEvent scroll deltas are wheel deltas, not page-content movement vectors.
  switch (direction) {
    case 'up':
      return { x: 0, y: pixels }
    case 'left':
      return { x: pixels, y: 0 }
    case 'right':
      return { x: -pixels, y: 0 }
    case 'down':
    default:
      return { x: 0, y: -pixels }
  }
}

function compactArtifactRefs(refs: Array<ArtifactRef | undefined>): ArtifactRef[] {
  return refs.filter((ref): ref is ArtifactRef => ref !== undefined)
}

function atomicError(message: string, code: string, evidence: ArtifactRef[]): Error & { code: string, evidence: ArtifactRef[] } {
  return Object.assign(new Error(message), { code, evidence })
}

function atomicErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function removeIfPresent(path: string | undefined): Promise<void> {
  if (!path)
    return
  await unlink(path).catch(() => {})
}

function sanitizeId(value: string): string {
  return value.replace(/[^\w.-]/g, '_').slice(0, 80)
}
