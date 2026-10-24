# Online Context Compact：计划步骤完成点触发原生压缩

## 问题

上游 SoL-Pi 的 Online Context Compact 复用 Pi 的计划工具：当某一步从“未完成”变成 `completed`
（且该步在上一次快照里已存在）时记一个**完成边界**；在 turn 结束时（该 tool result 非错误、assistant
未中止）做一次经济性判断——用 `cacheWriteReadRatio` 折出压缩后的缓存债、breakeven 与按剩余步骤数估算的
请求视界比较，并叠加窗口压力（接近窗口上限时跳过经济性）；满足才调用 Pi 原生 compaction。成功后在新
turn 里自动续跑；原生拒绝（太小/已压缩/摘要被截断）记录 skip 并暂时禁止“只靠计划”的再次重试；取消或
退出不续跑。

## DSH 抓手（已核对）

- `ctx.compaction`：`compactIfNeeded(agent, trigger, signal)` 只按阈值判断（低于阈值返回 null）；
  `compactNow(agent, signal)` 可强制但要求 idle；`compactRegion(start, end, agent, signal)` 可指定区间，
  要求 turn 开启且 surface 稳定——可以在 `agent/pre-step` 里调用，**同一 turn 的下一 step 自然用压缩后的
  surface 继续**，比注入“继续工作”的消息更干净。
- `ctx.tokenMeter.measure(session, header?)` 给 `totalTokens`、`surfaceTokens` 与按节点的 `nodes[]`，
  正好用于“可移除前缀值多少”的定价；`estimateMessage` 用于粗估。
- 计划来源：**复用内建 `todo_write`**（`todo/write` 事件 + `tools/post-execute` 观察），不另造
  `update_plan`——两个计划工具会污染工具前缀并抢 UI 的 todos 投影。DSH 的 todo 没有 id，用
  `content` 作稳定键；content 被改写视为新步骤（只会少压，不会错压）。
- 冷却/状态：`ctx.sessionProjections` 折叠 `request/header` 计数、`todo/write` 边界、`compaction/*` 的
  debt 与冷却；不写会话日志（未知事件类型无法 reopen），只在内存里留 pendingBoundary/selected。
- 续跑（仅在走 `compactNow` 时）：`agent.followup({content, source:{kind,form:'notice'}})` 唤醒下一 turn；
  `inject` 不唤醒，别用错。

## 约束

- 没有 `ctx.compaction` 或 `ctx.tokenMeter` 的 profile 里插件保持不激活，不抛错；
- 压缩进行中（`compaction/start` 未闭合）不抢；`changed-span` 失败一律 fail-open 并记原因；
- 经济性输入在 DSH 与 Pi 不同（DSH 的 totalTokens 按 route 计价），参数必须保守且可配；
- 压缩后不吞掉用户已排队的新 prompt；取消/退出不自动续跑；
- 卸载时 abort 在飞的压缩，避免留下未闭合的 compaction bracket。

## 验收

1. 关闭时无监听、无状态、无压缩调用；
2. 单次边界：压缩在同一 turn 的下一步生效，计划与进度保留；
3. 经济性分支全覆盖（first/subsequent/margin/debt/cooldown/window override/non-positive saving）；
4. busy、too-small、`changed-span` 失败：不压缩、不续跑，冷却生效；
5. 用户取消不续跑；resume 后冷却与债务从 session projection 重建；
6. 缺 compaction/tokenMeter/sessionProjections 的 profile 里不激活。

## 上游事实与 DSH 对照

- Pi 的边界：只有“上一次快照里同 id 且未完成 → 本次 completed”才算完成边界；新引入的 completed 只算历史。
- Pi 的经济性：saving=archive−memo；breakeven=newDebt/saving；horizon=1+floor(下界×剩余步数×scale)；
  首次压缩视界 ×2；非首次还要过 ×1.5 margin；`saving≤0` 恒不压；窗口压力可越过经济性与冷却。
