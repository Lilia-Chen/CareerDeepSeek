import type { ComputerUseConfig } from '../config.js'
import type { Bounds, WindowDescriptor, WindowObservation } from '../types.js'

import { runProcess } from '../process.js'
import { runSwiftScript } from '../swift-runner.js'
import { requireWindowNumber } from './types.js'

const APPLESCRIPT_WINDOW_MATCH_TOLERANCE = 16
const AX_WINDOW_MATCH_TOLERANCE = 12

export interface ChromeWindowForegroundVerification {
  verified: boolean
  method: 'windowserver_direct' | 'ax_focused_window' | 'ax_main_window' | 'not_foreground'
  auxiliaryWindow?: {
    windowNumber?: number
    ownerPid?: number
    title?: string | null
    bounds?: Bounds
  }
  axWindow?: AXChromeWindowSummary
}

interface AXChromeWindowSummary {
  title?: string
  bounds?: Bounds
  main?: boolean
  focused?: boolean
}

export function isChromeWindowForeground(
  observation: WindowObservation,
  window: WindowDescriptor,
): boolean {
  return isChromeApp(observation.frontmostAppName)
    && observation.frontmostWindowNumber === requireWindowNumber(window)
    && observation.frontmostWindowOwnerPid === window.ownerPid
}

export async function verifyChromeWindowForeground(
  config: ComputerUseConfig,
  observation: WindowObservation,
  window: WindowDescriptor,
): Promise<ChromeWindowForegroundVerification> {
  if (isChromeWindowForeground(observation, window)) {
    return { verified: true, method: 'windowserver_direct' }
  }

  if (!isChromeApp(observation.frontmostAppName)) {
    return {
      verified: false,
      method: 'not_foreground',
      auxiliaryWindow: auxiliaryWindowPayload(observation),
    }
  }

  const axState = await captureChromeAXWindowState(config, window.ownerPid).catch(() => undefined)
  if (axState?.focusedWindow && axWindowMatchesTarget(axState.focusedWindow, window)) {
    return {
      verified: true,
      method: 'ax_focused_window',
      auxiliaryWindow: auxiliaryWindowPayload(observation),
      axWindow: axState.focusedWindow,
    }
  }
  if (axState?.mainWindow && axWindowMatchesTarget(axState.mainWindow, window)) {
    return {
      verified: true,
      method: 'ax_main_window',
      auxiliaryWindow: auxiliaryWindowPayload(observation),
      axWindow: axState.mainWindow,
    }
  }

  return {
    verified: false,
    method: 'not_foreground',
    auxiliaryWindow: auxiliaryWindowPayload(observation),
    axWindow: axState?.focusedWindow ?? axState?.mainWindow,
  }
}

export async function raiseChromeWindow(
  config: ComputerUseConfig,
  window: WindowDescriptor,
): Promise<void> {
  const result = await runProcess(config.binaries.osascript, ['-e', raiseChromeWindowScript(window)], {
    timeoutMs: config.timeoutMs,
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || 'AppleScript failed to raise the target Chrome window.')
  }
}

function raiseChromeWindowScript(window: WindowDescriptor): string {
  const bounds = window.bounds
  const title = window.title ?? ''
  const targetRight = bounds.x + bounds.width
  const targetBottom = bounds.y + bounds.height

  return `
on nearEnough(a, b, tolerance)
  set delta to a - b
  if delta < 0 then set delta to -delta
  return delta <= tolerance
end nearEnough

set targetLeft to ${roundForAppleScript(bounds.x)}
set targetTop to ${roundForAppleScript(bounds.y)}
set targetRight to ${roundForAppleScript(targetRight)}
set targetBottom to ${roundForAppleScript(targetBottom)}
set targetTitle to ${appleScriptString(title)}
set tolerance to ${APPLESCRIPT_WINDOW_MATCH_TOLERANCE}
set candidateWindow to missing value

tell application "Google Chrome"
  activate
  repeat with chromeWindow in windows
    set windowBounds to bounds of chromeWindow
    set leftEdge to item 1 of windowBounds
    set topEdge to item 2 of windowBounds
    set rightEdge to item 3 of windowBounds
    set bottomEdge to item 4 of windowBounds
    if my nearEnough(leftEdge, targetLeft, tolerance) and my nearEnough(topEdge, targetTop, tolerance) and my nearEnough(rightEdge, targetRight, tolerance) and my nearEnough(bottomEdge, targetBottom, tolerance) then
      set candidateWindow to chromeWindow
      exit repeat
    end if
  end repeat

  if candidateWindow is missing value and targetTitle is not "" then
    repeat with chromeWindow in windows
      try
        set tabTitle to name of active tab of chromeWindow
        if tabTitle is targetTitle or tabTitle contains targetTitle or targetTitle contains tabTitle then
          set candidateWindow to chromeWindow
          exit repeat
        end if
      end try
    end repeat
  end if

  if candidateWindow is missing value then error "Target Chrome window not found by bounds or active tab title."
  set index of candidateWindow to 1
  return "raised"
end tell
`
}

function isChromeApp(appName: string | undefined): boolean {
  return typeof appName === 'string' && appName.toLowerCase().includes('chrome')
}

function roundForAppleScript(value: number): number {
  return Math.round(value)
}

