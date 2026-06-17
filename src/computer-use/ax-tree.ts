/**
 * macOS Accessibility tree capture via AXUIElement API.
 *
 * Walks the AX tree of the frontmost application (or a specified PID),
 * collecting role, title, value, description, bounds, enabled, and focused
 * state for every node. Returns a tree suitable for interactive-element
 * extraction and coordinate grounding.
 *
 * Uses an inline Swift script compiled at runtime.
 */

import type { ComputerUseConfig } from './config.js'
import type { AXNode, AXSnapshot, CaptureAXTreeInput } from './types.js'

import process from 'node:process'

import { runSwiftScript } from './swift-runner.js'

let nextSnapshotId = 1

function axTreeScript(): string {
  return String.raw`
import ApplicationServices
import AppKit
import Foundation

struct AXNodeJSON: Encodable {
  let role: String
  let title: String?
  let value: String?
  let description: String?
  let enabled: Bool?
  let focused: Bool?
  let bounds: BoundsJSON?
  let scroll: AXScrollEvidenceJSON?
  let children: [AXNodeJSON]
}

struct BoundsJSON: Encodable {
  let x: Int
  let y: Int
  let width: Int
  let height: Int
}

struct AXScrollEvidenceJSON: Encodable {
  let role: String
  let orientation: String?
  let value: Double?
  let min_value: Double?
  let max_value: Double?
  let bounds: BoundsJSON?
  let known_limits: [String]
}

struct OutputJSON: Encodable {
  let pid: Int32
  let appName: String
  let root: AXNodeJSON?
  let truncated: Bool
}

func getStringAttr(_ element: AXUIElement, _ attr: String) -> String? {
  var value: AnyObject?
  guard AXUIElementCopyAttributeValue(element, attr as CFString, &value) == .success else { return nil }
  return value as? String
}

func getBoolAttr(_ element: AXUIElement, _ attr: String) -> Bool? {
  var value: AnyObject?
  guard AXUIElementCopyAttributeValue(element, attr as CFString, &value) == .success else { return nil }
  if let num = value as? NSNumber { return num.boolValue }
  return nil
}

func getNumericAttr(_ element: AXUIElement, _ attr: String, _ label: String) -> (Double?, String?) {
  var value: AnyObject?
  guard AXUIElementCopyAttributeValue(element, attr as CFString, &value) == .success else {
    return (nil, "\(label) unavailable")
  }

  if let num = value as? NSNumber {
    return (num.doubleValue, nil)
  }

  if value is String {
    return (nil, "\(label) is string, not typed numeric")
  }

  if CFGetTypeID(value) == AXValueGetTypeID() {
    let axValue = value as! AXValue
    let axType = AXValueGetType(axValue)
    return (nil, "\(label) AXValue type \(axType) is not numeric")
  }

  return (nil, "\(label) is not numeric")
}

func normalizeOrientation(_ raw: String?) -> String {
  guard let raw else { return "unknown" }
  let normalized = raw.lowercased()
  if normalized.contains("vertical") { return "vertical" }
  if normalized.contains("horizontal") { return "horizontal" }
  return "unknown"
}

func getScrollEvidence(_ element: AXUIElement, _ role: String, _ bounds: BoundsJSON?) -> AXScrollEvidenceJSON? {
  guard role == "AXScrollBar" || role == "AXScrollArea" || role == "AXWebArea" else { return nil }

  var knownLimits: [String] = []
  let (numericValue, valueLimit) = getNumericAttr(element, kAXValueAttribute as String, "AXValue")
  let (minValue, minLimit) = getNumericAttr(element, kAXMinValueAttribute as String, "AXMinValue")
  let (maxValue, maxLimit) = getNumericAttr(element, kAXMaxValueAttribute as String, "AXMaxValue")
  if let valueLimit { knownLimits.append(valueLimit) }
  if let minLimit { knownLimits.append(minLimit) }
  if let maxLimit { knownLimits.append(maxLimit) }

  let orientationRaw = getStringAttr(element, kAXOrientationAttribute as String)
  let orientation = normalizeOrientation(orientationRaw)
  if orientationRaw == nil {
    knownLimits.append("AXOrientation unavailable")
  } else if orientation == "unknown" {
    knownLimits.append("AXOrientation unknown")
  }
  if bounds == nil {
    knownLimits.append("AX scroll bounds unavailable")
  }

  return AXScrollEvidenceJSON(
    role: role,
    orientation: orientation,
    value: numericValue,
    min_value: minValue,
    max_value: maxValue,
    bounds: bounds,
    known_limits: knownLimits
  )
}

func getBounds(_ element: AXUIElement) -> BoundsJSON? {
  var posValue: AnyObject?
  var sizeValue: AnyObject?
  guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as String as CFString, &posValue) == .success,
        AXUIElementCopyAttributeValue(element, kAXSizeAttribute as String as CFString, &sizeValue) == .success
  else { return nil }

  let posType = AXValueGetType(posValue as! AXValue)
  let sizeType = AXValueGetType(sizeValue as! AXValue)
  guard posType == .cgPoint, sizeType == .cgSize else { return nil }

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

func walkTree(_ element: AXUIElement, depth: Int, maxDepth: Int, nodeCount: inout Int, maxNodes: Int, verbose: Bool) -> AXNodeJSON? {
  if depth > maxDepth || nodeCount >= maxNodes { return nil }
  nodeCount += 1

  let role = getStringAttr(element, kAXRoleAttribute as String) ?? ""
  let title = getStringAttr(element, kAXTitleAttribute as String)
  let valueStr: String? = {
    var raw: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXValueAttribute as String as CFString, &raw) == .success else { return nil }
    if let s = raw as? String { return s.count > 500 ? String(s.prefix(500)) : s }
    if let n = raw as? NSNumber { return n.stringValue }
    return nil
  }()
  let desc = getStringAttr(element, kAXDescriptionAttribute as String)
  let bounds = getBounds(element)
  let scroll = getScrollEvidence(element, role, bounds)

  if !verbose && role.isEmpty && title == nil && desc == nil && valueStr == nil && scroll == nil {
    return nil
  }

  let enabled = getBoolAttr(element, kAXEnabledAttribute as String)
  let focused = getBoolAttr(element, kAXFocusedAttribute as String)

  var childNodes: [AXNodeJSON] = []
  var childrenRef: AnyObject?
  if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as String as CFString, &childrenRef) == .success,
     let children = childrenRef as? [AXUIElement] {
    for child in children {
      if let childNode = walkTree(child, depth: depth + 1, maxDepth: maxDepth, nodeCount: &nodeCount, maxNodes: maxNodes, verbose: verbose) {
        childNodes.append(childNode)
      }
    }
  }

  return AXNodeJSON(
    role: role,
    title: title,
    value: valueStr,
    description: desc,
    enabled: enabled,
    focused: focused,
    bounds: bounds,
    scroll: scroll,
    children: childNodes
  )
}

let environment = ProcessInfo.processInfo.environment
let rawInput = environment["COMPUTER_USE_SWIFT_STDIN"] ?? "{}"
let inputData = rawInput.data(using: .utf8) ?? Data()
let input = (try? JSONSerialization.jsonObject(with: inputData)) as? [String: Any] ?? [:]

let maxDepth = (input["maxDepth"] as? Int) ?? 15
let maxNodes = (input["maxNodes"] as? Int) ?? 2000
let verbose = (input["verbose"] as? Bool) ?? false
let targetPid: Int32? = (input["pid"] as? Int).map { Int32($0) }

let pid: Int32
let appName: String

if let targetPid {
  pid = targetPid
  let app = NSRunningApplication(processIdentifier: targetPid)
  appName = app?.localizedName ?? "pid:\(targetPid)"
} else {
  guard let frontApp = NSWorkspace.shared.frontmostApplication else {
    let output = OutputJSON(pid: 0, appName: "unknown", root: nil, truncated: false)
    let data = try JSONEncoder().encode(output)
    print(String(data: data, encoding: .utf8)!)
    exit(0)
  }
  pid = frontApp.processIdentifier
  appName = frontApp.localizedName ?? "unknown"
}

let appElement = AXUIElementCreateApplication(pid)
var nodeCount = 0
let root = walkTree(appElement, depth: 0, maxDepth: maxDepth, nodeCount: &nodeCount, maxNodes: maxNodes, verbose: verbose)

let output = OutputJSON(pid: pid, appName: appName, root: root, truncated: nodeCount >= maxNodes)
let encoder = JSONEncoder()
let data = try encoder.encode(output)
print(String(data: data, encoding: .utf8)!)
`
}

