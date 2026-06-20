/**
 * macOS desktop action executors — CGEvent mouse, keyboard, scroll, and
 * app control operations.
 *
 * Each action is implemented as an inline Swift script that calls Quartz
 * CGEvent APIs. The Swift source is compiled at runtime via `swift` CLI.
 *
 * These functions do NOT perform approval checks — that is the caller's
 * responsibility (actionPolicy.ts in CareerDeepSeek's automation layer).
 */

import type { ComputerUseConfig } from './config.js'
import type {
  MoveAndClickInput,
  PressKeysInput,
  ScrollInput,
  TypeTextInput,
} from './types.js'

import { runProcess } from './process.js'
import { runSwiftScript } from './swift-runner.js'

// ---------------------------------------------------------------------------
// Swift script builders
// ---------------------------------------------------------------------------

function moveAndClickScript(): string {
  return String.raw`
import CoreGraphics
import Foundation

func mouseButton(_ value: Int) -> CGMouseButton {
  switch value {
  case 1: return .right
  case 2: return .center
  default: return .left
  }
}

func mouseDownType(_ button: CGMouseButton) -> CGEventType {
  switch button {
  case .right: return .rightMouseDown
  case .center: return .otherMouseDown
  default: return .leftMouseDown
  }
}

func mouseUpType(_ button: CGMouseButton) -> CGEventType {
  switch button {
  case .right: return .rightMouseUp
  case .center: return .otherMouseUp
  default: return .leftMouseUp
  }
}

let environment = ProcessInfo.processInfo.environment
let rawInput = environment["COMPUTER_USE_SWIFT_STDIN"] ?? "{}"
let inputData = rawInput.data(using: .utf8) ?? Data()
let input = (try? JSONSerialization.jsonObject(with: inputData)) as? [String: Any] ?? [:]
let trace = input["pointerTrace"] as? [[String: Any]] ?? []
let buttonRaw = input["button"] as? Int ?? 0
let clickCount = input["clickCount"] as? Int ?? 1
let button = mouseButton(buttonRaw)
let source = CGEventSource(stateID: .combinedSessionState)

for point in trace {
  let x = point["x"] as? Double ?? 0
  let y = point["y"] as? Double ?? 0
  let delayMs = point["delayMs"] as? Int ?? 0
  let location = CGPoint(x: x, y: y)
  if let moveEvent = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: location, mouseButton: .left) {
    moveEvent.post(tap: .cgSessionEventTap)
  }
  if delayMs > 0 {
    usleep(useconds_t(delayMs * 1000))
  }
}

let lastPoint = trace.last
let x = lastPoint?["x"] as? Double ?? 0
let y = lastPoint?["y"] as? Double ?? 0
let location = CGPoint(x: x, y: y)

for _ in 0..<max(clickCount, 1) {
  if let down = CGEvent(mouseEventSource: source, mouseType: mouseDownType(button), mouseCursorPosition: location, mouseButton: button),
     let up = CGEvent(mouseEventSource: source, mouseType: mouseUpType(button), mouseCursorPosition: location, mouseButton: button) {
    down.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
    up.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
    down.post(tap: .cgSessionEventTap)
    up.post(tap: .cgSessionEventTap)
  }
}

print("{}")
`
}

