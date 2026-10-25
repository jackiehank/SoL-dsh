# 落地：灰色闪电 + 输入框下方可点开的“本会话节省”面板

## 问题

`status-surfaces-design` 已定稿，用户确认两处调整：

1. 每轮尾行**不加悬停提示**，保持现在的文字（四类计数）；
2. 输入框下方的面板里 **0 项也要显示**，不要隐藏零行。

现在按定稿落地。

## 方案

### 尾行（`conversation.chat.turnTail`）

- 灰色线性闪电（内联 SVG，`currentColor`）+ `本轮：融合 N · 收纳 N · 回执 N · 压缩 N`；
- 不加 `title`、不加 token 数、不可点击；
- 四类计数全零时不渲染（调试开关打开时显示“已加载”提示）。

### 输入框下方（`conversation.composer.dock`）

- **始终渲染**（本会话 0 命中也显示），文案 `已省 X tok · Y%`；
- 点击向上弹出面板，点外部 / Esc / 再次点击关闭；
- 面板行：收纳、回执、压缩、融合（次数）、工具输出少写（百分比），**零项显示 0**；
- 脚注说明估算口径。

### 数字口径

- 收纳：占位符 `estimated_tokens` - 占位符自身 token（4 字符/token）；
- 回执：回执头 `source_bytes` - 回执自身长度；
- 压缩：compaction 节点的 `shadowedTokenCount`（manual-compaction 取 `data.compaction`）；
- 融合：`[then_run:succeeded]` 次数，不折算 token；
- 百分比：`(收纳+回执) / (收纳+回执+工具结果实际写入 token)`。

全部在客户端从 `useChat` 快照算出，不改 Host 半、不新增通道。

## 验收

1. 刷新页面后，输入框下方出现 `⚡ 已省 0 tok · 0%`；点击弹出面板，所有行显示 0；
2. 造一次收纳（>10 KiB 的 pwsh 输出）后，数字随之变化；
3. 尾行仍是四计数、灰色闪电、无悬停提示；
4. `node --test tests` 全绿、`node --check plugin/client.js` 通过；
5. 版本递增到 `0.4.0`。
