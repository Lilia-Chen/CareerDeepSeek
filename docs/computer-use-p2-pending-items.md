# Computer-Use P2 Pending Items

状态：pending record。本文档不是实现授权。

本文档记录从 P1.5 明确延后的 computer-use 架构、driver、QA 和 workflow 项。目的不是提前设计 P2，而是防止后续 session 把这些内容混入 P1.5。

P1.5.0 owner decisions 已确认：P1.5 从 internal programmatic invoke API 开始；dev CLI、registered agent tool、MCP/server、public command catalog、browser recovery/back/close、Chrome tab transition、结构化 overlay detector 和 dismissible overlay dismissal primitive 均不进入 P1.5。

P1.5 当前目标只覆盖：

- AUV-style internal invoke runtime。
- primitive-first command catalog。
- programmatic invoke API。
- observe / recognize / promote / action / explicit post-action observe。
- stable failure class。
- primitive-first QA 输出。
- minimum static visual trace pack。

除非 owner 明确重新授权 scope，以下 pending items 不得进入 P1.5 实现。

## P2-01 Chrome Browser Context Contract

状态：P2 pending。

问题：

CDS 当前只有 window-level liveness，缺少 browser-level liveness。点击 Google result 后可能 same-tab navigation，也可能打开新 tab、后台 tab、主动切 tab。仅看 active tab URL/title 会误判。

P2 候选范围：

- click 前记录 active tab id/index/url/title。
- click 前记录 all tabs snapshot。
- click 后重新记录 active tab 和 all tabs。
- 绑定 window number、pid、profile。
- 定义 tab snapshot schema。
- 定义 browser context trace artifact。

P2 入口条件：

- 已完成 P1.5 invoke command sequence 和 trace 基建。
- 已确认 JXA tab 观测是只读，不会触发网页动作。
- 已确认 tab id/index 的稳定性和 Chrome window 绑定策略。

## P2-02 Navigation Transition Classification

状态：P2 pending。

问题：

当前缺少 action 后 browser transition 模型，导致 “URL 没变 = 没导航” 这种错误判断。

P2 候选 transition：

- `same_tab_navigated`
- `new_active_tab_opened`
- `new_background_tab_opened`
- `active_tab_switched`
- `no_navigation`
- `unknown`

P2 入口条件：

- P2-01 browser context contract 已确认。
- 每类 transition 有可复现 fixture 或 live QA case。
- unknown transition 不触发自动 recovery。

## P2-03 Browser Recovery / Back / Close Policy

状态：P2 pending。

问题：

`harness.goBack()` 当前依赖 OCR 找 Back 按钮，语义不可靠。错误情况下盲目 `Cmd+Left` 会破坏浏览器状态。新 tab 场景也不应该默认 back。

P1.5 不实现 `chrome.browser.back`、`chrome.browser.closeTab` 或 Chrome tab transition。依赖 Chrome toolbar Back button 的恢复流程只能作为旧 workflow 行为被审查，不能进入 P1.5 invoke productization。

P2 候选范围：

- same-tab navigation 才允许 browser back。
- new active tab opened 是否 close tab 由 workflow 决策。
- background tab opened 只报告，不切 tab。
- unexpected active tab switch 进入 hard warning。
- unknown transition 不自动 revert。
- `chrome.browser.back`、`chrome.browser.closeTab` 等 browser action primitive 必须依赖 transition classification。

P2 入口条件：

- P2-02 transition classification 已落地。
- 每个 recovery primitive 有 safety gate 和 trace artifact。
- workflow 层明确何时允许恢复 browser 状态。

## P2-04 Structural Web Page Overlay Detection

状态：P2 pending。

问题：

仅靠 cookie、accept、ad、close 等文本匹配会把正文内容误判成 overlay。P1.5 不 productize `chrome.detectWebPageOverlayNodes`。

P2 候选判据：

- DOM 节点具备 fixed/sticky/modal/dialog 等结构信号。
- 节点处于 viewport topmost hit-test 路径。
- 节点覆盖 viewport 的显著区域，或遮挡主要内容区域。
- 可关闭按钮、accept/reject 按钮与 overlay container 存在结构关系。
- OCR/AX 只能作为辅助证据，不能单独决定 overlay 存在。
- 正文中的 cookie/privacy 文本必须被排除。

P2 入口条件：

- 明确定义 “overlay” 的结构合同。
- 有 false-positive fixtures。
- 有 cookie banner、marketing modal、newsletter popup、正文 cookie 文本等对照集。

## P2-05 Page Interruption Dismissal Primitive

状态：P2 pending。

问题：

即使能检测 overlay，也不等于可以自动关闭。dismissal 是网页动作，必须经过 observe -> recognize -> promote -> action，而不能由 detector 直接点击。

P2 候选范围：

- `chrome.dismissPageInterruption` 是否存在需要重新审查。
- detector 只输出 candidate nodes / signals。
- dismiss command 必须消费 promoted candidate。
- hard-stop 和 dismissible interruption 必须分开。
- captcha / real-person / human-check 只能 hard-stop，不允许自动处理。

P2 入口条件：

- P2-04 structural detector 已确认。
- dismissal 的候选按钮有 provenance 和 liveness recheck。
- policy 明确哪些 interruption 可以由 workflow 决策关闭。

## P2-06 Full Trace Replay / Inspect Product

状态：P2 pending。

问题：

P1.5 只做 minimum static visual trace pack。完整 trace replay、inspect server、multi-run viewer 会明显扩大架构面。

P2 候选范围：

- interactive timeline。
- inspect server。
- multi-run viewer。
- screenshot/video replay。
- span/event/artifact cross-link。
- side-by-side before/after comparison。
- failure clustering。
- model-friendly export package。

