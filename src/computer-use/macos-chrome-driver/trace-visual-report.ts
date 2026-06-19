import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ArtifactRecord, EventRecord, RunRecord, SpanRecord } from './types.js'
import { uniqueStrings } from './shared.js'

type JsonObject = Record<string, unknown>

export interface GenerateVisualTraceReportInput {
  traceDir: string
  outputDir?: string
}

export interface GenerateVisualTraceReportResult {
  jsonPath: string
  htmlPath: string
  summary: VisualTraceReportSummary
}

export interface VisualTraceReportSummary {
  trace_dir: string
  visual_report: string
  json_report: string
  run_id?: string
  command_count: number
  span_count: number
  artifact_count: number
  screenshot_count: number
  action_count: number
  failure_count: number
  known_limit_count: number
  missing_artifact_ref_count: number
  missing_file_count: number
}

interface VisualTraceReport {
  generatedAt: string
  traceDir: string
  run: RunRecord | null
  commandSequence: string[]
  spanSequence: VisualSpanSummary[]
  spans: SpanRecord[]
  events: EventRecord[]
  artifacts: VisualArtifactSummary[]
  screenshots: VisualScreenshotSummary[]
  observations: VisualObservationSummary[]
  recognitions: VisualRecognitionSummary[]
  candidateBoxes: VisualCandidateBoxSummary[]
  actions: VisualActionSummary[]
  failures: VisualFailureSummary[]
  knownLimits: string[]
  missingFiles: string[]
  missingArtifactRefs: VisualArtifactRef[]
  parseErrors: VisualParseError[]
  summary: VisualTraceReportSummary
}

interface VisualSpanSummary {
  spanId: string
  parentSpanId?: string
  name: string
  state: string
  statusCode: string
  summary?: string
}

interface VisualArtifactSummary {
  artifactId: string
  spanId: string
  eventId?: string
  role: string
  mimeType: string
  path: string
  exists: boolean
  summary?: string
}

interface VisualScreenshotSummary {
  artifactId: string
  path: string
  width?: number
  height?: number
  observationArtifactIds: string[]
}

interface VisualObservationSummary {
  artifactId: string
  snapshotId?: string
  spanId?: string
  source?: string
  screenshotPath?: string
  nodeCount?: number
  knownLimits: string[]
}

interface VisualRecognitionSummary {
  artifactId: string
  recognitionId?: string
  found?: boolean
  source?: string
  bestBox?: RecognitionBoxLike
  bestText?: string
  screenshotPath?: string
  knownLimits: string[]
}

interface VisualCandidateBoxSummary {
  artifactId: string
  candidateLocalId?: string
  kind?: string
  label?: string
  grounding?: string
  bounds: RecognitionBoxLike
  anchorText?: string
  screenshotPath?: string
  recognitionArtifactId?: string
  knownLimits: string[]
}

interface VisualActionSummary {
  artifactId: string
  actionId?: string
  actionType?: string
  spanId?: string
  executed?: boolean
  refused?: boolean
  refusalReasons: string[]
  grounding?: string
  candidateRef?: VisualArtifactRef
  candidateBox?: RecognitionBoxLike
  livenessFreshBox?: RecognitionBoxLike
  clickPoint?: VisualPoint
  freshScreenshotPath?: string
  failures: VisualFailureSummary[]
  knownLimits: string[]
}

interface VisualFailureSummary {
  source: string
  spanId?: string
  eventId?: string
  artifactId?: string
  commandId?: string
  failureClass?: string
  failureCode: string
  message?: string
}

interface VisualArtifactRef {
  run_id: string
  artifact_id: string
  span_id: string
  captured_event_id?: string
}

interface VisualParseError {
  path: string
  line?: number
  message: string
}

interface RecognitionBoxLike {
  x: number
  y: number
  width: number
  height: number
}

interface VisualPoint {
  x: number
  y: number
  source: string
}

interface LoadedArtifact {
  record: ArtifactRecord
  path: string
  payload?: unknown
}

interface TraceReadState {
  missingFiles: string[]
  parseErrors: VisualParseError[]
}

const REPORT_JSON_FILE_NAME = 'visual-trace-report.json'
const REPORT_HTML_FILE_NAME = 'visual-trace-report.html'

