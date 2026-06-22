import type { ComputerUseConfig } from '../config.js'
import type { ChromeWindowRef } from './types.js'
import { runProcess } from '../process.js'

export type ChromeAppleEventsTabCommand = 'inspect' | 'back' | 'forward' | 'reload'

export interface ChromeAppleEventsTabMetadata {
  tabId?: number
  activeTabIndex?: number
  url?: string
  title?: string
  loading?: boolean
}

export interface ChromeAppleEventsWindowEvidence {
  index: number
  id?: number
  bounds?: { x: number, y: number, width: number, height: number }
  title?: string
  activeTab?: ChromeAppleEventsTabMetadata
  matchReasons: string[]
}

export interface ChromeAppleEventsTabCommandResult {
  ok: boolean
  command: ChromeAppleEventsTabCommand
  deliveryPath: 'apple_events'
  reason?: string
  error?: string
  candidateCount: number
  matchingCandidateCount: number
  candidates: ChromeAppleEventsWindowEvidence[]
  selectedWindow?: ChromeAppleEventsWindowEvidence
  before?: ChromeAppleEventsTabMetadata
  after?: ChromeAppleEventsTabMetadata
}

export async function runChromeAppleEventsTabCommand(input: {
  config: ComputerUseConfig
  targetWindow: ChromeWindowRef
  command: ChromeAppleEventsTabCommand
}): Promise<ChromeAppleEventsTabCommandResult> {
  const result = await runProcess(
    input.config.binaries.osascript,
    ['-l', 'JavaScript', '-e', chromeAppleEventsScript(input.targetWindow, input.command)],
    { timeoutMs: input.config.timeoutMs },
  )

  if (!result.stdout || result.exitCode !== 0) {
    return {
      ok: false,
      command: input.command,
      deliveryPath: 'apple_events',
      reason: 'osascript_failed',
      error: result.stderr || `osascript exited ${result.exitCode}`,
      candidateCount: 0,
      matchingCandidateCount: 0,
      candidates: [],
    }
  }

  try {
    return JSON.parse(result.stdout.trim()) as ChromeAppleEventsTabCommandResult
  }
  catch (error) {
    return {
      ok: false,
      command: input.command,
      deliveryPath: 'apple_events',
      reason: 'invalid_apple_events_json',
      error: error instanceof Error ? error.message : String(error),
      candidateCount: 0,
      matchingCandidateCount: 0,
      candidates: [],
    }
  }
}

