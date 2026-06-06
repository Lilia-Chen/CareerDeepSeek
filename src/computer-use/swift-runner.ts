/**
 * Swift script runner — writes an inline Swift source string to a temp file,
 * runs `swift <script>`, and returns parsed stdout.
 *
 * JSON input data is passed to the script through the COMPUTER_USE_SWIFT_STDIN
 * environment variable (matching AIRI's convention so we can reuse Swift
 * scripts with minimal changes).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { runProcess } from './process.js'

export interface RunSwiftScriptOptions {
  swiftBinary: string
  timeoutMs: number
  source: string
  stdinPayload?: unknown
}

export async function runSwiftScript(options: RunSwiftScriptOptions): Promise<{ stdout: string, stderr: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), 'careerdeepseek-cu-'))
  const scriptPath = join(tempDir, 'script.swift')

  await writeFile(scriptPath, options.source, 'utf-8')

  try {
    const result = await runProcess(options.swiftBinary, [scriptPath], {
      timeoutMs: options.timeoutMs,
      env: options.stdinPayload == null
        ? process.env
        : {
            ...process.env,
            COMPUTER_USE_SWIFT_STDIN: JSON.stringify(options.stdinPayload),
          },
    })

    if (result.exitCode !== 0 && result.stderr) {
      throw new Error(`Swift script exited with code ${result.exitCode}: ${result.stderr}`)
    }

    return { stdout: result.stdout, stderr: result.stderr }
  }
  finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
