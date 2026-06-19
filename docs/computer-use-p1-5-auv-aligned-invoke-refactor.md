# P1.5 AUV-Aligned Invoke Refactor

状态：P1.5.0 owner-review / implementation-scope reset。本文档不是 runtime 实现授权。

本文档定义 CareerDeepSeek computer-use 的 P1.5 重构计划。P1.5 的核心目标是把当前基于 `MacOSChromeAgentHarness` 的调试方式，调整为 AUV 风格的 primitive invoke、结构化 trace、分层 QA 闭环。P1.5.0 只重置 owner-review / implementation scope，不授权文档以外的 runtime 实现。

P1.5 不解决全部 browser correctness 问题。Chrome tab transition、browser session lease、人类扰动抵抗、结构化网页 overlay detection、完整 trace replay/inspect server 等内容进入 P2。

P1.5 纳入一个更小的 visual trace 目标：针对当前 run 生成静态 visual trace pack，让人和多模态模型可以直接检查截图、候选框、点击点、before/after 状态和失败原因。它不是完整 replay UI，也不是 AUV inspect server parity。

## P1.5 vs P1-5

本文中的 `P1.5` 是一个架构重构阶段，目标是引入 CDS 内部 invoke runtime、internal command catalog 和 primitive-first QA loop。

现有 `docs/computer-use-p1-evidence-action-scope.md` 中的 `P1-5 Text/OCR Row-Block Click` 是 P1 evidence/action scope 里的一个点击语义 slice。两者不是同一个阶段：

- `P1-5`：已有点击能力 slice，聚焦 text/OCR row-block click、promotion、liveness recheck 和 `action-execution`。
- `P1.5`：新增架构阶段，聚焦 AUV-aligned invoke 调用面和 QA 基建。

P1.5 不能绕过 P1-5 已经冻结的点击安全边界。凡是涉及 click candidate、liveness recheck、promoted candidate provenance、`action-execution` 的实现，仍必须服从 P1/P1-5 scope。

## Scope Authorization

本文档记录 P1.5.0 owner decisions，不自动授权 runtime 实现。

P1.5 若进入实现，必须先完成一轮 scope 授权更新，并再次获得 owner 确认。至少需要同步检查和更新：

- `docs/computer-use-auv-scope-freeze.md`
- `docs/computer-use-p1-evidence-action-scope.md`
- `docs/computer-use-testing-and-qa.md`
- `.opencode/skills/browser-use-policy/SKILL.md`
- computer-use public exports and registered tool policy, if an invoke entry becomes agent-facing

P1.5 允许讨论和设计 `internal CDS command catalog`。这不是 AUV public command catalog parity，不是 public API 扩张，也不自动授权 CLI、registered agent tool、MCP tool 或 production workflow 使用 invoke。

P1.5.8 后：

- browser-use policy 仍是执行约束。
- P1.5 programmatic invoke 是新 primitive work 的主调用面。
- 顶层 computer-use 入口暴露 P1.5 programmatic invoke API；`MacOSChromeAgentHarness` 不再是 approved workflow entry point。
- dev CLI、registered agent tool、MCP/server 和 public command catalog 仍不进入 P1.5。

## 背景

最近的 live QA 暴露出一个结构性问题：底层 driver primitive、agent harness、研究 workflow 混在一起验证。一次完整任务失败时，很难判断错误来自观察、识别、promotion、安全门、输入投递、页面变化判断，还是研究策略本身。

AUV 的 `invoke` 体系提供了更清晰的开发闭环：

```txt
command catalog
  -> invoke runtime
    -> driver operation
      -> trace / artifact / result
```

AUV 的价值不在 CLI 命令本身，而在于每个 primitive 能被独立调用、独立记录、独立检查。CDS 应该借鉴这个架构方式，但不能复制 AUV 的 desktop driver command set。CDS 的场景是 visible Chrome research session，有独立的 profile、foreground、window lease、hard-stop、public/private 数据边界和 browser-use policy。

## 已确认边界

P1.5 必须遵守以下边界：

- CareerDeepSeek 的目标仍然是原生 macOS Chrome computer-use driver。
- 网页内动作必须走 observe -> recognize -> promote -> action -> observe。
- 不使用 Playwright、CDP、raw HTTP、headless bulk scraping、direct DOM action。
- JXA / DOM 只能用于只读观测，不能执行网页动作。
- QA 脚本和 agent research workflow 必须分开。
- 写死页面流程只能用于 primitive QA，不能作为研究 workflow 结论。
- 当前 P0 scope-freeze 中 frozen artifact roles 继续有效。
- P1.5 只讨论 CDS internal command catalog；不新增生产级 public command catalog parity。
- P1.5 不引入完整 AUV desktop driver。
- P1.5 不引入 Chrome tab transition contract；该问题延后。
- P1.5 不引入结构化网页 overlay detector；dismissible overlay 识别与关闭策略延后。
- P1.5 允许最小静态 visual trace pack，但不引入完整 trace replay server。