export function generateVisualTraceReport(input: GenerateVisualTraceReportInput): GenerateVisualTraceReportResult {
  const traceDir = resolve(input.traceDir)
  if (!existsSync(traceDir) || !statSync(traceDir).isDirectory())
    throw new Error(`Trace root does not exist: ${traceDir}`)

  const outputDir = resolve(input.outputDir ?? traceDir)
  mkdirSync(outputDir, { recursive: true })

  const readState: TraceReadState = {
    missingFiles: [],
    parseErrors: [],
  }
  const run = readOptionalJson<RunRecord>(join(traceDir, 'run.json'), readState)
  const spans = readOptionalJsonl<SpanRecord>(join(traceDir, 'spans.jsonl'), readState)
  const events = readOptionalJsonl<EventRecord>(join(traceDir, 'events.jsonl'), readState)
  const artifactRecords = readOptionalJsonl<ArtifactRecord>(join(traceDir, 'artifacts.jsonl'), readState)
  const loadedArtifacts = artifactRecords.map(record => loadArtifact(traceDir, record, readState))
  const artifactById = new Map(loadedArtifacts.map(artifact => [artifact.record.artifact_id, artifact]))

  const artifacts = loadedArtifacts.map(artifact => artifactSummary(artifact))
  const screenshots = screenshotSummaries(loadedArtifacts, artifactById)
  const observations = loadedArtifacts
    .filter(artifact => artifact.record.role === 'observation-snapshot')
    .map(artifact => observationSummary(artifact, artifactById))
  const recognitions = loadedArtifacts
    .filter(artifact => artifact.record.role === 'recognition-result')
    .map(artifact => recognitionSummary(artifact, artifactById))
  const candidateBoxes = loadedArtifacts
    .filter(artifact => artifact.record.role === 'promoted-candidate')
    .map(artifact => candidateBoxSummary(artifact, artifactById))
    .filter((candidate): candidate is VisualCandidateBoxSummary => candidate !== null)
  const candidateByArtifactId = new Map(candidateBoxes.map(candidate => [candidate.artifactId, candidate]))
  const actions = loadedArtifacts
    .filter(artifact => artifact.record.role === 'action-execution')
    .map(artifact => actionSummary(artifact, artifactById, candidateByArtifactId))
  const failures = uniqueFailures([
    ...events.flatMap(eventFailures),
    ...actions.flatMap(action => action.failures),
  ])
  const knownLimits = uniqueStrings([
    ...loadedArtifacts.flatMap(artifact => collectKnownLimits(artifact.payload)),
    ...actions.flatMap(action => action.knownLimits),
  ])
  const missingArtifactRefs = missingRefs({
    runId: run?.run_id,
    events,
    loadedArtifacts,
    artifactById,
  })

  const htmlPath = join(outputDir, REPORT_HTML_FILE_NAME)
  const jsonPath = join(outputDir, REPORT_JSON_FILE_NAME)
  const summary: VisualTraceReportSummary = {
    trace_dir: traceDir,
    visual_report: htmlPath,
    json_report: jsonPath,
    run_id: run?.run_id,
    command_count: commandSequence(events).length,
    span_count: spans.length,
    artifact_count: artifacts.length,
    screenshot_count: screenshots.length,
    action_count: actions.length,
    failure_count: failures.length,
    known_limit_count: knownLimits.length,
    missing_artifact_ref_count: missingArtifactRefs.length,
    missing_file_count: readState.missingFiles.length,
  }
  const report: VisualTraceReport = {
    generatedAt: new Date().toISOString(),
    traceDir,
    run,
    commandSequence: commandSequence(events),
    spanSequence: spans.map(spanSummary),
    spans,
    events,
    artifacts,
    screenshots,
    observations,
    recognitions,
    candidateBoxes,
    actions,
    failures,
    knownLimits,
    missingFiles: readState.missingFiles,
    missingArtifactRefs,
    parseErrors: readState.parseErrors,
    summary,
  }

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(htmlPath, renderHtmlReport(report))

  return { jsonPath, htmlPath, summary }
}

function readOptionalJson<T>(path: string, state: TraceReadState): T | null {
  if (!existsSync(path)) {
    state.missingFiles.push(path)
    return null
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  }
  catch (error) {
    state.parseErrors.push({ path, message: errorMessage(error) })
    return null
  }
}

function readOptionalJsonl<T>(path: string, state: TraceReadState): T[] {
  if (!existsSync(path)) {
    state.missingFiles.push(path)
    return []
  }
  const lines = readFileSync(path, 'utf-8').split(/\r?\n/)
  const records: T[] = []
  lines.forEach((line, index) => {
    if (!line.trim())
      return
    try {
      records.push(JSON.parse(line) as T)
    }
    catch (error) {
      state.parseErrors.push({ path, line: index + 1, message: errorMessage(error) })
    }
  })
  return records
}