function typeTextScript(): string {
  return String.raw`
import Carbon
import CoreGraphics
import Foundation

let environment = ProcessInfo.processInfo.environment
let rawInput = environment["COMPUTER_USE_SWIFT_STDIN"] ?? "{}"
let inputData = rawInput.data(using: .utf8) ?? Data()
let input = (try? JSONSerialization.jsonObject(with: inputData)) as? [String: Any] ?? [:]
let trace = input["pointerTrace"] as? [[String: Any]] ?? []
let text = input["text"] as? String ?? ""
let pressEnter = input["pressEnter"] as? Bool ?? false
let source = CGEventSource(stateID: .combinedSessionState)
let previousInputSource = TISCopyCurrentKeyboardInputSource()?.takeRetainedValue()
let asciiKeyMap: [String: (UInt16, CGEventFlags)] = [
  "a": (0, []), "b": (11, []), "c": (8, []), "d": (2, []), "e": (14, []), "f": (3, []), "g": (5, []), "h": (4, []),
  "i": (34, []), "j": (38, []), "k": (40, []), "l": (37, []), "m": (46, []), "n": (45, []), "o": (31, []),
  "p": (35, []), "q": (12, []), "r": (15, []), "s": (1, []), "t": (17, []), "u": (32, []), "v": (9, []),
  "w": (13, []), "x": (7, []), "y": (16, []), "z": (6, []),
  "0": (29, []), "1": (18, []), "2": (19, []), "3": (20, []), "4": (21, []), "5": (23, []), "6": (22, []),
  "7": (26, []), "8": (28, []), "9": (25, []),
  " ": (49, []), ".": (47, []), ",": (43, []), "/": (44, []), "\\": (42, []),
  "-": (27, []), "=": (24, []), "[": (33, []), "]": (30, []), ";": (41, []), "'": (39, []),
  "!": (18, .maskShift), "@": (19, .maskShift), "#": (20, .maskShift), "$": (21, .maskShift), "%": (23, .maskShift),
  "^": (22, .maskShift), "&": (26, .maskShift), "*": (28, .maskShift), "(": (25, .maskShift), ")": (29, .maskShift),
  "_": (27, .maskShift), "+": (24, .maskShift), "{": (33, .maskShift), "}": (30, .maskShift), "|": (42, .maskShift),
  ":": (41, .maskShift), "\"": (39, .maskShift), "<": (43, .maskShift), ">": (47, .maskShift), "?": (44, .maskShift)
]

func postKeyboard(_ keyCode: UInt16, _ flags: CGEventFlags = []) {
  if let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
     let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) {
    down.flags = flags
    up.flags = flags
    down.post(tap: .cgSessionEventTap)
    usleep(18000)
    up.post(tap: .cgSessionEventTap)
    usleep(12000)
  }
}

func postUnicode(_ charStr: String) {
  if let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
     let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) {
    down.keyboardSetUnicodeString(stringLength: 1, unicodeString: [unichar(charStr.utf16.first ?? 0)])
    up.keyboardSetUnicodeString(stringLength: 1, unicodeString: [unichar(charStr.utf16.first ?? 0)])
    down.post(tap: .cgSessionEventTap)
    usleep(12000)
    up.post(tap: .cgSessionEventTap)
    usleep(8000)
  }
}

func isUppercaseAsciiLetter(_ charStr: String) -> Bool {
  guard let scalar = charStr.unicodeScalars.first, charStr.unicodeScalars.count == 1 else { return false }
  return scalar.value >= 65 && scalar.value <= 90
}

func selectInputSource(id: String) -> Bool {
  let filter = [kTISPropertyInputSourceID as String: id] as CFDictionary
  guard let list = TISCreateInputSourceList(filter, false)?.takeRetainedValue() as? [TISInputSource] else {
    return false
  }
  for inputSource in list {
    if TISSelectInputSource(inputSource) == noErr {
      return true
    }
  }
  return false
}

func selectLatinInputSource() -> Bool {
  for id in ["com.apple.keylayout.US", "com.apple.keylayout.ABC"] {
    if selectInputSource(id: id) {
      return true
    }
  }
  return false
}

func restorePreviousInputSource() {
  if let previousInputSource {
    TISSelectInputSource(previousInputSource)
  }
}

if !selectLatinInputSource() {
  fputs("Could not select a Latin keyboard input source for computer-use typing.\n", stderr)
  exit(2)
}
defer {
  restorePreviousInputSource()
}

// First move the cursor via pointer trace (e.g., to focus a text field).
for point in trace {
  let x = point["x"] as? Double ?? 0
  let y = point["y"] as? Double ?? 0
  let delayMs = point["delayMs"] as? Int ?? 0
  let location = CGPoint(x: x, y: y)
  if let moveEvent = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: location, mouseButton: .left) {
    moveEvent.post(tap: .cgSessionEventTap)
  }
  if delayMs > 0 {
    usleep(useconds_t(delayMs * 1000))
  }
}

// Then click at final position to focus the field.
if let lastPoint = trace.last {
  let location = CGPoint(x: lastPoint["x"] as? Double ?? 0, y: lastPoint["y"] as? Double ?? 0)
  if let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: location, mouseButton: .left),
     let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: location, mouseButton: .left) {
    down.post(tap: .cgSessionEventTap)
    up.post(tap: .cgSessionEventTap)
  }
  usleep(50000)
}

// Type each character individually with brief delays to prevent
// Electron/Vue textareas from dropping tail characters (12ms minimum).
for char in text {
  let charStr = String(char)
  if let spec = asciiKeyMap[charStr.lowercased()] {
    var flags = spec.1
    if isUppercaseAsciiLetter(charStr) {
      flags.insert(.maskShift)
    }
    postKeyboard(spec.0, flags)
  }
  else {
    postUnicode(charStr)
  }
}

if pressEnter {
  usleep(50000)
  postKeyboard(36)
}

print("{}")
`
}

