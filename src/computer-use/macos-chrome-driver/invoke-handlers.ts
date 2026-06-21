import type {
  MacOSChromeOperationCall,
  MacOSChromeOperationResponse,
} from './atomic-commands.js'
import type {
  AtomicClickResult,
  AtomicClickTargetKind,
  AtomicFindResult,
  AtomicKeyResult,
  AtomicScrollRegionResult,
  AtomicTargetHint,
  AtomicTypeTextResult,
  AtomicWaitForTextResult,
} from './atomic-types.js'
import type {
  ComputerUseCommandSpec,
  ComputerUseFailureClass,
  ComputerUseInvokeRequest,
  ComputerUseInvokeResult,
  ComputerUseInvokeStatus,
} from './invoke-types.js'
import type {
  ArtifactRef,
  ObservationSnapshot,
  SafetyCheckResult,
} from './types.js'
import {
  isObjectLikeRecord,
  safeErrorMessage,
  uniqueArtifactRefs,
  uniqueStrings,
} from './shared.js'

export interface ComputerUseCommandHandlerContext {
  request: ComputerUseInvokeRequest
  spec: Readonly<ComputerUseCommandSpec>
  spanId: string
}

export type ComputerUseCommandHandler
  = (context: ComputerUseCommandHandlerContext) => ComputerUseInvokeResult | Promise<ComputerUseInvokeResult>

export type ComputerUseCommandHandlerRegistry = Readonly<Partial<Record<string, ComputerUseCommandHandler>>>

export const EMPTY_COMPUTER_USE_COMMAND_HANDLERS: ComputerUseCommandHandlerRegistry = Object.freeze({})

export interface MacOSChromeInvokeDriver {
  observe: () => Promise<ObservationSnapshot>
  checkSafetyGate: () => Promise<SafetyCheckResult>
  invokeOperation: (call: MacOSChromeOperationCall) => Promise<MacOSChromeOperationResponse>
}

export function createMacOSChromeHandlers(driver: MacOSChromeInvokeDriver): ComputerUseCommandHandlerRegistry {
  return Object.freeze({
    'chrome.observe': async ({ spec }) => invokeObserve(spec, driver),
    'chrome.checkSafetyGate': async ({ spec }) => invokeCheckSafetyGate(spec, driver),
    'chrome.findText': async ({ request, spec }) => invokeAtomicFindText(request, spec, driver),
    'chrome.waitForText': async ({ request, spec }) => invokeAtomicWaitForText(request, spec, driver),
    'chrome.clickTarget': async ({ request, spec }) => invokeAtomicClickTarget(request, spec, driver),
    'chrome.typeInput': async ({ request, spec }) => invokeAtomicTypeInput(request, spec, driver),
    'chrome.key': async ({ request, spec }) => invokeAtomicKey(request, spec, driver),
    'chrome.scrollRegion': async ({ request, spec }) => invokeAtomicScrollRegion(request, spec, driver),
  })
}

async function invokeAtomicFindText(
  request: ComputerUseInvokeRequest,
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
): Promise<ComputerUseInvokeResult> {
  const query = requiredString(request.inputs, 'query', spec.id)
  if (!query.ok)
    return query.result

  try {
    const result = await invokeDriverOperation<AtomicFindResult>(driver, spec, { query: query.value })
    return {
      commandId: spec.id,
      status: 'completed',
      summary: result.found
        ? `Found ${result.matchCount} OCR text match(es) for ${query.value}.`
        : `Found 0 OCR text matches for ${query.value}.`,
      output: result,
      signals: [result.found ? 'text_found' : 'text_not_found'],
      artifacts: result.evidence,
      knownLimits: result.knownLimits,
    }
  }
  catch (error) {
    return atomicFailureResult(spec.id, 'findText', 'recognition', error)
  }
}

