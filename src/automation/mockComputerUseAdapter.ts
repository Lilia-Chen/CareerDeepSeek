import { normalizeVisualState } from './visualState.js'
import type { ComputerUseAdapter, VisualAction, VisualState } from '../types.js'

export class MockComputerUseAdapter implements ComputerUseAdapter {
  #states: VisualState[]
  #index = 0
  #actions: VisualAction[] = []

  constructor(states: unknown[]) {
    if (!Array.isArray(states) || states.length === 0) {
      throw new TypeError('MockComputerUseAdapter requires a non-empty states array.')
    }

    this.#states = states.map(normalizeVisualState)
  }

  async observe(): Promise<VisualState> {
    return this.#states[this.#index]
  }

  async act(action: VisualAction): Promise<{ ok: true, action: VisualAction }> {
    this.#actions.push({ ...action } as VisualAction)
    if (this.#index < this.#states.length - 1) {
      this.#index += 1
    }
    return {
      ok: true,
      action,
    }
  }

  get actions(): VisualAction[] {
    return [...this.#actions]
  }
}