function pressKeysScript(): string {
  return String.raw`
import CoreGraphics
import Foundation

let keyCodeMap: [String: UInt16] = [
  "a": 0, "b": 11, "c": 8, "d": 2, "e": 14, "f": 3, "g": 5, "h": 4,
  "i": 34, "j": 38, "k": 40, "l": 37, "m": 46, "n": 45, "o": 31,
  "p": 35, "q": 12, "r": 15, "s": 1, "t": 17, "u": 32, "v": 9,
  "w": 13, "x": 7, "y": 16, "z": 6,
  "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22,
  "7": 26, "8": 28, "9": 25,
  "enter": 36, "return": 36, "tab": 48, "space": 49, "escape": 53,
  "esc": 53, "delete": 51, "backspace": 51,
  "up": 126, "down": 125, "left": 123, "right": 124
]

let modifierFlags: [String: CGEventFlags] = [
  "command": .maskCommand, "cmd": .maskCommand,
  "shift": .maskShift, "control": .maskControl, "ctrl": .maskControl,
  "option": .maskAlternate, "alt": .maskAlternate
]

let environment = ProcessInfo.processInfo.environment
let rawInput = environment["COMPUTER_USE_SWIFT_STDIN"] ?? "{}"
let inputData = rawInput.data(using: .utf8) ?? Data()
let input = (try? JSONSerialization.jsonObject(with: inputData)) as? [String: Any] ?? [:]
let keys = input["keys"] as? [String] ?? []
let modifiers = input["modifiers"] as? [String] ?? []

var flags: CGEventFlags = []
for mod in modifiers {
  if let f = modifierFlags[mod.lowercased()] { flags.insert(f) }
}

let source = CGEventSource(stateID: .combinedSessionState)
for key in keys {
  guard let keyCode = keyCodeMap[key.lowercased()] else { continue }
  if let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
     let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) {
    down.flags = flags
    up.flags = flags
    down.post(tap: .cgSessionEventTap)
    usleep(12000)
    up.post(tap: .cgSessionEventTap)
    usleep(8000)
  }
}

print("{}")
`
}

function scrollScript(): string {
  return String.raw`
import CoreGraphics
import Foundation

let environment = ProcessInfo.processInfo.environment
let rawInput = environment["COMPUTER_USE_SWIFT_STDIN"] ?? "{}"
let inputData = rawInput.data(using: .utf8) ?? Data()
let input = (try? JSONSerialization.jsonObject(with: inputData)) as? [String: Any] ?? [:]
let trace = input["pointerTrace"] as? [[String: Any]] ?? []
let deltaX = input["deltaX"] as? Double ?? 0
let deltaY = input["deltaY"] as? Double ?? 600
let settleMs = input["settleMs"] as? Int ?? 0

let source = CGEventSource(stateID: .hidSystemState)
let currentLocation = CGEvent(source: nil)?.location ?? CGPoint(x: 0, y: 0)
let location: CGPoint
if let lastPoint = trace.last {
  location = CGPoint(x: lastPoint["x"] as? Double ?? 0, y: lastPoint["y"] as? Double ?? 0)
}
else {
  location = currentLocation
}
let originalLocation = CGEvent(source: nil)?.location ?? location

// Move cursor to target first if trace supplied
for point in trace {
  let x = point["x"] as? Double ?? 0
  let y = point["y"] as? Double ?? 0
  let delayMs = point["delayMs"] as? Int ?? 0
  let location = CGPoint(x: x, y: y)
  CGWarpMouseCursorPosition(location)
  if let moveEvent = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: location, mouseButton: .left) {
    moveEvent.post(tap: .cghidEventTap)
  }
  if delayMs > 0 {
    usleep(useconds_t(delayMs * 1000))
  }
}

// Post scroll event
if let scrollEvent = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: Int32(deltaY.rounded()), wheel2: Int32(deltaX.rounded()), wheel3: 0) {
  scrollEvent.post(tap: .cghidEventTap)
}

CGWarpMouseCursorPosition(originalLocation)

if settleMs > 0 {
  usleep(useconds_t(settleMs * 1000))
}

print("{}")
`
}

// ---------------------------------------------------------------------------
// Public action functions
// ---------------------------------------------------------------------------

export async function executeMoveAndClick(
  config: ComputerUseConfig,
  input: MoveAndClickInput,
): Promise<void> {
  await runSwiftScript({
    swiftBinary: config.binaries.swift,
    timeoutMs: config.timeoutMs,
    source: moveAndClickScript(),
    stdinPayload: input,
  })
}

export async function executeTypeText(
  config: ComputerUseConfig,
  input: TypeTextInput,
): Promise<void> {
  await runSwiftScript({
    swiftBinary: config.binaries.swift,
    timeoutMs: config.timeoutMs,
    source: typeTextScript(),
    stdinPayload: input,
  })
}

export async function executePressKeys(
  config: ComputerUseConfig,
  input: PressKeysInput,
): Promise<void> {
  await runSwiftScript({
    swiftBinary: config.binaries.swift,
    timeoutMs: config.timeoutMs,
    source: pressKeysScript(),
    stdinPayload: input,
  })
}

export async function executeScroll(
  config: ComputerUseConfig,
  input: ScrollInput,
): Promise<void> {
  await runSwiftScript({
    swiftBinary: config.binaries.swift,
    timeoutMs: config.timeoutMs,
    source: scrollScript(),
    stdinPayload: input,
  })
}

export async function executeOpenApp(
  config: ComputerUseConfig,
  appName: string,
  options: {
    args?: string[]
    newInstance?: boolean
  } = {},
): Promise<void> {
  const openArgs = [
    ...(options.newInstance ? ['-n'] : []),
    '-a',
    appName,
    ...(options.args?.length ? ['--args', ...options.args] : []),
  ]
  await runProcess(config.binaries.open, openArgs, {
    timeoutMs: config.timeoutMs,
  })
}
