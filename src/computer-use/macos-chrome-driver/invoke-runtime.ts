import type { EventRecord, TraceStatusCode } from './types.js'
import type {
  ComputerUseCommandSpec,
  ComputerUseFailureClass,
  ComputerUseInvokeRequest,
  ComputerUseInvokeResult,
} from './invoke-types.js'
import {
  ComputerUseCommandResolutionError,
  dryRunComputerUseCommand,
  resolveComputerUseCommandSpec,
} from './invoke-catalog.js'
import {
  EMPTY_COMPUTER_USE_COMMAND_HANDLERS,
} from './invoke-handlers.js'
import type { ComputerUseCommandHandlerRegistry } from './invoke-handlers.js'

type TraceEventInput = Omit<EventRecord, 'api_version'>
type EndSpanStatusCode = Extract<TraceStatusCode, 'ok' | 'error'>

export interface ComputerUseInvokeTraceSink {
  startSpan: (spanId: string, parentSpanId: string | undefined, name: string) => unknown
  recordEvent: (event: TraceEventInput) => void
  endSpan: (spanId: string, statusCode: EndSpanStatusCode, summary?: string) => void
}

export interface ComputerUseInvokeOptions {
  handlers?: ComputerUseCommandHandlerRegistry
  trace?: ComputerUseInvokeTraceSink
  spanId?: string
  parentSpanId?: string
  now?: () => number
}

let nextInvokeSpanOrdinal = 0

export async function invoke(
  request: ComputerUseInvokeRequest,
  options: ComputerUseInvokeOptions = {},
): Promise<ComputerUseInvokeResult> {
  const spanId = options.spanId ?? nextInvokeSpanId(request.commandId)
  const trace = options.trace
  const now = options.now ?? Date.now
  let eventOrdinal = 0

  const recordEvent = (name: string, attributes: Record<string, unknown>): void => {
    trace?.recordEvent({
      event_id: `${spanId}.${++eventOrdinal}.${name}`,
      span_id: spanId,
      name,
      timestamp_millis: now(),
      attributes,
      artifact_ids: [],
    })
  }

  trace?.startSpan(spanId, options.parentSpanId, 'computer_use.invoke')
  recordEvent('command_resolution_started', {
    command_id: request.commandId,
    dry_run: request.dryRun === true,
  })

  let spec: Readonly<ComputerUseCommandSpec>
  try {
    spec = resolveComputerUseCommandSpec(request.commandId)
  }
  catch (error) {
    const result = runtimeCommandResolutionFailure(request.commandId, error)
    recordEvent('command_resolution_failed', {
      command_id: request.commandId,
      failure_class: result.failure?.class,
      failure_code: result.failure?.code,
      failure_message: result.failure?.message,
    })
    trace?.endSpan(spanId, 'error', result.summary)
    return result
  }

  recordEvent('command_resolution_completed', {
    command_id: spec.id,
    namespace: spec.namespace,
    operation: spec.operation,
  })

  if (request.dryRun === true) {
    const result = dryRunComputerUseCommand(request)
    recordEvent('dry_run_completed', {
      command_id: spec.id,
      status: result.status,
    })
    trace?.endSpan(spanId, 'ok', result.summary)
    return result
  }

  const handlers = options.handlers ?? EMPTY_COMPUTER_USE_COMMAND_HANDLERS
  const handler = handlers[spec.id]
  if (!handler) {
    const result = noHandlerFailure(spec)
    recordEvent('handler_invocation_failed', {
      command_id: spec.id,
      failure_class: result.failure?.class,
      failure_code: result.failure?.code,
      failure_message: result.failure?.message,
    })
    trace?.endSpan(spanId, 'error', result.summary)
    return result
  }

  recordEvent('handler_invocation_started', {
    command_id: spec.id,
    operation: spec.operation,
  })

  try {
    const result = await handler({ request, spec, spanId })
    const statusCode: EndSpanStatusCode = result.status === 'completed' ? 'ok' : 'error'
    recordEvent(result.status === 'completed' ? 'handler_invocation_completed' : 'handler_invocation_failed', {
      command_id: spec.id,
      status: result.status,
      failure_class: result.failure?.class,
      failure_code: result.failure?.code,
      failure_message: result.failure?.message,
    })
    trace?.endSpan(spanId, statusCode, result.summary)
    return result
  }
  catch (error) {
    const result = unhandledHandlerExceptionFailure(spec, error)
    recordEvent('handler_invocation_exception', {
      command_id: spec.id,
      failure_class: result.failure?.class,
      failure_code: result.failure?.code,
      failure_message: result.failure?.message,
    })
    trace?.endSpan(spanId, 'error', result.summary)
    return result
  }
}

function runtimeCommandResolutionFailure(commandId: string, error: unknown): ComputerUseInvokeResult {
  if (error instanceof ComputerUseCommandResolutionError) {
    return runtimeFailureResult({
      commandId,
      summary: error.message,
      failureClass: error.failureClass,
      code: error.code,
      message: error.message,
      signals: ['command_resolution_failed'],
      knownLimits: ['p1_5_runtime_command_resolution_failed'],
    })
  }

  const message = unknownErrorMessage(error)
  return runtimeFailureResult({
    commandId,
    summary: `Command resolution failed unexpectedly: ${message}`,
    failureClass: 'runtime_unknown',
    code: 'command_resolution_exception',
    message,
    signals: ['command_resolution_failed', 'runtime_exception'],
    knownLimits: ['p1_5_runtime_command_resolution_failed'],
  })
}

function noHandlerFailure(spec: Readonly<ComputerUseCommandSpec>): ComputerUseInvokeResult {
  return runtimeFailureResult({
    commandId: spec.id,
    summary: `No invoke handler registered for ${spec.id}.`,
    failureClass: 'runtime_unknown',
    code: 'handler_not_registered',
    message: `No invoke handler registered for ${spec.id}.`,
    signals: ['catalog_resolved', 'handler_not_registered'],
    knownLimits: ['p1_5_runtime_handler_not_registered'],
  })
}

function unhandledHandlerExceptionFailure(
  spec: Readonly<ComputerUseCommandSpec>,
  error: unknown,
): ComputerUseInvokeResult {
  const message = unknownErrorMessage(error)
  return runtimeFailureResult({
    commandId: spec.id,
    summary: `Unhandled handler exception: ${message}`,
    failureClass: 'runtime_unknown',
    code: 'unhandled_handler_exception',
    message,
    signals: ['catalog_resolved', 'handler_exception'],
    knownLimits: ['p1_5_runtime_handler_exception_wrapped'],
  })
}

function runtimeFailureResult(input: {
  commandId: string
  summary: string
  failureClass: ComputerUseFailureClass
  code: string
  message: string
  signals: string[]
  knownLimits: string[]
}): ComputerUseInvokeResult {
  return {
    commandId: input.commandId,
    status: 'failed',
    summary: input.summary,
    signals: input.signals,
    artifacts: [],
    failure: {
      class: input.failureClass,
      code: input.code,
      message: input.message,
    },
    knownLimits: input.knownLimits,
  }
}

function nextInvokeSpanId(commandId: string): string {
  nextInvokeSpanOrdinal += 1
  return `invoke_${sanitizeTraceIdPart(commandId)}_${nextInvokeSpanOrdinal}`
}

function sanitizeTraceIdPart(value: string): string {
  return value.replace(/[^\w.-]/g, '_').slice(0, 80)
}

function unknownErrorMessage(error: unknown): string {
  if (error instanceof Error)
    return error.message
  if (typeof error === 'string')
    return error
  return 'unknown error'
}
