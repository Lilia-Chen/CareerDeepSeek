import { normalizeVisualState } from "./visualState.js";

export class MockComputerUseAdapter {
  #states;
  #index = 0;
  #actions = [];

  constructor(states) {
    if (!Array.isArray(states) || states.length === 0) {
      throw new TypeError("MockComputerUseAdapter requires a non-empty states array.");
    }

    this.#states = states.map(normalizeVisualState);
  }

  async observe() {
    return this.#states[this.#index];
  }

  async act(action) {
    this.#actions.push({ ...action });
    if (this.#index < this.#states.length - 1) {
      this.#index += 1;
    }
    return {
      ok: true,
      action
    };
  }

  get actions() {
    return [...this.#actions];
  }
}
