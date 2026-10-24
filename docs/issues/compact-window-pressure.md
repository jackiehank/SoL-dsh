# 窗口压力分支：DSH 是否已经自带“快满就压”

## 问题

`plugin/lib/compact.js` 的经济性判断里保留了 `pressure` 分支（压力时可以越过冷却与请求视界），
但装配处把 `pressure` 写死为 `false`（`compact.js:194`），从未接 `contextWindow`。上游 Pi 在接近窗口
上限时会跳过经济性直接压缩，我们的移植缺了这一段。

补之前先要回答：

1. DSH 自身（`dsh-compaction` / `dsh-compaction-basic` / `dsh-compaction-tool-result-pruner` /
   `/compact` 命令）是否已经有“窗口快满自动压缩”的机制？
2. 如果有：由什么触发、阈值多少、压缩粒度是 whole-surface 还是定区间、运行在 turn 的哪个位置？
3. 如果已有：我们的压力分支是**重复触发**（与原生竞争、可能对同一区间压两次）还是**补位**
   （原生只在特定时机跑，我们能补上 `confirm` 之前的缺口）？

## 约束

- 只读调查：不改 DSH 源码、只用已安装包里能读到的实现；
- 结论必须落回我们自己的决策入口（`agent/pre-step` + `ctx.compaction.compactRegion`），
  不能假设我们能改 DSH 的触发条件；
- 不因为“代码里有分支”就打开它：原生已覆盖时应保持关闭，并把理由写进文档。

## 验收

1. 列出 DSH 侧所有会产生压缩的入口（服务方法 / 事件 / 命令），各自触发条件、阈值、粒度；
2. 说明如果接 `pressure`，该读哪个信号（`session.requestContext()` 的窗口大小？tokenMeter 的
   `totalTokens` 占窗口比例？），以及现有的 fail-open 与冷却如何与之共存；
3. 结论三选一并给出依据：不接（原生已覆盖）/ 接但默认关 / 接且默认开；若接，写明与原生如何避免重复压缩。

## collect：DSH 自带的压缩入口（读实现，不是猜）

`dsh-base` 的 composition 里就已经挂了三个相关插件（`dsh-base/cordis.patch.yml:317-326, 394-399`）：

```yaml
- id: token-meter          name: '@deepseek-ai/dsh-token-meter'
- id: compaction-basic     name: '@deepseek-ai/dsh-compaction-basic'   # 无 config → 全默认
- id: command-compact      name: '@deepseek-ai/dsh-command-compact'
- id: tool-result-pruner   name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
  config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 }
```

`compaction-basic` 无 config，默认值在代码里（`dsh-compaction-basic/lib/index.js:58-78`）：
`auto: true`、`thresholdRatio: 0.8`、`retainRatio: 0.16`、`maxTokens: 8192`、`compactionRetries: 1`、
`maxOverflowRetries: 1`。

### 三个触发入口

| 入口 | 位置 | 触发条件 | 粒度 |
| --- | --- | --- | --- |
| 窗口压力（自动） | `agent/pre-step` 监听器 (`index.js:798-811`) | `tokenMeter.measure(session).totalTokens >= floor(contextWindow × 0.8)` | 先 `toolResultPruner.pruneSession()`，修完仍超阈值才摘要；保留 `0.16 × window` 尾部 |
| 溢出恢复（自动） | `agent/request-error` (`index.js:820-846`) | provider 回 `CONTEXT_WINDOW_EXCEEDED` | 忽略阈值与保留策略，做一次最大 balanced 头部归约；surface `replaceGeneration` 前进后返回 `{kind:'retry'}` 重发请求，最多 1 次 |
| 人工 | `dsh-command-compact` → `compactNow()` | 用户输入 `/compact` | 立即压，低于阈值也压 |

### 共同细节

- **容量来源**：`ctx.llm.resolveModelInfo(target.provider, target.model).context.contextWindow`
  （`index.js:895-900`），路由来自 `session.requestHeader().config`（`index.js:714-721`）。
  adapter 不报容量就抛 `TargetPressureConfigError`，**同一个 target 只警告一次**，然后拿全量历史继续。
- **区间选择**：`selectCompactableRange`（`index.js:393-416`）——起点是第一个非 `system/message` 节点，
  尾部按 retain 预算留够，切点必须落在 tool-call/result 配平的边界，绝不把一次工具调用劈成两半。
- **事务与锁**：`compaction/start` → 摘要 → 替换 → `compaction/end`；`assertCompactionInactive`
  拒绝并发压缩（`index.js:433-437`）。
