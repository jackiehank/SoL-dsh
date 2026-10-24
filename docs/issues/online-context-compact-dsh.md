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
