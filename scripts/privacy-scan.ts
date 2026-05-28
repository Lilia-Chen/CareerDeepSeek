#!/usr/bin/env node

import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { runPrivacyScan } from '../src/harness/privacyScan.js'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const result = await runPrivacyScan(rootDir)

if (result.findings.length > 0) {
  console.error(`Privacy scan failed: ${result.findings.length} finding(s).`)
  for (const finding of result.findings) {
    console.error(`${finding.file}: ${finding.rule} - ${finding.message}`)
  }
  process.exitCode = 1
}
else {
  console.info(`Privacy scan passed: ${result.filesScanned} tracked file(s).`)
}