function appleScriptString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function foregroundDebugPayload(
  observation: WindowObservation,
): Record<string, unknown> {
  return {
    frontmost_app_name: observation.frontmostAppName,
    frontmost_app_bundle_id: observation.frontmostAppBundleId,
    frontmost_window_title: observation.frontmostWindowTitle,
    frontmost_window_number: observation.frontmostWindowNumber,
    frontmost_window_owner_pid: observation.frontmostWindowOwnerPid,
    frontmost_window_owner_bundle_id: observation.frontmostWindowOwnerBundleId,
    frontmost_window_bounds: boundsPayload(observation.frontmostWindowBounds),
  }
}

function boundsPayload(bounds: Bounds | undefined): Bounds | undefined {
  return bounds
}

async function captureChromeAXWindowState(
  config: ComputerUseConfig,
  ownerPid: number,
): Promise<{ focusedWindow?: AXChromeWindowSummary, mainWindow?: AXChromeWindowSummary }> {
  const { stdout } = await runSwiftScript({
    swiftBinary: config.binaries.swift,
    timeoutMs: config.timeoutMs,
    source: axChromeWindowStateScript(),
    stdinPayload: { ownerPid },
  })
  return JSON.parse(stdout.trim()) as { focusedWindow?: AXChromeWindowSummary, mainWindow?: AXChromeWindowSummary }
}

function axChromeWindowStateScript(): string {
  return String.raw`
import ApplicationServices
import Foundation

struct BoundsJSON: Encodable {
  let x: Int
  let y: Int
  let width: Int
  let height: Int
}

struct AXWindowJSON: Encodable {
  let title: String?
  let bounds: BoundsJSON?
  let main: Bool?
  let focused: Bool?
}

struct OutputJSON: Encodable {
  let focusedWindow: AXWindowJSON?
  let mainWindow: AXWindowJSON?
}

func stringAttr(_ element: AXUIElement, _ attr: String) -> String? {
  var value: AnyObject?
  guard AXUIElementCopyAttributeValue(element, attr as CFString, &value) == .success else { return nil }
  return value as? String
}

func boolAttr(_ element: AXUIElement, _ attr: String) -> Bool? {
  var value: AnyObject?
  guard AXUIElementCopyAttributeValue(element, attr as CFString, &value) == .success else { return nil }
  return (value as? NSNumber)?.boolValue
}

func boundsAttr(_ element: AXUIElement) -> BoundsJSON? {
  var posValue: AnyObject?
  var sizeValue: AnyObject?
  guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posValue) == .success,
        AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue) == .success,
        CFGetTypeID(posValue!) == AXValueGetTypeID(),
        CFGetTypeID(sizeValue!) == AXValueGetTypeID()
  else { return nil }

  var point = CGPoint.zero
  var size = CGSize.zero
  AXValueGetValue(posValue as! AXValue, .cgPoint, &point)
  AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
  return BoundsJSON(
    x: Int(point.x.rounded()),
    y: Int(point.y.rounded()),
    width: Int(size.width.rounded()),
    height: Int(size.height.rounded())
  )
}

func windowJSON(_ element: AXUIElement?) -> AXWindowJSON? {
  guard let element else { return nil }
  return AXWindowJSON(
    title: stringAttr(element, kAXTitleAttribute as String),
    bounds: boundsAttr(element),
    main: boolAttr(element, kAXMainAttribute as String),
    focused: boolAttr(element, kAXFocusedAttribute as String)
  )
}

let environment = ProcessInfo.processInfo.environment
let rawInput = environment["COMPUTER_USE_SWIFT_STDIN"] ?? "{}"
let inputData = rawInput.data(using: .utf8) ?? Data()
let input = (try? JSONSerialization.jsonObject(with: inputData)) as? [String: Any] ?? [:]
let ownerPid = (input["ownerPid"] as? Int) ?? 0
let app = AXUIElementCreateApplication(pid_t(ownerPid))

var focusedObj: AnyObject?
let focusedStatus = AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focusedObj)
var mainObj: AnyObject?
let mainStatus = AXUIElementCopyAttributeValue(app, kAXMainWindowAttribute as CFString, &mainObj)

let output = OutputJSON(
  focusedWindow: focusedStatus == .success ? windowJSON(focusedObj as! AXUIElement?) : nil,
  mainWindow: mainStatus == .success ? windowJSON(mainObj as! AXUIElement?) : nil
)
let data = try JSONEncoder().encode(output)
print(String(data: data, encoding: .utf8)!)
`
}

function axWindowMatchesTarget(axWindow: AXChromeWindowSummary, target: WindowDescriptor): boolean {
  if (axWindow.bounds && boundsNear(axWindow.bounds, target.bounds, AX_WINDOW_MATCH_TOLERANCE)) {
    return true
  }

  const axTitle = axWindow.title?.trim()
  const targetTitle = target.title?.trim()
  return Boolean(axTitle && targetTitle && (axTitle === targetTitle || axTitle.includes(targetTitle) || targetTitle.includes(axTitle)))
}

function boundsNear(a: Bounds, b: Bounds, tolerance: number): boolean {
  return Math.abs(a.x - b.x) <= tolerance
    && Math.abs(a.y - b.y) <= tolerance
    && Math.abs(a.width - b.width) <= tolerance
    && Math.abs(a.height - b.height) <= tolerance
}

function auxiliaryWindowPayload(observation: WindowObservation): ChromeWindowForegroundVerification['auxiliaryWindow'] {
  return {
    windowNumber: observation.frontmostWindowNumber,
    ownerPid: observation.frontmostWindowOwnerPid,
    title: observation.frontmostWindowTitle,
    bounds: observation.frontmostWindowBounds,
  }
}
