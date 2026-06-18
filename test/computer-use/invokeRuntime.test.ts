import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import type { ComputerUseInvokeResult } from '../../src/computer-use/macos-chrome-driver/invoke-types.js'
import { invoke } from '../../src/computer-use/macos-chrome-driver/invoke-runtime.js'
import type { ComputerUseInvokeTraceSink } from '../../src/computer-use/macos-chrome-driver/invoke-runtime.js'
import type { ComputerUseCommandHandlerRegistry } from '../../src/computer-use/macos-chrome-driver/invoke-handlers.js'
import type { EventRecord, TraceStatusCode } from '../../src/computer-use/macos-chrome-driver/types.js'

type TraceEventInput = Omit<EventRecord, 'api_version'>

class MemoryTraceSink implements ComputerUseInvokeTraceSink {
  readonly startedSpans: Array<{ spanId: string, parentSpanId: string | undefined, name: string }> = []
  readonly events: TraceEventInput[] = []
  readonly endedSpans: Array<{ spanId: string, statusCode: TraceStatusCode, summary: string | undefined }> = []

  startSpan(spanId: string, parentSpanId: string | undefined, name: string): void {
    this.startedSpans.push({ spanId, parentSpanId, name })
  }

  recordEvent(event: TraceEventInput): void {
    this.events.push(event)
  }

  endSpan(spanId: string, statusCode: TraceStatusCode, summary?: string): void {
    this.endedSpans.push({ spanId, statusCode, summary })
  }
}

