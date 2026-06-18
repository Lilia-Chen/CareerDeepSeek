import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  buildComputerUseQaReport,
  validateComputerUseQaReport,
} from '../../src/computer-use/macos-chrome-driver/invoke-qa-report.js'
import type { ArtifactRef } from '../../src/computer-use/macos-chrome-driver/types.js'
import type {
  ComputerUseFailureClass,
  ComputerUseInvokeResult,
} from '../../src/computer-use/macos-chrome-driver/invoke-types.js'

describe('invoke QA report contract', () => {
  it('builds a primitive-first completed report from command results while preserving command order', () => {
    const observationArtifact = artifactRef('observation_mco_1')
    const actionArtifact = artifactRef('action_execution_action_1')

    const report = buildComputerUseQaReport({
      caseId: 'primitive-click-candidate-delivery',
      traceRoot: '/tmp/cds-trace/run_1',
      commandResults: [
        completedResult('chrome.observe', [observationArtifact], ['read_only_observation_only']),
        completedResult('chrome.recognize'),
        completedResult('chrome.promote'),
        completedResult('chrome.clickCandidate', [actionArtifact], ['same_session_candidate_only']),
        completedResult('chrome.observe', [observationArtifact]),
      ],
      visualReportPath: '/tmp/cds-trace/run_1/visual-trace-report.html',
      knownLimits: ['qa case uses synthetic command results'],
    })

    assert.deepEqual(report, {
      case_id: 'primitive-click-candidate-delivery',
      command_sequence: [
        'chrome.observe',
        'chrome.recognize',
        'chrome.promote',
        'chrome.clickCandidate',
        'chrome.observe',
      ],
      trace_root: '/tmp/cds-trace/run_1',
      artifact_refs: [observationArtifact, actionArtifact],
      visual_report: '/tmp/cds-trace/run_1/visual-trace-report.html',
      status: 'completed',
      failure_class: null,
      failure_code: null,
      known_limits: [
        'read_only_observation_only',
        'same_session_candidate_only',
        'qa case uses synthetic command results',
      ],
    })
  })

  it('requires an explicit visual report absence reason when no visual report path exists', () => {
    const report = buildComputerUseQaReport({
      caseId: 'primitive-scroll-visible-change',
      traceRoot: 'run_2',
      commandResults: [
        completedResult('chrome.observe'),
        completedResult('chrome.scroll'),
        completedResult('chrome.observe'),
      ],
      visualReportAbsentReason: 'trace root is retained by external QA runner',
    })

    assert.equal(report.visual_report, null)
    assert.equal(report.visual_report_absent_reason, 'trace root is retained by external QA runner')
  })

  it('records stable failure class and code from the first failed primitive result', () => {
    const report = buildComputerUseQaReport({
      caseId: 'primitive-promote-candidate',
      traceRoot: '/tmp/cds-trace/run_3',
      commandResults: [
        completedResult('chrome.observe'),
        failedResult('chrome.promote', 'candidate_provenance', 'candidate_not_in_session'),
      ],
      visualReportPath: '/tmp/cds-trace/run_3/visual-trace-report.html',
    })

    assert.equal(report.status, 'failed')
    assert.equal(report.failure_class, 'candidate_provenance')
    assert.equal(report.failure_code, 'candidate_not_in_session')
  })

  it('rejects completed status override when command results contain a failed primitive', () => {
    assert.throws(
      () => buildComputerUseQaReport({
        caseId: 'primitive-promote-candidate',
        traceRoot: '/tmp/cds-trace/run_3',
        commandResults: [
          completedResult('chrome.observe'),
          failedResult('chrome.promote', 'candidate_provenance', 'candidate_not_in_session'),
        ],
        visualReportPath: '/tmp/cds-trace/run_3/visual-trace-report.html',
        status: 'completed',
      }),
      /cannot override non-completed command result status/,
    )
  })

  it('rejects empty command results and empty command sequence', () => {
    assert.throws(
      () => buildComputerUseQaReport({
        caseId: 'primitive-observe',
        traceRoot: 'run_7',
        commandResults: [],
        visualReportPath: '/tmp/cds-trace/run_7/visual-trace-report.html',
      }),
      /commandResults must contain at least one result/,
    )

    assert.throws(
      () => validateComputerUseQaReport({
        case_id: 'primitive-observe',
        command_sequence: [],
        trace_root: 'run_7',
        artifact_refs: [],
        visual_report: '/tmp/cds-trace/run_7/visual-trace-report.html',
        status: 'completed',
        failure_class: null,
        failure_code: null,
        known_limits: [],
      }),
      /command_sequence must contain at least one command/,
    )
  })

  it('rejects visual report path with visual report absence reason', () => {
    assert.throws(
      () => validateComputerUseQaReport({
        case_id: 'primitive-observe',
        command_sequence: ['chrome.observe'],
        trace_root: 'run_8',
        artifact_refs: [],
        visual_report: '/tmp/cds-trace/run_8/visual-trace-report.html',
        visual_report_absent_reason: 'report generation was skipped',
        status: 'completed',
        failure_class: null,
        failure_code: null,
        known_limits: [],
      }),
      /visual_report_absent_reason must not be set when visual_report is present/,
    )
  })

  it('rejects non-completed reports without stable failure class and code', () => {
    assert.throws(
      () => validateComputerUseQaReport({
        case_id: 'primitive-hard-stop-detection',
        command_sequence: ['chrome.observe', 'chrome.clickCandidate'],
        trace_root: 'run_4',
        artifact_refs: [],
        visual_report: '/tmp/cds-trace/run_4/visual-trace-report.html',
        status: 'refused',
        failure_class: null,
        failure_code: null,
        known_limits: [],
      }),
      /failure_class and failure_code are required/,
    )
  })

  it('rejects completed reports with failure class or failure code', () => {
    assert.throws(
      () => validateComputerUseQaReport({
        case_id: 'primitive-observe',
        command_sequence: ['chrome.observe'],
        trace_root: 'run_5',
        artifact_refs: [],
        visual_report: '/tmp/cds-trace/run_5/visual-trace-report.html',
        status: 'completed',
        failure_class: 'runtime_unknown',
        failure_code: 'should_not_exist',
        known_limits: [],
      }),
      /completed QA reports must not include failure_class or failure_code/,
    )
  })

  it('rejects reports without visual report path or absence reason', () => {
    assert.throws(
      () => validateComputerUseQaReport({
        case_id: 'primitive-observe',
        command_sequence: ['chrome.observe'],
        trace_root: 'run_6',
        artifact_refs: [],
        visual_report: null,
        status: 'completed',
        failure_class: null,
        failure_code: null,
        known_limits: [],
      }),
      /visual_report_absent_reason is required/,
    )
  })
})

function completedResult(
  commandId: string,
  artifacts: ArtifactRef[] = [],
  knownLimits: string[] = [],
): ComputerUseInvokeResult {
  return {
    commandId,
    status: 'completed',
    summary: `${commandId} completed`,
    signals: [],
    artifacts,
    knownLimits,
  }
}

function failedResult(
  commandId: string,
  failureClass: ComputerUseFailureClass,
  failureCode: string,
): ComputerUseInvokeResult {
  return {
    commandId,
    status: 'failed',
    summary: `${commandId} failed`,
    signals: [],
    artifacts: [],
    failure: {
      class: failureClass,
      code: failureCode,
      message: `${commandId} failure`,
    },
    knownLimits: [],
  }
}

function artifactRef(artifactId: string): ArtifactRef {
  return {
    run_id: 'run_1',
    span_id: 'span_1',
    artifact_id: artifactId,
  }
}
