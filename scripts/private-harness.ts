#!/usr/bin/env node

import process from 'node:process'
import { runPrivateHarness } from '../src/harness/privateHarness.js'

const args = process.argv.slice(2)
const dataDir = readFlagValue(args, '--data-dir')
const reportPath = readFlagValue(args, '--report')
const requirePrivate = args.includes('--require-private')

const result = await runPrivateHarness({
  dataDir,
  reportPath,
})

if (result.status === 'skipped') {
  const message = 'Private harness skipped: no CAREERDEEPSEEK_DATA_DIR or ../CareerDeepSeek-data directory found.'
  if (requirePrivate) {
    console.error(message)
    process.exitCode = 1
  }
  else {
    console.info(message)
  }
}
else if (result.status === 'failed') {
  console.error(
    `Private harness failed: ${result.errors.length} error(s), `
    + `${result.targetsChecked} target record(s), ${result.reviewItemsChecked} review item(s).`,
  )
  for (const error of result.errors) {
    console.error(error)
  }
  process.exitCode = 1
}
else {
  console.info(
    `Private harness passed: `
    + `${result.targetsChecked} target record(s), ${result.reviewItemsChecked} review item(s).`,
  )
}

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) {
    return undefined
  }

  return args[index + 1]
}