- **失败即放行**：压力路径任何异常只 `logger.warn('step compaction failed: …; continuing the turn')`
  （`index.js:806-809`），不打断 turn；摘要被截断/失败也保留最近一次持久 surface。
- **摘要复用 warm prefix**：摘要调用把 system prompt、tools、被压区间的消息逐字节重放，只有末尾指令和
  输出未命中缓存（README「Summarization mechanics」）。

## collect：当前 profile 的实测

`cordis_inspect_query(host, Service, listService)` 的服务目录里同时存在
`compaction`、`tokenMeter`、`toolResultPruner` 三个服务：

- `compaction.compactIfNeeded / compactNow / compactRegion` 全部可用；
- 结论：`online-context-compact-dsh` 里 D2 记录的“本 profile 没有 compaction 服务、插件 attach 前返回”
  **只对当时那次运行成立**。现在三个机制缺的不是服务，而是（a）我们默认关，（b）我们没把 `pressure` 接上。

## collect：如果接压力分支，读什么信号、会和谁撞

- **信号**：只能抄 DSH 的做法——`session.requestHeader().config` 取路由，再
  `ctx.llm.resolveModelInfo(...)` 拿 `context.contextWindow`，用 `tokenMeter.measure(...).totalTokens`
  与之相比。**`session.requestContext()` 这个方法在 DSH 里不存在**（全 profile `.d.ts` 无此符号），
  旧 issue 里“pressure 暂未接 `session.requestContext().contextWindow`”的表述是错的，本次更正。
- **重复触发风险**：我们和 `compaction-basic` 的监听器都在 `agent/pre-step`。DSH 的在 base 层先注册
  （`dsh-base` 在 bundle 列表里早于本插件），同一步里大概率先跑它的压力判断；再跑我们的。
  若两边同一步都触发：
  1. 同一步付两次摘要调用；
  2. 第二次的 `selectRange` 只跳过 node 0（system），**不认识 `<compacted-summary>` checkpoint**，
     会把刚生成的 checkpoint 再压一遍（摘要的摘要）；
  3. 我们的 `busy` 只防自己，没有 DSH 的 `assertCompactionInactive` 等价物。
- **它能补的位**：原生只在“超过 80% 窗口”或“已经溢出”时压；低于阈值时它什么都不做。
  我们的完成边界 + 经济性压缩是在**没有压力时**按计划进度做小步压缩，这条是互补的。

## 结论：不接压力分支，保持 `pressure: false`

依据（按重要性排序）：

1. **原生已覆盖且更完整**：`compaction-basic` 默认 `auto: true`，在 `agent/pre-step` 按
   `0.8 × contextWindow` 触发，先修剪再摘要；`agent/request-error` 还会对 `CONTEXT_WINDOW_EXCEEDED`
   做一次强制归约并重发请求。我们在同一事件上加第二条压力路径，只会让同一问题被处理两次。
2. **接上就有真实的双压缩风险**：两边都挂 `agent/pre-step`，同一步都触发时付两次摘要调用；
   我们的 `selectRange` 不识别 `<compacted-summary>` checkpoint，会把刚生成的摘要再压一遍；
   我们也没有 DSH 的 `assertCompactionInactive` 等价互斥（`busy` 只防自己）。
3. **我们的边际价值在低压力区**：完成边界 + 经济性判断本来就在“没到 80%”时工作，与原生不重叠；
   压力场景交给原生，收益/风险比更差的分支不值得移植。
4. **可观测性不丢**：原生压缩在会话日志里留 `compaction/*` 事件，`/compact` 也照常可用；
   真要诊断窗口压力，看这些事件即可，不需要我们另记一份账。

因此：

- `compact.js` 的 `pressure` 分支**保留但休眠**（装配处继续传 `false`），作为换到没有
  `compaction-basic` 的 profile 时的备用路径，不删除（删了就丢掉了上游语义与测试覆盖）；
- 如果将来真的要启用，前置条件是三件事，缺一不可：
  1. 用 `ctx.llm.resolveModelInfo(provider, model, signal).context.contextWindow` +
     `session.requestHeader().config` 拿容量与路由（**不是** `session.requestContext()`，DSH 无此 API）；
  2. `selectRange` 要学会识别 compaction checkpoint（`isCompactCheckpointSource` / `<compacted-summary>`），
     不把摘要再摘要；
  3. 与原生互斥：检测 `compaction/start` 未闭合或刚完成时跳过，避免同一步压两次。

行为不变：本次只改文档，不动插件代码；四个机制仍全关，`pressure: false` 保持原样。

