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

## 调研结论（2026-10-25）

### DSH 自己怎么显示（可照抄的交互语言）

「Token 用量」就是 `conversation.composer.dock` 里的一个条目：`id: "usage"`、`order: 1`，
组件 `UsagePill({ useProjection, usePerformanceUsage, t })`。点击后走 `DialogPill`：

- 触发：`<button aria-haspopup="dialog" aria-expanded>`，`pill` 样式 12px、
  `--dsw-alias-label-tertiary`，hover 背景 `--dsw-alias-interactive-bg-hover` 且字变 secondary；
  图标 14px 线性，`currentColor`；
- 面板：portal 到 `document.body`，`role="dialog"`，`position: fixed`，
  按触发按钮 `side: "top", gap: 8` 定位并做视口 clamp，`z-index: 1100`；
  背景 `--dsw-specific-menu`、`radius-lg`、`padding 16px`、标题 primary/500、
  0.5px 分隔线 `--dsw-alias-label-*`、明细两列 grid（`minmax(76px,auto)`，右对齐、tabular-nums）；
- 关闭：外部 pointerdown/click、Esc、再次点击触发按钮。

所以“可点击 + 浮层”不需要新交互，照着 dock 里已有的 pill/dialog 做即可。

### 客户端能拿到的数据（都已在本 build 验证）

| 需要 | 来源 | 说明 |
| --- | --- | --- |
| 本会话计费 token | `useProjection("tokenUsage")` | `uncachedInputTokens / cacheReadTokens / cacheWriteTokens / outputTokens`；DSH 的 `UsagePill` 在**同一个 dock 座位**里用了它，`ActivityPill` 同座位同时用 `useChat`+`useProjection`，说明 dock 条目的 standard props 两者都有 |
| 全量 turn 列表 | `useChat((s) => s.timeline.turnOrder)` | 配合 `snapshot.locations.getTurn(turn)`、`snapshot.nodes` 遍历已加载的轮次 |
| 收纳省了多少 | 占位符文本 | 含 `original_bytes`、`original_lines`、`estimated_tokens`，占位符自身长度也可量 |
| 回执省了多少 | 回执头 | `receiptText` 里带 `source_bytes=`，回执自身长度可量 |
| 压缩移出多少 | compaction 节点 `data` | 含 `shadowedTokenCount`、`shadowedItemCount` |
| 融合省了几次 | `[then_run:succeeded]` | 只有次数，没有 token 数 |

`tokenUsage` 的面板口径（DSH 自己）：`billedInput = uncached + cacheRead + cacheWrite`，
总量 = `billedInput + outputTokens`。这条可以直接借用。

### 图标

没有可假设共享的图标组件；用内联 SVG（`fill="none" stroke="currentColor"`，14×14），
颜色继承 `--dsw-alias-label-tertiary`，hover 时可到 `--dsw-alias-label-secondary`。
灰色闪电就是“线性 + currentColor”，不再用 emoji。

## 已确认的方向

- 本轮只出设计，方案确认后再落地；
- 只有输入框下方那一行可点击；
- 口径用 token 数 + 百分比（相对“不省时会消耗的 token”）。

## 设计

### A. 每轮尾行（`conversation.chat.turnTail`）

- 座位与位置不变（order 5，动作行之前）；只展示，不可点。
- 图标：14px 灰色线性闪电（内联 SVG，`stroke="currentColor"`），颜色
  `--dsw-alias-label-tertiary`；文字同色，12px / 20px，和 composer 状态条同字号。
- 文案只列非零项：
  - 有 token 收益：`⚡ 少写 12.2k tok · 收纳 1 · 回执 1`
  - 只有融合：`⚡ 省 1 次往返`
  - 全零：不渲染；调试开关打开时显示 `⚡ sol-dsh 已加载（本轮无机制命中）`
- 鼠标悬停的 `title` 给完整四项计数 + 本轮 token + 一行口径说明。

### B. 输入框下方（`conversation.composer.dock`）

- 灰色闪电同款；按钮文案：`⚡ 已省 34.5k tok · 12.4%`（k/M 紧凑数，tabular-nums）。
- 只在“本会话至少命中一次”时渲染；没有命中就整条不渲染（默认安静，命中后自然出现）。
- 点击：向上弹出面板（`role="dialog"`，锚在按钮正上方 8px，视口 clamp），
  点外部 / Esc / 再次点击关闭——照抄 dock 里 DSH 自己的 pill/dialog 交互。