## P1.5 总目标

建立 CDS 自己的 AUV-style invoke 基建，让 agent 和 QA 最终能直接调用 driver primitive，并获得结构化结果、trace artifact 和 failure class。

目标结果：

```txt
Agent / QA
  -> CDS invoke entry
    -> command catalog
      -> invoke runtime
        -> Chrome driver primitive
          -> trace / artifact / structured result
```

`MacOSChromeAgentHarness` 的降级已完成 policy switch：P1.5 新 primitive workflow / QA 使用 programmatic invoke API。Harness 只能作为直接子路径下的 legacy adapter 测试对象，不能作为顶层入口、QA 入口或 workflow 入口。

## 非目标

P1.5 不做以下事项：

- Chrome tab id/index/session transition 分类。
- 自动 browser recovery。
- 自动关闭新 tab。
- 通过 URL/title 猜测完整导航语义。
- 研究 workflow scoring、source ranking、company rubric 调整。
- AUV inspect server。
- AUV local run store 全量移植。
- 完整 interactive trace replay、inspect server、multi-run viewer。
- AUV display/window/screen generic command parity。
- 新 artifact role。
- 新网页动作通道。
- 结构化网页 overlay detector 或 overlay dismissal primitive。

## 设计原则

### 1. Primitive-first

每个底层能力都必须能被单独调用和测试。完整 agent workflow 不能作为 primitive 是否可靠的唯一验证方式。

### 2. Programmatic invoke is the target internal surface

P1.5 的目标状态是内部 agent / QA 代码通过 programmatic invoke API 调用 invoke command，而不是调用厚 harness helper。

允许存在薄 adapter，但它只做参数校验、命令转发、结果返回，不做隐藏 retry、自动恢复或研究判断。

在 browser-use policy 更新前，这只是目标架构，不覆盖当前 harness policy。

### 3. Harness is not the architecture center

`MacOSChromeAgentHarness` 过去混合了 primitive 编排、agent 便利封装、legacy overlay-dismissal heuristic、targetless scroll effect 判断和 recovery 倾向。P1.5 后，approved surface 只保留 invoke；dismissible overlay detection / dismissal、targetless scroll 和 browser recovery 不迁移、不新增、不 productize。

### 4. Trace before interpretation

每个 primitive 调用必须先产生结构化结果和 trace，再由 QA 或 research workflow 解释其含义。

### 5. Failure class must be explicit

失败不能只返回 generic error。`failure.class` 必须来自稳定枚举，`failure.code` 必须是稳定机器码，只有 `failure.message` 可以是人类可读自由文本。

至少要能区分：

- command resolution failure
- invalid input
- observe failure
- recognition failure
- promotion refusal
- safety gate refusal
- action delivery failure
- hard-stop / safety signal
- unknown runtime failure

### 6. Tab management delayed, unsafe recovery forbidden

P1.5 可以继续记录 active tab URL/title，但不声明完整 tab transition。任何自动 back、自动 close tab、自动切 tab 都不进入 P1.5。

### 7. Visual trace is inspection support, not a new action surface

P1.5 的 visual trace pack 只读取既有 trace/artifact，生成便于审查的静态报告。它不能引入新的浏览器动作，不能改变 action 判定，也不能绕过 artifact role 授权边界。HTML/JSON report 只是 QA 输出文件；若实现需要新增任何 trace artifact role，必须回到 P1.5.0 scope 授权。

### 8. All input actions require explicit target selection

P1.5 不允许 action command 依赖“当前鼠标位置刚好正确”或“当前键盘焦点刚好正确”。所有会投递输入的网页内动作都必须先通过 caller pre-action observation 建立明确目标；需要元素身份的动作再进入 recognition / promotion。

- pointer click 消费 promoted candidate。
- scroll 消费最近一次 `chrome.observe` 生成的 Chrome scroll region lease。它不消费 promoted candidate，也不接受 caller 坐标。
- keyboard input 必须先通过 promoted candidate 显式选中或聚焦目标，再投递 `typeText` / `pressKey`。
- action 后仍由调用者显式执行 caller post-action observation。

## 目标架构

### Layer 1: Chrome Primitive Driver

职责：

- Chrome profile / lease / foreground 检查。
- Chrome window capture。
- OCR / AX / read-only DOM observation。
- Recognition result。
- Candidate promotion。
- Safety gate。
- Pointer / keyboard / scroll action delivery。
- Trace artifact 写入。

边界：

- 不决定研究策略。
- 不隐藏 retry。
- 不自动恢复 browser navigation。
- 不提供 direct DOM action。

