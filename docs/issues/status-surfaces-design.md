# 状态面设计：每轮尾行 + 输入框下方

## 问题

`@local/sol-dsh` 现在有两个状态显示面，交互和口径都还没定：

1. **每轮对话后的一行**（`conversation.chat.turnTail`）：
   `⚡ 本轮：融合 1 · 收纳 1 · 回执 0 · 压缩 0`；四个计数全零时不渲染（调试开关打开时例外）。
2. **输入框下方的一行**（`conversation.composer.dock`）：
   目前只是调试探针 `⚡ sol-dsh 客户端已加载（debug）`，只在
   `localStorage['sol-dsh:debug'] === '1'` 时出现。

用户提出两个方向：

- 闪电图标从当前的黄色 emoji 改为**灰色**，与 DSH 原本的界面风格一致
  （参考图 1：输入框下方状态栏的灰色文字与图标）。
- 输入框下方的显示改为**可点击**；点击后展示**本会话累计节省的 token**
  （或百分比），形式参考 DSH 自己的「Token 用量」浮层
  （图 2：总量 + 缓存命中率 + 未缓存输入 / 缓存读取 / 输出）。

## 已知事实

- turnTail 的计数来自会话快照里机制自己写下的字面量
  （`[then_run:succeeded]`、占位符首行、回执头、`compaction` 节点），不花模型 token。
- ObservationPack 的占位符文本里带 `original_bytes`、`original_lines`、`estimated_tokens`
  （`plugin/lib/observation-pack.js`），客户端可以从快照里解析出“这条结果原本多大”。
- Reducer 回执替换前后的字节数在宿主侧有，但当前没有进入客户端可见的结果文本。
- 客户端可用的 Services 是 `layout / locale / sessions / slots / theme / timer / uiWorkspace / workspaces`，
  **没有**现成的 popover / tooltip / 浮层服务，也没有共享图标组件表。
- `conversation.composer.dock` 是 list 座位，条目按 `order` 排列，用于 composer 卡片下方的环境信息。
- 宿主侧存在 `tokenMeter` 服务（`measure(session)`、`estimateMessage(message)`），但它是 Host Service，
  客户端读不到。
- 客户端 `host.call(...)` 是否存在、静态 bundle 能否用，**尚未验证**。

## 需要先定下来的问题

1. 灰色闪电的落点：只改 turnTail 行，还是 dock 行统一？用内联 SVG（`currentColor`）
   还是 Unicode 文本字符？
2. 可点击的是哪一处：只 dock，还是 turnTail 也可点？浮层的锚点、宽度、关闭方式
   （点外部 / Esc / 再次点击）？
3. 数字口径：
   - token 用 `estimated_tokens`（4 字符/token 的估算）还是按字节折算？
   - 百分比的分母是什么：本会话已用 token？当前上下文窗口？如果不省则会用掉的 token？
   - 融合省下的一次往返怎么计（不计 / 固定折算）？
4. 会话累计数据的来源：客户端扫描全部 turn（无需新通道，但要有全量快照），
   还是宿主侧计数 + 下发（需要验证通道）？
5. 空状态：本会话没有任何机制命中时，dock 是否仍显示（如 `⚡ 本会话暂未命中`）？
6. 本轮范围：只出设计（conclude），还是设计 + 落地（apply）？

## 验收（设计阶段）

- 给出两个状态面的最终形态：文案、图标、位置、交互、数据口径；
- 给出降级路径（拿不到数据时显示什么、出错时是否隐藏）；
- 不改任何代码，不装插件。
