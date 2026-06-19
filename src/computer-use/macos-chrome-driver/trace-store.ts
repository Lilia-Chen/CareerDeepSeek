import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import type { ArtifactRecord, EventRecord, RunRecord, SpanRecord } from './types.js'
import { ARTIFACT_API_VERSION, EVENT_API_VERSION, RUN_API_VERSION, SPAN_API_VERSION } from './types.js'

export interface JsonArtifactInput {
  artifact_id: string
  span_id: string
  role: string
  payload: unknown
  attributes?: Record<string, unknown>
  event_id?: string
  summary?: string
}

export class TraceStore {
  readonly traceDir: string
  readonly #artifactsDir: string
  #run?: RunRecord
  #spans = new Map<string, SpanRecord>()
  #events: EventRecord[] = []
  #artifacts: ArtifactRecord[] = []

  constructor(sessionRoot: string, sessionId: string) {
    this.traceDir = join(sessionRoot, 'traces', sessionId)
    this.#artifactsDir = join(this.traceDir, 'artifacts')
    mkdirSync(this.traceDir, { recursive: true })
    mkdirSync(join(this.traceDir, 'screenshots'), { recursive: true })
    mkdirSync(this.#artifactsDir, { recursive: true })
  }

  startRun(runId: string, attributes: Record<string, unknown>): RunRecord {
    const run: RunRecord = {
      api_version: RUN_API_VERSION,
      run_id: runId,
      trace_id: runId,
      run_type: 'execute',
      state: 'running',
      status_code: 'unset',
      started_at_millis: Date.now(),
      root_span_id: 'session',
      attributes,
    }
    this.#run = run
    atomicWriteFile(join(this.traceDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`)
    return run
  }

  endRun(_runId: string, statusCode: 'ok' | 'error', summary?: string): void {
    if (!this.#run)
      return
    const finishedAtMillis = Date.now()
    this.#run = { ...this.#run, state: 'ended', status_code: statusCode, finished_at_millis: finishedAtMillis, summary }
    for (const [spanId, span] of this.#spans) {
      if (span.state !== 'running')
        continue
      this.#spans.set(spanId, {
        ...span,
        state: 'ended',
        status_code: statusCode,
        finished_at_millis: finishedAtMillis,
      })
    }
    this.#writeRun()
    this.#writeSpans()
    this.#writeEvents()
    this.#writeArtifacts()
  }

  startSpan(spanId: string, parentSpanId: string | undefined, name: string): SpanRecord {
    const span: SpanRecord = {
      api_version: SPAN_API_VERSION,
      span_id: spanId,
      parent_span_id: parentSpanId,
      name,
      state: 'running',
      status_code: 'unset',
      started_at_millis: Date.now(),
      attributes: {},
    }
    this.#spans.set(spanId, span)
    this.#writeSpans()
    return span
  }

  endSpan(spanId: string, statusCode: 'ok' | 'error', summary?: string): void {
    const current = this.#spans.get(spanId)
    if (!current)
      throw new Error(`Cannot end unknown trace span: ${spanId}`)
    this.#spans.set(spanId, {
      ...current,
      state: 'ended',
      status_code: statusCode,
      finished_at_millis: Date.now(),
      summary,
    })
    this.#writeSpans()
  }

  recordEvent(event: Omit<EventRecord, 'api_version'>): void {
    this.#events.push({ api_version: EVENT_API_VERSION, ...event })
    this.#writeEvents()
  }

  recordArtifact(artifact: Omit<ArtifactRecord, 'api_version'>): void {
    this.#artifacts.push(this.#stageArtifactRecord(artifact))
    this.#writeArtifacts()
  }

  writeJsonArtifact(input: JsonArtifactInput): ArtifactRecord {
    const body = `${JSON.stringify(input.payload, null, 2)}\n`
    const relativePath = artifactRelativePath(`${sanitizeArtifactFileName(input.artifact_id)}.json`)
    const path = this.#resolveArtifactDestination(relativePath)
    atomicWriteFile(path, body)

    const record: ArtifactRecord = {
      api_version: ARTIFACT_API_VERSION,
      artifact_id: input.artifact_id,
      span_id: input.span_id,
      event_id: input.event_id,
      role: input.role,
      mime_type: 'application/json',
      path: relativePath,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      attributes: input.attributes ?? {},
      summary: input.summary,
    }
    this.#artifacts.push(record)
    this.#writeArtifacts()
    return record
  }

  #stageArtifactRecord(artifact: Omit<ArtifactRecord, 'api_version'>): ArtifactRecord {
    const sourcePath = resolveArtifactSourcePath(this.traceDir, artifact.path)
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile())
      throw new Error(`Cannot stage missing trace artifact source: ${artifact.path}`)

    const existingRelativePath = relativePathInsideArtifacts(this.#artifactsDir, sourcePath)
    const relativePath = existingRelativePath
      ?? artifactRelativePath(`${sanitizeArtifactFileName(artifact.artifact_id)}${extname(sourcePath)}`)
    const destinationPath = existingRelativePath
      ? sourcePath
      : this.#resolveArtifactDestination(relativePath)

    if (!existingRelativePath) {
      const tmpPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`
      copyFileSync(sourcePath, tmpPath)
      renameSync(tmpPath, destinationPath)
    }

    return {
      api_version: ARTIFACT_API_VERSION,
      ...artifact,
      path: relativePath,
      sha256: createHash('sha256').update(readFileSync(destinationPath)).digest('hex'),
    }
  }

  #resolveArtifactDestination(relativePath: string): string {
    if (!relativePath.startsWith('artifacts/'))
      throw new Error(`Trace artifact destination must stay under artifacts/: ${relativePath}`)
    const destinationPath = resolve(this.traceDir, relativePath)
    const artifactsRoot = resolve(this.#artifactsDir)
    if (destinationPath !== artifactsRoot && !destinationPath.startsWith(`${artifactsRoot}${sep}`))
      throw new Error(`Trace artifact destination escapes artifacts/: ${relativePath}`)
    return destinationPath
  }

  #writeRun(): void {
    if (this.#run)
      atomicWriteFile(join(this.traceDir, 'run.json'), `${JSON.stringify(this.#run, null, 2)}\n`)
  }

  #writeSpans(): void {
    writeJsonlSnapshot(join(this.traceDir, 'spans.jsonl'), [...this.#spans.values()])
  }

  #writeEvents(): void {
    writeJsonlSnapshot(join(this.traceDir, 'events.jsonl'), this.#events)
  }

  #writeArtifacts(): void {
    writeJsonlSnapshot(join(this.traceDir, 'artifacts.jsonl'), this.#artifacts)
  }
}

function sanitizeArtifactFileName(value: string): string {
  const safe = value.replace(/[^\w.-]/g, '_').slice(0, 120)
  return safe.length > 0 ? safe : 'artifact'
}

function artifactRelativePath(fileName: string): string {
  return `artifacts/${basename(fileName)}`
}

function resolveArtifactSourcePath(traceDir: string, path: string): string {
  if (existsSync(path))
    return resolve(path)
  return resolve(traceDir, path)
}

function relativePathInsideArtifacts(artifactsDir: string, path: string): string | undefined {
  const artifactsRoot = resolve(artifactsDir)
  const sourcePath = resolve(path)
  if (sourcePath !== artifactsRoot && !sourcePath.startsWith(`${artifactsRoot}${sep}`))
    return undefined
  const relativePath = relative(artifactsRoot, sourcePath)
  if (!relativePath || relativePath.startsWith('..') || relativePath.includes(`${sep}..${sep}`))
    return undefined
  return `artifacts/${relativePath.split(sep).join('/')}`
}

function writeJsonlSnapshot(path: string, records: unknown[]): void {
  // Current CDS QA runs are small, so every mutation atomically rewrites the
  // full JSONL snapshot. Large runs can move to append-only complete records,
  // but must not return to start/end patch-split rows.
  atomicWriteFile(path, records.length > 0 ? `${records.map(record => JSON.stringify(record)).join('\n')}\n` : '')
}

function atomicWriteFile(path: string, body: string | NodeJS.ArrayBufferView): void {
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmpPath, body)
  renameSync(tmpPath, path)
}