现有主要文件：

- `src/computer-use/macos-chrome-driver/driver.ts`
- `src/computer-use/macos-chrome-driver/types.ts`
- `src/computer-use/macos-chrome-driver/recognition.ts`
- `src/computer-use/macos-chrome-driver/candidate-promotion.ts`
- `src/computer-use/macos-chrome-driver/safety-gate.ts`
- `src/computer-use/macos-chrome-driver/trace-store.ts`

### Layer 2: CDS Invoke Runtime

职责：

- 定义 command catalog。
- resolve command id。
- 校验 command namespace / disturbance class。
- 构造 driver call。
- 调用 command handler。
- 记录 command span / driver span / event / artifact ref。
- 返回结构化 invoke result。

建议新增文件：

- `src/computer-use/macos-chrome-driver/invoke-types.ts`
- `src/computer-use/macos-chrome-driver/invoke-catalog.ts`
- `src/computer-use/macos-chrome-driver/invoke-runtime.ts`
- `src/computer-use/macos-chrome-driver/invoke-handlers.ts`

P1.5 初期可以复用现有 `TraceStore`，不移植 AUV run store。

### Layer 3: Invoke Entry

职责：

- 暴露给内部 agent / QA 代码。
- 接收 command id、target、inputs、dry-run。
- 返回 JSON result。

P1.5 入口：

- programmatic API

dev CLI、registered agent tool、MCP/server、public command catalog 都进入 P2。P1.5 的关键是先形成稳定 invoke contract 和 runtime，不让 CLI 或 tool wrapper 拥有执行语义。

### Layer 4: Legacy Harness Adapter

职责：

- 兼容短期已有调用。
- 作为人工脚本 convenience。
- 可逐步改为 invoke client。

边界：

- 不新增核心能力。
- 不承载 primitive QA。
- 不提供自动 recovery。
- 不作为新 workflow 的推荐入口。

### Layer 5: Research Workflow

职责：

- 判断页面是否有研究价值。
- 判断公司、团队、职位是否符合目标。
- 管理 evidence depth、stop criteria、source quality。
- 写入研究结果。

边界：

- 不直接调用 driver internals。
- 不绕过 invoke primitive。
- 不把固定 QA flow 当作研究策略。

### Layer 6: Minimum Visual Trace Inspect

职责：

- 读取当前 run 的 trace 目录。
- 解析 `run.json`、`spans.jsonl`、`events.jsonl`、`artifacts.jsonl`。
- 解析既有 screenshot、observation、recognition、promoted-candidate、action-execution artifact refs。
- 生成静态 visual trace pack。
- 呈现 command sequence、before/after screenshot、candidate bounds、click point、failure class/code、known limits。

边界：

- 不启动 browser。
- 不执行网页动作。
- 不新增 replay controller。
- 不提供 multi-run viewer。
- 不等同 AUV inspect server。
- 不把报告本身作为 action evidence。

## Invoke Contract 草案

以下为 P1.5 候选 contract。具体字段需在实现前再次审查。

```ts
export type ComputerUseCommandNamespace
  = | 'observe'
    | 'verify'
    | 'prepare'
    | 'action'
    | 'test'

export type ComputerUseDisturbanceClass
  = | 'none'
    | 'focus'
    | 'foreground_app'
    | 'keyboard'
    | 'pointer'

export interface ComputerUseCommandSpec {
  id: string
  summary: string
  namespace: ComputerUseCommandNamespace
  driverId: 'macos.chrome'
  operation: string
  mutatesPage: boolean
  deliversInput: boolean
  mayActivateChrome: boolean
  disturbanceClasses: ComputerUseDisturbanceClass[]
  maxDisturbance: ComputerUseDisturbanceClass
}

export interface ComputerUseInvokeRequest {
  commandId: string
  target?: {
    profile?: 'managed'
    window?: 'leased_chrome_window'
  }
  inputs?: Record<string, unknown>
  dryRun?: boolean
}

export type ComputerUseInvokeStatus = 'completed' | 'failed' | 'refused'

export type ComputerUseFailureClass
  = | 'command_resolution'
    | 'invalid_input'
    | 'observe'
    | 'recognition'
    | 'candidate_promotion'
    | 'candidate_provenance'
    | 'safety_gate'
    | 'action_delivery'
    | 'hard_stop'
    | 'trace_artifact'
    | 'runtime_unknown'

export interface ComputerUseInvokeResult {
  commandId: string
  status: ComputerUseInvokeStatus
  summary: string
  output?: unknown
  signals: string[]
  artifacts: ArtifactRef[]
  failure?: {
    class: ComputerUseFailureClass
    code: string
    message: string
  }
  knownLimits: string[]
}
```

Contract 规则：

