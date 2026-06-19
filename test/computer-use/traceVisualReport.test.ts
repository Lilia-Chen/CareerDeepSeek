import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateVisualTraceReport } from '../../src/computer-use/macos-chrome-driver/trace-visual-report.js'

describe('static visual trace report generator', () => {
  it('generates JSON and HTML reports for a complete click trace without mutating artifacts.jsonl', () => {
    const traceDir = createCompleteTrace()
    const artifactsBefore = readFileSync(join(traceDir, 'artifacts.jsonl'), 'utf-8')

    const result = generateVisualTraceReport({ traceDir })

    assert.equal(existsSync(result.jsonPath), true)
    assert.equal(existsSync(result.htmlPath), true)
    assert.equal(result.summary.visual_report, result.htmlPath)
    assert.equal(result.summary.missing_artifact_ref_count, 0)
    assert.equal(readFileSync(join(traceDir, 'artifacts.jsonl'), 'utf-8'), artifactsBefore)

    const report = JSON.parse(readFileSync(result.jsonPath, 'utf-8')) as VisualTraceReportFixture
    assert.deepEqual(report.commandSequence, ['chrome.observe', 'chrome.recognize', 'chrome.promote', 'chrome.clickCandidate', 'chrome.observe'])
    assert.deepEqual(
      report.artifacts.map(artifact => artifact.role),
      ['screenshot', 'observation-snapshot', 'recognition-result', 'promoted-candidate', 'action-execution'],
    )
    assert.equal(report.screenshots[0]?.path, join(traceDir, 'screenshots', 'observe.png'))
    assert.deepEqual(report.candidateBoxes[0]?.bounds, { x: 100, y: 120, width: 80, height: 30 })
    assert.equal(report.candidateBoxes[0]?.grounding, 'ocr_anchor')
    assert.deepEqual(report.actions[0]?.clickPoint, { x: 155, y: 140, source: 'fresh_box_center' })
    assert.deepEqual(report.actions[0]?.livenessFreshBox, { x: 115, y: 125, width: 80, height: 30 })
    assert.equal(report.actions[0]?.grounding, 'ocr_anchor')
    assert.equal(report.failures.some(failure => failure.failureClass === 'action_delivery' && failure.failureCode === 'action_execution_error'), true)
    assert.equal(report.knownLimits.includes('action failed after passing precondition gate'), true)
    assert.deepEqual(report.missingArtifactRefs, [])

    const html = readFileSync(result.htmlPath, 'utf-8')
    assert.match(html, /chrome\.clickCandidate/)
    assert.match(html, /file:\/\//)
    assert.match(html, /action_execution_error/)
    assert.match(html, /fresh_box_center/)
  })

  it('records missing artifact refs without throwing when JSONL files are absent or incomplete', () => {
    const traceDir = createTraceRoot()
    writeJson(join(traceDir, 'run.json'), fakeRunRecord())
    writeJsonl(join(traceDir, 'events.jsonl'), [
      fakeEvent('event_1', 'invoke_failed', {
        command_id: 'chrome.clickCandidate',
        failure_class: 'candidate_provenance',
        failure_code: 'missing_promoted_candidate_artifact',
      }, ['action_missing']),
    ])
    writeJson(join(traceDir, 'artifacts', 'action.json'), {
      action_id: 'action_1',
      action_type: 'click',
      run_id: 'run_1',
      span_id: 'action_1_click',
      candidate_ref: { run_id: 'run_1', artifact_id: 'promoted_missing', span_id: 'session' },
      precondition_result: {
        passed: false,
        checks: { profile_verified: true, chrome_foreground: true, no_hard_stop_signal: true },
        failures: [{ code: 'missing_promoted_candidate_artifact', detail: 'missing candidate', observed: null }],
      },
      executed: false,
      refused: true,
      refusal_reasons: ['missing_promoted_candidate_artifact'],
      liveness_recheck: null,
      timestamp_millis: 3,
      known_limits: ['action refused before macOS event delivery'],
    })
    writeJsonl(join(traceDir, 'artifacts.jsonl'), [
      fakeArtifact('action_missing', 'action-execution', join(traceDir, 'artifacts', 'action.json'), 'action_1_click'),
    ])

    const outputDir = join(traceDir, 'qa-output')
    const result = generateVisualTraceReport({ traceDir, outputDir })

    assert.equal(result.jsonPath, join(outputDir, 'visual-trace-report.json'))
    assert.equal(result.htmlPath, join(outputDir, 'visual-trace-report.html'))

    const report = JSON.parse(readFileSync(result.jsonPath, 'utf-8')) as VisualTraceReportFixture
    assert.equal(report.missingFiles.includes(join(traceDir, 'spans.jsonl')), true)
    assert.equal(report.missingArtifactRefs.some(ref => ref.artifact_id === 'promoted_missing'), true)
    assert.equal(report.missingArtifactRefs.some(ref => ref.artifact_id === 'action_missing'), false)
    assert.equal(report.failures.some(failure => failure.failureCode === 'missing_promoted_candidate_artifact'), true)
  })

  it('resolves relative artifact paths from the trace directory', () => {
    const traceDir = createTraceRoot()
    writeJson(join(traceDir, 'run.json'), fakeRunRecord())
    writeJsonl(join(traceDir, 'spans.jsonl'), [fakeSpan('observe_mco_1', 'observe')])
    writeJsonl(join(traceDir, 'events.jsonl'), [])
    writeFileSync(join(traceDir, 'artifacts', 'observe.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
    writeJsonl(join(traceDir, 'artifacts.jsonl'), [
      fakeArtifact('screenshot_mco_1', 'screenshot', 'artifacts/observe.png', 'observe_mco_1', 'image/png'),
    ])

    const result = generateVisualTraceReport({ traceDir })
    const report = JSON.parse(readFileSync(result.jsonPath, 'utf-8')) as VisualTraceReportFixture

    assert.equal(result.summary.missing_file_count, 0)
    assert.equal(report.artifacts[0]?.path, join(traceDir, 'artifacts', 'observe.png'))
    assert.equal(report.screenshots[0]?.path, join(traceDir, 'artifacts', 'observe.png'))
  })

  it('builds command sequence from final invoke resolution events only', () => {
    const traceDir = createTraceRoot()
    writeJson(join(traceDir, 'run.json'), fakeRunRecord())
    writeJsonl(join(traceDir, 'events.jsonl'), [
      fakeEvent('event_1', 'command_resolution_started', { command_id: 'chrome.observe' }),
      fakeEvent('event_2', 'command_resolution_completed', { command_id: 'chrome.observe' }),
      fakeEvent('event_3', 'handler_invocation_started', { command_id: 'chrome.observe' }),
      fakeEvent('event_4', 'handler_invocation_completed', { command_id: 'chrome.observe', status: 'completed' }),
      fakeEvent('event_5', 'command_resolution_started', { command_id: 'chrome.observe' }),
      fakeEvent('event_6', 'command_resolution_completed', { command_id: 'chrome.observe' }),
      fakeEvent('event_7', 'handler_invocation_started', { command_id: 'chrome.observe' }),
      fakeEvent('event_8', 'handler_invocation_completed', { command_id: 'chrome.observe', status: 'completed' }),
      fakeEvent('event_9', 'command_resolution_started', { command_id: 'chrome.clickCandidate' }),
      fakeEvent('event_10', 'handler_invocation_failed', {
        command_id: 'chrome.clickCandidate',
        status: 'failed',
        failure_class: 'safety_gate',
        failure_code: 'anchor_recheck_moved',
      }),
      fakeEvent('event_11', 'dry_run_completed', { command_id: 'chrome.pressKey', status: 'completed' }),
      fakeEvent('event_12', 'command_resolution_failed', {
        command_id: 'chrome.unknown',
        failure_class: 'command_resolution',
        failure_code: 'unknown_command',
      }),
      fakeEvent('event_13', 'handler_invocation_exception', {
        command_id: 'chrome.checkSafetyGate',
        failure_class: 'runtime_unknown',
        failure_code: 'unhandled_handler_exception',
        message: 'handler exploded',
      }),
    ])

    const result = generateVisualTraceReport({ traceDir })
    const report = JSON.parse(readFileSync(result.jsonPath, 'utf-8')) as VisualTraceReportFixture

    assert.deepEqual(report.commandSequence, [
      'chrome.observe',
      'chrome.observe',
      'chrome.clickCandidate',
      'chrome.pressKey',
      'chrome.unknown',
      'chrome.checkSafetyGate',
    ])
  })

  it('throws only when the trace root does not exist', () => {
    const traceDir = join(tmpdir(), `cds-trace-missing-${Date.now()}`)

    assert.throws(
      () => generateVisualTraceReport({ traceDir }),
      /Trace root does not exist/,
    )
  })
})

interface VisualTraceReportFixture {
  commandSequence: string[]
  artifacts: Array<{ artifactId: string, role: string, path: string }>
  screenshots: Array<{ artifactId: string, path: string }>
  candidateBoxes: Array<{ artifactId: string, candidateLocalId?: string, grounding?: string, bounds: Record<string, number> }>
  actions: Array<{
    artifactId: string
    grounding?: string
    clickPoint?: { x: number, y: number, source: string }
    livenessFreshBox?: Record<string, number>
  }>
  failures: Array<{ failureClass?: string, failureCode: string }>
  knownLimits: string[]
  missingFiles: string[]
  missingArtifactRefs: Array<{ run_id: string, artifact_id: string, span_id: string }>
}

function createCompleteTrace(): string {
  const traceDir = createTraceRoot()
  const screenshotPath = join(traceDir, 'screenshots', 'observe.png')
  writeFileSync(screenshotPath, Buffer.from('89504e470d0a1a0a', 'hex'))

  writeJson(join(traceDir, 'run.json'), fakeRunRecord())
  writeJsonl(join(traceDir, 'spans.jsonl'), [
    fakeSpan('invoke_observe', 'computer_use.invoke'),
    fakeSpan('invoke_click', 'computer_use.invoke'),
  ])
  writeJsonl(join(traceDir, 'events.jsonl'), [
    fakeEvent('event_1', 'handler_invocation_completed', { command_id: 'chrome.observe', status: 'completed' }),
    fakeEvent('event_2', 'handler_invocation_completed', { command_id: 'chrome.recognize', status: 'completed' }),
    fakeEvent('event_3', 'handler_invocation_completed', { command_id: 'chrome.promote', status: 'completed' }),
    fakeEvent('event_4', 'handler_invocation_failed', {
      command_id: 'chrome.clickCandidate',
      failure_class: 'action_delivery',
      failure_code: 'action_execution_error',
    }, ['action_execution_action_1']),
    fakeEvent('event_5', 'handler_invocation_completed', { command_id: 'chrome.observe', status: 'completed' }),
  ])

  const observationPath = join(traceDir, 'artifacts', 'observation.json')
  const recognitionPath = join(traceDir, 'artifacts', 'recognition.json')
  const candidatePath = join(traceDir, 'artifacts', 'candidate.json')
  const actionPath = join(traceDir, 'artifacts', 'action.json')
  writeJson(observationPath, fakeObservation('screenshot_mco_1'))
  writeJson(recognitionPath, fakeRecognition())
  writeJson(candidatePath, fakeCandidate())
  writeJson(actionPath, fakeActionExecution())
  writeJsonl(join(traceDir, 'artifacts.jsonl'), [
    fakeArtifact('screenshot_mco_1', 'screenshot', screenshotPath, 'observe_mco_1', 'image/png'),
    fakeArtifact('observation_mco_1', 'observation-snapshot', observationPath, 'observe_mco_1'),
    fakeArtifact('recognition_rec_1', 'recognition-result', recognitionPath, 'recognize_1'),
    fakeArtifact('promoted_rec_1', 'promoted-candidate', candidatePath, 'session'),
    fakeArtifact('action_execution_action_1', 'action-execution', actionPath, 'action_1_click'),
  ])
  return traceDir
}

function createTraceRoot(): string {
  const traceDir = mkdtempSync(join(tmpdir(), 'cds-trace-visual-'))
  mkdirSync(join(traceDir, 'screenshots'), { recursive: true })
  mkdirSync(join(traceDir, 'artifacts'), { recursive: true })
  return traceDir
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeJsonl(path: string, values: unknown[]): void {
  writeFileSync(path, `${values.map(value => JSON.stringify(value)).join('\n')}\n`)
}

function fakeRunRecord(): Record<string, unknown> {
  return {
    api_version: 'careerdeepseek.run.v1alpha1',
    run_id: 'run_1',
    trace_id: 'run_1',
    run_type: 'execute',
    state: 'ended',
    status_code: 'error',
    started_at_millis: 1,
    finished_at_millis: 4,
    root_span_id: 'session',
    attributes: {},
  }
}

function fakeSpan(spanId: string, name: string): Record<string, unknown> {
  return {
    api_version: 'careerdeepseek.span.v1alpha1',
    span_id: spanId,
    name,
    state: 'ended',
    status_code: 'ok',
    started_at_millis: 1,
    finished_at_millis: 2,
    attributes: {},
  }
}

function fakeEvent(
  eventId: string,
  name: string,
  attributes: Record<string, unknown>,
  artifactIds: string[] = [],
): Record<string, unknown> {
  const eventOrdinal = Number.parseInt(eventId.replace(/\D/g, ''), 10)
  return {
    api_version: 'careerdeepseek.event.v1alpha1',
    event_id: eventId,
    span_id: 'invoke_span',
    name,
    timestamp_millis: Number.isFinite(eventOrdinal) ? eventOrdinal : 2,
    attributes,
    artifact_ids: artifactIds,
  }
}

function fakeArtifact(
  artifactId: string,
  role: string,
  path: string,
  spanId: string,
  mimeType = 'application/json',
): Record<string, unknown> {
  return {
    api_version: 'careerdeepseek.artifact.v1alpha1',
    artifact_id: artifactId,
    span_id: spanId,
    role,
    mime_type: mimeType,
    path,
    attributes: {},
  }
}

function fakeObservation(screenshotArtifactId: string): Record<string, unknown> {
  return {
    api_version: 'careerdeepseek.observation_snapshot.v1alpha1',
    snapshot_id: 'mco_1',
    run_id: 'run_1',
    span_id: 'observe_mco_1',
    captured_at_millis: 1,
    source: 'ocr',
    scope: {
      surface: 'window',
      capture_artifact: { run_id: 'run_1', artifact_id: screenshotArtifactId, span_id: 'observe_mco_1' },
    },
    evidence: [{ run_id: 'run_1', artifact_id: screenshotArtifactId, span_id: 'observe_mco_1' }],
    nodes: [],
    detail: {},
    known_limits: ['managed Chrome context lease established'],
  }
}

function fakeRecognition(): Record<string, unknown> {
  return {
    found: true,
    recognition_id: 'rec_1',
    source: 'ocr_text',
    scope: {
      surface: 'window',
      capture_artifact: { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'observe_mco_1' },
    },
    best: { item_id: 'item_1', kind: 'ocr_text', text: 'Accept', box: { x: 100, y: 120, width: 80, height: 30 }, detail: {} },
    filtered: [],
    all: [],
    detail: {},
    evidence: [{ run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'observe_mco_1' }],
    known_limits: ['read_only_recognition_only'],
  }
}

function fakeCandidate(): Record<string, unknown> {
  return {
    candidate_local_id: 'candidate_1',
    kind: 'ocr_text',
    label: 'Accept',
    target_spec: {
      grounding: 'ocr_anchor',
      box: { x: 100, y: 120, width: 80, height: 30 },
      anchor_text: 'Accept',
    },
    evidence: {
      capture_artifact: { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'observe_mco_1' },
      recognition_artifact: { run_id: 'run_1', artifact_id: 'recognition_rec_1', span_id: 'recognize_1' },
      observation_blob: {},
    },
    liveness: { preconditions: { window_ref: { app_bundle_id: 'com.google.Chrome', window_number: 42 } } },
    control: { requires_app_frontmost: true, requires_window_focus: true },
    source_run_id: 'run_1',
    source_span_id: 'session',
    source_operation_id: 'rec_1',
    source_artifact_id: 'promoted_rec_1',
    known_limits: ['same_session_candidate_only'],
  }
}

function fakeActionExecution(): Record<string, unknown> {
  return {
    action_id: 'action_1',
    action_type: 'click',
    run_id: 'run_1',
    span_id: 'action_1_click',
    candidate_ref: { run_id: 'run_1', artifact_id: 'promoted_rec_1', span_id: 'session' },
    precondition_result: {
      passed: true,
      checks: { profile_verified: true, chrome_foreground: true, no_hard_stop_signal: true },
      failures: [{ code: 'action_execution_error', detail: 'click failed', observed: 'click failed' }],
    },
    executed: false,
    refused: true,
    refusal_reasons: ['action_execution_error'],
    liveness_recheck: {
      status: 'passed',
      grounding: 'ocr_anchor',
      original_candidate_ref: { run_id: 'run_1', artifact_id: 'promoted_rec_1', span_id: 'session' },
      original_box: { x: 100, y: 120, width: 80, height: 30 },
      fresh_capture_ref: { run_id: 'run_1', artifact_id: 'screenshot_mco_1', span_id: 'observe_mco_2' },
      fresh_box: { x: 115, y: 125, width: 80, height: 30 },
      known_limits: [],
    },
    timestamp_millis: 3,
    known_limits: ['action failed after passing precondition gate'],
  }
}
