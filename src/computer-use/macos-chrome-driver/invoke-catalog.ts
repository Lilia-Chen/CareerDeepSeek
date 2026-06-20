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
    id: 'chrome.findText',
    summary: 'Capture the managed Chrome window and locate OCR text anchors.',
    namespace: 'observe',
    driverId: 'macos.chrome',
    operation: 'findText',
    mutatesPage: false,
    deliversInput: false,
    mayActivateChrome: true,
    disturbanceClasses: ['foreground_app'],
    maxDisturbance: 'foreground_app',
  },
  {
    id: 'chrome.clickText',
    summary: 'Capture the managed Chrome window, resolve OCR text, and click the selected match.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'clickText',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['pointer'],
    maxDisturbance: 'pointer',
  },
  {
    id: 'chrome.findRows',
    summary: 'Capture the managed Chrome window and detect OCR rows.',
    namespace: 'observe',
    driverId: 'macos.chrome',
    operation: 'findRows',
    mutatesPage: false,
    deliversInput: false,
    mayActivateChrome: true,
    disturbanceClasses: ['foreground_app'],
    maxDisturbance: 'foreground_app',
  },
  {
    id: 'chrome.clickRow',
    summary: 'Capture the managed Chrome window, detect OCR rows, and click the selected row.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'clickRow',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['pointer'],
    maxDisturbance: 'pointer',
  },
  {
    id: 'chrome.focusText',
    summary: 'Capture AX once and pointer-click a text input matched by query.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'focusText',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['pointer'],
    maxDisturbance: 'pointer',
  },
  {
    id: 'chrome.axFocusText',
    summary: 'Capture AX once and focus a text input through AX without pointer click.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'axFocusText',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['keyboard'],
    maxDisturbance: 'keyboard',
  },
  {
    id: 'chrome.pressButton',
    summary: 'Capture AX once and pointer-click a button-like node matched by query.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'pressButton',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['pointer'],
    maxDisturbance: 'pointer',
  },
  {
    id: 'chrome.axPressButton',
    summary: 'Capture AX once and press a button-like node through AX without pointer fallback.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'axPressButton',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['keyboard'],
    maxDisturbance: 'keyboard',
  },
  {
    id: 'chrome.typeText',
    summary: 'Type text into the active Chrome control.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'typeTextAtomic',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['keyboard'],
    maxDisturbance: 'keyboard',
  },
  {
    id: 'chrome.key',
    summary: 'Press a key in the active Chrome app.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'key',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['keyboard'],
    maxDisturbance: 'keyboard',
  },
  {
    id: 'chrome.scrollRegion',
    summary: 'Resolve the managed Chrome window and scroll a region center.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'scrollRegion',
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