- `dryRun` 只能 resolve command 和校验输入，不触发 live action。
- `dryRun` 不建立 Chrome lease，不激活 Chrome，不验证 live candidate，不运行 safety gate。
- `action` namespace 必须通过 safety gate。
- pointer action 必须消费 traced `promoted-candidate` artifact。
- command result 不能吞掉 driver refusal。
- failure class 和 failure code 必须稳定，便于 QA 聚合。
- P1.5 授权 `action-execution.grounding` 记录动作消费的 grounding，并授权 `action-execution.scroll_region` 记录 `chrome.scroll` 消费的 observe-derived Chrome scroll region lease、anchor、delivery path 和 fallback reason。除此之外，P1.5 不授权新增 action-result schema 或新的 `action-execution` schema field；invoke linkage 只能通过 invoke result、trace span/event 和既有 artifact refs 表达。

## Observation Terminology

P1.5 必须区分三类 observation：

1. `caller pre-action observation`
   - 调用者显式执行的 action 前观察。
   - 典型序列是 `chrome.observe -> chrome.recognize -> chrome.promote`。
   - 这层 observation 用于发现 visible evidence 和生成 candidate。

2. `driver liveness recheck observation`
   - `MacOSChromeDriver.click()` 内部的安全边界。
   - 它必须保留，用于重新观察当前 Chrome window、重新匹配 promoted candidate、重新投影点击点。
   - invoke runtime 不能用外部 pre-action observation 替代这层 recheck。

3. `caller post-action observation`
   - 调用者显式执行的 action 后观察。
   - 用于判断页面是否变化、是否出现 hard-stop、是否需要下一步。
   - P1.5 runtime 不自动隐藏执行 post-action observation，也不把它包装成 click command 的隐式行为。

因此，推荐 agent command sequence 是：

```txt
chrome.observe
chrome.recognize
chrome.promote
chrome.clickCandidate
chrome.observe
```

其中最后一个 `chrome.observe` 是 caller post-action observation。

## Candidate Provenance

`chrome.clickCandidate` 是 P1.5 最敏感的 action command。初版 provenance 规则必须保守：

- 只支持 same live driver session 内消费 promoted candidate。
- 主要输入是 `candidateLocalId`，对应当前 driver session 内部已经登记的 promoted-candidate record。
- 可选输入 `candidateRef` 只能用于交叉校验 artifact identity，不作为 TraceStore artifact resolver。
- P1.5 不实现从 TraceStore 读取历史 `promoted-candidate` artifact 并恢复 action candidate。
- P1.5 不接受 raw `PromotedCandidate` JSON 作为 action 输入。
- 若 `candidateLocalId` 不存在、session 不匹配、artifact ref 不匹配、candidate TTL 过期，必须拒绝。
- forged or mismatched candidate refusal 必须返回 `failure.class = 'candidate_provenance'`。

候选 input shape：

```ts
interface ClickCandidateInputs {
  candidateLocalId: string
  candidateRef?: ArtifactRef
}
```

这保持了现有 driver 的安全模型：promotion 产生 candidate 和 artifact，click 只能消费同一 live driver session 中可验证的 promoted candidate。

## Failure Class Mapping

P1.5 初版 failure class 使用稳定枚举。handler 可以保留更细的 `failure.code`，但 `failure.class` 不能临时发明。

| Source condition | failure.class | failure.code example |
| --- | --- | --- |
| Unknown command id | `command_resolution` | `unknown_command` |
| Input schema invalid | `invalid_input` | `missing_candidate_local_id` |
| Driver observe throws | `observe` | `observe_failed` |
| Recognition found no candidate | `recognition` | `recognition_not_found` |
| Promotion refused | `candidate_promotion` | existing promotion refusal code |
| Candidate not found in same session | `candidate_provenance` | `candidate_not_in_session` |
| Candidate artifact ref mismatch | `candidate_provenance` | `candidate_ref_mismatch` |
| Safety gate failure | `safety_gate` | existing `SafetyFailure.code` |
| Hard-stop signal detected | `hard_stop` | `hard_stop_signal` |
| OS event delivery failed | `action_delivery` | `action_execution_error` |
| Trace artifact write/read failure | `trace_artifact` | `artifact_write_failed` |
| Unclassified runtime error | `runtime_unknown` | `unknown_error` |

## 第一批命令

### Data-read-only commands

```txt
chrome.observe
chrome.recognize
chrome.checkSafetyGate
```

要求：

- 不修改网页数据。
- 不点击、不输入、不滚动。
- 可以扰动 OS foreground/focus；该能力必须在 command spec 中通过 `mayActivateChrome` 和 `disturbanceClasses` 显式声明。
- 返回 output、signals、artifact refs、known limits。

候选 command metadata：

