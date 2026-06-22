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
    summary: 'Observe the managed Chrome window with optional all, viewport, or browser-chrome scope.',
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
    id: 'chrome.findText',
    summary: 'Capture the managed Chrome page viewport and locate visible text anchors.',
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
    id: 'chrome.waitForText',
    summary: 'Poll managed Chrome page-viewport OCR until a text anchor appears or timeout expires.',
    namespace: 'observe',
    driverId: 'macos.chrome',
    operation: 'waitForText',
    mutatesPage: false,
    deliversInput: false,
    mayActivateChrome: true,
    disturbanceClasses: ['foreground_app'],
    maxDisturbance: 'foreground_app',
  },
  {
    id: 'chrome.clickTarget',
    summary: 'Resolve a semantic page-viewport target from OCR, AXTree, and Chrome DOM evidence, then foreground-click it.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'clickTarget',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['pointer'],
    maxDisturbance: 'pointer',
  },
  {
    id: 'chrome.typeInput',
    summary: 'Resolve a page-viewport input field from AXTree and Chrome DOM evidence, foreground-focus it, and type text.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'typeInput',
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
    summary: 'Resolve the managed Chrome page viewport and scroll a viewport-relative region center.',
    namespace: 'action',
    driverId: 'macos.chrome',
    operation: 'scrollRegion',
    mutatesPage: false,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['pointer'],
    maxDisturbance: 'pointer',
  },
  {
    id: 'chrome.back',
    summary: 'Navigate back in the active tab of the leased managed Chrome window.',
    namespace: 'domain',
    driverId: 'macos.chrome',
    operation: 'back',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['keyboard'],
    maxDisturbance: 'keyboard',
  },
  {
    id: 'chrome.forward',
    summary: 'Navigate forward in the active tab of the leased managed Chrome window.',
    namespace: 'domain',
    driverId: 'macos.chrome',
    operation: 'forward',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['keyboard'],
    maxDisturbance: 'keyboard',
  },
  {
    id: 'chrome.reload',
    summary: 'Reload the active tab of the leased managed Chrome window.',
    namespace: 'domain',
    driverId: 'macos.chrome',
    operation: 'reload',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['keyboard'],
    maxDisturbance: 'keyboard',
  },
  {
    id: 'chrome.addressBarSubmit',
    summary: 'Focus the Chrome omnibox in the leased managed window, type text, and submit with Return.',
    namespace: 'domain',
    driverId: 'macos.chrome',
    operation: 'addressBarSubmit',
    mutatesPage: true,
    deliversInput: true,
    mayActivateChrome: true,
    disturbanceClasses: ['keyboard'],
    maxDisturbance: 'keyboard',
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