function loadArtifact(traceDir: string, record: ArtifactRecord, state: TraceReadState): LoadedArtifact {
  const artifactPath = resolveArtifactPath(traceDir, record.path)
  if (!existsSync(artifactPath)) {
    state.missingFiles.push(artifactPath)
    return { record, path: artifactPath }
  }
  if (isJsonArtifact(record, artifactPath)) {
    try {
      return { record, path: artifactPath, payload: JSON.parse(readFileSync(artifactPath, 'utf-8')) }
    }
    catch (error) {
      state.parseErrors.push({ path: artifactPath, message: errorMessage(error) })
    }
  }
  return { record, path: artifactPath }
}

function resolveArtifactPath(traceDir: string, artifactPath: string): string {
  return isAbsolute(artifactPath) ? artifactPath : resolve(traceDir, artifactPath)
}

function isJsonArtifact(record: ArtifactRecord, path: string): boolean {
  return record.mime_type === 'application/json' || path.endsWith('.json')
}

function artifactSummary(artifact: LoadedArtifact): VisualArtifactSummary {
  return {
    artifactId: artifact.record.artifact_id,
    spanId: artifact.record.span_id,
    eventId: artifact.record.event_id,
    role: artifact.record.role,
    mimeType: artifact.record.mime_type,
    path: artifact.path,
    exists: existsSync(artifact.path),
    summary: artifact.record.summary,
  }
}

function screenshotSummaries(
  artifacts: LoadedArtifact[],
  artifactById: Map<string, LoadedArtifact>,
): VisualScreenshotSummary[] {
  return artifacts
    .filter(artifact => artifact.record.role === 'screenshot')
    .map((artifact) => {
      const observationArtifactIds = artifacts
        .filter(candidate => candidate.record.role === 'observation-snapshot')
        .filter(candidate => artifactRefsIn(candidate.payload).some(ref => ref.artifact_id === artifact.record.artifact_id))
        .map(candidate => candidate.record.artifact_id)
      return {
        artifactId: artifact.record.artifact_id,
        path: artifact.path,
        width: numericAttribute(artifact.record.attributes, 'width'),
        height: numericAttribute(artifact.record.attributes, 'height'),
        observationArtifactIds,
      }
    })
    .sort((left, right) => sortByArtifactOrder(left.artifactId, right.artifactId, artifactById))
}

function observationSummary(
  artifact: LoadedArtifact,
  artifactById: Map<string, LoadedArtifact>,
): VisualObservationSummary {
  const payload = asObject(artifact.payload)
  return {
    artifactId: artifact.record.artifact_id,
    snapshotId: stringField(payload, 'snapshot_id'),
    spanId: stringField(payload, 'span_id'),
    source: stringField(payload, 'source'),
    screenshotPath: screenshotPathForRefs(artifactRefsIn(payload), artifactById),
    nodeCount: arrayField(payload, 'nodes')?.length,
    knownLimits: knownLimitsFromObject(payload),
  }
}

function recognitionSummary(
  artifact: LoadedArtifact,
  artifactById: Map<string, LoadedArtifact>,
): VisualRecognitionSummary {
  const payload = asObject(artifact.payload)
  const best = asObject(payload.best)
  return {
    artifactId: artifact.record.artifact_id,
    recognitionId: stringField(payload, 'recognition_id'),
    found: booleanField(payload, 'found'),
    source: stringField(payload, 'source'),
    bestBox: recognitionBox(best.box),
    bestText: stringField(best, 'text'),
    screenshotPath: screenshotPathForRefs(artifactRefsIn(payload), artifactById),
    knownLimits: knownLimitsFromObject(payload),
  }
}