| Command | Namespace | mutatesPage | deliversInput | mayActivateChrome | Disturbance |
| --- | --- | --- | --- | --- | --- |
| `chrome.observe` | `observe` | false | false | true | `foreground_app` |
| `chrome.recognize` | `observe` | false | false | false | `none` |
| `chrome.checkSafetyGate` | `verify` | false | false | false | `none` |

### Prepare commands

```txt
chrome.promote
```

要求：

- `chrome.promote` 不投递输入，不写 `action-execution`。
- `chrome.promote` 只产生或拒绝 `promoted-candidate`。
- `promoted-candidate` 是后续 pointer action 的候选证据，不是 action delivery 证据。

候选 command metadata：

| Command | Namespace | mutatesPage | deliversInput | mayActivateChrome | Disturbance |
| --- | --- | --- | --- | --- | --- |
| `chrome.promote` | `prepare` | false | false | false | `none` |

### Action commands

```txt
chrome.clickCandidate
chrome.focusTextInput
chrome.typeText
chrome.pressKey
chrome.scroll
```

要求：

- `chrome.clickCandidate` 必须消费 `ocr_anchor` 或 OCR-derived `visual_row` grounded `promoted-candidate` artifact，并拒绝 `ax_node`。
- `chrome.focusTextInput` 必须消费同一 command sequence 中 promoted 的 `ax_node` text-input candidate；这是 `typeText` / `pressKey` 的 focus provenance 来源。
- `chrome.scroll` 必须消费最近一次 `chrome.observe` 生成的 Chrome scroll region lease，不能依赖当前鼠标位置或 caller 坐标。
- `chrome.typeText`、`chrome.pressKey` 必须在同一 audited command sequence 中跟随一次成功的 promoted target focus/selection，不能依赖当前键盘焦点。
- 所有 `action` namespace command 都必须写 `action-execution` artifact。
- post-action caller observation 由调用者显式调用，runtime 不隐藏自动 workflow。

候选 command metadata：

| Command | Namespace | mutatesPage | deliversInput | mayActivateChrome | Disturbance | Target requirement |
| --- | --- | --- | --- | --- | --- | --- |
| `chrome.clickCandidate` | `action` | true | true | true | `pointer` | promoted candidate |
| `chrome.focusTextInput` | `action` | true | true | true | `focus` | promoted `ax_node` text input |
| `chrome.typeText` | `action` | true | true | true | `keyboard` | audited focused target |
| `chrome.pressKey` | `action` | true | true | true | `keyboard` | audited focused target |
| `chrome.scroll` | `action` | false | true | true | `pointer` | observe-derived Chrome scroll region lease |

### Deferred commands

```txt
chrome.detectWebPageOverlayNodes
chrome.dismissPageInterruption
chrome.tabs.snapshot
chrome.navigation.diff
chrome.browser.back
chrome.browser.closeTab
```

`chrome.detectWebPageOverlayNodes` 和 `chrome.dismissPageInterruption` 不进入 P1.5。原因是现阶段尚未确认清晰的结构化判据：仅靠 cookie/ad/accept 等文本匹配会把正文内容误判成 overlay。未来若重启，必须先定义 DOM/AX/OCR 的证据边界，并证明存在悬浮、遮挡、topmost、viewport coverage 等结构信号。

P1.5 只保留 hard-stop / safety signal 暴露，例如 `confirm you're a real person`、captcha、人类验证等不可自动处理状态。可关闭 cookie/marketing overlay 的识别和关闭，不在 P1.5 productize。

tab、navigation、browser recovery 相关命令依赖 browser-level liveness 和 transition contract，不进入 P1.5。

## 分阶段计划

### P1.5.0 Scope Reset

目标：冻结 P1.5 边界，完成 scope 授权更新，修正文档中的旧设计假设。

范围：

- 新增本设计文档。
- 更新 `docs/computer-use-auv-scope-freeze.md`，明确 internal CDS invoke catalog 与 public AUV catalog parity 的边界。
- 更新 `docs/computer-use-p1-evidence-action-scope.md`，明确 P1.5 不绕过 P1/P1-5 promoted candidate 和 action evidence 规则。
- 更新 browser-use policy / testing docs 中与 harness primary path、Back recovery 冲突的说法。
- 明确 harness 到 invoke 的迁移阶段和 source of truth。
- 明确 tab transition 延后。

不做：

- 不写 runtime。
- 不改 driver 行为。
- 不改 QA 脚本。

验收：

- 文档明确 P1.5 的目标、非目标、分层、阶段。
- 文档明确 `MacOSChromeAgentHarness` 降级。
- 文档明确 unsafe recovery 禁止。
- scope-freeze、P1 scope、browser-use policy、testing/QA 之间没有互相冲突的 primary path 表述。
- owner 明确确认 P1.5 可以进入实现。

