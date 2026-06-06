/**
 * Minimal subprocess runner.  All external tool calls (swift, screencapture,
 * osascript, open) flow through this so we have a single place to enforce
 * timeouts and collect stderr.
 */

import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import process from 'node:process'

export interface RunProcessOptions {
  timeoutMs: number
  env?: NodeJS.ProcessEnv
}

export interface RunProcessResult {
  stdout: string
  stderr: string
  exitCode: number
}

export function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<RunProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Process timed out after ${options.timeoutMs}ms: ${command} ${args.join(' ')}`))
    }, options.timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        exitCode: code ?? -1,
      })
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}