interface RawAXNode {
  role: string
  title?: string
  value?: string
  description?: string
  enabled?: boolean
  focused?: boolean
  bounds?: { x: number, y: number, width: number, height: number }
  scroll?: {
    role: string
    orientation?: 'vertical' | 'horizontal' | 'unknown'
    value?: number
    min_value?: number
    max_value?: number
    bounds?: { x: number, y: number, width: number, height: number }
    known_limits?: string[]
  }
  children?: RawAXNode[]
}

interface RawAXOutput {
  pid: number
  appName: string
  root?: RawAXNode
  truncated: boolean
}

function assignUids(raw: RawAXNode, snapshotId: string): AXNode {
  let counter = 0

  function walk(node: RawAXNode): AXNode {
    const uid = `${snapshotId}_${counter++}`
    return {
      uid,
      role: node.role,
      title: node.title,
      value: node.value,
      description: node.description,
      enabled: node.enabled,
      focused: node.focused,
      bounds: node.bounds,
      scroll: node.scroll
        ? {
            role: node.scroll.role,
            orientation: normalizeAXOrientation(node.scroll.orientation),
            value: finiteNumberOrUndefined(node.scroll.value),
            min_value: finiteNumberOrUndefined(node.scroll.min_value),
            max_value: finiteNumberOrUndefined(node.scroll.max_value),
            bounds: node.scroll.bounds,
            known_limits: Array.isArray(node.scroll.known_limits)
              ? node.scroll.known_limits.filter((limit): limit is string => typeof limit === 'string')
              : [],
          }
        : undefined,
      children: (node.children ?? []).map(walk),
    }
  }

  return walk(raw)
}

