import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { COMPUTER_USE_COMMAND_SPECS, getComputerUseCommandSpec } from './computer-use/macos-chrome-driver/invoke-catalog.js'
import { createMacOSChromeInvokeEntry } from './computer-use/macos-chrome-driver/invoke-entry.js'
import type { ComputerUseInvokeRequest } from './computer-use/macos-chrome-driver/invoke-types.js'

export interface ParsedCliInvoke {
  commandId: string
  target?: ComputerUseInvokeRequest['target']
  inputs: Record<string, string>
  dryRun: boolean
  help: boolean
}

export function parseCliArgs(argv: string[]): ParsedCliInvoke {
  const [command, maybeCommandId, ...rest] = argv
  if (command !== 'invoke')
    throw new Error('Usage: cds invoke <command-id> [--flag value] [--dry-run]')

  if (maybeCommandId === '--help' || maybeCommandId === '-h') {
    return {
      commandId: '',
      target: undefined,
      inputs: {},
      dryRun: false,
      help: true,
    }
  }

  if (!maybeCommandId || maybeCommandId.startsWith('--'))
    throw new Error('cds invoke requires a command id.')

  const parsed: ParsedCliInvoke = {
    commandId: maybeCommandId,
    target: undefined,
    inputs: {},
    dryRun: false,
    help: false,
  }

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (!arg.startsWith('--'))
      throw new Error(`Unexpected positional argument: ${arg}`)

    const key = arg.slice(2)
    if (!key)
      throw new Error('Empty CLI flag is not allowed.')
    if (key.includes('.'))
      throw new Error(`Dotted CLI flags are not accepted: --${key}`)

    if (key === 'help') {
      parsed.help = true
      continue
    }
    if (key === 'dry-run') {
      parsed.dryRun = true
      continue
    }

    const value = rest[index + 1]
    if (value === undefined || value.startsWith('--'))
      throw new Error(`Flag --${key} requires a value.`)
    index += 1

    if (key === 'target') {
      if (value !== 'managed')
        throw new Error('Only --target managed is supported.')
      parsed.target = { profile: 'managed', window: 'leased_chrome_window' }
      continue
    }

    parsed.inputs[key] = value
  }

  return parsed
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseCliArgs(argv)
  if (parsed.help) {
    process.stdout.write(helpText(parsed.commandId))
    return
  }

  const entry = createMacOSChromeInvokeEntry({
    driverOptions: {
      sessionId: `cli_${Date.now()}`,
    },
  })
  const request: ComputerUseInvokeRequest = {
    commandId: parsed.commandId,
    inputs: parsed.inputs,
    dryRun: parsed.dryRun,
  }
  if (parsed.target)
    request.target = parsed.target

  const result = await entry.invoke(request)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.status !== 'completed')
    process.exitCode = 1
}

export function helpText(commandId: string): string {
  if (commandId) {
    const spec = getComputerUseCommandSpec(commandId)
    return [
      `Usage: cds invoke ${commandId} [--flag value] [--dry-run]`,
      spec ? `Summary: ${spec.summary}` : 'Summary: unknown command',
      '',
    ].join('\n')
  }
  return [
    'Usage: cds invoke <command-id> [--flag value] [--dry-run]',
    '',
    'Commands:',
    ...COMPUTER_USE_COMMAND_SPECS.map(spec => `  ${spec.id} - ${spec.summary}`),
    '',
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
