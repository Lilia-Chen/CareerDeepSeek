import { describe, expect, it } from 'vitest'
import { createMacOSChromeInvokeEntryForTest } from '../../src/computer-use/macos-chrome-driver/invoke-entry.js'
import { createMacOSChromeHandlers } from '../../src/computer-use/macos-chrome-driver/invoke-handlers.js'
import { invoke } from '../../src/computer-use/macos-chrome-driver/invoke-runtime.js'
import type { MacOSChromeInvokeDriver } from '../../src/computer-use/macos-chrome-driver/invoke-handlers.js'
import type { MacOSChromeAtomicCommands, MacOSChromeOperationCall } from '../../src/computer-use/macos-chrome-driver/atomic-commands.js'

function fakeDriver(atomicCommands: Partial<MacOSChromeAtomicCommands>): MacOSChromeInvokeDriver {
  return {
    observe: async () => {
      throw new Error('observe should not be called by CLI atomic handlers')
    },
    checkSafetyGate: async () => ({
      passed: true,
      checks: {
        profile_verified: true,
        chrome_foreground: true,
        leased_window_foreground: true,
        no_hard_stop_signal: true,
      },
      failures: [],
    }),
    invokeOperation: async call => invokeFakeOperation(atomicCommands, call),
  } as MacOSChromeInvokeDriver
}

async function invokeFakeOperation(
  atomicCommands: Partial<MacOSChromeAtomicCommands>,
  call: MacOSChromeOperationCall,
): Promise<Awaited<ReturnType<MacOSChromeAtomicCommands[keyof MacOSChromeAtomicCommands]>>> {
  switch (call.operation) {
    case 'findText':
      return requiredFakeCommand(atomicCommands.findText, call.operation)({ query: call.inputs.query as string })
    case 'waitForText':
      return requiredFakeCommand(atomicCommands.waitForText, call.operation)({
        query: call.inputs.query as string,
        timeoutMs: call.inputs.timeoutMs as number | undefined,
        pollIntervalMs: call.inputs.pollIntervalMs as number | undefined,
      })
    case 'clickTarget':
      return requiredFakeCommand(atomicCommands.clickTarget, call.operation)({
        query: call.inputs.query as string,
        kind: call.inputs.kind as 'text' | 'button' | 'link' | 'menuitem' | 'any',
        hint: call.inputs.hint as { left: number, top: number, right: number, bottom: number } | undefined,
      })
    case 'typeInput':
      return requiredFakeCommand(atomicCommands.typeInput, call.operation)({
        query: call.inputs.query as string,
        text: call.inputs.text as string,
        submitKey: call.inputs.submitKey as string | undefined,
        hint: call.inputs.hint as { left: number, top: number, right: number, bottom: number } | undefined,
      })
    case 'key':
      return requiredFakeCommand(atomicCommands.key, call.operation)({
        key: call.inputs.key as string,
        modifiers: call.inputs.modifiers as string[] | undefined,
      })
    case 'scrollRegion':
      return requiredFakeCommand(atomicCommands.scrollRegion, call.operation)({
        direction: call.inputs.direction as string | undefined,
        amount: call.inputs.amount as number | undefined,
        region: call.inputs.region as { left: number, top: number, right: number, bottom: number } | undefined,
      })
    default:
      throw new Error(`No fake operation for ${call.operation}`)
  }
}

function requiredFakeCommand<T extends (...args: never[]) => unknown>(command: T | undefined, operation: string): T {
  if (!command)
    throw new Error(`${operation} should not be called`)
  return command
}