function candidateBoxSummary(
  artifact: LoadedArtifact,
  artifactById: Map<string, LoadedArtifact>,
): VisualCandidateBoxSummary | null {
  const payload = asObject(artifact.payload)
  const targetSpec = asObject(payload.target_spec)
  const evidence = asObject(payload.evidence)
  const bounds = recognitionBox(targetSpec.box)
  if (!bounds)
    return null
  return {
    artifactId: artifact.record.artifact_id,
    candidateLocalId: stringField(payload, 'candidate_local_id'),
    kind: stringField(payload, 'kind'),
    label: stringField(payload, 'label'),
    grounding: stringField(targetSpec, 'grounding'),
    bounds,
    anchorText: stringField(targetSpec, 'anchor_text'),
    screenshotPath: screenshotPathForRefs(artifactRefsIn(evidence), artifactById),
    recognitionArtifactId: isArtifactRef(evidence.recognition_artifact)
      ? evidence.recognition_artifact.artifact_id
      : undefined,
    knownLimits: knownLimitsFromObject(payload),
  }
}

function actionSummary(
  artifact: LoadedArtifact,
  artifactById: Map<string, LoadedArtifact>,
  candidateByArtifactId: Map<string, VisualCandidateBoxSummary>,
): VisualActionSummary {
  const payload = asObject(artifact.payload)
  const liveness = asObject(payload.liveness_recheck)
  const candidateRef = isArtifactRef(payload.candidate_ref) ? payload.candidate_ref : undefined
  const candidateBox = candidateRef ? candidateByArtifactId.get(candidateRef.artifact_id)?.bounds : undefined
  const freshBox = recognitionBox(liveness.fresh_box)
  const originalBox = recognitionBox(liveness.original_box)
  const clickPoint = clickPointForAction(stringField(payload, 'action_type'), freshBox, candidateBox, originalBox)
  const failures = actionFailures(artifact.record.artifact_id, payload)
  const refs = artifactRefsIn(payload)
  return {
    artifactId: artifact.record.artifact_id,
    actionId: stringField(payload, 'action_id'),
    actionType: stringField(payload, 'action_type'),
    spanId: stringField(payload, 'span_id'),
    executed: booleanField(payload, 'executed'),
    refused: booleanField(payload, 'refused'),
    refusalReasons: stringArrayField(payload, 'refusal_reasons'),
    grounding: stringField(payload, 'grounding') ?? stringField(liveness, 'grounding'),
    candidateRef,
    candidateBox: candidateBox ?? originalBox,
    livenessFreshBox: freshBox,
    clickPoint,
    freshScreenshotPath: screenshotPathForRefs(refs, artifactById),
    failures,
    knownLimits: uniqueStrings([
      ...knownLimitsFromObject(payload),
      ...knownLimitsFromObject(liveness),
    ]),
  }
}

