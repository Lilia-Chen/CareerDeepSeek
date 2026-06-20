# 删除旧 Programmatic API — 架构决策与具体改动清单

**日期:** 2026-06-20
**阶段:** P2 Feature 1 前置清理
**决策:** 旧 programmatic session API 彻底删除，不做向后兼容。新 atomic API 是唯一路径。

---

## 为什么必须删

旧 API 不是 "另一种合法方式"——是引入了三个错误抽象层级，与 AUV 架构根本矛盾：

### 1. Handler 闭包状态

`createMacOSChromeInvokeHandlers` (invoke-handlers.ts:68-127) 维护跨调用的闭包变量：

```
latestRecognition       → chrome.recognize 写，chrome.promote 读
latestObservation       → chrome.recognize 读，chrome.scroll 读
promotedCandidates      → chrome.promote 写，chrome.clickCandidate/focusTextInput 读
latestFocusedTarget     → chrome.focusTextInput 写，chrome.typeText/pressKey 读
```

每个 CLI 调用创建新进程 → 新 handler registry → 闭包全是空的。这个设计根本不支持 Atomic CLI。

### 2. Driver 内部重复工作

旧 API 的 driver 方法不是原子操作——每个都在内部做多余的事：

```
driver.observe()               → capture + AX + DOM + OCR + OCR rows（全家桶）
driver.recognizeFromCapture()  → 重新 OCR + 重新 OCR rows + 读 #lastObservation.nodes 混入 DOM/AX
driver.promoteCandidate()      → 存 artifact 到 #promotedCandidateArtifacts
driver.click(candidate)        → #checkActionPreconditions + #recheckCandidateLiveness(又一次 observe+recognize!) + click
driver.focusTextInput()        → 同上 liveness 路径 + focus
driver.typeText()              → 读 #focusedTextInputLease（闭包依赖）
driver.pressKey()              → 读 #focusedTextInputLease（闭包依赖）
driver.scroll()                → 读 #scrollRegionLease（闭包依赖）
```

AUV 的 `click_window_text`：1 capture + 1 OCR + 1 click。旧 CDS 的 `chrome.clickCandidate`：2 capture + 2 OCR + liveness + click。多出 2x capture、2x OCR，根因就是 driver 层职责越界。

### 3. 与 AUV 架构根本矛盾

AUV 的 runtime.rs:342-359 只有一条 dispatch 路径：

```rust
direct_command = registry.resolve(&command_id)
→ invoke_direct_command_in_span(run, parent, request, command)
  → driver.invoke(&call)  // 单次调用，无跨调用状态
```

不存在 "programmatic session API" 和 "CLI command API" 双轨。每个 invoke 创建独立的 RecordingRun。CDS 要对齐，就必须只有一条路径。

---

## 删除范围：Driver 层

### 删除的 public/protected 方法 (6 个)

| 方法 | 行号 | 删除理由 |
|------|------|---------|
| `recognizeFromCapture()` | driver.ts:392 | re-runs OCR + reads `#lastObservation` implicitly |
| `promoteCandidate()` | driver.ts:502 | stores artifact in `#promotedCandidateArtifacts` — atomic commands don't need this |
| `click(candidate)` | driver.ts:549 | calls `#recheckCandidateLiveness` → double observe+recognize before every click |
| `focusTextInput(candidate)` | driver.ts:593 | same liveness path as click |
| `typeText(text)` | driver.ts:646 | reads `#focusedTextInputLease` — closure state |
| `pressKey(key, modifiers)` | driver.ts:654 | reads `#focusedTextInputLease` — closure state |

### 删除的 public 方法 (1 个)

| 方法 | 行号 | 删除理由 |
|------|------|---------|
| `scroll(deltaY, deltaX, options)` | driver.ts:659 | reads `#scrollRegionLease` — cross-call state from `observe()` |

### 保留的 public 方法 (3 个)

| 方法 | 行号 | 保留理由 |
|------|------|---------|
| `observe()` | driver.ts:212 | 只服务 `chrome.observe` 命令（agent 动作后查看页面状态）。删除对 `#focusedTextInputLease` 的 reset |
| `checkSafetyGate()` | driver.ts:207 | 只服务 `chrome.checkSafetyGate` |
| `traceSink` getter | driver.ts:203 | 供 invoke runtime 连接 trace 记录 |

### 删除的私有状态 (7 个)

