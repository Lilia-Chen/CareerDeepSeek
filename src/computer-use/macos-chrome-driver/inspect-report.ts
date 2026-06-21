import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ArtifactRecord, EventRecord, RunRecord, SpanRecord } from './types.js'

interface TraceRunEntry {
  traceDir: string
  run: RunRecord
}

interface TraceRunData extends TraceRunEntry {
  spans: SpanRecord[]
  events: EventRecord[]
  artifacts: ArtifactRecord[]
}

export function listTraceRuns(sessionRoot: string): string {
  const runs = discoverTraceRuns(sessionRoot)
    .sort((a, b) => b.run.started_at_millis - a.run.started_at_millis)

  const lines = ['Available Runs', '']
  if (runs.length === 0) {
    lines.push(`No runs found under ${resolve(sessionRoot)}.`)
    return `${lines.join('\n')}\n`
  }

  for (const entry of runs) {
    lines.push([
      entry.run.run_id,
      `status=${entry.run.status_code}`,
      `state=${entry.run.state}`,
      `started=${formatMillis(entry.run.started_at_millis)}`,
      entry.run.finished_at_millis ? `finished=${formatMillis(entry.run.finished_at_millis)}` : undefined,
      entry.run.summary ? `summary=${entry.run.summary}` : undefined,
      `trace=${entry.traceDir}`,
    ].filter(Boolean).join('  '))
  }

  return `${lines.join('\n')}\n`
}

export function inspectTraceRun(sessionRoot: string, runId: string): string {
  const entry = findTraceRun(sessionRoot, runId)
  if (!entry)
    throw new Error(`No trace run found for run id: ${runId}`)

  const data = readTraceRunData(entry)
  const roleCounts = countBy(data.artifacts.map(artifact => artifact.role))
  const missingArtifacts = data.artifacts.filter(artifact => !existsSync(resolve(data.traceDir, artifact.path)))
  const commandEvents = data.events.filter(event => typeof event.attributes.command_id === 'string')
  const failureEvents = data.events.filter(event =>
    typeof event.attributes.failure_class === 'string'
    || typeof event.attributes.failure_code === 'string')
  const knownLimits = collectKnownLimits(data)
  const actionSummaries = collectActionSummaries(data)

  const lines = [
    `Run: ${data.run.run_id}`,
    `Status: ${data.run.status_code}`,
    `State: ${data.run.state}`,
    `Trace: ${data.traceDir}`,
    `Started: ${formatMillis(data.run.started_at_millis)}`,
    data.run.finished_at_millis ? `Finished: ${formatMillis(data.run.finished_at_millis)}` : undefined,
    data.run.summary ? `Summary: ${data.run.summary}` : undefined,
    '',
    'Command Sequence:',
    ...formatCommandSequence(commandEvents),
    '',
    'Failures:',
    ...formatFailures(failureEvents, data.spans),
    '',
    'Artifact Roles:',
    ...formatCounts(roleCounts),
    '',
    'Artifacts:',
    ...formatArtifacts(data.artifacts),
    '',
    'Known Limits:',
    ...(knownLimits.length > 0 ? knownLimits.map(limit => `- ${limit}`) : ['- none observed']),
    '',
    'Action / Match Summaries:',
    ...(actionSummaries.length > 0 ? actionSummaries.map(summary => `- ${summary}`) : ['- none observed']),
    '',
    'Missing Artifact Files:',
    ...(missingArtifacts.length > 0
      ? missingArtifacts.map(artifact => `- ${artifact.artifact_id} role=${artifact.role} path=${artifact.path}`)
      : ['- none']),
    '',
  ].filter((line): line is string => line !== undefined)

  return `${lines.join('\n')}\n`
}

function discoverTraceRuns(sessionRoot: string): TraceRunEntry[] {
  const tracesRoot = join(sessionRoot, 'traces')
  if (!existsSync(tracesRoot))
    return []

  return readdirSync(tracesRoot)
    .map(name => join(tracesRoot, name))
    .filter(path => statSync(path).isDirectory())
    .flatMap((traceDir) => {
      const runPath = join(traceDir, 'run.json')
      if (!existsSync(runPath))
        return []
      return [{ traceDir, run: readJsonFile<RunRecord>(runPath, 'run record') }]
    })
}

function findTraceRun(sessionRoot: string, runId: string): TraceRunEntry | undefined {
  return discoverTraceRuns(sessionRoot).find(entry => entry.run.run_id === runId)
}

function readTraceRunData(entry: TraceRunEntry): TraceRunData {
  return {
    ...entry,
    spans: readJsonlFile<SpanRecord>(join(entry.traceDir, 'spans.jsonl'), 'span records'),
    events: readJsonlFile<EventRecord>(join(entry.traceDir, 'events.jsonl'), 'event records'),
    artifacts: readJsonlFile<ArtifactRecord>(join(entry.traceDir, 'artifacts.jsonl'), 'artifact records'),
  }
}