- Pi 的续跑：压缩成功后注入一条 hidden 消息并 `triggerTurn`，在新 turn 继续。
- DSH 的压缩入口：`ctx.compaction.compactRegion(start, end, agent, signal)`，要求 turn 打开且
  whole-surface 稳定（可在 `agent/pre-step` 调用）；成功后**同一 turn 的下一 step 自然继续**，
  不需要注入消息。`compactIfNeeded` 只按阈值、`compactNow` 要求 idle，都不适合边界驱动。
- DSH 的计价：`ctx.tokenMeter.measure(session)` 给 `nodes[{seq,tokens}]`，区间选择与收益定价都用它；
  节点 0 是 system/message，永不入区间。
- DSH 的计划：复用内建 `todo_write`（观察参数，不另造工具）；todo 没有 id，以 `content` 作稳定键，
  content 被改写按新步骤处理（只会少压，不会错压）。

## 测试与结果

`tests/compact.test.mjs`（5 项，全绿）：

- 计划跟踪：旧步骤 in_progress → completed 才产生边界；新引入 completed 不算；边界只消费一次；
- 经济性：净收益非正、冷却、视界不够、非首次 margin、窗口压力越过冷却，五个分支各自命中；
- 区间选择：节点 0（system）永不入区间、尾部按 `compactKeepRecentTokens` 保留、不足三个节点返回 undefined；
- 装配（假 compaction/tokenMeter）：完成边界后的 pre-step 调一次 `compactRegion(1, 2, agent, signal)`，
  同一 turn 返回 `{kind:'enter'}`；没有新边界时不再调用；`compaction`/`tokenMeter` 缺失时不激活；
  `compactRegion` 抛错时 fail-open（返回 `{kind:'enter'}`）并记 `fallback` 账本。

## 落地

- `plugin/lib/compact.js`：`createPlanTracker`（content 作键的完成边界）、`decideCompaction`（保守经济性）、
  `selectRange`（system 不入区间、按 `compactKeepRecentTokens` 留尾）、`attachOnlineContextCompact`
  （观察 `todo_write`、数 `agent/request`、在 `agent/pre-step` 压缩一次）。
- 配置：`onlineContextCompact`、`compactKeepRecentTokens`(20000)、`compactMinRequestsSinceLast`(2)、
  `compactFirstScale`(2)、`compactMargin`(1.5)、`compactSummaryTokens`(1000)，全部参与严格校验。
- 守卫：缺 `compaction`/`tokenMeter` 时只警告、不激活；区间选不出、经济性不成立、冷却中都不调用；
  `compactRegion` 抛错、tokenMeter 异常一律 fail-open（照常 `next()`），原因写
  `evidence-preserving-reducer/ledger.jsonl`（`scope=online-context-compact`）。
- 已知边界：状态是进程内内存，会话 resume 后冷却/计数从头开始；`pressure` 参数暂未接
  `session.requestContext().contextWindow`，窗口压力分支保留给后续迭代。

## 已验证 / 未验证

- 已验证：决策核心、装配路径、fail-open、无依赖时不激活（单测）。
- 未验证：真实会话里的 `compactRegion` 调用（需要真实 turn、整 surface 稳定与一次摘要模型调用）；
  端到端只能在打开开关后由使用中的会话观察，失败会按 fail-open 记录。

## D2 真机结果（未触发）

按方案在开启 `onlineContextCompact`（`compactKeepRecentTokens=1500`、`compactSummaryTokens=300`、
冷却 0）后跑了一个 14 step 的会话：3 次 `todo/write`（含一次把 in_progress 改为 completed 的完成边界）、
13 次工具调用、1 个 turn，正确性（8 个 SHA256）全对。

但**没有产生任何 `compaction/*` 事件**，账本里也没有 `online-context-compact` 记录——
连 attach 时写的 `attached` 都没有。结论：`attachOnlineContextCompact` 在服务检查处提前返回，
即本 profile 里 `ctx.get('compaction')` 或 `ctx.get('tokenMeter')` 不可用（与调研时看到的
“`include:compaction-basic` 条目 inactive”一致）。插件按设计只警告、不激活，未影响会话。

同时修掉一个真实缺陷：`agent/request` / `agent/pre-step` 监听器之前没带 `{ global: true }`，
跨 scope 收不到事件；已改为 global，并在 attach 成功后写一条 `attached` 账本便于诊断。
