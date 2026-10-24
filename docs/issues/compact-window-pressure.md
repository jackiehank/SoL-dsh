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
