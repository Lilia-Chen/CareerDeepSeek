#!/usr/bin/env node

import process from 'node:process'
import { runLlmSmoke } from '../src/llm/llmSmoke.js'

try {
  const result = await runLlmSmoke()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`LLM smoke failed: ${message}`)
  process.exitCode = 1
}
