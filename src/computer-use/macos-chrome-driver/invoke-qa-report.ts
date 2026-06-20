import type {
  ComputerUseFailureClass,
  ComputerUseInvokeResult,
  ComputerUseInvokeStatus,
} from './invoke-types.js'
import type { ArtifactRef } from './types.js'
import { uniqueArtifactRefs, uniqueStrings } from './shared.js'

export interface ComputerUseQaReport {
  case_id: string
  command_sequence: string[]
  trace_root: string
  artifact_refs: ArtifactRef[]
  visual_report: string | null
  visual_report_absent_reason?: string
  status: ComputerUseInvokeStatus
  failure_class: ComputerUseFailureClass | null
  failure_code: string | null
  known_limits: string[]
}

export interface BuildComputerUseQaReportInput {
  caseId: string
  traceRoot: string
  commandResults: readonly ComputerUseInvokeResult[]
  visualReportPath?: string | null
  visualReportAbsentReason?: string
  status?: ComputerUseInvokeStatus
  failureClass?: ComputerUseFailureClass | null
  failureCode?: string | null
  knownLimits?: readonly string[]
}

export function buildComputerUseQaReport(input: BuildComputerUseQaReportInput): ComputerUseQaReport {
  if (input.commandResults.length === 0)
    throw new Error('commandResults must contain at least one result')

  const firstNonCompletedResult = input.commandResults.find(result => result.status !== 'completed')
  const firstFailure = input.commandResults.find(result => result.failure)?.failure
  if (firstNonCompletedResult && input.status === 'completed')
    throw new Error('cannot override non-completed command result status with completed')

  const status = input.status ?? firstNonCompletedResult?.status ?? 'completed'
  const visualReportPath = nonEmptyStringOrNull(input.visualReportPath)
  const visualReportAbsentReason = nonEmptyStringOrUndefined(input.visualReportAbsentReason)
  const report: ComputerUseQaReport = {
    case_id: input.caseId,
    command_sequence: input.commandResults.map(result => result.commandId),
    trace_root: input.traceRoot,
    artifact_refs: uniqueArtifactRefs(input.commandResults.flatMap(result => result.artifacts)),
    visual_report: visualReportPath,
    ...(visualReportAbsentReason ? { visual_report_absent_reason: visualReportAbsentReason } : {}),
    status,
    failure_class: status === 'completed'
      ? null
      : input.failureClass ?? firstFailure?.class ?? null,
    failure_code: status === 'completed'
      ? null
      : nonEmptyStringOrNull(input.failureCode) ?? firstFailure?.code ?? null,
    known_limits: uniqueStrings([
      ...input.commandResults.flatMap(result => result.knownLimits),
      ...(input.knownLimits ?? []),
    ]),
  }

  return validateComputerUseQaReport(report)
}

export function validateComputerUseQaReport(report: ComputerUseQaReport): ComputerUseQaReport {
  assertNonEmptyString(report.case_id, 'case_id')
  assertStringArray(report.command_sequence, 'command_sequence')
  if (report.command_sequence.length === 0)
    throw new Error('command_sequence must contain at least one command')
  assertNonEmptyString(report.trace_root, 'trace_root')
  assertArtifactRefs(report.artifact_refs)
  assertStatus(report.status)
  assertStringArray(report.known_limits, 'known_limits')

  if (report.visual_report === null) {
    if (!isNonEmptyString(report.visual_report_absent_reason))
      throw new Error('visual_report_absent_reason is required when visual_report is null')
  }
  else {
    assertNonEmptyString(report.visual_report, 'visual_report')
    if (report.visual_report_absent_reason !== undefined)
      throw new Error('visual_report_absent_reason must not be set when visual_report is present')
  }

  if (report.status === 'completed') {
    if (report.failure_class !== null || report.failure_code !== null)
      throw new Error('completed QA reports must not include failure_class or failure_code')
  }
  else {
    if (!isComputerUseFailureClass(report.failure_class) || !isNonEmptyString(report.failure_code))
      throw new Error('failure_class and failure_code are required when QA report status is not completed')
  }

  return report
}

function assertArtifactRefs(value: readonly ArtifactRef[]): void {
  if (!Array.isArray(value))
    throw new Error('artifact_refs must be an array')

  value.forEach((ref, index) => {
    assertNonEmptyString(ref.run_id, `artifact_refs[${index}].run_id`)
    assertNonEmptyString(ref.artifact_id, `artifact_refs[${index}].artifact_id`)
    assertNonEmptyString(ref.span_id, `artifact_refs[${index}].span_id`)
    if (ref.captured_event_id !== undefined)
      assertNonEmptyString(ref.captured_event_id, `artifact_refs[${index}].captured_event_id`)
  })
}

function assertStatus(value: ComputerUseInvokeStatus): void {
  if (value !== 'completed' && value !== 'failed' && value !== 'refused')
    throw new Error('status must be completed, failed, or refused')
}

function assertStringArray(value: readonly string[], fieldName: string): void {
  if (!Array.isArray(value))
    throw new Error(`${fieldName} must be an array`)

  value.forEach((item, index) => {
    assertNonEmptyString(item, `${fieldName}[${index}]`)
  })
}

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (!isNonEmptyString(value))
    throw new Error(`${fieldName} must be a non-empty string`)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function nonEmptyStringOrNull(value: string | null | undefined): string | null {
  return isNonEmptyString(value) ? value : null
}

function nonEmptyStringOrUndefined(value: string | undefined): string | undefined {
  return isNonEmptyString(value) ? value : undefined
}

function isComputerUseFailureClass(value: unknown): value is ComputerUseFailureClass {
  return value === 'command_resolution'
    || value === 'invalid_input'
    || value === 'observe'
    || value === 'recognition'
    || value === 'safety_gate'
    || value === 'action_delivery'
    || value === 'hard_stop'
    || value === 'trace_artifact'
    || value === 'runtime_unknown'
}