async function invokeAtomicWaitForText(
  request: ComputerUseInvokeRequest,
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
): Promise<ComputerUseInvokeResult> {
  const query = requiredString(request.inputs, 'query', spec.id)
  if (!query.ok)
    return query.result
  if (request.inputs && Object.hasOwn(request.inputs, 'match_index')) {
    return handlerFailureResult({
      commandId: spec.id,
      summary: 'waitForText does not accept match_index input.',
      failureClass: 'invalid_input',
      code: 'wait_for_text_match_index_not_accepted',
      message: 'chrome.waitForText returns observed matches but does not select a match_index. Use chrome.clickTarget with query/kind/hint after waiting.',
      signals: ['wait_for_text_match_index_not_accepted'],
      knownLimits: ['wait_for_text_observation_only'],
    })
  }
  const timeoutMs = optionalPositiveInteger(request.inputs, 'timeout_ms', 3000, spec.id)
  if (!timeoutMs.ok)
    return timeoutMs.result
  const pollIntervalMs = optionalPositiveInteger(request.inputs, 'poll_interval_ms', 250, spec.id)
  if (!pollIntervalMs.ok)
    return pollIntervalMs.result

  try {
    const result = await invokeDriverOperation<AtomicWaitForTextResult>(driver, spec, {
      query: query.value,
      timeoutMs: timeoutMs.value,
      pollIntervalMs: pollIntervalMs.value,
    })
    return {
      commandId: spec.id,
      status: 'completed',
      summary: result.found
        ? `Observed OCR text ${query.value} after ${result.pollCount} poll(s).`
        : `Timed out waiting for OCR text ${query.value} after ${result.pollCount} poll(s).`,
      output: result,
      signals: [result.found ? 'text_wait_found' : 'text_wait_timed_out'],
      artifacts: result.evidence,
      knownLimits: uniqueStrings(['wait_for_text_self_contained_polling', ...result.knownLimits]),
    }
  }
  catch (error) {
    return atomicFailureResult(spec.id, 'waitForText', 'recognition', error)
  }
}

async function invokeAtomicClickTarget(
  request: ComputerUseInvokeRequest,
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
): Promise<ComputerUseInvokeResult> {
  const query = requiredString(request.inputs, 'query', spec.id)
  if (!query.ok)
    return query.result
  const kind = parseClickTargetKind(request.inputs, spec.id)
  if (!kind.ok)
    return kind.result
  const hint = optionalHint(request.inputs, spec.id)
  if (!hint.ok)
    return hint.result

  try {
    const result = await invokeDriverOperation<AtomicClickResult>(driver, spec, {
      query: query.value,
      kind: kind.value,
      ...(hint.value === undefined ? {} : { hint: hint.value }),
    })
    return completedAtomicActionResult(spec.id, 'Clicked resolved foreground target.', 'target_clicked', result)
  }
  catch (error) {
    return atomicFailureResult(spec.id, 'clickTarget', 'action_delivery', error)
  }
}

async function invokeAtomicTypeInput(
  request: ComputerUseInvokeRequest,
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
): Promise<ComputerUseInvokeResult> {
  const query = requiredString(request.inputs, 'query', spec.id)
  if (!query.ok)
    return query.result
  const text = requiredString(request.inputs, 'text', spec.id, 'missing_text')
  if (!text.ok)
    return text.result
  const submitKey = optionalString(request.inputs, 'submit_key', spec.id)
  if (!submitKey.ok)
    return submitKey.result
  const hint = optionalHint(request.inputs, spec.id)
  if (!hint.ok)
    return hint.result

  try {
    const result = await invokeDriverOperation<AtomicTypeTextResult>(driver, spec, {
      query: query.value,
      text: text.value,
      ...(submitKey.value === undefined ? {} : { submitKey: submitKey.value }),
      ...(hint.value === undefined ? {} : { hint: hint.value }),
    })
    return {
      commandId: spec.id,
      status: 'completed',
      summary: 'Resolved input field and typed text.',
      output: result,
      signals: ['input_typed'],
      artifacts: result.evidence,
      knownLimits: result.knownLimits,
    }
  }
  catch (error) {
    return atomicFailureResult(spec.id, 'typeInput', 'action_delivery', error)
  }
}

