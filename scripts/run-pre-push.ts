#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import process from 'node:process'

const commands: Array<[string, string[]]> = [
  ['pnpm', ['run', 'lint']],
  ['pnpm', ['run', 'typecheck']],
  ['pnpm', ['test']],
  ['pnpm', ['run', 'eval']],
  ['pnpm', ['run', 'demo:discovery']],
  ['pnpm', ['run', 'privacy:scan']],
  ['pnpm', ['run', 'harness:private']],
]

for (const [command, args] of commands) {
  const result = process.platform === 'win32'
    ? spawnSync([command, ...args].join(' '), {
        shell: true,
        stdio: 'inherit',
      })
    : spawnSync(command, args, {
        stdio: 'inherit',
      })

  if (result.error) {
    console.error(`Failed to run ${command} ${args.join(' ')}: ${result.error.message}`)
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1
    break
  }
}