function normalizeAXOrientation(value: unknown): 'vertical' | 'horizontal' | 'unknown' {
  return value === 'vertical' || value === 'horizontal' ? value : 'unknown'
}

function finiteNumberOrUndefined(value: unknown): number | undefined {
  return Number.isFinite(value) ? value as number : undefined
}

export async function captureAXTree(
  config: ComputerUseConfig,
  input: CaptureAXTreeInput = {},
): Promise<AXSnapshot> {
  if (process.platform !== 'darwin') {
    throw new Error('AX tree capture is only supported on macOS')
  }

  const { stdout } = await runSwiftScript({
    swiftBinary: config.binaries.swift,
    timeoutMs: config.timeoutMs,
    source: axTreeScript(),
    stdinPayload: {
      pid: input.pid,
      maxDepth: input.maxDepth ?? 15,
      maxNodes: input.maxNodes ?? 2000,
      verbose: input.verbose ?? false,
    },
  })

  const raw = JSON.parse(stdout.trim()) as RawAXOutput
  const snapshotId = String(nextSnapshotId++)

  const root: AXNode = raw.root
    ? assignUids(raw.root, snapshotId)
    : { uid: `${snapshotId}_0`, role: 'AXApplication', children: [] }

  return {
    snapshotId,
    pid: raw.pid,
    appName: raw.appName,
    root,
    capturedAt: new Date().toISOString(),
    maxDepth: input.maxDepth ?? 15,
    truncated: raw.truncated,
  }
}

/** Interactive AX roles — everything a user can click, type in, or focus. */
const INTERACTABLE_AX_ROLES = new Set([
  'AXButton',
  'AXLink',
  'AXTextField',
  'AXTextArea',
  'AXCheckBox',
  'AXRadioButton',
  'AXPopUpButton',
  'AXComboBox',
  'AXSlider',
  'AXMenuItem',
  'AXMenuBarItem',
  'AXTab',
  'AXTabGroup',
  'AXToolbar',
  'AXIncrementor',
  'AXColorWell',
  'AXDisclosureTriangle',
  'AXScrollBar',
  'AXScrollArea',
])

/**
 * Extract interactable AX nodes with bounds as flat candidate list.
 * Only nodes with valid bounds and an interactable role are included.
 */
export function extractInteractableAXNodes(snapshot: AXSnapshot): AXNode[] {
  const candidates: AXNode[] = []

  function walk(node: AXNode) {
    if (node.bounds && INTERACTABLE_AX_ROLES.has(node.role)) {
      candidates.push(node)
    }
    for (const child of node.children) {
      walk(child)
    }
  }

  walk(snapshot.root)
  return candidates
}