```
#lastCapture                    → 删除。每个 handler 自己管理 capture，不存 driver 上
#lastObservation                → 删除。recognizeFromCapture/scroll 的隐式输入消失
#recognitionArtifacts           → 删除。promoteCandidate 的 artifact map 消失
#promotedCandidateArtifacts     → 删除。click/focusTextInput 的 provenance 验证消失
#focusedTextInputLease          → 删除。typeText/pressKey 的闭包依赖消失
#scrollRegionLease              → 删除。scroll 的跨调用依赖消失
#nextActionId                   → 删除。旧 action recording 计数器
```

### 删除的私有方法 (6 个)

```
#recheckCandidateLiveness()     → ~200 行。二次 observe+recognize+liveness checks
#executeAction()                → ~90 行。liveness + precondition + artifact recording wrapper
#recordActionExecution()        → ~30 行。旧 action artifact 写入
#captureEvidenceRefs()          → ~12 行。读 #lastObservation
#visibleTextForSafety()         → ~5 行。读 #lastObservation.nodes
#checkActionPreconditions()     → ~60 行。precondition + window re-observation
```

### 保留并简化的

```
constructor + session/run 管理      → 保留
#chromeContextLease                 → 保留，atomic commands 复用 Chrome 窗口解析
#ensureChromeContextLease()         → 保留
#requireLeasedChromeContext()       → 保留
#profileConfig                      → 保留
#runId, #spanId, #sessionId         → 保留
#traceStore                         → 保留
#nextObservationId, #nextRecognitionId → 保留，供 observe 和新的 atomic 操作使用
observe()                           → 简化：去掉 reset #focusedTextInputLease 那行
checkSafetyGate()                   → 简化：去掉 #visibleTextForSafety() 调用
```

### 预计净删除

driver.ts 当前 ~2400 行 → 删除 ~1500 行 → 剩余 ~900 行

---

## 删除范围：Handler 层

### 删除整个旧注册表

```
createMacOSChromeInvokeHandlers()  → 删除。invoke-handlers.ts:68-127
```

### 删除所有闭包变量 + 辅助类型

```
latestRecognition                    → 删
latestRecognitionTargetKind          → 删
latestFocusedTarget                  → 删
latestNonTextInputClickedTarget      → 删
latestObservation                    → 删
promotedCandidates: Map              → 删
resetActionSequence()                → 删

RegisteredPromotedCandidate (L129-133)    → 删
RegisteredFocusedTarget (L135-138)        → 删
```

### 删除旧 handler 函数 (8 个)

```
invokeRecognize()         → 删。改用 chrome.findText
invokePromote()           → 删。atomic click 不做 promote
invokeClickCandidate()    → 删。改用 chrome.clickText
invokeFocusTextInput()    → 删。改用 chrome.focusText / chrome.axFocusText
invokeTypeText(旧)        → 删。闭包依赖 latestFocusedTarget
invokePressKey(旧)        → 删。闭包依赖 latestFocusedTarget
invokeScroll(旧)          → 删。闭包依赖 latestObservation
invokeObserve(旧)         → 删。简化版不需要 resetActionSequence
```

### 删除旧辅助函数 (5 个)

```
parseCandidateLocalIdInput()     → 删。旧 clickCandidate/focusTextInput 的输入解析
requireFocusedCandidate()        → 删。旧 typeText/pressKey 的闭包验证
candidateProvenanceRefusal()     → 删。旧 candidate provenance 错误响应
mapDriverActionError()           → 删。旧 SAFETY_GATE_FAILURE_CODES 映射
SAFETY_GATE_FAILURE_CODES        → 删。旧 error code 集合
```

### 唯一的 handler 注册表

```
createMacOSChromeHandlers(driver: MacOSChromeInvokeDriver):
  → 13 个 handler，每个是纯函数 (inputs, driver) → ComputerUseInvokeResult
  → 不使用任何闭包状态
```

Handler 职责从 "编排多个 driver 方法" 降级为 "解析 inputs + 调用一个底层函数 + 包装输出"。

---

## 删除范围：Catalog 层

### 删除的 Command Specs (7 个)

```
chrome.recognize
chrome.promote
chrome.clickCandidate
chrome.focusTextInput
chrome.typeText       (旧的，闭包依赖)
chrome.pressKey       (旧的，闭包依赖)
chrome.scroll         (旧的，lease 依赖)
```

### 最终 Catalog (13 个)

