# turnTail 计数仍为 0：工具节点在 data.root 里，不是 tool-result 节点

## 问题

修掉 `kind`/`type` 之后仍显示“本轮无机制命中”。对照 Chat 快照的类型定义发现第二处形状误判：

- Chat 渲染节点（`ChatNodeKind`）里**没有** `tool-result` 这种节点；工具调用是一个
  `kind: 'tool-call'` 的节点，真正的生命周期在 `node.data.root` 上（`ToolCallBlock` 联合：
  运行中是 `RunningToolCall`，落定后才是 `kind: 'tool-result'` 的 `ToolResultNode`），
  嵌套调用在 `ToolResultNode.subCalls` 里。
- 压缩是 `kind: 'compaction'`（人工压缩是 `'manual-compaction'`）。

原来我们写的是“节点自身 `kind === 'tool-result'`”，这个分支永远不会命中，于是四类计数全为 0。

## 验收

1. `countsOf` 从 `node.data.root` 往下走，只对 `kind === 'tool-result'` 的块取文本，并递归 `subCalls`；
2. 压缩节点同时识别 `compaction` 与 `manual-compaction`；
3. 调试开关打开时，每次渲染把这一轮的节点形状打到控制台：
   `[sol-dsh] turn N keys M kinds tool-call,tool-call,…`，便于下次一眼定位；
4. 刷新后，制造过事件的轮次应显示 `⚡ 本轮：融合 1 · 收纳 1 · 回执 0 · 压缩 0`。