### P1.5.1 Invoke Contract

目标：新增 invoke 类型和 command catalog。

范围：

- 定义 invoke request/result/spec 类型。
- 定义 namespace、data mutation、input delivery、Chrome activation 和 disturbance class。
- 定义第一批 command specs。
- 支持 command resolve 和 dry-run。

建议文件：

- `src/computer-use/macos-chrome-driver/invoke-types.ts`
- `src/computer-use/macos-chrome-driver/invoke-catalog.ts`
- `test/computer-use/invokeCatalog.test.ts`

不做：

- 不调用真实 driver。
- 不新增 CLI。
- 不修改 harness。

验收：

- unknown command 返回明确错误。
- dry-run 能返回 command spec。
- command spec 含 namespace、operation、disturbance。
- dry-run 不建立 lease、不激活 Chrome、不运行 safety gate、不验证 live candidate。
- 单测覆盖 command resolve、unknown command、namespace metadata。

### P1.5.2 Invoke Runtime Skeleton

目标：建立 runtime 主路径。

范围：

- 新增 `invoke(request)`。
- 支持 fake handler。
- 记录 command resolution、handler invocation、success/failure。
- 返回结构化 result。

建议文件：

- `src/computer-use/macos-chrome-driver/invoke-runtime.ts`
- `src/computer-use/macos-chrome-driver/invoke-handlers.ts`
- `test/computer-use/invokeRuntime.test.ts`

不做：

- 不接 live Chrome。
- 不接 action command。
- 不新增 artifact role。

验收：

- fake command success 有 result。
- fake command failure 有 failure class。
- runtime 不吞异常。
- trace span/event 可检查。

### P1.5.3 Data-Read-Only Commands

目标：把 data-read-only primitive 接入 invoke。

范围：

- `chrome.observe`
- `chrome.recognize`
- `chrome.checkSafetyGate`

建议文件：

- `src/computer-use/macos-chrome-driver/invoke-handlers.ts`
- `test/computer-use/invokeReadOnlyCommands.test.ts`

不做：

- 不投递任何输入。
- 不修改 candidate promotion。
- 不新增 overlay productization。
- 不改 harness。

验收：

- 每个命令可以独立调用。
- result 包含 output、signals、artifacts、knownLimits。
- observe 产出 `observation-snapshot` artifact。
- recognize 产出 `recognition-result` artifact。
- 每个 command 明确 `mutatesPage`、`deliversInput`、`mayActivateChrome`、`disturbanceClasses`。
- hard-stop/safety signal 通过 `chrome.checkSafetyGate` 或 observe result 暴露，不新增 `chrome.detectWebPageOverlayNodes`。

### P1.5.4 Prepare and Action Commands

目标：把 prepare primitive 和 mutating primitive 接入 invoke。

范围：

- `chrome.promote`
- `chrome.clickCandidate`
- `chrome.focusTextInput`
- `chrome.typeText`
- `chrome.pressKey`
- `chrome.scroll`

建议文件：

- `src/computer-use/macos-chrome-driver/invoke-handlers.ts`
- `test/computer-use/invokeActionCommands.test.ts`

不做：

- 不自动 observe after action。
- 不自动 back。
- 不自动 close tab。
- 不判断完整 navigation transition。
- 不实现 TraceStore artifact resolver。
- 不接受 raw `PromotedCandidate` JSON 作为 action 输入。

验收：

- `chrome.promote` 属于 `prepare` namespace，不写 `action-execution`。
- `chrome.promote` 成功时只写 `promoted-candidate` artifact。
- `clickCandidate` 缺少 traced candidate artifact 时拒绝。
- `clickCandidate` 只消费 same live driver session 的 `candidateLocalId`，可选 `ArtifactRef` 只做交叉校验。
- `clickCandidate` 拒绝 `ax_node` grounding；`ax_node` 只能由 `focusTextInput` 消费。
- `focusTextInput` 只消费同一 command sequence 的 promoted `ax_node` text-input candidate，并在成功后记录 keyboard focus provenance。
- forged、mismatched、expired candidate 返回 `candidate_provenance` failure class。
- `typeText`、`pressKey`、`scroll` 仍走 safety gate。
- `typeText`、`pressKey` 缺少 audited focused target 时拒绝。
- `scroll` 缺少 observe-derived Chrome scroll region lease 时拒绝。
- action command 不读取或信任隐式 OS mouse position / keyboard focus 作为目标来源。
- action failure 返回 stable failure class。
- `action-execution` artifact 继续满足 frozen role contract。
- scroll 返回 visible-change 层面的结果，不声称完整页面边界。

### P1.5.5 Minimum Visual Trace Inspect