async function invokeAtomicKey(
  request: ComputerUseInvokeRequest,
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
): Promise<ComputerUseInvokeResult> {
  const key = requiredString(request.inputs, 'key', spec.id, 'missing_key')
  if (!key.ok)
    return key.result
  const modifiers = optionalModifiers(request.inputs, spec.id)
  if (!modifiers.ok)
    return modifiers.result

  try {
    const result = await invokeDriverOperation<AtomicKeyResult>(driver, spec, { key: key.value, modifiers: modifiers.value })
    return {
      commandId: spec.id,
      status: 'completed',
      summary: 'Pressed key in active Chrome app.',
      output: result,
      signals: ['key_pressed'],
      artifacts: result.evidence,
      knownLimits: result.knownLimits,
    }
  }
  catch (error) {
    return atomicFailureResult(spec.id, 'key', 'action_delivery', error)
  }
}

async function invokeAtomicScrollRegion(
  request: ComputerUseInvokeRequest,
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
): Promise<ComputerUseInvokeResult> {
  const direction = optionalString(request.inputs, 'direction', spec.id, 'down')
  if (!direction.ok)
    return direction.result
  const directionValue = direction.value ?? 'down'
  if (!['up', 'down', 'left', 'right'].includes(directionValue)) {
    return handlerFailureResult({
      commandId: spec.id,
      summary: 'direction input is invalid.',
      failureClass: 'invalid_input',
      code: 'invalid_direction',
      message: 'chrome.scrollRegion direction must be one of up, down, left, right.',
      signals: ['invalid_direction'],
      knownLimits: ['scroll_region_self_contained'],
    })
  }
  const amount = optionalNumber(request.inputs, 'amount', 6, spec.id)
  if (!amount.ok)
    return amount.result
  if (amount.value <= 0) {
    return handlerFailureResult({
      commandId: spec.id,
      summary: 'amount input is invalid.',
      failureClass: 'invalid_input',
      code: 'invalid_amount',
      message: 'chrome.scrollRegion amount must be greater than 0.',
      signals: ['invalid_amount'],
      knownLimits: ['scroll_region_self_contained'],
    })
  }
  const region = optionalRegion(request.inputs, spec.id)
  if (!region.ok)
    return region.result

  try {
    const result = await invokeDriverOperation<AtomicScrollRegionResult>(driver, spec, {
      direction: directionValue,
      amount: amount.value,
      region: region.value,
    })
    return {
      commandId: spec.id,
      status: 'completed',
      summary: 'Scrolled managed Chrome region.',
      output: result,
      signals: ['region_scrolled'],
      artifacts: result.evidence,
      knownLimits: uniqueStrings(['scroll_region_self_contained', ...result.knownLimits]),
    }
  }
  catch (error) {
    return atomicFailureResult(spec.id, 'scrollRegion', 'action_delivery', error)
  }
}

async function invokeDriverOperation<T extends MacOSChromeOperationResponse>(
  driver: MacOSChromeInvokeDriver,
  spec: Readonly<ComputerUseCommandSpec>,
  inputs: Record<string, unknown>,
): Promise<T> {
  return await driver.invokeOperation({
    commandId: spec.id,
    operation: spec.operation,
    inputs,
  }) as T
}

async function invokeObserve(
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
): Promise<ComputerUseInvokeResult> {
  try {
    const snapshot = await driver.observe()
    const artifacts = uniqueArtifactRefs([
      observationArtifactRef(snapshot),
      ...snapshot.evidence,
      ...(snapshot.capture_contract_ref ? [snapshot.capture_contract_ref] : []),
    ])
    const hardStopSignals = observationHardStopSignals(snapshot)

    return {
      commandId: spec.id,
      status: 'completed',
      summary: `Observed Chrome window snapshot ${snapshot.snapshot_id}.`,
      output: snapshot,
      signals: [
        'observe_completed',
        ...(hardStopSignals.length > 0 ? ['hard_stop_signal'] : []),
      ],
      artifacts,
      knownLimits: uniqueStrings([
        'read_only_observation_only',
        ...snapshot.known_limits,
      ]),
    }
  }
  catch (error) {
    return handlerFailureResult({
      commandId: spec.id,
      summary: 'Chrome observe failed.',
      failureClass: 'observe',
      code: 'observe_failed',
      message: safeErrorMessage(error),
      signals: ['observe_failed'],
      knownLimits: ['read_only_observation_only'],
    })
  }
}

