/**
 * CareerDeepSeek Computer-Use module.
 *
 * Provides the AUV-style invoke entry for bounded macOS Chrome computer-use
 * automation. The low-level driver remains internal to the macOS Chrome
 * submodule; top-level callers use command ids and flat inputs.
 *
 * ```ts
 * import { createMacOSChromeInvokeEntry } from './computer-use/index.js'
 *
 * const chrome = createMacOSChromeInvokeEntry({ driverOptions })
 * const snapshot = await chrome.invoke({ commandId: 'chrome.observe' })
 * ```
 */

export {
  createMacOSChromeInvokeEntry,
} from './macos-chrome-driver/index.js'

export type {
  MacOSChromeDriverOptions,
  MacOSChromeInvokeEntry,
  MacOSChromeInvokeEntryOptions,
  ComputerUseFailureClass,
  ComputerUseInvokeRequest,
  ComputerUseInvokeResult,
  ComputerUseInvokeStatus,
} from './macos-chrome-driver/index.js'

export { resolveComputerUseConfig } from './config.js'
export type { ComputerUseConfig } from './config.js'