function commandSequence(events: EventRecord[]): string[] {
  const resolutionEvents = new Set([
    'handler_invocation_completed',
    'handler_invocation_failed',
    'handler_invocation_exception',
    'dry_run_completed',
    'command_resolution_failed',
  ])

  return events
    .slice()
    .sort((left, right) => left.timestamp_millis - right.timestamp_millis)
    .filter(event => resolutionEvents.has(event.name))
    .map(event => asObject(event.attributes).command_id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
}

function spanSummary(span: SpanRecord): VisualSpanSummary {
  return {
    spanId: span.span_id,
    parentSpanId: span.parent_span_id,
    name: span.name,
    state: span.state,
    statusCode: span.status_code,
    summary: span.summary,
  }
}

function eventFailures(event: EventRecord): VisualFailureSummary[] {
  const attributes = asObject(event.attributes)
  const failureCode = stringField(attributes, 'failure_code')
  if (!failureCode)
    return []
  return [{
    source: 'event',
    spanId: event.span_id,
    eventId: event.event_id,
    commandId: stringField(attributes, 'command_id'),
    failureClass: stringField(attributes, 'failure_class'),
    failureCode,
    message: stringField(attributes, 'message'),
  }]
}

function actionFailures(artifactId: string, payload: JsonObject): VisualFailureSummary[] {
  const failures: VisualFailureSummary[] = []
  const precondition = asObject(payload.precondition_result)
  const preconditionFailures = arrayField(precondition, 'failures') ?? []
  for (const failure of preconditionFailures) {
    const failureObject = asObject(failure)
    const code = stringField(failureObject, 'code')
    if (!code)
      continue
    failures.push({
      source: 'action-execution.precondition_result',
      artifactId,
      spanId: stringField(payload, 'span_id'),
      failureCode: code,
      message: stringField(failureObject, 'detail'),
    })
  }
  for (const reason of stringArrayField(payload, 'refusal_reasons')) {
    failures.push({
      source: 'action-execution.refusal_reasons',
      artifactId,
      spanId: stringField(payload, 'span_id'),
      failureCode: reason,
    })
  }
  return uniqueFailures(failures)
}

function missingRefs(input: {
  runId?: string
  events: EventRecord[]
  loadedArtifacts: LoadedArtifact[]
  artifactById: Map<string, LoadedArtifact>
}): VisualArtifactRef[] {
  const refs = [
    ...input.events.flatMap(event => event.artifact_ids.map(artifactId => ({
      run_id: input.runId ?? 'unknown',
      artifact_id: artifactId,
      span_id: event.span_id,
    }))),
    ...input.loadedArtifacts.flatMap(artifact => artifactRefsIn(artifact.payload)),
  ]
  return uniqueArtifactRefs(refs.filter(ref => !input.artifactById.has(ref.artifact_id)))
}

function artifactRefsIn(value: unknown): VisualArtifactRef[] {
  const refs: VisualArtifactRef[] = []
  collectArtifactRefs(value, refs, new Set<unknown>())
  return uniqueArtifactRefs(refs)
}

function collectArtifactRefs(value: unknown, refs: VisualArtifactRef[], seen: Set<unknown>): void {
  if (!value || typeof value !== 'object')
    return
  if (seen.has(value))
    return
  seen.add(value)
  if (isArtifactRef(value)) {
    refs.push(value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectArtifactRefs(item, refs, seen))
    return
  }
  Object.values(value).forEach(item => collectArtifactRefs(item, refs, seen))
}

function collectKnownLimits(value: unknown): string[] {
  if (!value || typeof value !== 'object')
    return []
  const limits: string[] = []
  collectKnownLimitsInto(value, limits, new Set<unknown>())
  return uniqueStrings(limits)
}

function collectKnownLimitsInto(value: unknown, limits: string[], seen: Set<unknown>): void {
  if (!value || typeof value !== 'object')
    return
  if (seen.has(value))
    return
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach(item => collectKnownLimitsInto(item, limits, seen))
    return
  }
  const record = value as JsonObject
  for (const [key, item] of Object.entries(record)) {
    if ((key === 'known_limits' || key === 'knownLimits') && Array.isArray(item)) {
      limits.push(...item.filter((limit): limit is string => typeof limit === 'string'))
      continue
    }
    collectKnownLimitsInto(item, limits, seen)
  }
}

function screenshotPathForRefs(
  refs: VisualArtifactRef[],
  artifactById: Map<string, LoadedArtifact>,
): string | undefined {
  for (const ref of refs) {
    const artifact = artifactById.get(ref.artifact_id)
    if (artifact?.record.role === 'screenshot')
      return artifact.path
  }
  return undefined
}

function clickPointForAction(
  actionType: string | undefined,
  freshBox?: RecognitionBoxLike,
  candidateBox?: RecognitionBoxLike,
  originalBox?: RecognitionBoxLike,
): VisualPoint | undefined {
  if (actionType !== 'click')
    return undefined
  if (freshBox)
    return { ...centerOf(freshBox), source: 'fresh_box_center' }
  if (candidateBox)
    return { ...centerOf(candidateBox), source: 'promoted_candidate_center' }
  if (originalBox)
    return { ...centerOf(originalBox), source: 'original_box_center' }
  return undefined
}

function centerOf(box: RecognitionBoxLike): { x: number, y: number } {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  }
}

function recognitionBox(value: unknown): RecognitionBoxLike | undefined {
  const box = asObject(value)
  const x = numberField(box, 'x')
  const y = numberField(box, 'y')
  const width = numberField(box, 'width')
  const height = numberField(box, 'height')
  if (x === undefined || y === undefined || width === undefined || height === undefined)
    return undefined
  return { x, y, width, height }
}

function isArtifactRef(value: unknown): value is VisualArtifactRef {
  if (!value || typeof value !== 'object')
    return false
  const record = value as JsonObject
  return typeof record.run_id === 'string'
    && typeof record.artifact_id === 'string'
    && typeof record.span_id === 'string'
}

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return {}
  return value as JsonObject
}

function arrayField(record: JsonObject, field: string): unknown[] | undefined {
  const value = record[field]
  return Array.isArray(value) ? value : undefined
}

function stringField(record: JsonObject, field: string): string | undefined {
  const value = record[field]
  return typeof value === 'string' ? value : undefined
}

function booleanField(record: JsonObject, field: string): boolean | undefined {
  const value = record[field]
  return typeof value === 'boolean' ? value : undefined
}