describe('macOS Chrome CLI invoke handlers', () => {
  it('returns completed when chrome.findText finds no matches', async () => {
    const handlers = createMacOSChromeHandlers(fakeDriver({
      findText: async () => ({
        found: false,
        recognitionId: 'atomic_test',
        matchCount: 0,
        matches: [],
        nodes: [],
        audit: { status: 'unknown', sourceGroups: [], comparedItems: [], knownLimits: [] },
        evidence: [],
        knownLimits: [],
      }),
    }))

    const result = await invoke(
      { commandId: 'chrome.findText', inputs: { query: 'LangChain' } },
      { handlers },
    )

    expect(result.status).toBe('completed')
    expect(result.output).toMatchObject({ found: false, matchCount: 0 })
    expect(result.failure).toBeUndefined()
  })

  it('parses chrome.waitForText defaults and returns timeout as completed observation', async () => {
    let received: unknown
    const handlers = createMacOSChromeHandlers(fakeDriver({
      waitForText: async (input) => {
        received = input
        return {
          found: false,
          query: input.query,
          elapsedMs: 3000,
          pollCount: 7,
          matches: [],
          evidence: [{ run_id: 'run_test', artifact_id: 'artifact_ocr', span_id: 'span_test' }],
          knownLimits: [],
        }
      },
    }))

    const result = await invoke(
      { commandId: 'chrome.waitForText', inputs: { query: 'Results' } },
      { handlers },
    )

    expect(received).toEqual({
      query: 'Results',
      timeoutMs: 3000,
      pollIntervalMs: 250,
    })
    expect(result.status).toBe('completed')
    expect(result.output).toMatchObject({ found: false, query: 'Results', matches: [] })
    expect(result.failure).toBeUndefined()
    expect(result.signals).toEqual(['text_wait_timed_out'])
  })

  it('rejects chrome.waitForText match_index because wait has no candidate selection', async () => {
    const handlers = createMacOSChromeHandlers(fakeDriver({
      waitForText: async () => {
        throw new Error('waitForText should not be called when match_index is supplied')
      },
    }))

    const result = await invoke(
      { commandId: 'chrome.waitForText', inputs: { query: 'Results', match_index: '1' } },
      { handlers },
    )

    expect(result.status).toBe('failed')
    expect(result.failure).toMatchObject({
      class: 'invalid_input',
      code: 'wait_for_text_match_index_not_accepted',
    })
    expect(result.failure?.message).toContain('chrome.clickTarget')
  })

  it('parses chrome.clickTarget kind and normalized hint inputs', async () => {
    let received: unknown
    const handlers = createMacOSChromeHandlers(fakeDriver({
      clickTarget: async (input) => {
        received = input
        return {
          clicked: {
            kind: 'dom_link',
            text: input.query,
            box: { x: 10, y: 20, width: 100, height: 30 },
            confidence: 0.9,
            logicalPoint: { x: 60, y: 35 },
            matchIndex: 0,
            anchorOffset: { x: 0, y: 0 },
          },
          evidence: [],
          knownLimits: [],
        }
      },
    }))

    const result = await invoke(
      {
        commandId: 'chrome.clickTarget',
        inputs: {
          query: 'Code with Claude',
          kind: 'link',
          hint_left: '0.2',
          hint_top: '0.3',
          hint_right: '0.6',
          hint_bottom: '0.4',
        },
      },
      { handlers },
    )

    expect(result.status).toBe('completed')
    expect(received).toEqual({
      query: 'Code with Claude',
      kind: 'link',
      hint: { left: 0.2, top: 0.3, right: 0.6, bottom: 0.4 },
    })
  })

  it('rejects chrome.clickTarget kind=input before invoking the driver', async () => {
    const handlers = createMacOSChromeHandlers(fakeDriver({
      clickTarget: async () => {
        throw new Error('clickTarget should not run for kind=input')
      },
    }))

    const result = await invoke(
      { commandId: 'chrome.clickTarget', inputs: { query: 'Search', kind: 'input' } },
      { handlers },
    )

    expect(result.status).toBe('failed')
    expect(result.failure).toMatchObject({
      class: 'invalid_input',
      code: 'click_target_input_kind_not_supported',
    })
  })

  it('rejects non-finite normalized hint inputs before invoking the driver', async () => {
    const handlers = createMacOSChromeHandlers(fakeDriver({
      clickTarget: async () => {
        throw new Error('clickTarget should not run for invalid hints')
      },
    }))

    const result = await invoke(
      {
        commandId: 'chrome.clickTarget',
        inputs: {
          query: 'Submit',
          kind: 'button',
          hint_left: 'abc',
          hint_top: '0.1',
          hint_right: '0.8',
          hint_bottom: '0.2',
        },
      },
      { handlers },
    )

    expect(result.status).toBe('failed')
    expect(result.failure).toMatchObject({
      class: 'invalid_input',
      code: 'invalid_hint',
    })
  })

  it('parses chrome.typeInput target, text, submit key, and hint', async () => {
    let received: unknown
    const handlers = createMacOSChromeHandlers(fakeDriver({
      typeInput: async (input) => {
        received = input
        return {
          typed: {
            textLength: input.text.length,
            submitKey: input.submitKey ?? null,
            inputMode: 'replace',
          },
          evidence: [],
          knownLimits: [],
        }
      },
    }))

    const result = await invoke(
      {
        commandId: 'chrome.typeInput',
        inputs: {
          query: 'Search',
          text: 'AI agent London',
          submit_key: 'return',
          hint_left: '0.1',
          hint_top: '0.05',
          hint_right: '0.9',
          hint_bottom: '0.15',
        },
      },
      { handlers },
    )

    expect(result.status).toBe('completed')
    expect(received).toEqual({
      query: 'Search',
      text: 'AI agent London',
      submitKey: 'return',
      hint: { left: 0.1, top: 0.05, right: 0.9, bottom: 0.15 },
    })
  })

  it('uses atomic metadata for chrome.typeInput in cli dry-run', async () => {
    const entry = createMacOSChromeInvokeEntryForTest(fakeDriver({}))
    const result = await entry.invoke({ commandId: 'chrome.typeInput', dryRun: true })

    expect(result.status).toBe('completed')
    expect(result.output).toMatchObject({
      id: 'chrome.typeInput',
      operation: 'typeInput',
    })
  })
})
