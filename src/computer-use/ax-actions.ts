import type { ComputerUseConfig } from './config.js'
import type { Bounds } from './types.js'
import { runSwiftScript } from './swift-runner.js'

export interface AXQueryActionInput {
  pid: number
  query: string
  roles: string[]
  action: 'focus' | 'press'
  actionName?: string
  windowBounds: Bounds
}

export interface AXQueryActionResult {
  role: string
  text: string
  bounds?: Bounds
  focusedBefore?: boolean
  action: string
}

function axQueryActionScript(): string {
  return String.raw`
import ApplicationServices
import Foundation

struct BoundsJSON: Encodable {
  let x: Int
  let y: Int
  let width: Int
  let height: Int
}

struct MatchJSON: Encodable {
  let role: String
  let text: String
  let bounds: BoundsJSON?
  let focusedBefore: Bool?
  let action: String
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
  guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as String as CFString, &posValue) == .success,
        AXUIElementCopyAttributeValue(element, kAXSizeAttribute as String as CFString, &sizeValue) == .success
  else { return nil }
  guard CFGetTypeID(posValue) == AXValueGetTypeID(), CFGetTypeID(sizeValue) == AXValueGetTypeID() else { return nil }
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

func nodeText(_ element: AXUIElement) -> String {
  [kAXTitleAttribute, kAXValueAttribute, kAXDescriptionAttribute, kAXHelpAttribute]
    .compactMap { stringAttr(element, $0 as String) }
    .filter { !$0.isEmpty }
    .joined(separator: " ")
}

func pointInside(_ bounds: BoundsJSON, _ window: [String: Any]) -> Bool {
  let x = Double(bounds.x) + Double(bounds.width) / 2.0
  let y = Double(bounds.y) + Double(bounds.height) / 2.0
  let wx = window["x"] as? Double ?? 0
  let wy = window["y"] as? Double ?? 0
  let ww = window["width"] as? Double ?? 0
  let wh = window["height"] as? Double ?? 0
  return x >= wx && x <= wx + ww && y >= wy && y <= wy + wh
}

func matches(_ element: AXUIElement, roles: Set<String>, normalizedQuery: String, windowBounds: [String: Any]) -> Bool {
  guard let role = stringAttr(element, kAXRoleAttribute as String), roles.contains(role) else { return false }
  guard let bounds = boundsAttr(element), pointInside(bounds, windowBounds) else { return false }
  if normalizedQuery.isEmpty { return true }
  return nodeText(element).lowercased().contains(normalizedQuery)
}

func findMatch(_ element: AXUIElement, roles: Set<String>, normalizedQuery: String, windowBounds: [String: Any], visited: inout Int) -> AXUIElement? {
  visited += 1
  if visited > 5000 { return nil }
  if matches(element, roles: roles, normalizedQuery: normalizedQuery, windowBounds: windowBounds) {
    return element
  }
  var childrenRef: AnyObject?
  guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as String as CFString, &childrenRef) == .success,
        let children = childrenRef as? [AXUIElement]
  else { return nil }
  for child in children {
    if let found = findMatch(child, roles: roles, normalizedQuery: normalizedQuery, windowBounds: windowBounds, visited: &visited) {
      return found
    }
  }
  return nil
}

let environment = ProcessInfo.processInfo.environment
let rawInput = environment["COMPUTER_USE_SWIFT_STDIN"] ?? "{}"
let inputData = rawInput.data(using: .utf8) ?? Data()
let input = (try? JSONSerialization.jsonObject(with: inputData)) as? [String: Any] ?? [:]

let pid = input["pid"] as? Int ?? 0
let query = input["query"] as? String ?? ""
let roles = Set((input["roles"] as? [String] ?? []).filter { !$0.isEmpty })
let action = input["action"] as? String ?? ""
let actionName = input["actionName"] as? String ?? "AXPress"
let windowBounds = input["windowBounds"] as? [String: Any] ?? [:]

if pid <= 0 || roles.isEmpty {
  fputs("AX action requires pid and roles.\n", stderr)
  exit(2)
}

let app = AXUIElementCreateApplication(pid_t(pid))
var visited = 0
guard let target = findMatch(app, roles: roles, normalizedQuery: query.lowercased(), windowBounds: windowBounds, visited: &visited) else {
  fputs("No matching AX node found.\n", stderr)
  exit(3)
}

let role = stringAttr(target, kAXRoleAttribute as String) ?? ""
let text = nodeText(target)
let bounds = boundsAttr(target)
let focusedBefore = boolAttr(target, kAXFocusedAttribute as String)

if action == "focus" {
  let status = AXUIElementSetAttributeValue(target, kAXFocusedAttribute as CFString, kCFBooleanTrue)
  if status != .success {
    fputs("AX focus unavailable: \(status.rawValue)\n", stderr)
    exit(4)
  }
} else if action == "press" {
  let status = AXUIElementPerformAction(target, actionName as CFString)
  if status != .success {
    fputs("AX press unavailable: \(status.rawValue)\n", stderr)
    exit(5)
  }
} else {
  fputs("Unsupported AX action.\n", stderr)
  exit(6)
}

let output = MatchJSON(role: role, text: text, bounds: bounds, focusedBefore: focusedBefore, action: action)
let data = try JSONEncoder().encode(output)
print(String(data: data, encoding: .utf8)!)
`
}

export async function executeAXQueryAction(
  config: ComputerUseConfig,
  input: AXQueryActionInput,
): Promise<AXQueryActionResult> {
  const { stdout } = await runSwiftScript({
    swiftBinary: config.binaries.swift,
    timeoutMs: config.timeoutMs,
    source: axQueryActionScript(),
    stdinPayload: input,
  })

  return JSON.parse(stdout.trim()) as AXQueryActionResult
}