async function invokeCheckSafetyGate(
  spec: Readonly<ComputerUseCommandSpec>,
  driver: MacOSChromeInvokeDriver,
): Promise<ComputerUseInvokeResult> {
  try {
    const result = await driver.checkSafetyGate()
    if (result.passed) {
      return {
        commandId: spec.id,
        status: 'completed',
        summary: 'Chrome safety gate passed.',
        output: result,
        signals: ['safety_gate_passed'],
        artifacts: [],
        knownLimits: ['read_only_safety_check_only'],
      }
    }

    const failure = result.failures[0]
    const hardStop = result.failures.some(item => item.code === 'hard_stop_signal')
    const failureCode = hardStop ? 'hard_stop_signal' : (failure?.code ?? 'safety_gate_failed')

    return {
      commandId: spec.id,
      status: 'refused',
      summary: `Chrome safety gate refused: ${failureCode}.`,
      output: result,
      signals: uniqueStrings([
        'safety_gate_failed',
        ...result.failures.map(item => item.code),
      ]),
      artifacts: [],
      failure: {
        class: hardStop ? 'hard_stop' : 'safety_gate',
        code: failureCode,
        message: failure?.detail ?? 'Chrome safety gate refused the current context.',
      },
      knownLimits: [
        hardStop ? 'hard_stop_exposed_without_overlay_dismissal' : 'read_only_safety_check_only',
      ],
    }
  }
  catch (error) {
    return handlerFailureResult({
      commandId: spec.id,
      summary: 'Chrome safety gate check failed.',
      failureClass: 'safety_gate',
      code: 'check_safety_gate_failed',
      message: safeErrorMessage(error),
      signals: ['safety_gate_check_failed'],
      knownLimits: ['read_only_safety_check_only'],
    })
  }
}

function observationArtifactRef(snapshot: ObservationSnapshot): ArtifactRef {
  return {
    run_id: snapshot.run_id,
    artifact_id: `observation_${snapshot.snapshot_id}`,
    span_id: snapshot.span_id,
  }
}

type StringInputResult
  = | { ok: true, value: string }
    | { ok: false, result: ComputerUseInvokeResult }

type OptionalStringInputResult
  = | { ok: true, value: string | undefined }
    | { ok: false, result: ComputerUseInvokeResult }

type NumberValueInputResult
  = | { ok: true, value: number }
    | { ok: false, result: ComputerUseInvokeResult }

type OptionalModifiersInputResult
  = | { ok: true, value: string[] }
    | { ok: false, result: ComputerUseInvokeResult }

type RegionInputResult
  = | { ok: true, value: { left: number, top: number, right: number, bottom: number } }
    | { ok: false, result: ComputerUseInvokeResult }

type ClickTargetKindInputResult
  = | { ok: true, value: AtomicClickTargetKind }
    | { ok: false, result: ComputerUseInvokeResult }

type HintInputResult
  = | { ok: true, value: AtomicTargetHint | undefined }
    | { ok: false, result: ComputerUseInvokeResult }

function requiredString(
  inputs: Record<string, unknown> | undefined,
  key: string,
  commandId: string,
  missingCode = `missing_${key}`,
): StringInputResult {
  const value = inputs?.[key]
  if (typeof value === 'string' && value.trim() !== '')
    return { ok: true, value }

  return {
    ok: false,
    result: handlerFailureResult({
      commandId,
      summary: `${key} input is required.`,
      failureClass: 'invalid_input',
      code: missingCode,
      message: `${commandId} requires ${key} as a non-empty string.`,
      signals: [missingCode],
      knownLimits: ['cli_flat_inputs_only'],
    }),
  }
}

