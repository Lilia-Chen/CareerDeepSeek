import type { ArtifactRef } from './types.js'

export type ComputerUseCommandNamespace
  = | 'observe'
    | 'verify'
    | 'prepare'
    | 'action'
    | 'test'

export type ComputerUseDisturbanceClass
  = | 'none'
    | 'focus'
    | 'foreground_app'
    | 'keyboard'
    | 'pointer'

export interface ComputerUseCommandSpec {
  readonly id: string
  readonly summary: string
  readonly namespace: ComputerUseCommandNamespace
  readonly driverId: 'macos.chrome'
  readonly operation: string
  readonly mutatesPage: boolean
  readonly deliversInput: boolean
  readonly mayActivateChrome: boolean
  readonly disturbanceClasses: readonly ComputerUseDisturbanceClass[]
  readonly maxDisturbance: ComputerUseDisturbanceClass
}

export interface ComputerUseInvokeRequest {
  commandId: string
  target?: {
    profile?: 'managed'
    window?: 'leased_chrome_window'
  }
  inputs?: Record<string, unknown>
  dryRun?: boolean
}

export type ComputerUseInvokeStatus = 'completed' | 'failed' | 'refused'

export type ComputerUseFailureClass
  = | 'command_resolution'
    | 'invalid_input'
    | 'observe'
    | 'recognition'
    | 'safety_gate'
    | 'action_delivery'
    | 'hard_stop'
    | 'trace_artifact'
    | 'runtime_unknown'

export interface ComputerUseInvokeResult {
  commandId: string
  status: ComputerUseInvokeStatus
  summary: string
  output?: unknown
  signals: string[]
  artifacts: ArtifactRef[]
  failure?: {
    class: ComputerUseFailureClass
    code: string
    message: string
  }
  knownLimits: string[]
}
