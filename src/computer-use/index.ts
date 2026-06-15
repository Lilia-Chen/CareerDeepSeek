/**
 * CareerDeepSeek Computer-Use module.
 *
 * Provides macOS Chrome observation, target recognition, and visible input
 * control for bounded browser research automation. The driver uses OS-level
 * capture and input APIs; browser-internal scripts are read-only observers.
 *
 * Primary low-level entry point: MacOSChromeDriver
 * Primary agent-facing entry point: MacOSChromeAgentHarness
 *
 * ```ts
 * import { MacOSChromeAgentHarness, MacOSChromeDriver } from './computer-use/index.js'
 *
 * const driver = new MacOSChromeDriver({
 *   sessionId: 'discovery-2026-06-06',
 *   foregroundPolicy: 'auto_focus_chrome',
 * })
 *
 * const browser = new MacOSChromeAgentHarness(driver)
 * await browser.clickObservedButton(/Hide sponsored result/i, {
 *   reason: 'Collapse sponsored results before judging organic sources.',
 * })
 * ```
 */

export {
  MacOSChromeAgentHarness,
  MacOSChromeDriver,
} from './macos-chrome-driver/index.js'

export type {
  AgentActionResult,
  AgentHarnessActionOptions,
  AgentHarnessScrollOptions,
  AgentPageObservation,
  ChromeCaptureContract,
  ChromeContextSnapshot,
  ChromeForegroundPolicy,
  ChromeRecognitionTarget,
  ChromeWindowCapture,
  ChromeWindowRef,
  MacOSChromeAgentDriver,
  MacOSChromeDriverOptions,
  MacOSChromeScrollOptions,
  OcrTextMatch,
  OverlayDismissResult,
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
  ChromeContextLease,
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
