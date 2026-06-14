/**
 * Window enumeration via CGWindowListCopyWindowInfo.
 *
 * Returns every on-screen window with its app name, title, bounds, owner PID,
 * and window layer. Optionally filtered to a specific app name substring.
 *
 * Uses an inline Swift script compiled on-the-fly — no pre-compiled binaries.
 */

import type { ComputerUseConfig } from './config.js'
import type { EnumerateWindowsInput, WindowObservation } from './types.js'

import process from 'node:process'

import { runSwiftScript } from './swift-runner.js'

function observeWindowsScript(): string {
  return String.raw`
import AppKit
import CoreGraphics
import Foundation

func boundsDict(_ value: NSDictionary?) -> [String: Int]? {
  guard let value else { return nil }
  var rect = CGRect.zero
  guard CGRectMakeWithDictionaryRepresentation(value, &rect) else { return nil }
  return [
    "x": Int(rect.origin.x.rounded()),
    "y": Int(rect.origin.y.rounded()),
    "width": Int(rect.size.width.rounded()),
    "height": Int(rect.size.height.rounded())
  ]
}

let environment = ProcessInfo.processInfo.environment
let rawInput = environment["COMPUTER_USE_SWIFT_STDIN"] ?? "{}"
let inputData = rawInput.data(using: .utf8) ?? Data()
let input = (try? JSONSerialization.jsonObject(with: inputData)) as? [String: Any] ?? [:]
let limit = (input["limit"] as? Int) ?? 12
let appFilter = ((input["app"] as? String) ?? "").lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
let frontmostApp = NSWorkspace.shared.frontmostApplication
let frontmostAppName = frontmostApp?.localizedName
let frontmostAppBundleId = frontmostApp?.bundleIdentifier

let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let rawWindowInfo = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
var windows: [[String: Any]] = []
for window in rawWindowInfo {
  let ownerName = (window[kCGWindowOwnerName as String] as? String) ?? "Unknown"
  if !appFilter.isEmpty && !ownerName.lowercased().contains(appFilter) {
    continue
  }

  let alpha = window[kCGWindowAlpha as String] as? Double ?? 1.0
  let layer = window[kCGWindowLayer as String] as? Int ?? 0
  let bounds = boundsDict(window[kCGWindowBounds as String] as? NSDictionary)
  let title = (window[kCGWindowName as String] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
  let ownerPid = window[kCGWindowOwnerPID as String] as? Int ?? 0
  let windowNumber = window[kCGWindowNumber as String] as? Int ?? 0
  let ownerBundleId = NSRunningApplication(processIdentifier: pid_t(ownerPid))?.bundleIdentifier

  if alpha <= 0 || (bounds?["width"] ?? 0) <= 1 || (bounds?["height"] ?? 0) <= 1 {
    continue
  }

  windows.append([
    "id": "\(windowNumber)",
    "windowNumber": windowNumber,
    "appName": ownerName,
    "ownerBundleId": ownerBundleId as Any,
    "title": title as Any,
    "bounds": bounds as Any,
    "ownerPid": ownerPid,
    "layer": layer,
    "isOnScreen": true,
  ])

  if windows.count >= limit {
    break
  }
}

let frontmostWindowTitle = windows.first(where: { ($0["appName"] as? String) == frontmostAppName })?["title"]
let payload: [String: Any] = [
  "frontmostAppName": frontmostAppName as Any,
  "frontmostAppBundleId": frontmostAppBundleId as Any,
  "frontmostWindowTitle": frontmostWindowTitle as Any,
  "windows": windows,
  "observedAt": ISO8601DateFormatter().string(from: Date()),
]

let data = try JSONSerialization.data(withJSONObject: payload, options: [])
print(String(data: data, encoding: .utf8)!)
`
}

interface RawWindowEntry {
  id: string
  windowNumber?: number
  appName: string
  ownerBundleId?: string
  title: string | null
  bounds: { x: number, y: number, width: number, height: number }
  ownerPid: number
  layer: number
  isOnScreen: boolean
}

interface RawWindowOutput {
  frontmostAppName?: string
  frontmostAppBundleId?: string
  frontmostWindowTitle?: string | null
  windows: RawWindowEntry[]
  observedAt: string
}

export async function observeWindows(
  config: ComputerUseConfig,
  input: EnumerateWindowsInput = {},
): Promise<WindowObservation> {
  if (process.platform !== 'darwin') {
    return {
      frontmostAppName: undefined,
      frontmostWindowTitle: null,
      windows: [],
      observedAt: new Date().toISOString(),
    }
  }

  const { stdout } = await runSwiftScript({
    swiftBinary: config.binaries.swift,
    timeoutMs: config.timeoutMs,
    source: observeWindowsScript(),
    stdinPayload: input,
  })

  const raw = JSON.parse(stdout.trim()) as RawWindowOutput

  return {
    frontmostAppName: raw.frontmostAppName,
    frontmostAppBundleId: raw.frontmostAppBundleId,
    frontmostWindowTitle: raw.frontmostWindowTitle,
    windows: raw.windows.map(w => ({
      id: w.id,
      windowNumber: w.windowNumber,
      appName: w.appName,
      ownerBundleId: w.ownerBundleId,
      title: w.title,
      bounds: w.bounds,
      ownerPid: w.ownerPid,
      layer: w.layer,
      isOnScreen: w.isOnScreen,
    })),
    observedAt: raw.observedAt,
  }
}
