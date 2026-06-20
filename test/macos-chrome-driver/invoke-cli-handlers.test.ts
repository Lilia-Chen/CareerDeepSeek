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
        no_hard_stop_signal: true,
      },
      failures: [],
    }),
    invokeOperation: async (call) => {
      return invokeFakeOperation(atomicCommands, call)
    },
  } as MacOSChromeInvokeDriver
}

async function invokeFakeOperation(
  atomicCommands: Partial<MacOSChromeAtomicCommands>,
  call: MacOSChromeOperationCall,
): Promise<Awaited<ReturnType<MacOSChromeAtomicCommands[keyof MacOSChromeAtomicCommands]>>> {
  switch (call.operation) {
    case 'findText':
      return requiredFakeCommand(atomicCommands.findText, call.operation)({ query: call.inputs.query as string })
    case 'clickText':
      return requiredFakeCommand(atomicCommands.clickText, call.operation)({
        query: call.inputs.query as string,
        matchIndex: call.inputs.matchIndex as number | undefined,
        anchorOffsetX: call.inputs.anchorOffsetX as number | undefined,
        anchorOffsetY: call.inputs.anchorOffsetY as number | undefined,
      })
    case 'findRows':
      return requiredFakeCommand(atomicCommands.findRows, call.operation)({ query: call.inputs.query as string | undefined })
    case 'clickRow':
      return requiredFakeCommand(atomicCommands.clickRow, call.operation)({
        query: call.inputs.query as string | undefined,
        rowIndex: call.inputs.rowIndex as number,
      })
    case 'focusText':
      return requiredFakeCommand(atomicCommands.focusText, call.operation)({ query: call.inputs.query as string })
    case 'axFocusText':
      return requiredFakeCommand(atomicCommands.axFocusText, call.operation)({ query: call.inputs.query as string })
    case 'pressButton':
      return requiredFakeCommand(atomicCommands.pressButton, call.operation)({ query: call.inputs.query as string })
    case 'axPressButton':
      return requiredFakeCommand(atomicCommands.axPressButton, call.operation)({ query: call.inputs.query as string })
    case 'typeTextAtomic':
      return requiredFakeCommand(atomicCommands.typeText, call.operation)({
        text: call.inputs.text as string,
        submitKey: call.inputs.submitKey as string | undefined,
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

  it('parses chrome.clickText numeric match index and anchor offsets', async () => {
    let received: unknown
    const handlers = createMacOSChromeHandlers(fakeDriver({
      clickText: async (input) => {
        received = input
        return {
          clicked: {
            kind: 'ocr_text',
            text: input.query,
            box: { x: 10, y: 20, width: 30, height: 10 },
            confidence: 0.9,
            logicalPoint: { x: 25, y: 25 },
            matchIndex: input.matchIndex ?? 0,
            anchorOffset: {
              x: input.anchorOffsetX ?? 0,
              y: input.anchorOffsetY ?? 0,
            },
          },
          evidence: [{ run_id: 'run_test', artifact_id: 'artifact_screenshot', span_id: 'span_test' }],
          knownLimits: [],
        }
      },
    }))

    const result = await invoke(
      {
        commandId: 'chrome.clickText',
        inputs: { query: 'LangChain', match_index: '1', anchor_offset_x: '8', anchor_offset_y: '-2' },
      },
      { handlers },
    )

    expect(result.status).toBe('completed')
    expect(received).toEqual({
      query: 'LangChain',
      matchIndex: 1,
      anchorOffsetX: 8,
      anchorOffsetY: -2,
    })
    expect(result.output).toMatchObject({ clicked: { matchIndex: 1 } })
  })

  it('classifies atomic action target misses as recognition failures', async () => {
    const handlers = createMacOSChromeHandlers(fakeDriver({
      clickText: async () => {
        throw Object.assign(new Error('No OCR text match'), { code: 'recognition_not_found' })
      },
    }))

    const result = await invoke(
      { commandId: 'chrome.clickText', inputs: { query: 'Missing' } },
      { handlers },
    )

    expect(result.status).toBe('failed')
    expect(result.failure).toMatchObject({
      class: 'recognition',
      code: 'recognition_not_found',
    })
  })

  it('rejects negative chrome.clickText match_index', async () => {
    const handlers = createMacOSChromeHandlers(fakeDriver({
      clickText: async () => {
        throw new Error('clickText should not be called for invalid match_index')
      },
    }))

    const result = await invoke(
      { commandId: 'chrome.clickText', inputs: { query: 'LangChain', match_index: '-1' } },
      { handlers },
    )

    expect(result.status).toBe('failed')
    expect(result.failure?.code).toBe('invalid_match_index')
  })

  it('rejects chrome.typeText when query is supplied', async () => {
    const handlers = createMacOSChromeHandlers(fakeDriver({
      typeText: async () => {
        throw new Error('typeText should not be called for invalid input')
      },
    }))

    const result = await invoke(
      { commandId: 'chrome.typeText', inputs: { text: 'abc', query: 'Search' } },
      { handlers },
    )

    expect(result.status).toBe('failed')
    expect(result.failure).toMatchObject({
      class: 'invalid_input',
      code: 'type_text_query_not_accepted',
    })
  })

  it('passes 1-based row_index to chrome.clickRow', async () => {
    let received: unknown
    const handlers = createMacOSChromeHandlers(fakeDriver({
      clickRow: async (input) => {
        received = input
        return {
          clicked: {
            kind: 'ocr_row',
            text: 'Result',
            box: { x: 10, y: 20, width: 100, height: 30 },
            confidence: 0.8,
            logicalPoint: { x: 60, y: 35 },
            matchIndex: input.rowIndex - 1,
            anchorOffset: { x: 0, y: 0 },
          },
          evidence: [],
          knownLimits: [],
        }
      },
    }))

    const result = await invoke(
      { commandId: 'chrome.clickRow', inputs: { query: 'Result', row_index: '2' } },
      { handlers },
    )

    expect(result.status).toBe('completed')
    expect(received).toEqual({ query: 'Result', rowIndex: 2 })
  })

  it('rejects chrome.clickRow row_index values below 1', async () => {
    const handlers = createMacOSChromeHandlers(fakeDriver({
      clickRow: async () => {
        throw new Error('clickRow should not be called for invalid row_index')
      },
    }))

    const result = await invoke(
      { commandId: 'chrome.clickRow', inputs: { row_index: '0' } },
      { handlers },
    )

    expect(result.status).toBe('failed')
    expect(result.failure?.code).toBe('invalid_row_index')
  })

  it('routes focusText and axFocusText through atomic commands', async () => {
    const calls: unknown[] = []
    const clickResult = {
      clicked: {
        kind: 'ax_textfield',
        text: 'Search',
        box: { x: 1, y: 2, width: 3, height: 4 },
        confidence: 1,
        logicalPoint: { x: 2.5, y: 4 },
        matchIndex: 0,
        anchorOffset: { x: 0, y: 0 },
      },
      evidence: [],
      knownLimits: [],
    }
    const handlers = createMacOSChromeHandlers(fakeDriver({
      focusText: async (input) => {
        calls.push(['focusText', input])
        return clickResult
      },
      axFocusText: async (input) => {
        calls.push(['axFocusText', input])
        return clickResult
      },
    }))

    const pointerResult = await invoke(
      { commandId: 'chrome.focusText', inputs: { query: 'Search' } },
      { handlers },
    )
    const axResult = await invoke(
      { commandId: 'chrome.axFocusText', inputs: { query: 'Search' } },
      { handlers },
    )

    expect(pointerResult.status).toBe('completed')
    expect(axResult.status).toBe('completed')
    expect(calls).toEqual([
      ['focusText', { query: 'Search' }],
      ['axFocusText', { query: 'Search' }],
    ])
  })

  it('preserves ax_press_unavailable from chrome.axPressButton', async () => {
    const handlers = createMacOSChromeHandlers(fakeDriver({
      axPressButton: async () => {
        throw Object.assign(new Error('AX press unavailable'), { code: 'ax_press_unavailable' })
      },
    }))

    const result = await invoke(
      { commandId: 'chrome.axPressButton', inputs: { query: 'Submit' } },
      { handlers },
    )

    expect(result.status).toBe('failed')
    expect(result.failure?.code).toBe('ax_press_unavailable')
  })

  it('parses typeText submit_key and key modifiers', async () => {
    const calls: unknown[] = []
    const handlers = createMacOSChromeHandlers(fakeDriver({
      typeText: async (input) => {
        calls.push(['typeText', input])
        return { typed: { textLength: input.text.length, submitKey: input.submitKey ?? null }, evidence: [], knownLimits: [] }
      },
      key: async (input) => {
        calls.push(['key', input])
        return { pressed: { key: input.key, modifiers: input.modifiers ?? [] }, evidence: [], knownLimits: [] }
      },
    }))

    await invoke(
      { commandId: 'chrome.typeText', inputs: { text: 'abc', submit_key: 'return' } },
      { handlers },
    )
    await invoke(
      { commandId: 'chrome.key', inputs: { key: 'l', modifiers: 'command,shift' } },
      { handlers },
    )

    expect(calls).toEqual([
      ['typeText', { text: 'abc', submitKey: 'return' }],
      ['key', { key: 'l', modifiers: ['command', 'shift'] }],
    ])
  })

  it('parses scrollRegion defaults and validates region bounds', async () => {
    let received: unknown
    const handlers = createMacOSChromeHandlers(fakeDriver({
      scrollRegion: async (input) => {
        received = input
        return {
          scrolled: {
            direction: input.direction ?? 'down',
            amount: input.amount ?? 6,
            logicalPoint: { x: 50, y: 50 },
            region: input.region ?? { left: 0, top: 0, right: 1, bottom: 1 },
          },
          evidence: [],
          knownLimits: [],
        }
      },
    }))

    const result = await invoke(
      { commandId: 'chrome.scrollRegion', inputs: {} },
      { handlers },
    )
    const invalidDirection = await invoke(
      { commandId: 'chrome.scrollRegion', inputs: { direction: 'diagonal' } },
      { handlers },
    )
    const invalidBounds = await invoke(
      { commandId: 'chrome.scrollRegion', inputs: { region_left: '0.8', region_right: '0.2' } },
      { handlers },
    )
    const invalidAmount = await invoke(
      { commandId: 'chrome.scrollRegion', inputs: { amount: '-4' } },
      { handlers },
    )
    const zeroAmount = await invoke(
      { commandId: 'chrome.scrollRegion', inputs: { amount: '0' } },
      { handlers },
    )

    expect(result.status).toBe('completed')
    expect(received).toEqual({
      direction: 'down',
      amount: 6,
      region: { left: 0, top: 0, right: 1, bottom: 1 },
    })
    expect(invalidDirection.failure?.code).toBe('invalid_direction')
    expect(invalidBounds.failure?.code).toBe('invalid_region_bounds')
    expect(invalidAmount.failure?.code).toBe('invalid_amount')
    expect(zeroAmount.failure?.code).toBe('invalid_amount')
  })

  it('rejects removed programmatic commands through the single invoke entry', async () => {
    const entry = createMacOSChromeInvokeEntryForTest(fakeDriver({}))

    const result = await entry.invoke({ commandId: 'chrome.promote', dryRun: true })

    expect(result.status).toBe('failed')
    expect(result.failure?.code).toBe('unknown_command')
  })

  it('uses atomic metadata for chrome.typeText in cli dry-run', async () => {
    const entry = createMacOSChromeInvokeEntryForTest(fakeDriver({}))

    const result = await entry.invoke({ commandId: 'chrome.typeText', dryRun: true })

    expect(result.status).toBe('completed')
    expect(result.output).toMatchObject({
      id: 'chrome.typeText',
      operation: 'typeTextAtomic',
      summary: 'Type text into the active Chrome control.',
    })
  })
})