function numberField(record: JsonObject, field: string): number | undefined {
  const value = record[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringArrayField(record: JsonObject, field: string): string[] {
  const value = record[field]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function numericAttribute(attributes: Record<string, unknown>, field: string): number | undefined {
  const value = attributes[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function knownLimitsFromObject(record: JsonObject): string[] {
  return stringArrayField(record, 'known_limits')
}

function uniqueArtifactRefs(refs: VisualArtifactRef[]): VisualArtifactRef[] {
  const seen = new Set<string>()
  const unique: VisualArtifactRef[] = []
  for (const ref of refs) {
    const key = `${ref.run_id}\0${ref.artifact_id}\0${ref.span_id}\0${ref.captured_event_id ?? ''}`
    if (seen.has(key))
      continue
    seen.add(key)
    unique.push(ref)
  }
  return unique
}

function uniqueFailures(failures: VisualFailureSummary[]): VisualFailureSummary[] {
  const seen = new Set<string>()
  const unique: VisualFailureSummary[] = []
  for (const failure of failures) {
    const key = [
      failure.source,
      failure.spanId ?? '',
      failure.eventId ?? '',
      failure.artifactId ?? '',
      failure.commandId ?? '',
      failure.failureClass ?? '',
      failure.failureCode,
      failure.message ?? '',
    ].join('\0')
    if (seen.has(key))
      continue
    seen.add(key)
    unique.push(failure)
  }
  return unique
}

function sortByArtifactOrder(
  leftArtifactId: string,
  rightArtifactId: string,
  artifactById: Map<string, LoadedArtifact>,
): number {
  const ids = [...artifactById.keys()]
  return ids.indexOf(leftArtifactId) - ids.indexOf(rightArtifactId)
}

function renderHtmlReport(report: VisualTraceReport): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CareerDeepSeek Visual Trace Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1f2933; background: #f7f8fa; }
    h1, h2 { margin: 0 0 12px; }
    section { margin: 0 0 24px; padding: 16px; background: #fff; border: 1px solid #d8dee4; border-radius: 6px; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { border: 1px solid #d8dee4; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #eef2f6; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f4f6f8; padding: 10px; border-radius: 4px; }
    img { max-width: 560px; max-height: 420px; border: 1px solid #d8dee4; background: #fff; }
    .sequence { display: flex; flex-wrap: wrap; gap: 6px; }
    .pill { border: 1px solid #b8c2cc; border-radius: 4px; padding: 4px 6px; background: #f4f6f8; }
  </style>
</head>
<body>
  <h1>CareerDeepSeek Visual Trace Report</h1>
  ${renderSummarySection(report)}
  ${renderCommandSection(report)}
  ${renderScreenshotSection(report)}
  ${renderCandidateSection(report)}
  ${renderActionSection(report)}
  ${renderFailureSection(report)}
  ${renderKnownLimitsSection(report)}
  ${renderMissingSection(report)}
  ${renderArtifactSection(report)}
</body>
</html>
`
}

function renderSummarySection(report: VisualTraceReport): string {
  return `<section>
  <h2>Summary</h2>
  <pre>${escapeHtml(JSON.stringify(report.summary, null, 2))}</pre>
</section>`
}

function renderCommandSection(report: VisualTraceReport): string {
  return `<section>
  <h2>Command Sequence</h2>
  <div class="sequence">${report.commandSequence.map(command => `<span class="pill">${escapeHtml(command)}</span>`).join('')}</div>
</section>`
}

function renderScreenshotSection(report: VisualTraceReport): string {
  const rows = report.screenshots.map(screenshot => `<tr>
    <td>${escapeHtml(screenshot.artifactId)}</td>
    <td><code>${escapeHtml(screenshot.path)}</code></td>
    <td>${escapeHtml([screenshot.width, screenshot.height].filter(Boolean).join(' x '))}</td>
  </tr>`).join('')
  const images = report.screenshots.map(screenshot => `<figure>
    <img src="${escapeHtml(pathToFileURL(screenshot.path).href)}" alt="${escapeHtml(screenshot.artifactId)}">
    <figcaption><code>${escapeHtml(screenshot.path)}</code></figcaption>
  </figure>`).join('')
  return `<section>
  <h2>Screenshots</h2>
  ${images}
  <table><thead><tr><th>Artifact</th><th>Path</th><th>Size</th></tr></thead><tbody>${rows}</tbody></table>
</section>`
}

function renderCandidateSection(report: VisualTraceReport): string {
  const rows = report.candidateBoxes.map(candidate => `<tr>
    <td>${escapeHtml(candidate.artifactId)}</td>
    <td>${escapeHtml(candidate.candidateLocalId ?? '')}</td>
    <td>${escapeHtml(candidate.label ?? '')}</td>
    <td>${escapeHtml(candidate.grounding ?? '')}</td>
    <td><pre>${escapeHtml(JSON.stringify(candidate.bounds, null, 2))}</pre></td>
    <td><code>${escapeHtml(candidate.screenshotPath ?? '')}</code></td>
  </tr>`).join('')
  return `<section>
  <h2>Candidate Bounds</h2>
  <table><thead><tr><th>Artifact</th><th>Candidate</th><th>Label</th><th>Grounding</th><th>Bounds</th><th>Screenshot</th></tr></thead><tbody>${rows}</tbody></table>
</section>`
}

function renderActionSection(report: VisualTraceReport): string {
  const rows = report.actions.map(action => `<tr>
    <td>${escapeHtml(action.artifactId)}</td>
    <td>${escapeHtml(action.actionType ?? '')}</td>
    <td>${escapeHtml(action.grounding ?? '')}</td>
    <td>${escapeHtml(String(action.executed))}</td>
    <td>${escapeHtml(String(action.refused))}</td>
    <td><pre>${escapeHtml(JSON.stringify(action.clickPoint ?? null, null, 2))}</pre></td>
    <td><pre>${escapeHtml(JSON.stringify(action.livenessFreshBox ?? null, null, 2))}</pre></td>
    <td>${escapeHtml(action.refusalReasons.join(', '))}</td>
  </tr>`).join('')
  return `<section>
  <h2>Actions</h2>
  <table><thead><tr><th>Artifact</th><th>Type</th><th>Grounding</th><th>Executed</th><th>Refused</th><th>Click Point</th><th>Fresh Box</th><th>Refusal Reasons</th></tr></thead><tbody>${rows}</tbody></table>
</section>`
}

function renderFailureSection(report: VisualTraceReport): string {
  const rows = report.failures.map(failure => `<tr>
    <td>${escapeHtml(failure.source)}</td>
    <td>${escapeHtml(failure.commandId ?? '')}</td>
    <td>${escapeHtml(failure.failureClass ?? '')}</td>
    <td>${escapeHtml(failure.failureCode)}</td>
    <td>${escapeHtml(failure.message ?? '')}</td>
  </tr>`).join('')
  return `<section>
  <h2>Failures</h2>
  <table><thead><tr><th>Source</th><th>Command</th><th>Class</th><th>Code</th><th>Message</th></tr></thead><tbody>${rows}</tbody></table>
</section>`
}

function renderKnownLimitsSection(report: VisualTraceReport): string {
  return `<section>
  <h2>Known Limits</h2>
  <ul>${report.knownLimits.map(limit => `<li>${escapeHtml(limit)}</li>`).join('')}</ul>
</section>`
}

function renderMissingSection(report: VisualTraceReport): string {
  return `<section>
  <h2>Missing Files And Artifact Refs</h2>
  <h3>Files</h3>
  <pre>${escapeHtml(JSON.stringify(report.missingFiles, null, 2))}</pre>
  <h3>Artifact Refs</h3>
  <pre>${escapeHtml(JSON.stringify(report.missingArtifactRefs, null, 2))}</pre>
  <h3>Parse Errors</h3>
  <pre>${escapeHtml(JSON.stringify(report.parseErrors, null, 2))}</pre>
</section>`
}

function renderArtifactSection(report: VisualTraceReport): string {
  const rows = report.artifacts.map(artifact => `<tr>
    <td>${escapeHtml(artifact.artifactId)}</td>
    <td>${escapeHtml(artifact.role)}</td>
    <td>${escapeHtml(artifact.mimeType)}</td>
    <td><code>${escapeHtml(artifact.path)}</code></td>
    <td>${escapeHtml(String(artifact.exists))}</td>
  </tr>`).join('')
  return `<section>
  <h2>Artifacts</h2>
  <table><thead><tr><th>Artifact</th><th>Role</th><th>MIME</th><th>Path</th><th>Exists</th></tr></thead><tbody>${rows}</tbody></table>
</section>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

function errorMessage(error: unknown): string {
  if (error instanceof Error)
    return error.message
  if (typeof error === 'string')
    return error
  return 'unknown error'
}
