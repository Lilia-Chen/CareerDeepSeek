import { MacOSChromeDriver } from './driver.js'
import { createMacOSChromeHandlers } from './invoke-handlers.js'
import { invoke } from './invoke-runtime.js'
import type { MacOSChromeDriverOptions } from './driver.js'
import type { MacOSChromeInvokeDriver } from './invoke-handlers.js'
import type { ComputerUseInvokeOptions } from './invoke-runtime.js'
import type { ComputerUseInvokeRequest, ComputerUseInvokeResult } from './invoke-types.js'

export interface MacOSChromeInvokeEntry {
  invoke: (request: unknown | ComputerUseInvokeRequest) => Promise<ComputerUseInvokeResult>
}

export interface MacOSChromeInvokeEntryOptions {
  driverOptions: MacOSChromeDriverOptions
  trace?: ComputerUseInvokeOptions['trace']
  now?: ComputerUseInvokeOptions['now']
}

export function createMacOSChromeInvokeEntry(
  options: MacOSChromeInvokeEntryOptions,
): MacOSChromeInvokeEntry {
  const driver = new MacOSChromeDriver(options.driverOptions)
  return createMacOSChromeInvokeEntryWithDriver(driver, options)
}

export function createMacOSChromeInvokeEntryForTest(
  driver: MacOSChromeInvokeDriver,
  options: Pick<MacOSChromeInvokeEntryOptions, 'trace' | 'now'> = {},
): MacOSChromeInvokeEntry {
  return createMacOSChromeInvokeEntryWithDriver(driver, options)
}

function createMacOSChromeInvokeEntryWithDriver(
  driver: MacOSChromeInvokeDriver,
  options: Pick<MacOSChromeInvokeEntryOptions, 'trace' | 'now'>,
): MacOSChromeInvokeEntry {
  const handlers = createMacOSChromeHandlers(driver)

  // AUV-aligned: the driver's TraceStore is the single source of truth for
  // events, spans, and artifacts. When no external trace sink is provided,
  // wire the driver's own TraceStore into the invoke runtime so events.jsonl
  // is always populated and command_count > 0 for executed commands.
  const driverTrace: ComputerUseInvokeOptions['trace'] | undefined
    = driver instanceof MacOSChromeDriver ? driver.traceSink as unknown as ComputerUseInvokeOptions['trace'] : undefined

  return Object.freeze({
    invoke: async (request: unknown) => {
      const parsed = parseInvokeRequest(request)
      if (!parsed.ok)
        return parsed.result

      return invoke(parsed.request, {
        handlers,
        trace: options.trace ?? driverTrace,
        now: options.now,
      })
    },
  })
}

type RequestParseResult
  = | { ok: true, request: ComputerUseInvokeRequest }
    | { ok: false, result: ComputerUseInvokeResult }

function parseInvokeRequest(request: unknown): RequestParseResult {
  if (!isNonArrayRecord(request)) {
    return invalidRequestFailure({
      commandId: 'invalid_request',
      code: 'request_must_be_object',
      message: 'Invoke request must be an object.',
    })
  }

  const commandId = request.commandId
  if (typeof commandId !== 'string' || commandId.trim() === '') {
    return invalidRequestFailure({
      commandId: 'invalid_request',
      code: 'missing_command_id',
      message: 'Invoke request requires a non-empty commandId string.',
    })
  }

  if (request.inputs !== undefined && !isNonArrayRecord(request.inputs)) {
    return invalidRequestFailure({
      commandId,
      code: 'inputs_must_be_object',
      message: 'Invoke request inputs must be an object when provided.',
    })
  }

  if (request.target !== undefined && !isNonArrayRecord(request.target)) {
    return invalidRequestFailure({
      commandId,
      code: 'target_must_be_object',
      message: 'Invoke request target must be an object when provided.',
    })
  }

  const parsedRequest: ComputerUseInvokeRequest = { commandId }
  if (request.inputs !== undefined)
    parsedRequest.inputs = request.inputs
  if (request.target !== undefined)
    parsedRequest.target = request.target
  if (request.dryRun === true)
    parsedRequest.dryRun = true

  return { ok: true, request: parsedRequest }
}

function invalidRequestFailure(input: {
  commandId: string
  code: string
  message: string
}): RequestParseResult {
  return {
    ok: false,
    result: {
      commandId: input.commandId,
      status: 'failed',
      summary: `Invoke request is invalid: ${input.code}.`,
      signals: ['invalid_invoke_request', input.code],
      artifacts: [],
      failure: {
        class: 'invalid_input',
        code: input.code,
        message: input.message,
      },
      knownLimits: ['entry_validates_request_shape_only'],
    },
  }
}

function isNonArrayRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
