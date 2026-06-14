/**
 * CareerDeepSeek Computer-Use module.
 *
 * Provides macOS Chrome observation, target recognition, and visible input
 * control for bounded browser research automation. The driver uses OS-level
 * capture and input APIs; browser-internal scripts are read-only observers.
 *
 * Primary entry point: MacOSChromeDriver
 *
 * ```ts
 * import { MacOSChromeDriver, promoteChromeCandidate } from './computer-use/index.js'
 *
 * const driver = new MacOSChromeDriver({
 *   sessionId: 'discovery-2026-06-06',
 *   foregroundPolicy: 'auto_focus_chrome',
 * })
 *
 * const recognition = await driver.recognize({ kind: 'text_input', name: /search/i })
 * const candidate = promoteChromeCandidate(recognition)
 * await driver.click(candidate)
 * ```
 */

export {
  MacOSChromeDriver,
  captureChromeWindow,
  promoteChromeCandidate,
  recognizeTextInImage,
} from './macos-chrome-driver/index.js'
export type {
  ChromeCaptureContract,
  ChromeContextSnapshot,
  ChromeForegroundPolicy,
  ChromeRecognitionTarget,
  ChromeRecognizedItem,
  ChromeWindowCapture,
  ChromeWindowRef,
  MacOSChromeCandidateRef,
  MacOSChromeDriverOptions,
  MacOSChromeObservationSnapshot,
  MacOSChromeRecognitionResult,
  OcrTextMatch,
  OcrTextSnapshot,
} from './macos-chrome-driver/index.js'

export { resolveComputerUseConfig } from './config.js'
export type { ComputerUseConfig } from './config.js'

export { captureScreenshot } from './screenshot.js'
export { observeWindows } from './window-observation.js'
export { captureAXTree, extractInteractableAXNodes } from './ax-tree.js'
export { captureChromeDom } from './chrome-dom.js'
export { buildChromeContext, classifyBrowserPage } from './page-context.js'
export { detectBlockingStopSignal, planOverlayDismissal } from './overlay-resolver.js'
export type { BlockingStopSignal, OverlayDismissalDecision, OverlayDismissalKind } from './overlay-resolver.js'

export { buildPointerTrace } from './pointer-trace.js'

export {
  executeMoveAndClick,
  executeTypeText,
  executePressKeys,
  executeScroll,
  executeOpenApp,
} from './macos-actions.js'

export type {
  Bounds,
  WindowDescriptor,
  WindowObservation,
  ScreenshotArtifact,
  AXNode,
  AXSnapshot,
  ChromeDomElement,
  ChromeDomObservation,
  PointerTracePoint,
} from './types.js'