function chromeAppleEventsScript(targetWindow: ChromeWindowRef, command: ChromeAppleEventsTabCommand): string {
  return `
(function(){
  var targetWindow = ${JSON.stringify({
    title: targetWindow.title,
    bounds: targetWindow.bounds,
    windowNumber: targetWindow.windowNumber,
  })};
  var command = ${JSON.stringify(command)};
  var chrome = Application('Google Chrome');
  if (!chrome.running()) return JSON.stringify(fail('chrome_not_running', []));
  var windows = chrome.windows();
  if (!windows || windows.length === 0) return JSON.stringify(fail('no_chrome_windows', []));

  var candidates = [];
  for (var i = 0; i < windows.length; i++) {
    candidates.push(readWindowEvidence(windows[i], i + 1, targetWindow));
  }

  var matches = candidates.filter(function(candidate){ return candidate.matchReasons.indexOf('bounds_match') !== -1; });
  if (matches.length !== 1) {
    return JSON.stringify({
      ok: false,
      command: command,
      deliveryPath: 'apple_events',
      reason: matches.length === 0 ? 'target_window_not_found' : 'target_window_ambiguous',
      candidateCount: candidates.length,
      matchingCandidateCount: matches.length,
      candidates: candidates
    });
  }

  var selected = matches[0];
  var win = windows[selected.index - 1];
  var before = readActiveTab(win);
  try {
    if (command === 'back') win.activeTab().goBack();
    else if (command === 'forward') win.activeTab().goForward();
    else if (command === 'reload') win.activeTab().reload();
  } catch(e) {
    return JSON.stringify({
      ok: false,
      command: command,
      deliveryPath: 'apple_events',
      reason: 'tab_command_failed',
      error: e.message,
      candidateCount: candidates.length,
      matchingCandidateCount: matches.length,
      candidates: candidates,
      selectedWindow: selected,
      before: before
    });
  }
  var after = readActiveTab(win);
  selected.activeTab = after;
  return JSON.stringify({
    ok: true,
    command: command,
    deliveryPath: 'apple_events',
    candidateCount: candidates.length,
    matchingCandidateCount: matches.length,
    candidates: candidates,
    selectedWindow: selected,
    before: before,
    after: after
  });

  function fail(reason, candidates) {
    return {
      ok: false,
      command: command,
      deliveryPath: 'apple_events',
      reason: reason,
      candidateCount: candidates.length,
      matchingCandidateCount: 0,
      candidates: candidates
    };
  }

  function readWindowEvidence(win, index, target) {
    var bounds = readChromeWindowBounds(win);
    var activeTab = readActiveTab(win);
    var title = activeTab.title || safeRead(function(){ return String(win.name() || ''); });
    var evidence = {
      index: index,
      id: safeRead(function(){ return Number(win.id()); }),
      bounds: bounds,
      title: title,
      activeTab: activeTab,
      matchReasons: []
    };
    if (bounds && target.bounds && windowBoundsMatch(bounds, target.bounds)) evidence.matchReasons.push('bounds_match');
    if (target.title && title && (title === target.title || title.indexOf(target.title) !== -1 || target.title.indexOf(title) !== -1)) evidence.matchReasons.push('title_match');
    return evidence;
  }

  function readActiveTab(win) {
    try {
      var tab = win.activeTab();
      return {
        tabId: safeRead(function(){ return Number(tab.id()); }),
        activeTabIndex: safeRead(function(){ return Number(win.activeTabIndex()); }),
        url: safeRead(function(){ return String(tab.url() || ''); }),
        title: safeRead(function(){ return String(tab.title ? tab.title() : tab.name()); }),
        loading: safeRead(function(){ return Boolean(tab.loading()); })
      };
    } catch(e) {
      return {};
    }
  }

  function safeRead(fn) {
    try {
      var value = fn();
      return value === null || typeof value === 'undefined' ? undefined : value;
    } catch(e) {
      return undefined;
    }
  }

  function windowBoundsMatch(actual, target) {
    var tolerance = 16;
    return Math.abs(actual.x - target.x) <= tolerance
      && Math.abs(actual.y - target.y) <= tolerance
      && Math.abs(actual.width - target.width) <= tolerance
      && Math.abs(actual.height - target.height) <= tolerance;
  }

  function readChromeWindowBounds(win) {
    try {
      var raw = win.bounds();
      if (!raw) return undefined;
      if (typeof raw.length === 'number' && raw.length >= 4) {
        var left = Number(raw[0]);
        var top = Number(raw[1]);
        var right = Number(raw[2]);
        var bottom = Number(raw[3]);
        if (isFinite(left) && isFinite(top) && isFinite(right) && isFinite(bottom)) {
          return { x: left, y: top, width: right - left, height: bottom - top };
        }
      }
      var x = numberFromRecord(raw, ['x', 'left']);
      var y = numberFromRecord(raw, ['y', 'top']);
      var width = numberFromRecord(raw, ['width']);
      var height = numberFromRecord(raw, ['height']);
      var rightValue = numberFromRecord(raw, ['right']);
      var bottomValue = numberFromRecord(raw, ['bottom']);
      if (isFinite(x) && isFinite(y)) {
        if (isFinite(width) && isFinite(height)) return { x: x, y: y, width: width, height: height };
        if (isFinite(rightValue) && isFinite(bottomValue)) return { x: x, y: y, width: rightValue - x, height: bottomValue - y };
      }
    } catch(e) {}
    return undefined;
  }

  function numberFromRecord(record, keys) {
    for (var i = 0; i < keys.length; i++) {
      var value = record[keys[i]];
      if (typeof value !== 'undefined') {
        var numberValue = Number(value);
        if (isFinite(numberValue)) return numberValue;
      }
    }
    return NaN;
  }
})()
`
}
