import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ArtifactRecord, EventRecord, RunRecord, SpanRecord } from './types.js'
import { ARTIFACT_API_VERSION, EVENT_API_VERSION, RUN_API_VERSION, SPAN_API_VERSION } from './types.js'

export class TraceStore {
  readonly traceDir: string
  #runWritten = false

  constructor(sessionRoot: string, sessionId: string) {
    this.traceDir = join(sessionRoot, 'traces', sessionId)
    mkdirSync(this.traceDir, { recursive: true })
    mkdirSync(join(this.traceDir, 'screenshots'), { recursive: true })
  }

  startRun(runId: string, attributes: Record<string, unknown>): RunRecord {
    const run: RunRecord = {
      api_version: RUN_API_VERSION, run_id: runId, trace_id: runId,
      run_type: 'execute', state: 'running', status_code: 'unset',
      started_at_millis: Date.now(), root_span_id: 'session', attributes,
    }
    writeFileSync(join(this.traceDir, 'run.json'), JSON.stringify(run, null, 2) + '\n')
    this.#runWritten = true
    return run
  }

  endRun(runId: string, statusCode: 'ok' | 'error', summary?: string): void {
    if (!this.#runWritten) return
    const runPath = join(this.traceDir, 'run.json')
    const current = JSON.parse(readFileSync(runPath, 'utf-8'))
    const run: RunRecord = { ...current, state: 'ended', status_code: statusCode, finished_at_millis: Date.now(), summary }
    writeFileSync(runPath, JSON.stringify(run, null, 2) + '\n')
  }

  startSpan(spanId: string, parentSpanId: string | undefined, name: string): SpanRecord {
    const span: SpanRecord = {
      api_version: SPAN_API_VERSION, span_id: spanId, parent_span_id: parentSpanId,
      name, state: 'running', status_code: 'unset', started_at_millis: Date.now(), attributes: {},
    }
    appendFileSync(join(this.traceDir, 'spans.jsonl'), JSON.stringify(span) + '\n')
    return span
  }

  endSpan(spanId: string, statusCode: 'ok' | 'error', summary?: string): void {
    const span = { api_version: SPAN_API_VERSION, span_id: spanId, state: 'ended' as const, status_code: statusCode, finished_at_millis: Date.now(), summary }
    appendFileSync(join(this.traceDir, 'spans.jsonl'), JSON.stringify(span) + '\n')
  }

  recordEvent(event: Omit<EventRecord, 'api_version'>): void {
    appendFileSync(join(this.traceDir, 'events.jsonl'), JSON.stringify({ api_version: EVENT_API_VERSION, ...event }) + '\n')
  }

  recordArtifact(artifact: Omit<ArtifactRecord, 'api_version'>): void {
    appendFileSync(join(this.traceDir, 'artifacts.jsonl'), JSON.stringify({ api_version: ARTIFACT_API_VERSION, ...artifact }) + '\n')
  }
}