目标：为当前 run 生成静态 visual trace pack，缩短调试闭环，让人和多模态模型能直接检查 driver 行为。

范围：

- 读取当前 trace root。
- 解析 `run.json`、`spans.jsonl`、`events.jsonl`、`artifacts.jsonl`。
- 解析既有 screenshot、observation-snapshot、recognition-result、promoted-candidate、action-execution artifact refs。
- 生成静态报告文件，例如 `visual-trace-report.html` 和 `visual-trace-report.json`。
- 报告中展示 command sequence、artifact list、before/after screenshot、candidate boxes、click point、failure class/code、known limits。
- 报告必须能被人工审查，也必须能被多模态模型通过截图和本地文件路径审查。

建议文件：

- `src/computer-use/macos-chrome-driver/trace-visual-report.ts`
- `test/computer-use/traceVisualReport.test.ts`
- `docs/computer-use-testing-and-qa.md`

不做：

- 不启动 Chrome。
- 不执行任何 action。
- 不实现 replay controller。
- 不实现 AUV inspect server。
- 不实现 multi-run viewer。
- 不新增 production agent command。
- 不把 visual report 当成 action evidence。
- 不新增任何 artifact role；HTML/JSON report 只是 QA 输出文件。若必须新增 QA-only report artifact role，先回到 P1.5.0 scope authorization。

验收：

- 给定 fixture trace，报告能稳定生成。
- 报告没有 missing artifact ref。
- 报告能显示至少一个 observation screenshot。
- 对 click flow，报告能显示 candidate bounds 和 click point。
- 对 failed/refused flow，报告能显示 failure class、failure code 和 known limits。
- 输出文件路径能进入 live QA 最小输出 schema。

### P1.5.6 Programmatic Invoke API Surface

目标：让内部 agent / QA 代码能通过 programmatic API 调用 invoke command。

范围：

- 暴露 programmatic invoke entry。
- entry 只做参数校验和命令转发。
- dev CLI、registered agent tool、MCP/server、public command catalog 不进入 P1.5。

建议文件：

- `src/computer-use/macos-chrome-driver/index.ts`
- 可能新增 `src/computer-use/macos-chrome-driver/invoke-entry.ts`

不做：

- 不提供 `clickObservedLink()` 作为核心 API。
- 不新增 dev CLI。
- 不新增 registered agent tool。
- 不新增 MCP/server entry。
- 不新增 public command catalog。
- 不做 hidden retry。
- 不做 browser recovery。
- 不做 research source judgment。
- 不在 browser-use policy 更新前替代 production harness path。

验收：

- 内部 agent / QA 能按以下 audited sequences 逐步调用：

```txt
# click target
chrome.observe
chrome.recognize
chrome.promote
chrome.clickCandidate
chrome.observe

# keyboard input into selected target
chrome.observe
chrome.recognize
chrome.promote
chrome.focusTextInput
chrome.typeText
chrome.observe

# scroll observed Chrome region
chrome.observe
chrome.scroll
chrome.observe
```

- 每一步都有独立 result。
- 每一步都能定位 trace artifact。
- QA 可以复现 agent 的 command sequence。
- keyboard / scroll action 不允许裸调用；必须有明确 target / focus provenance。

### P1.5.7 QA Rebuild

目标：重建 primitive-first QA 矩阵。

QA 分层：

```txt
unit tests
  -> invoke contract / catalog / runtime

driver integration tests
  -> observe / recognize / promote / safety gate / action execution

live primitive QA
  -> Google sponsored collapse
  -> scroll visible-change
  -> hard-stop detection
  -> click candidate delivery

agent workflow QA
  -> only after primitive QA passes
```

建议文件：

- `docs/computer-use-testing-and-qa.md`
- `test/computer-use/*`
- live QA scripts path 需实现前确认。

不做：

- 不把 live QA 写成固定 research workflow。
- 不点 `gov.uk` / civil service 作为职业目标候选。
- 不把 QA 结果写成公司研究结论。

验收：

- 每个 live QA case 输出 command sequence。
- 每个 live QA case 输出 trace path 和 artifact path。
- 每个 live QA case 输出 visual trace report path，或说明未生成原因。
- 每个失败有 failure class。
- deterministic tests 不编码固定 Google/LinkedIn research workflow。

Live QA 最小输出 schema：

```json
{
  "case_id": "google-sponsored-collapse",
  "command_sequence": [
    "chrome.observe",
    "chrome.recognize",
    "chrome.promote",
    "chrome.clickCandidate",
    "chrome.observe"
  ],
  "trace_root": "path-or-run-id",
  "artifact_refs": [],
  "visual_report": "path-or-null",
  "status": "completed|failed|refused",
  "failure_class": "candidate_provenance",
  "failure_code": "candidate_not_in_session",
  "known_limits": []
}
```

