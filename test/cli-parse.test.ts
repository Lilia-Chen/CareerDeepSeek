import { describe, expect, it } from 'vitest'
import { helpText, parseCliArgs, parseCliCommand } from '../src/cli.js'
import { COMPUTER_USE_COMMAND_SPECS } from '../src/computer-use/macos-chrome-driver/invoke-catalog.js'

describe('parseCliArgs', () => {
  it('parses flat invoke inputs', () => {
    const parsed = parseCliArgs(['invoke', 'chrome.clickText', '--query', 'LangChain', '--match_index', '1'])

    expect(parsed).toEqual({
      commandId: 'chrome.clickText',
      target: undefined,
      inputs: { query: 'LangChain', match_index: '1' },
      dryRun: false,
      help: false,
    })
  })

  it('rejects dotted keys', () => {
    expect(() => parseCliArgs(['invoke', 'chrome.clickText', '--target.query', 'x'])).toThrow(/dotted/i)
  })

  it('parses dry-run and managed target', () => {
    const parsed = parseCliArgs(['invoke', 'chrome.findText', '--target', 'managed', '--dry-run', '--query', 'Search'])

    expect(parsed).toEqual({
      commandId: 'chrome.findText',
      target: { profile: 'managed', window: 'leased_chrome_window' },
      inputs: { query: 'Search' },
      dryRun: true,
      help: false,
    })
  })

  it('renders invoke help from the command catalog', () => {
    const output = helpText('')

    for (const spec of COMPUTER_USE_COMMAND_SPECS) {
      expect(output).toContain(spec.id)
      expect(output).toContain(spec.summary)
    }
  })

  it('parses inspect commands separately from invoke', () => {
    expect(parseCliCommand(['inspect'])).toEqual({ command: 'inspect', runId: undefined })
    expect(parseCliCommand(['inspect', 'run_123'])).toEqual({ command: 'inspect', runId: 'run_123' })
  })

  it('ignores pnpm script argument separator before top-level commands', () => {
    expect(parseCliCommand(['--', 'inspect'])).toEqual({ command: 'inspect', runId: undefined })
  })
})
