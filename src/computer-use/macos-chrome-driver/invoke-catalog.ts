import type {
  ComputerUseCommandSpec,
  ComputerUseFailureClass,
  ComputerUseInvokeRequest,
  ComputerUseInvokeResult,
} from './invoke-types.js'

export class ComputerUseCommandResolutionError extends Error {
  readonly commandId: string
  readonly failureClass: ComputerUseFailureClass = 'command_resolution'
  readonly code = 'unknown_command'

  constructor(commandId: string) {
    super(`Unknown computer-use command: ${commandId}`)
    this.name = 'ComputerUseCommandResolutionError'
    this.commandId = commandId
  }
}

const commandSpecs = [
  {
    id: 'chrome.observe',
    summary: 'Observe the managed Chrome window and produce current visible evidence.',
    namespace: 'observe',
    driverId: 'macos.chrome',
    operation: 'observe',
    mutatesPage: false,
    deliversInput: false,
    mayActivateChrome: true,
    disturbanceClasses: ['foreground_app'],
    maxDisturbance: 'foreground_app',
  },
  {
    id: 'chrome.recognize',
    summary: 'Recognize a target from the latest Chrome window capture evidence.',
    namespace: 'observe',
    driverId: 'macos.chrome',
    operation: 'recognizeFromCapture',
    mutatesPage: false,
    deliversInput: false,
    mayActivateChrome: false,
    disturbanceClasses: ['none'],
    maxDisturbance: 'none',
  },
  {
    id: 'chrome.checkSafetyGate',
    summary: 'Check Chrome action safety preconditions without delivering input.',
    namespace: 'verify',
    driverId: 'macos.chrome',
    operation: 'checkSafetyGate',
    mutatesPage: false,
    deliversInput: false,
    mayActivateChrome: false,
    disturbanceClasses: ['none'],
    maxDisturbance: 'none',
  },
  {
    id: 'chrome.promote',
    summary: 'Promote a recognized item into a short-lived action candidate.',
    namespace: 'prepare',
    driverId: 'macos.chrome',
    operation: 'promoteCandidate',
    mutatesPage: false,
    deliversInput: false,
    mayActivateChrome: false,
    disturbanceClasses: ['none'],
    maxDisturbance: 'none',
  },
  {
    id: 'chrome.clickCandidate',
    summary: 'Click a same-session promoted candidate after driver liveness checks.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'click',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['pointer'],
    maxDisturbance: 'pointer',
  },
  {
    id: 'chrome.focusTextInput',
    summary: 'Focus a same-session ax_node text input candidate after driver liveness checks.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'focusTextInput',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['focus'],
    maxDisturbance: 'focus',
  },
  {
    id: 'chrome.typeText',
    summary: 'Type text into an audited focused target in the managed Chrome window.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'typeText',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['keyboard'],
    maxDisturbance: 'keyboard',
  },
  {
    id: 'chrome.pressKey',
    summary: 'Press a key for an audited focused target in the managed Chrome window.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'pressKey',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['keyboard'],
    maxDisturbance: 'keyboard',
  },
  {
    id: 'chrome.scroll',
    summary: 'Scroll the latest observe-derived Chrome viewport region in the managed Chrome window.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'scroll',
    mutatesPage: false,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['pointer'],
    maxDisturbance: 'pointer',
  },
] satisfies ComputerUseCommandSpec[]

export const COMPUTER_USE_COMMAND_SPECS = Object.freeze(
  commandSpecs.map(spec => freezeCommandSpec(spec)),
)

const commandSpecById = new Map<string, Readonly<ComputerUseCommandSpec>>(
  COMPUTER_USE_COMMAND_SPECS.map(spec => [spec.id, spec]),
)

export function getComputerUseCommandSpec(commandId: string): Readonly<ComputerUseCommandSpec> | undefined {
  return commandSpecById.get(commandId)
}

export function resolveComputerUseCommandSpec(commandId: string): Readonly<ComputerUseCommandSpec> {
  const spec = getComputerUseCommandSpec(commandId)
  if (!spec)
    throw new ComputerUseCommandResolutionError(commandId)
  return spec
}

export function dryRunComputerUseCommand(request: ComputerUseInvokeRequest): ComputerUseInvokeResult {
  const spec = getComputerUseCommandSpec(request.commandId)
  if (!spec)
    return catalogCommandResolutionFailure(request.commandId)

  return {
    commandId: spec.id,
    status: 'completed',
    summary: `Resolved ${spec.id} without invoking the live driver.`,
    output: spec,
    signals: ['catalog_resolved', 'dry_run'],
    artifacts: [],
    knownLimits: [
      'catalog_only_no_live_driver',
      'input_schema_validation_deferred_to_runtime_phase',
    ],
  }
}

function freezeCommandSpec(spec: ComputerUseCommandSpec): Readonly<ComputerUseCommandSpec> {
  return Object.freeze({
    ...spec,
    disturbanceClasses: Object.freeze([...spec.disturbanceClasses]),
  })
}

function catalogCommandResolutionFailure(commandId: string): ComputerUseInvokeResult {
  return {
    commandId,
    status: 'failed',
    summary: `Unknown computer-use command: ${commandId}`,
    signals: ['command_resolution_failed', 'dry_run'],
    artifacts: [],
    failure: {
      class: 'command_resolution',
      code: 'unknown_command',
      message: `Unknown computer-use command: ${commandId}`,
    },
    knownLimits: ['catalog_only_no_live_driver'],
  }
}
