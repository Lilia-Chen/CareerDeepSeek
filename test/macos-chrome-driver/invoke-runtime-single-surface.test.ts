import { describe, expect, it } from 'vitest'
import {
  COMPUTER_USE_COMMAND_SPECS,
} from '../../src/computer-use/macos-chrome-driver/invoke-catalog.js'
import { invoke } from '../../src/computer-use/macos-chrome-driver/invoke-runtime.js'

const expectedCommandIds = [
  'chrome.observe',
  'chrome.checkSafetyGate',
  'chrome.findText',
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
})
