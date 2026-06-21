import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectTraceRun, listTraceRuns } from '../../src/computer-use/macos-chrome-driver/inspect-report.js'

describe('trace inspection report', () => {
  it('lists available runs from trace directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'cds-inspect-list-'))
    const traceDir = join(root, 'traces', 'session-a')
    mkdirSync(traceDir, { recursive: true })
    writeJson(join(traceDir, 'run.json'), {
      api_version: 'careerdeepseek.run.v1alpha1',
      run_id: 'run_session_a_1',
      trace_id: 'run_session_a_1',
      run_type: 'execute',
      state: 'ended',
      status_code: 'ok',
      started_at_millis: 1000,
      finished_at_millis: 2000,
      root_span_id: 'session',
      attributes: { intent: 'test' },
      summary: 'completed test run',
    })

    const report = listTraceRuns(root)

    expect(report).toContain('Available Runs')
    expect(report).toContain('run_session_a_1')
    expect(report).toContain('status=ok')
    expect(report).toContain('completed test run')
    expect(report).toContain(traceDir)
  })

  it('prints a human-readable run report with commands, failures, artifact roles, and missing files', () => {
    const root = mkdtempSync(join(tmpdir(), 'cds-inspect-run-'))
    const traceDir = join(root, 'traces', 'session-b')
    mkdirSync(join(traceDir, 'artifacts'), { recursive: true })
    writeJson(join(traceDir, 'run.json'), {
      api_version: 'careerdeepseek.run.v1alpha1',
      run_id: 'run_session_b_1',
      trace_id: 'run_session_b_1',
      run_type: 'execute',
      state: 'ended',
      status_code: 'error',
      started_at_millis: 1000,
      finished_at_millis: 2500,
      root_span_id: 'session',
      attributes: { intent: 'test' },
      summary: 'failed test run',
    })
    writeJsonl(join(traceDir, 'spans.jsonl'), [
      {
        api_version: 'careerdeepseek.span.v1alpha1',
        span_id: 'invoke_1',
        parent_span_id: 'session',
        name: 'computer_use.invoke',
        state: 'ended',
        status_code: 'error',
        started_at_millis: 1100,
        finished_at_millis: 1200,
        attributes: {},
        summary: 'waitForText failed',
      },
    ])
    writeJsonl(join(traceDir, 'events.jsonl'), [
      {
        api_version: 'careerdeepseek.event.v1alpha1',
        event_id: 'invoke_1.1.command_resolution_completed',
        span_id: 'invoke_1',
        name: 'command_resolution_completed',
        timestamp_millis: 1110,
        attributes: { command_id: 'chrome.waitForText', operation: 'waitForText' },
        artifact_ids: [],
      },
      {
        api_version: 'careerdeepseek.event.v1alpha1',
        event_id: 'invoke_1.2.handler_invocation_failed',
        span_id: 'invoke_1',
        name: 'handler_invocation_failed',
        timestamp_millis: 1190,
        attributes: {
          command_id: 'chrome.waitForText',
          status: 'failed',
          failure_class: 'recognition',
          failure_code: 'ocr_failed',
          failure_message: 'Vision OCR crashed.',
          known_limits: ['event level known limit'],
        },
        artifact_ids: [],
      },
      {
        api_version: 'careerdeepseek.event.v1alpha1',
        event_id: 'invoke_2.1.command_resolution_failed',
        span_id: 'invoke_2',
        name: 'command_resolution_failed',
        timestamp_millis: 1210,
        attributes: {
          command_id: 'chrome.unknown',
          failure_class: 'command_resolution',
          failure_code: 'unknown_command',
          failure_message: 'Unknown computer-use command: chrome.unknown',
        },
        artifact_ids: [],
      },
      {
        api_version: 'careerdeepseek.event.v1alpha1',
        event_id: 'invoke_3.1.handler_invocation_exception',
        span_id: 'invoke_3',
        name: 'handler_invocation_exception',
        timestamp_millis: 1220,
        attributes: {
          command_id: 'chrome.findText',
          failure_class: 'runtime_unknown',
          failure_code: 'unhandled_handler_exception',
          message: 'Legacy exception message key.',
        },
        artifact_ids: [],
      },
    ])
    writeJsonl(join(traceDir, 'artifacts.jsonl'), [
      {
        api_version: 'careerdeepseek.artifact.v1alpha1',
        artifact_id: 'ocr_text_1',
        span_id: 'atomic_1',
        role: 'ocr-text',
        mime_type: 'application/json',
        path: 'artifacts/ocr_text_1.json',
        attributes: {},
      },
      {
        api_version: 'careerdeepseek.artifact.v1alpha1',
        artifact_id: 'action_1',
        span_id: 'atomic_1',
        role: 'action-result',
        mime_type: 'application/json',
        path: 'artifacts/action_1.json',
        attributes: {},
      },
      {
        api_version: 'careerdeepseek.artifact.v1alpha1',
        artifact_id: 'ax_action_1',
        span_id: 'atomic_2',
        role: 'ax-action',
        mime_type: 'application/json',
        path: 'artifacts/ax_action_1.json',
        attributes: {},
      },
    ])
    writeJson(join(traceDir, 'artifacts', 'ocr_text_1.json'), { matches: [] })
    writeJson(join(traceDir, 'artifacts', 'ax_action_1.json'), { action: 'press', role: 'AXButton', text: 'Submit' })

    const report = inspectTraceRun(root, 'run_session_b_1')

    expect(report).toContain('Run: run_session_b_1')
    expect(report).toContain('Status: error')
    expect(report).toContain('chrome.waitForText')
    expect(report).toContain('command_resolution_failed')
    expect(report).toContain('chrome.unknown')
    expect(report).toContain('handler_invocation_exception')
    expect(report).toContain('failure=recognition/ocr_failed')
    expect(report).toContain('message=Vision OCR crashed.')
    expect(report).toContain('message=Legacy exception message key.')
    expect(report).toContain('ocr-text: 1')
    expect(report).toContain('action-result: 1')
    expect(report).toContain('ax-action: 1')
    expect(report).toContain('event level known limit')
    expect(report).toContain('Artifacts:')
    expect(report).toContain('ocr_text_1 role=ocr-text path=artifacts/ocr_text_1.json')
    expect(report).toContain('action_1 role=action-result path=artifacts/action_1.json')
    expect(report).toContain('ax_action_1 ax_action=press role=AXButton text=Submit')
    expect(report).toContain('Missing Artifact Files')
    expect(report).toContain('action_1')
  })
})

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeJsonl(path: string, records: unknown[]): void {
  writeFileSync(path, `${records.map(record => JSON.stringify(record)).join('\n')}\n`)
}
