/**
 * CareerDeepSeek Computer-Use module.
 *
 * Provides macOS desktop observation and control for bounded visible-browser
 * job search automation. The adapter controls the mouse and keyboard through
 * CGEvent APIs rather than browser-internal automation, so target sites see
 * only real human input.
 *
 * Primary entry point: MacOSComputerUseAdapter
 *
 * ```ts
 * import { MacOSComputerUseAdapter } from './computer-use/index.js'
 *
 * const adapter = new MacOSComputerUseAdapter({
 *   sessionId: 'discovery-2026-06-06',
 *   foregroundPolicy: 'auto_focus_chrome',
 * })
 *
 * // First observe Chrome/AX, locate a named target such as the address bar,
 * // then click its observed center before keyboard input.
 * const state = await adapter.observe()
 * const addressBarCenter = findObservedAddressBarCenter(state)
 * await adapter.act({ type: 'click', point: addressBarCenter })
 * await adapter.act({ type: 'press', key: 'l', modifiers: ['command'] })
 * await adapter.act({ type: 'type', text: 'https://example.com/careers' })
 * await adapter.act({ type: 'press', key: 'enter' })
 * const state = await adapter.observe()
 * ```
 */

export { MacOSComputerUseAdapter } from './macos-adapter.js'
export type { MacOSAdapterOptions } from './macos-adapter.js'

export { resolveComputerUseConfig } from './config.js'
export type { ComputerUseConfig } from './config.js'

export { captureScreenshot } from './screenshot.js'
export { observeWindows } from './window-observation.js'
export { captureAXTree, extractInteractableAXNodes } from './ax-tree.js'
export { captureChromeDom } from './chrome-dom.js'
export { captureDesktopGrounding, boundsIoU } from './desktop-grounding.js'
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
  DesktopTargetCandidate,
  DesktopGroundingSnapshot,
  GroundingStalenessFlags,
  PointerTracePoint,
} from './types.js'