describe('invoke runtime skeleton', () => {
  it('returns a completed result from an injected fake handler and records trace events', async () => {
    const trace = new MemoryTraceSink()
    const handlers: ComputerUseCommandHandlerRegistry = {
      'chrome.observe': async ({ request, spec }): Promise<ComputerUseInvokeResult> => ({
        commandId: spec.id,
        status: 'completed',
        summary: 'fake observe completed',
        output: { received: request.inputs },
        signals: ['fake_handler'],
        artifacts: [],
        knownLimits: ['runtime_skeleton_fake_handler'],
      }),
    }

    const result = await invoke(
      { commandId: 'chrome.observe', inputs: { query: 'visible page' } },
      { handlers, trace, spanId: 'invoke_success_span' },
    )

    assert.equal(result.commandId, 'chrome.observe')
    assert.equal(result.status, 'completed')
    assert.deepEqual(result.output, { received: { query: 'visible page' } })
    assert.deepEqual(trace.startedSpans, [
      { spanId: 'invoke_success_span', parentSpanId: undefined, name: 'computer_use.invoke' },
    ])
    assert.deepEqual(trace.events.map(event => event.name), [
      'command_resolution_started',
      'command_resolution_completed',
      'handler_invocation_started',
      'handler_invocation_completed',
    ])
    assert.deepEqual(trace.endedSpans, [
      { spanId: 'invoke_success_span', statusCode: 'ok', summary: 'fake observe completed' },
    ])
  })

  it('returns a fake handler failure and records an error span', async () => {
    const trace = new MemoryTraceSink()
    const handlers: ComputerUseCommandHandlerRegistry = {
      'chrome.recognize': async ({ spec }): Promise<ComputerUseInvokeResult> => ({
        commandId: spec.id,
        status: 'failed',
        summary: 'fake recognize rejected invalid input',
        signals: ['fake_handler'],
        artifacts: [],
        failure: {
          class: 'invalid_input',
          code: 'fake_invalid_target',
          message: 'fake target is invalid',
        },
        knownLimits: ['runtime_skeleton_fake_handler'],
      }),
    }

    const result = await invoke(
      { commandId: 'chrome.recognize', inputs: { target: null } },
      { handlers, trace, spanId: 'invoke_failure_span' },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'invalid_input')
    assert.equal(result.failure?.code, 'fake_invalid_target')
    assert.ok(trace.events.some(event => event.name === 'handler_invocation_failed'))
    assert.deepEqual(trace.endedSpans, [
      { spanId: 'invoke_failure_span', statusCode: 'error', summary: 'fake recognize rejected invalid input' },
    ])
  })

  it('short-circuits dry-run requests before handler dispatch', async () => {
    const trace = new MemoryTraceSink()
    let handlerCalls = 0
    const handlers: ComputerUseCommandHandlerRegistry = {
      'chrome.observe': async ({ spec }): Promise<ComputerUseInvokeResult> => {
        handlerCalls += 1
        return {
          commandId: spec.id,
          status: 'completed',
          summary: 'should not run on dry-run',
          signals: [],
          artifacts: [],
          knownLimits: [],
        }
      },
    }

    const result = await invoke(
      { commandId: 'chrome.observe', dryRun: true },
      { handlers, trace, spanId: 'invoke_dry_run_span' },
    )

    assert.equal(result.status, 'completed')
    assert.equal(result.commandId, 'chrome.observe')
    assert.equal(handlerCalls, 0)
    assert.equal((result.output as { id?: string }).id, 'chrome.observe')
    assert.deepEqual(trace.events.map(event => event.name), [
      'command_resolution_started',
      'command_resolution_completed',
      'dry_run_completed',
    ])
    assert.deepEqual(trace.endedSpans, [
      {
        spanId: 'invoke_dry_run_span',
        statusCode: 'ok',
        summary: 'Resolved chrome.observe without invoking the live driver.',
      },
    ])
  })

  it('converts an unexpected handler exception into a structured runtime_unknown failure', async () => {
    const trace = new MemoryTraceSink()
    const handlers: ComputerUseCommandHandlerRegistry = {
      'chrome.checkSafetyGate': async () => {
        throw new Error('fake handler exploded')
      },
    }

    const result = await invoke(
      { commandId: 'chrome.checkSafetyGate' },
      { handlers, trace, spanId: 'invoke_exception_span' },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'runtime_unknown')
    assert.equal(result.failure?.code, 'unhandled_handler_exception')
    assert.match(result.failure?.message ?? '', /fake handler exploded/)
    assert.deepEqual(result.knownLimits, ['p1_5_runtime_handler_exception_wrapped'])
    assert.ok(trace.events.some(event => event.name === 'handler_invocation_exception'))
    assert.deepEqual(trace.endedSpans, [
      { spanId: 'invoke_exception_span', statusCode: 'error', summary: 'Unhandled handler exception: fake handler exploded' },
    ])
  })

  it('returns neutral P1.5 runtime known limits when no handler is registered', async () => {
    const result = await invoke(
      { commandId: 'chrome.observe' },
      { handlers: {}, spanId: 'invoke_no_handler_span' },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'runtime_unknown')
    assert.equal(result.failure?.code, 'handler_not_registered')
    assert.deepEqual(result.knownLimits, ['p1_5_runtime_handler_not_registered'])
  })

  it('returns command_resolution failure for unknown commands without invoking a handler', async () => {
    const trace = new MemoryTraceSink()
    let handlerCalls = 0
    const handlers: ComputerUseCommandHandlerRegistry = {
      'chrome.observe': async ({ spec }): Promise<ComputerUseInvokeResult> => {
        handlerCalls += 1
        return {
          commandId: spec.id,
          status: 'completed',
          summary: 'should not run',
          signals: [],
          artifacts: [],
          knownLimits: [],
        }
      },
    }

    const result = await invoke(
      { commandId: 'chrome.unknown' },
      { handlers, trace, spanId: 'invoke_unknown_span' },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'command_resolution')
    assert.equal(result.failure?.code, 'unknown_command')
    assert.deepEqual(result.knownLimits, ['p1_5_runtime_command_resolution_failed'])
    assert.equal(handlerCalls, 0)
    assert.deepEqual(trace.events.map(event => event.name), [
      'command_resolution_started',
      'command_resolution_failed',
    ])
    assert.deepEqual(trace.endedSpans, [
      { spanId: 'invoke_unknown_span', statusCode: 'error', summary: 'Unknown computer-use command: chrome.unknown' },
    ])
  })

  it('returns command_resolution failure for unknown dry-run commands before dry-run completion', async () => {
    const trace = new MemoryTraceSink()

    const result = await invoke(
      { commandId: 'chrome.unknown', dryRun: true },
      { trace, spanId: 'invoke_unknown_dry_run_span' },
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.failure?.class, 'command_resolution')
    assert.equal(result.failure?.code, 'unknown_command')
    assert.deepEqual(result.knownLimits, ['p1_5_runtime_command_resolution_failed'])
    assert.deepEqual(trace.events.map(event => event.name), [
      'command_resolution_started',
      'command_resolution_failed',
    ])
    assert.deepEqual(trace.endedSpans, [
      {
        spanId: 'invoke_unknown_dry_run_span',
        statusCode: 'error',
        summary: 'Unknown computer-use command: chrome.unknown',
      },
    ])
  })
})
