export {
  MacOSChromeDriver,
  promoteChromeCandidate,
} from './driver.js'

export type {
  MacOSChromeDriverOptions,
} from './driver.js'

export {
  captureChromeWindow,
} from './capture.js'

export {
  recognizeTextInImage,
} from './ocr.js'

export type {
  ArtifactRecord,
  ArtifactRef,
  CandidatePromotion,
  ChromeCaptureContract,
  ChromeContextSnapshot,
  ChromeForegroundPolicy,
  ChromeRecognitionTarget,
  ChromeRecognizedItem,
  ChromeWindowCapture,
  ChromeWindowRef,
  EventRecord,
  MacOSChromeCandidateRef,
  MacOSChromeObservationSnapshot,
  MacOSChromeRecognitionResult,
  NodeRef,
  ObservationSnapshot,
  ObservationSource,
  OcrTextMatch,
  OcrTextSnapshot,
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
  SpanRecord,
  SurfaceNode,
  TraceState,
  TraceStatusCode,
} from './types.js'

export {
  ARTIFACT_API_VERSION,
  EVENT_API_VERSION,
  RUN_API_VERSION,
  SPAN_API_VERSION,
} from './types.js'