function readJsonFile<T>(path: string, label: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  }
  catch (error) {
    throw new Error(`Failed to read ${label} from ${path}: ${errorMessage(error)}`)
  }
}

function readJsonlFile<T>(path: string, label: string): T[] {
  if (!existsSync(path))
    throw new Error(`Missing required trace file for ${label}: ${path}`)
  const body = readFileSync(path, 'utf8').trim()
  if (body === '')
    return []
  return body.split(/\r?\n/).map((line, index) => {
    try {
      return JSON.parse(line) as T
    }
    catch (error) {
      throw new Error(`Malformed ${label} at ${path}:${index + 1}: ${errorMessage(error)}`)
    }
  })
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values)
    counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

function formatCounts(counts: Map<string, number>): string[] {
  if (counts.size === 0)
    return ['- none']
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([role, count]) => `- ${role}: ${count}`)
}

function formatCommandSequence(events: EventRecord[]): string[] {
  if (events.length === 0)
    return ['- none observed']
  return events.map((event, index) => {
    const commandId = stringAttribute(event, 'command_id') ?? 'unknown'
    const operation = stringAttribute(event, 'operation')
    const status = stringAttribute(event, 'status')
    const failureClass = stringAttribute(event, 'failure_class')
    const failureCode = stringAttribute(event, 'failure_code')
    return [
      `- ${index + 1}. ${event.name}`,
      commandId,
      operation ? `operation=${operation}` : undefined,
      status ? `status=${status}` : undefined,
      failureClass || failureCode ? `failure=${failureClass ?? 'unknown'}/${failureCode ?? 'unknown'}` : undefined,
      `span=${event.span_id}`,
    ].filter(Boolean).join(' ')
  })
}

function formatFailures(events: EventRecord[], spans: SpanRecord[]): string[] {
  const lines = events.map((event) => {
    const failureClass = stringAttribute(event, 'failure_class') ?? 'unknown'
    const failureCode = stringAttribute(event, 'failure_code') ?? 'unknown'
    const commandId = stringAttribute(event, 'command_id')
    const message = stringAttribute(event, 'failure_message') ?? stringAttribute(event, 'message')
    return [
      `- ${commandId ? `${commandId} ` : ''}failure=${failureClass}/${failureCode}`,
      message ? `message=${message}` : undefined,
      `span=${event.span_id}`,
    ].filter(Boolean).join(' ')
  })
  for (const span of spans) {
    if (span.status_code === 'error' && span.summary)
      lines.push(`- span=${span.span_id} status=error summary=${span.summary}`)
  }
  return lines.length > 0 ? lines : ['- none observed']
}

function formatArtifacts(artifacts: ArtifactRecord[]): string[] {
  if (artifacts.length === 0)
    return ['- none']
  return artifacts.map(artifact => `- ${artifact.artifact_id} role=${artifact.role} path=${artifact.path}`)
}

function collectKnownLimits(data: TraceRunData): string[] {
  const limits = new Set<string>()
  for (const event of data.events) {
    const value = event.attributes.known_limits ?? event.attributes.knownLimits
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string')
          limits.add(item)
      }
    }
  }
  for (const artifact of data.artifacts) {
    const payload = readArtifactPayload(data.traceDir, artifact)
    for (const key of ['knownLimits', 'known_limits']) {
      const value = isRecord(payload) ? payload[key] : undefined
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string')
            limits.add(item)
        }
      }
    }
  }
  return [...limits].sort()
}

function collectActionSummaries(data: TraceRunData): string[] {
  const summaries: string[] = []
  for (const artifact of data.artifacts) {
    const payload = readArtifactPayload(data.traceDir, artifact)
    if (!isRecord(payload))
      continue
    if (typeof payload.found === 'boolean') {
      summaries.push(`${artifact.artifact_id} found=${payload.found}`)
      continue
    }
    if (isRecord(payload.clicked)) {
      const text = typeof payload.clicked.text === 'string' ? ` text=${payload.clicked.text}` : ''
      summaries.push(`${artifact.artifact_id} clicked${text}`)
      continue
    }
    if (Array.isArray(payload.matches))
      summaries.push(`${artifact.artifact_id} matches=${payload.matches.length}`)
    if (typeof payload.action === 'string') {
      const role = typeof payload.role === 'string' ? ` role=${payload.role}` : ''
      const text = typeof payload.text === 'string' ? ` text=${payload.text}` : ''
      summaries.push(`${artifact.artifact_id} ax_action=${payload.action}${role}${text}`)
    }
  }
  return summaries
}

function readArtifactPayload(traceDir: string, artifact: ArtifactRecord): unknown {
  if (artifact.mime_type !== 'application/json')
    return undefined
  const path = resolve(traceDir, artifact.path)
  if (!existsSync(path))
    return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  }
  catch {
    return undefined
  }
}

function stringAttribute(event: EventRecord, key: string): string | undefined {
  const value = event.attributes[key]
  return typeof value === 'string' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatMillis(value: number): string {
  return new Date(value).toISOString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