P2 入口条件：

- P1.5 visual trace pack 已能稳定生成。
- trace schema 和 artifact refs 已足够稳定。
- 已确认是否对齐 AUV inspect server 或只做 CDS-specific viewer。

## P2-07 AUV Run Store Parity

状态：P2 pending。

问题：

P1.5 复用现有 `TraceStore`，不移植 AUV run store。完整 run store 会影响 trace 目录结构、artifact identity、inspect 工具和历史记录管理。

P2 候选范围：

- canonical run directory。
- run metadata index。
- artifact registry。
- cross-run search。
- inspect tool integration。
- retention / cleanup policy。

P2 入口条件：

- 现有 `TraceStore` 的不足已通过 QA 数据证明。
- P1.5 artifact contract 没有再频繁变化。
- 明确 public/private 数据边界。

## P2-08 Human Disturbance and Browser Lease Robustness

状态：P2 pending。

问题：

当前 driver 可以检查 foreground/window lease，但对人类抢鼠标、切窗口、键盘输入干扰、Chrome profile/session 漂移的抵抗力仍不足。

P2 候选范围：

- stronger browser session lease。
- action 前后 foreground/app/window/profile revalidation。
- pointer ownership / mouse movement disturbance detection。
- user interruption signal。
- lease invalidation and safe stop。
- recovery policy。

P2 入口条件：

- P1.5 invoke result 能稳定表达 refusal 和 known limits。
- 已有 live QA 记录具体人类扰动失败样例。

## P2-09 Cross-Source Visibility and Actionability Audit

状态：P2 pending。

问题：

当前 promotion 仍有风险：OCR 可见、DOM/AX 不可操作、cross-source audit unknown 时可能 promoted。需要重新定义 “可见性用 OCR，准确性/可操作性用 AX/DOM 校准” 的策略。

P2 候选范围：

- OCR visibility contract。
- DOM/AX actionability contract。
- cross-source disagreement classification。
- `unknown` audit status 的 promotion policy。
- browser chrome noise filtering。
- candidate confidence and refusal thresholds。

P2 入口条件：

- P1.5 primitive trace 能稳定记录 OCR/AX/DOM source evidence。
- 有足够 promoted / refused / mis-promoted 样例。

## P2-10 Advanced Scroll Scan and Boundary Evidence

状态：P2 pending。

问题：

P1.5 的 `chrome.scroll` 只返回 visible-change 层面的结果，不声明完整页面边界或内容收集完整性。

P2 候选范围：

- multi-step scroll scan controller。
- repeated no-visible-change boundary evidence。
- OCR/DOM/AX new-evidence detection。
- viewport overlap accounting。
- section completeness signal。
- source collection completeness signal。

P2 入口条件：

- P1.5 scroll primitive 结果稳定。
- `docs/computer-use-p2-scroll-boundary-evidence.md` 的边界证据要求重新审查。
- live QA 覆盖 Google results、article page、long listing page。

## P2-11 Public Invoke Surface Expansion

状态：P2 pending。

问题：

P1.5 先做 programmatic invoke API。dev CLI、registered agent tool、MCP/server、public command catalog 都会改变权限面和使用方式。

P2 候选范围：

- dev CLI。
- registered agent tool。
- MCP/server entry。
- public command catalog。
- dry-run UX。
- command discovery UX。
- policy-level allowlist。

P2 入口条件：

- P1.5 programmatic API 已通过 primitive QA。
- browser-use policy 已明确允许 agent 直接走 invoke。
- public/private data boundary 已重新确认。

## P2-12 Domain Workflow Composite Commands

状态：P2 pending。

问题：

CareerDeepSeek 的公司研究、职位判断、source ranking、evidence depth 不能混入 primitive invoke 层。否则 QA 又会退回 “一次完整任务失败但无法定位 primitive 问题” 的状态。

P2 候选范围：

- company research composite workflow。
- source-value judgment。
- target rubric integration。
- job-source collection。
- evidence depth policy。
- workflow-level stop criteria。

P2 入口条件：

- primitive invoke loop 已可单独 QA。
- research workflow 与 driver primitive 的边界重新确认。
- 不使用 civil service / `gov.uk` 作为职业目标候选。

## P2-13 Hard-Stop Policy Expansion

状态：P2 pending。

问题：

P1.5 可以补充 hard-stop signal 暴露，但不建立完整 hard-stop policy engine。captcha、人类验证、real-person check、登录墙、付费墙、地区限制等状态需要统一分类。

P1.5 只暴露 hard-stop / safety signals。现有文本/信号匹配可能有 false positives；这属于 known limit，不授权现在设计结构化 overlay detector。

P2 候选范围：

- hard-stop taxonomy。
- human-check / captcha / real-person detection fixtures。
- workflow-level stop behavior。
- evidence reporting。
- no-auto-dismiss policy。

P2 入口条件：

- P1.5 `chrome.checkSafetyGate` 能稳定暴露 hard-stop signal。
- hard-stop 和 dismissible overlay 的边界已在 P2-04/P2-05 中厘清。

## P2 Entry Gate

进入任何 P2 item 前，需要先检查：

- P1.5 是否已经完成 review gate。
- 是否新增接口、分层、runtime path、artifact payload field、tool entry 或 public export。
- 是否需要更新 scope-freeze、P1 evidence/action scope、browser-use policy、testing/QA 文档。
- 是否存在会污染 research workflow 的固定 QA 流程。
- 是否有足够 fixture/live trace 证明问题真实存在。

未经 owner 重新确认，P2 pending item 只能作为设计输入，不能作为实现授权。
