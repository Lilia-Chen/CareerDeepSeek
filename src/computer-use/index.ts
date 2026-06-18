/**
 * CareerDeepSeek Computer-Use module.
 *
 * Provides the P1.5 internal programmatic invoke entry for bounded macOS
 * Chrome computer-use automation. The low-level driver remains in the
 * macOS Chrome submodule; top-level callers use the AUV-style invoke entry.
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
  ChromeCaptureContract,
  ChromeContextSnapshot,
  ChromeForegroundPolicy,
  ChromeRecognitionTarget,
  ChromeWindowCapture,
  ChromeWindowRef,
  MacOSChromeDriverOptions,
  MacOSChromeScrollOptions,
  OcrTextMatch,
  OcrTextSnapshot,
  MacOSChromeInvokeEntry,
  MacOSChromeInvokeEntryOptions,
  ComputerUseFailureClass,
  ComputerUseInvokeRequest,
  ComputerUseInvokeResult,
  ComputerUseInvokeStatus,
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