function optionalString(
  inputs: Record<string, unknown> | undefined,
  key: string,
  commandId: string,
  defaultValue?: string,
): OptionalStringInputResult {
  const value = inputs?.[key]
  if (value === undefined)
    return { ok: true, value: defaultValue }
  if (typeof value === 'string')
    return { ok: true, value }

  return {
    ok: false,
    result: handlerFailureResult({
      commandId,
      summary: `${key} input is invalid.`,
      failureClass: 'invalid_input',
      code: `invalid_${key}`,
      message: `${commandId} requires ${key} to be a string when provided.`,
      signals: [`invalid_${key}`],
      knownLimits: ['cli_flat_inputs_only'],
    }),
  }
}

function parseClickTargetKind(
  inputs: Record<string, unknown> | undefined,
  commandId: string,
): ClickTargetKindInputResult {
  const value = inputs?.kind
  if (typeof value !== 'string' || value.trim() === '') {
    return {
      ok: false,
      result: handlerFailureResult({
        commandId,
        summary: 'kind input is required.',
        failureClass: 'invalid_input',
        code: 'missing_kind',
        message: `${commandId} requires kind to be one of text, button, link, menuitem, any.`,
        signals: ['missing_kind'],
        knownLimits: ['cli_flat_inputs_only'],
      }),
    }
  }

  if (value === 'input') {
    return {
      ok: false,
      result: handlerFailureResult({
        commandId,
        summary: 'input is not a click target kind.',
        failureClass: 'invalid_input',
        code: 'click_target_input_kind_not_supported',
        message: 'Use chrome.typeInput for input fields.',
        signals: ['click_target_input_kind_not_supported'],
        knownLimits: ['input_intent_uses_type_input'],
      }),
    }
  }

  if (['text', 'button', 'link', 'menuitem', 'any'].includes(value))
    return { ok: true, value: value as AtomicClickTargetKind }

  return {
    ok: false,
    result: handlerFailureResult({
      commandId,
      summary: 'kind input is invalid.',
      failureClass: 'invalid_input',
      code: 'invalid_kind',
      message: `${commandId} kind must be one of text, button, link, menuitem, any.`,
      signals: ['invalid_kind'],
      knownLimits: ['cli_flat_inputs_only'],
    }),
  }
}

function optionalHint(
  inputs: Record<string, unknown> | undefined,
  commandId: string,
): HintInputResult {
  const keys = ['hint_left', 'hint_top', 'hint_right', 'hint_bottom'] as const
  const present = keys.filter(key => inputs?.[key] !== undefined)
  if (present.length === 0)
    return { ok: true, value: undefined }
  if (present.length !== keys.length) {
    return {
      ok: false,
      result: handlerFailureResult({
        commandId,
        summary: 'hint inputs are incomplete.',
        failureClass: 'invalid_input',
        code: 'incomplete_hint',
        message: `${commandId} requires all hint_left, hint_top, hint_right, and hint_bottom when any hint is supplied.`,
        signals: ['incomplete_hint'],
        knownLimits: ['hint_coordinates_are_normalized_window_bounds'],
      }),
    }
  }

  const parsed = keys.map((key) => {
    const value = inputs?.[key]
    return typeof value === 'string' || typeof value === 'number' ? Number(value) : undefined
  })
  if (parsed.some(value => value === undefined || !Number.isFinite(value) || value < 0 || value > 1)) {
    return {
      ok: false,
      result: handlerFailureResult({
        commandId,
        summary: 'hint inputs are invalid.',
        failureClass: 'invalid_input',
        code: 'invalid_hint',
        message: `${commandId} hint coordinates must be finite numbers in [0, 1].`,
        signals: ['invalid_hint'],
        knownLimits: ['hint_coordinates_are_normalized_window_bounds'],
      }),
    }
  }

  const [left, top, right, bottom] = parsed as [number, number, number, number]
  if (left >= right || top >= bottom) {
    return {
      ok: false,
      result: handlerFailureResult({
        commandId,
        summary: 'hint bounds are invalid.',
        failureClass: 'invalid_input',
        code: 'invalid_hint_bounds',
        message: `${commandId} requires hint_left < hint_right and hint_top < hint_bottom.`,
        signals: ['invalid_hint_bounds'],
        knownLimits: ['hint_coordinates_are_normalized_window_bounds'],
      }),
    }
  }

  return { ok: true, value: { left, top, right, bottom } }
}

