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
 * import { MacOSChromeDriver } from './computer-use/index.js'
 *
 * const driver = new MacOSChromeDriver({
 *   sessionId: 'discovery-2026-06-06',
 *   foregroundPolicy: 'auto_focus_chrome',
 * })
 *
 * const snapshot = await driver.observe()
 * const recognition = await driver.recognizeFromCapture(snapshot.capture, { kind: 'text_input', name: /search/i })
 * const promotion = await driver.promoteCandidate(recognition, snapshot.capture)
 * if (promotion.status === 'promoted') {
 *   await driver.click(promotion.candidate)
 * }
 * ```
 */

export {
  MacOSChromeDriver,
  captureChromeWindow,
  promoteChromeCandidate,
  recognizeTextInImage,
} from './macos-chrome-driver/index.js'

// New module value exports
export {
  normalizeToSurfaceNodes,
  inferObservationSource,
  recognizeFromCapture,
  promoteCandidate,
  detectHardStopSignals,
  checkSafetyGate,
  loadProfileConfig,
  TraceStore,
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

// New module type exports
export type {
  NormalizeInput,
  PromotionOptions,
  ArtifactRecord,
  ArtifactRef,
  CandidatePromotion,
  EventRecord,
  NodeRef,
  ObservationSnapshot,
  ObservationSource,
  ProfileConfig,
  PromotedCandidate,
  PromotionRefusal,
  RatioRegion,
  RecognitionBox,
  RecognitionResult,
  RecognitionScope,
  RecognitionSource,
  RecognitionSurface,
  RecognizedItem,
  RunRecord,
  RunType,
  SafetyCheckResult,
  SafetyFailure,
  Size2D,
  Scale2D,
  SpanRecord,
  SurfaceNode,
  TraceState,
  TraceStatusCode,
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
