import { describe, expect, it } from 'vitest'
import {
  COMPUTER_USE_COMMAND_SPECS,
} from '../../src/computer-use/macos-chrome-driver/invoke-catalog.js'
import { invoke } from '../../src/computer-use/macos-chrome-driver/invoke-runtime.js'
import type { ComputerUseInvokeTraceSink } from '../../src/computer-use/macos-chrome-driver/invoke-runtime.js'

const expectedCommandIds = [
  'chrome.observe',
  'chrome.checkSafetyGate',
  'chrome.findText',
  'chrome.waitForText',
  'chrome.clickText',
  'chrome.findRows',
  'chrome.clickRow',
  'chrome.focusText',
  'chrome.axFocusText',
  'chrome.pressButton',
  'chrome.axPressButton',
  'chrome.typeText',
  'chrome.key',
  'chrome.scrollRegion',
]

const removedCommandIds = [
  'chrome.recognize',
  'chrome.promote',
  'chrome.clickCandidate',
  'chrome.focusTextInput',
  'chrome.typeTextAudited',
  'chrome.pressKey',
  'chrome.scroll',
]

describe('invoke runtime single surface', () => {
  it('exposes exactly the AUV-shaped command catalog', () => {
    const commandIds = COMPUTER_USE_COMMAND_SPECS.map(spec => spec.id)

    expect(commandIds).toEqual(expectedCommandIds)
    expect(new Set(commandIds).size).toBe(commandIds.length)
  })

  it('treats removed programmatic commands as unknown commands', async () => {
    for (const commandId of removedCommandIds) {
      const result = await invoke({ commandId, dryRun: true })

      expect(result.status).toBe('failed')
      expect(result.failure).toMatchObject({
        class: 'command_resolution',
        code: 'unknown_command',
      })
    }
  })

  it('dry-runs observe and safety commands on the single command surface', async () => {
    for (const commandId of ['chrome.observe', 'chrome.checkSafetyGate']) {
      const result = await invoke({ commandId, dryRun: true })

      expect(result.status).toBe('completed')
      expect(result.failure).toBeUndefined()
    }
  })

  it('records failure messages in trace events for inspect', async () => {
    const events: Array<{ attributes: Record<string, unknown> }> = []
    const trace: ComputerUseInvokeTraceSink = {
      startSpan: () => {},
      endSpan: () => {},
      recordEvent: event => events.push(event),
    }

    await invoke(
      { commandId: 'chrome.findText', inputs: { query: 'Missing' } },
      {
        trace,
        handlers: {
          'chrome.findText': () => ({
            commandId: 'chrome.findText',
            status: 'failed',
            summary: 'findText failed.',
            signals: ['findText_failed'],
            artifacts: [],
            failure: {
              class: 'recognition',
              code: 'ocr_failed',
              message: 'Vision OCR crashed.',
            },
            knownLimits: [],
          }),
        },
      },
    )

    expect(events.some(event =>
      event.attributes.failure_class === 'recognition'
      && event.attributes.failure_code === 'ocr_failed'
      && event.attributes.failure_message === 'Vision OCR crashed.',
    )).toBe(true)
  })

  it('records unhandled handler exceptions with failure_message in trace events', async () => {
    const events: Array<{ name: string, attributes: Record<string, unknown> }> = []
    const trace: ComputerUseInvokeTraceSink = {
      startSpan: () => {},
      endSpan: () => {},
      recordEvent: event => events.push(event),
    }

    await invoke(
      { commandId: 'chrome.findText', inputs: { query: 'Missing' } },
      {
        trace,
        handlers: {
          'chrome.findText': () => {
            throw new Error('Unexpected handler failure.')
          },
        },
      },
    )

    const exceptionEvent = events.find(event => event.name === 'handler_invocation_exception')
    expect(exceptionEvent?.attributes).toMatchObject({
      failure_class: 'runtime_unknown',
      failure_code: 'unhandled_handler_exception',
      failure_message: 'Unexpected handler failure.',
    })
    expect(exceptionEvent?.attributes).not.toHaveProperty('message')
  })
})