```
chrome.observe             → observe, OBSERVE
chrome.checkSafetyGate     → verify, VERIFY

chrome.findText            → observe, OBSERVE (1 capture + 1 OCR + match)
chrome.clickText           → action, ACTION  (1 capture + 1 OCR + click)
chrome.findRows            → observe, OBSERVE (1 capture + rows)
chrome.clickRow            → action, ACTION  (1 capture + rows + click)

chrome.focusText           → action, ACTION  (1 AX + pointer focus)
chrome.axFocusText         → action, ACTION  (1 AX + AX focus attribute)
chrome.pressButton         → action, ACTION  (1 AX + pointer click)
chrome.axPressButton       → action, ACTION  (1 AX + AX press)

chrome.typeText            → action, ACTION  (active control only)
chrome.key                 → action, ACTION  (active app)
chrome.scrollRegion        → action, ACTION  (resolve window every call)
```

---

## 删除范围：Entry + Runtime 层

### invoke-entry.ts

```
删除 mode: 'cli' | 'programmatic' 参数
删除 createMacOSChromeCLIHandlers vs createMacOSChromeInvokeHandlers 二选一
改为：createMacOSChromeHandlers(driver) → 单一路径
```

### invoke-runtime.ts

```
删除 allowedCommandIds gate  → 不再是双轨，不需要 gate
删除 command_not_in_cli_surface 错误码
```

### invoke-handlers.ts（接口层）

```
MacOSChromeInvokeDriver 接口：
  删除 recognizeFromCapture, promoteCandidate, click, focusTextInput
  删除 typeText, pressKey, scroll
  删除 lastCapture getter
  保留 observe, checkSafetyGate
```

---

## 删除范围：Types 层

```
StoredPromotedCandidate           → 删。driver.#promotedCandidateArtifacts 消失
FocusedTextInputLease             → 删。driver.#focusedTextInputLease 消失
ChromeScrollRegionLease           → 删。driver.#scrollRegionLease 消失
ChromeViewportBoundsCandidate     → 删。scroll lease 辅助类型
ResolvedScrollRegionLease         → 删。scroll lease 辅助类型
CandidateLivenessCheck            → 删。#recheckCandidateLiveness 返回类型
ActionType                        → 删。#executeAction 参数类型
ActionExecutorResult              → 删。#executeAction 返回类型
```

---

## Spec 的 CLI Public Surface 改写

改前（双轨）：

```
CLI-exposed: chrome.observe, chrome.checkSafetyGate, chrome.findText, ...
Not exposed (programmatic only): chrome.recognize, chrome.promote, ...
```

改后（单轨）：

```
cds invoke supports 13 commands. There is no programmatic-only surface.
All commands are self-contained and invoke-able from CLI and programmatic API identically.
```

删掉 spec 里整段 "Do not expose these stateful programmatic commands"。

---

## Plan 变化

| 旧 Task | 变化 |
|---------|------|
| Task 1 (Atomic Types) | 不变 |
| Task 2 (Recognition Helpers) | 不变 |
| Task 3 (Atomic Command Adapter) | **删掉。** handler 直接调用底层函数，不需要 adapter 中间层 |
| Task 4-10 (逐命令实现) | 不变，但 handler 不再通过 `driver.atomicCommands.*` 调用——直接在 handler 内 compose captureChromeWindow + recognizeTextInImage + executeMoveAndClick 等 |
| Task 11 (Command Specs) | 只加新 11 个 spec，同时**删旧 7 个 spec** |
| Task 12 (CLI Handlers) | **删掉 `createMacOSChromeCLIHandlers` vs `createMacOSChromeInvokeHandlers` 双轨。** 改为单一 `createMacOSChromeHandlers` |
| Task 13 (Entry + Runtime) | 删掉 mode 路由和 allowlist gate |
| Task 14-15 (CLI + Guide) | 不变 |
| **新 Task** | **Driver 清理：** 删 `recognizeFromCapture/promoteCandidate/click/focusTextInput/typeText/pressKey/scroll` + 删私有状态 + 删 `#recheckCandidateLiveness/#executeAction/#recordActionExecution/#captureEvidenceRefs/#visibleTextForSafety/#checkActionPreconditions` |
| **新 Task** | **Types 清理：** 删 8 个旧 API 专用类型 |
| **新 Task** | **Handler 清理：** 删旧注册表 + 8 个旧 handler 函数 + 5 个旧辅助函数 |