`failure_class` 和 `failure_code` 可以为 `null` only when status is `completed`。

### P1.5.8 Harness Downgrade And Legacy Surface Removal

目标：将 `MacOSChromeAgentHarness` 从 primary path 降级，并从 approved P1.5 surface 移除旧 action helper。

范围：

- 文档不再推荐 harness 作为核心调用面。
- 新 QA 不依赖 harness。
- harness 不从顶层 computer-use 入口或 macOS Chrome barrel 导出。
- `scrollDown()` / `scrollUp()` targetless scroll helper 移除。
- `dismissKnownOverlay()` dismissible overlay helper 移除。
- 后续可将 harness 改为 invoke client。

建议文件：

- `src/computer-use/macos-chrome-driver/agent-harness.ts`
- `test/computer-use/macosChromeAgentHarness.test.ts`
- `.opencode/skills/browser-use-policy/SKILL.md`

不做：

- 不在 P1.5.8 之前破坏现有测试。
- 不删除仍被直接子路径测试覆盖的 harness class。
- 不新增 harness semantic helper。

验收：

- harness 测试只覆盖 adapter 行为。
- 新 invoke tests 成为 primary primitive test。
- `goBack()` 不再作为 canonical recovery path。
- targetless scroll 和 dismissible overlay detection / dismissal 不迁移、不新增、不 productize；P1.5 只暴露 hard-stop / safety signal。
- 顶层 `src/computer-use/index.ts` 导出 `createMacOSChromeInvokeEntry`，不导出 driver/harness runtime。

### P1.5.9 Review Gate

目标：每个阶段都有独立审查材料。

每阶段完成时必须提供：

- diff summary
- touched files
- test command
- passing/failing status
- example invoke result
- trace artifact 示例
- visual trace report 示例，或未生成原因
- known limits
- 下一阶段是否需要新增机制
- 是否新增接口、分层、runtime path、artifact payload field、tool entry、public export
- 若有新增机制，是否已经回到 owner 确认

每阶段禁止：

- 顺手修改 research workflow。
- 顺手引入 tab/session model。
- 顺手修改 scoring rubric。
- 顺手扩展 browser automation 权限。
- 顺手新增 artifact role。
- 顺手把 review draft 当作实现授权。

## 推荐实施顺序

```txt
P1.5.0 Scope Reset
P1.5.1 Invoke Contract
P1.5.2 Invoke Runtime Skeleton
P1.5.3 Data-Read-Only Commands
P1.5.4 Prepare and Action Commands
P1.5.5 Minimum Visual Trace Inspect
P1.5.6 Programmatic Invoke API Surface
P1.5.7 QA Rebuild
P1.5.8 Harness Downgrade
P1.5.9 Review Gate
```

## 实现前检查项

P1.5.0 owner decisions 已经收敛以下边界。每个后续实现阶段开始前，必须检查计划 diff 是否仍符合这些条件：

1. P1.5.0 是 owner-review / implementation-scope reset；除本文档和关联 policy 文档更新外，不授权 runtime 实现。
2. P1.5 从 programmatic invoke API 开始；dev CLI、registered agent tool、MCP/server、public command catalog 全部留在 P2。
3. `MacOSChromeAgentHarness` 在 P1.5 invoke 实现并完成 policy 更新后不再是 approved workflow entry point；顶层入口必须是 programmatic invoke API。
4. `chrome.promote` 归入 `prepare` namespace，并禁止写 `action-execution`。
5. caller post-action observation 必须由调用者显式执行；action command 不隐藏自动 post-observe。
6. live primitive QA 必须输出 command sequence、trace/artifact refs、`visual_report` path、stable failure class/code，并与 research workflow 分离。
7. P1.5 授权 `action-execution.grounding` 作为动作 consumed grounding 的 trace 字段，并授权 `action-execution.scroll_region` 作为 `chrome.scroll` 的 region/anchor/delivery provenance 字段；除此之外不新增 action-result schema 或新的 `action-execution` schema field。invoke linkage 留在 invoke result、trace span/event 和既有 artifact refs。
8. `clickCandidate` 初版只接受 same live driver session 的 `candidateLocalId`，可选 `candidateRef` 仅用于交叉校验，不实现 TraceStore artifact resolver。
9. `chrome.detectWebPageOverlayNodes`、dismissible overlay detector / dismissal primitive、browser recovery/back/close、Chrome tab transition 全部留在 P2；P1.5 只暴露 hard-stop / safety signal。
10. visual trace pack 保持 QA file-only；不新增 artifact role、action result shape、public export，且除 `action-execution.grounding` 和 scroll-only `action-execution.scroll_region` 外不新增 trace schema field。

任何实现计划如果需要突破这些检查项，必须先回到 scope authorization。