- 面板内容（对齐 DSH 的 stat dialog 视觉：`--dsw-specific-menu` 背景、radius-lg、
  padding 16、标题 primary/500、0.5px 分隔线、两列 grid、右对齐数字）：

  ```
  ⚡ sol-dsh 本会话                  34,567 tok
  ─────────────────────────────────────────────
  收纳                3 次 · 9,800 tok
  回执                1 次 · 1,200 tok
  压缩                1 次 · 23,567 tok
  融合                2 次往返
  工具输出少写        12.4%
  估算：4 字符 ≈ 1 token；只计首次写入，不含后续缓存读取。
  ```

  - 零项隐藏；压缩单独列，不计入“工具输出少写”的分母；
  - 面板不 portal（避免动 `document.body`），绝对定位在 dock 的按钮容器内；
    若被祖先裁剪，落地时再退回 portal。

### C. 数据与公式

1. 扫描范围：`useChat((s) => s.timeline.turnOrder)` 的每一轮 →
   `locations.getTurn(turn)` → `nodes`；只读，不改快照。
2. 收纳：`saved = estimated_tokens - ceil(占位符字符数 / 4)`；
   `estimated_tokens` 直接取占位符里的字段。
3. 回执：`saved = ceil((source_bytes - 回执字节数) / 4)`；`source_bytes` 从回执头解析。
4. 压缩：`saved = Σ compaction 节点的 shadowedTokenCount`（只累加非负整数）。
5. 融合：只计 `[then_run:succeeded]` 次数，不折算 token。
6. 本会话 token 总数 = 2 + 3 + 4；每轮/本会话都按同一套公式算。
7. 百分比（工具输出口径）：
   `(收纳 + 回执) / (收纳 + 回执 + 本会话工具结果实际写入 token)`；
   “实际写入”= 所有已落定工具结果文本的 `ceil(字符数 / 4)` 之和。
8. 例子：占位符原始 12,200 字节、`estimated_tokens` 3,050，占位符自身 1,300 字节 ≈ 325 tok，
   省 2,725 tok；回执 `source_bytes=8,400`、回执 3,100 字节，省 1,325 tok；
   压缩 `shadowedTokenCount=23,000`。合计 27,050 tok；工具输出实际写入 20,000 tok，
   “工具输出少写” = 4,050 / 24,050 ≈ 16.8%。

### D. 降级与边界

- 拿不到 `tokenUsage`：dock 隐藏百分比，只留 token 总数；
- 快照分页：累计只覆盖已加载窗口，不伪造“全量”；
- 估算性质：4 字符/token 只用于展示，不是计费口径，面板脚注写明；
- 只计首次写入：同一结果在后续请求里以缓存读取重发，那部分不算“省”；
- 出错：组件返回 null，不影响会话流。

### E. 落地计划（下一个 issue）

1. `plugin/client.js`：抽 `summarizeSession(snapshot)` 纯函数；TailRow 与 DockRow 共用
   `LightningIcon`；DockRow 用 `useProjection("tokenUsage")` + `useChat`；
   CSS 用 `styles.insert` 注入（对齐 DSH 的 pill/dialog 视觉）。
2. 客户端半无法在 Node 里单测（`window.__ModuleLoader__` + React 都是浏览器侧），
   沿用现有做法：`node --check` + 真机造数验证。
3. 约定：`plugin/package.json` 版本递增；安装后必须刷新页面才加载新 bundle。

### F. 验收（设计阶段）

- 两个面的形态、文案、交互、数据口径都写清楚，可直接照此落地；
- 不新增 Host→Client 通道；
- 本轮不改任何代码、不装插件。

## 结论

1. **两个面分工明确**：尾行回答“这一轮省了什么”，dock 回答“这个会话一共省了多少”；
   尾行只读，dock 可点开明细。
2. **不需要新通道**：`useProjection("tokenUsage")`、`useChat` 快照、占位符里的
   `estimated_tokens`、回执头的 `source_bytes`、compaction 节点的 `shadowedTokenCount`
   已经覆盖全部数字；DSH 自己的 `UsagePill` 就注册在同一个 dock 座位。
3. **灰色闪电用内联 SVG + `currentColor`**，与 DSH 的线性图标同风格；
   emoji 的黄色是字体渲染，CSS 改不掉。
4. **百分比用“工具输出少写”口径**（收纳+回执 ÷ 工具输出总量），压缩单独列；
   这样百分比不会被会话累计的缓存读取稀释。
5. **本轮只出设计**；落地改动见「落地计划」，另开 issue 执行。