function optionalInteger(
  inputs: Record<string, unknown> | undefined,
  key: string,
  defaultValue: number,
  commandId: string,
): NumberValueInputResult {
  const parsed = parseFiniteNumber(inputs?.[key], defaultValue)
  if (parsed === undefined || !Number.isInteger(parsed)) {
    return {
      ok: false,
      result: handlerFailureResult({
        commandId,
        summary: `${key} input is invalid.`,
        failureClass: 'invalid_input',
        code: `invalid_${key}`,
        message: `${commandId} requires ${key} to be an integer when provided.`,
        signals: [`invalid_${key}`],
        knownLimits: ['cli_flat_inputs_only'],
      }),
    }
  }
  return { ok: true, value: parsed }
}

function optionalPositiveInteger(
  inputs: Record<string, unknown> | undefined,
  key: string,
  defaultValue: number,
  commandId: string,
): NumberValueInputResult {
  const parsed = optionalInteger(inputs, key, defaultValue, commandId)
  if (!parsed.ok)
    return parsed
  if (parsed.value <= 0) {
    return {
      ok: false,
      result: handlerFailureResult({
        commandId,
        summary: `${key} input is invalid.`,
        failureClass: 'invalid_input',
        code: `invalid_${key}`,
        message: `${commandId} requires ${key} to be greater than 0 when provided.`,
        signals: [`invalid_${key}`],
        knownLimits: ['cli_flat_inputs_only'],
      }),
    }
  }
  return parsed
}

function optionalNumber(
  inputs: Record<string, unknown> | undefined,
  key: string,
  defaultValue: number,
  commandId: string,
): NumberValueInputResult {
  const parsed = parseFiniteNumber(inputs?.[key], defaultValue)
  if (parsed === undefined) {
    return {
      ok: false,
      result: handlerFailureResult({
        commandId,
        summary: `${key} input is invalid.`,
        failureClass: 'invalid_input',
        code: `invalid_${key}`,
        message: `${commandId} requires ${key} to be a finite number when provided.`,
        signals: [`invalid_${key}`],
        knownLimits: ['cli_flat_inputs_only'],
      }),
    }
  }
  return { ok: true, value: parsed }
}

function optionalModifiers(
  inputs: Record<string, unknown> | undefined,
  commandId: string,
): OptionalModifiersInputResult {
  const value = inputs?.modifiers
  if (value === undefined)
    return { ok: true, value: [] }
  if (Array.isArray(value) && value.every(item => typeof item === 'string'))
    return { ok: true, value }
  if (typeof value === 'string') {
    return {
      ok: true,
      value: value.split(',').map(item => item.trim()).filter(Boolean),
    }
  }

  return {
    ok: false,
    result: handlerFailureResult({
      commandId,
      summary: 'modifiers input is invalid.',
      failureClass: 'invalid_input',
      code: 'invalid_modifiers',
      message: `${commandId} modifiers must be a comma-separated string or array of strings.`,
      signals: ['invalid_modifiers'],
      knownLimits: ['cli_flat_inputs_only'],
    }),
  }
}

function optionalRegion(
  inputs: Record<string, unknown> | undefined,
  commandId: string,
): RegionInputResult {
  const left = optionalNumber(inputs, 'region_left', 0, commandId)
  if (!left.ok)
    return left
  const top = optionalNumber(inputs, 'region_top', 0, commandId)
  if (!top.ok)
    return top
  const right = optionalNumber(inputs, 'region_right', 1, commandId)
  if (!right.ok)
    return right
  const bottom = optionalNumber(inputs, 'region_bottom', 1, commandId)
  if (!bottom.ok)
    return bottom

  const region = { left: left.value, top: top.value, right: right.value, bottom: bottom.value }
  if (!Object.values(region).every(value => value >= 0 && value <= 1)) {
    return {
      ok: false,
      result: handlerFailureResult({
        commandId,
        summary: 'region ratio input is invalid.',
        failureClass: 'invalid_input',
        code: 'invalid_region_ratio',
        message: 'chrome.scrollRegion region ratios must be within [0, 1].',
        signals: ['invalid_region_ratio'],
        knownLimits: ['scroll_region_ratio_inputs'],
      }),
    }
  }
  if (region.left >= region.right || region.top >= region.bottom) {
    return {
      ok: false,
      result: handlerFailureResult({
        commandId,
        summary: 'region bounds input is invalid.',
        failureClass: 'invalid_input',
        code: 'invalid_region_bounds',
        message: 'chrome.scrollRegion requires region_left < region_right and region_top < region_bottom.',
        signals: ['invalid_region_bounds'],
        knownLimits: ['scroll_region_ratio_inputs'],
      }),
    }
  }

  return { ok: true, value: region }
}

