# 节省统计要覆盖整条会话历史，而不是当前面板扫到的窗口

## 问题

输入框下方的“本会话已省”现在由客户端扫描 `useChat` 快照里的已加载轮次得出。这有两个后果：

1. 会话快照是分页的，窗口外的旧轮次不在统计里；
2. 机制关掉之后，新会话的窗口里没有历史命中，面板就回到 0——用户看到的不是“累计”，而是“当前窗口”。

用户要求：**同一会话里之前开过选项、后来关掉，之前省下的数量不能因此变 0**。

## 方案

把统计改成 Host 侧投影（projection），不再由客户端扫快照：

- DSH 自带 `ctx.sessionProjections` 服务：注册一个纯 fold，按 `session/event` 流把整条会话日志
  （含分页/压缩之前的旧事件）折成一份状态；服务负责变更通知与下发；
- 注册 key 为 `solDshStats`，wire 出 `{ fusion, pack, receipt, compact, packTokens, receiptTokens,
  compactTokens, toolTokens }`；
- fold 规则与客户端现有口径一致：
  - `tool/result`：结果文本含 `[then_run:succeeded]` → `fusion + 1`；
    含占位符首行 → `pack + 1`，`packTokens += estimated_tokens - 占位符自身`；
    含回执头 → `receipt + 1`，`receiptTokens += source_bytes - 回执自身`；
    每条工具结果都累加 `toolTokens`（百分比分母）；
  - `compaction/summary`：`compact + 1`，`compactTokens += shadowedTokenCount`；
- 客户端 dock 改为 `useProjection("solDshStats")`；投影尚不可用时退回现有的快照扫描（老版本兼容）；
- 尾行保持现状（本来就只看当前轮）。

这样统计来自会话日志本身：分页、重启、机制开关都不影响历史累计。

## 验收

1. 打开一个之前有命中的会话（机制现在关着），面板显示当时累计的数字，不再回 0；
2. 机制开着时新命中会让数字继续增长；
3. 投影不可用（老版本 DSH）时退回客户端扫描，界面不报错；
4. 现有 55 项测试 + 新增投影 fold 测试全绿；`node --check plugin/client.js` 通过。
