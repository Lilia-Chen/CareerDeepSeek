import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMacOSChromeInvokeEntry } from '../../src/computer-use/macos-chrome-driver/invoke-entry.js'

describe('invoke entry TraceStore lifecycle', () => {
  it('finalizes the driver run after an invoke completes', async () => {
    const sessionRoot = mkdtempSync(join(tmpdir(), 'cds-trace-finalize-'))
    const entry = createMacOSChromeInvokeEntry({
      driverOptions: {
        sessionId: 'trace-finalize-test',
        config: { sessionRoot },
      },
      now: () => 1000,
    })

    const result = await entry.invoke({ commandId: 'chrome.waitForText', inputs: { query: 'Results' }, dryRun: true })

    expect(result.status).toBe('completed')
    const traceDir = join(sessionRoot, 'traces', 'trace-finalize-test')
    const run = JSON.parse(readFileSync(join(traceDir, 'run.json'), 'utf8')) as {
      state: string
      status_code: string
      summary?: string
      finished_at_millis?: number
    }
    expect(run).toMatchObject({
      state: 'ended',
      status_code: 'ok',
      summary: 'Resolved chrome.waitForText without invoking the live driver.',
    })
    expect(run.finished_at_millis).toEqual(expect.any(Number))
    expect(existsSync(join(traceDir, 'artifacts.jsonl'))).toBe(true)
  })
})