function parseFiniteNumber(value: unknown, defaultValue: number): number | undefined {
  if (value === undefined)
    return defaultValue
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed))
      return parsed
  }
  return undefined
}

function completedAtomicActionResult(
  commandId: string,
  summary: string,
  signal: string,
  result: { evidence: ArtifactRef[], knownLimits: string[] },
): ComputerUseInvokeResult {
  return {
    commandId,
    status: 'completed',
    summary,
    output: result,
    signals: [signal],
    artifacts: result.evidence,
    knownLimits: result.knownLimits,
  }
}

function atomicFailureResult(
  commandId: string,
  actionType: string,
  failureClass: ComputerUseFailureClass,
  error: unknown,
): ComputerUseInvokeResult {
  const code = errorCode(error) ?? `${actionType}_failed`
  const message = safeErrorMessage(error)
  return handlerFailureResult({
    commandId,
    summary: `${actionType} failed.`,
    failureClass: classifyAtomicFailure(code, message, failureClass),
    code,
    message,
    signals: [`${actionType}_failed`],
    artifacts: errorEvidence(error),
    knownLimits: ['atomic_cli_command_failed_without_sequence_state'],
  })
}

function classifyAtomicFailure(
  code: string,
  message: string,
  fallback: ComputerUseFailureClass,
): ComputerUseFailureClass {
  if (code === 'recognition_not_found')
    return 'recognition'
  if (code === 'target_outside_window')
    return 'safety_gate'
  if (code === 'hard_stop_signal')
    return 'hard_stop'
  if ([
    'profile_mismatch',
    'chrome_not_foreground',
    'check_safety_gate_failed',
  ].includes(code)) {
    return 'safety_gate'
  }
  if (/\b(?:profile|foreground|lease|managed Chrome context|Google Chrome must)\b/i.test(message))
    return 'safety_gate'
  return fallback
}

function observationHardStopSignals(snapshot: ObservationSnapshot): string[] {
  const signals = isObjectLikeRecord(snapshot.detail) ? snapshot.detail.signals : undefined
  if (!Array.isArray(signals))
    return []
  return signals.filter((item): item is string => typeof item === 'string')
}

function errorEvidence(error: unknown): ArtifactRef[] {
  if (!isObjectLikeRecord(error) || !Array.isArray(error.evidence))
    return []
  return error.evidence.filter(isArtifactRef)
}

function isArtifactRef(value: unknown): value is ArtifactRef {
  return isObjectLikeRecord(value)
    && typeof value.run_id === 'string'
    && typeof value.artifact_id === 'string'
    && typeof value.span_id === 'string'
}

function handlerFailureResult(input: {
  commandId: string
  status?: ComputerUseInvokeStatus
  summary: string
  output?: unknown
  failureClass: ComputerUseFailureClass
  code: string
  message: string
  signals: string[]
  artifacts?: ArtifactRef[]
  knownLimits: string[]
}): ComputerUseInvokeResult {
  return {
    commandId: input.commandId,
    status: input.status ?? 'failed',
    summary: input.summary,
    output: input.output,
    signals: input.signals,
    artifacts: input.artifacts ?? [],
    failure: {
      class: input.failureClass,
      code: input.code,
      message: input.message,
    },
    knownLimits: input.knownLimits,
  }
}

function errorCode(error: unknown): string | undefined {
  if (!isObjectLikeRecord(error))
    return undefined
  return typeof error.code === 'string' ? error.code : undefined
}
