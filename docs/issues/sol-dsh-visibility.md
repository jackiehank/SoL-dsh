# 可见性：上游在 Pi 的 TUI 里怎么显示，我们在 DSH 里该怎么显示

## 问题

四个机制现在只有“账本”和一份 `sol_dsh_status` 工具，用户在日常使用里看不到任何反馈：不知道
ObservationPack 替换了哪条结果、Reducer 是否回退、Compact 何时压过、Action Fusion 的 `then_run` 有没有跑。

上游 SoL-Pi 是给 Pi 的 TUI 做的扩展，它有一套自己的呈现方式。要回答：

1. **上游怎么显示**：在 Pi 的 TUI 里，sol-pi 把状态放在哪（footer / 状态行 / 通知 / 工具结果末尾），
   每个机制有没有可见反馈，用户与其交互的入口是什么；
2. **DSH 的等价面是什么**：DSH 没有 TUI，是 Web GUI + 会话流；我们能用的展示面有哪几种
   （工具结果的 `output.render`、client 插件 slot、slash command 输出、会话事件、日志、tokenMeter 面板），
   各自能拿到什么数据、有什么限制；
3. **该显示什么**：哪些信息对用户有意义（“这次省了什么”）、哪些只对排障有意义（账本细节）、
   哪些绝不该显示（归档原文、日志正文、密钥）。

## 约束

- 不改 DSH 源码，只用公开的插件 / slot / 工具渲染 / 命令接口；
- **展示不能增加模型上下文**：任何状态行、徽标、面板都不该进入 prompt 或每步请求；
- 不泄露内容：只显示计数、字节数、句柄 id、原因码，不显示被归档的正文；
- 默认安静：默认不显示任何东西，需显式开启，避免污染正常会话；
- 失败开放：展示层出错不影响工具执行与会话。

## 验收

1. 一份上游 TUI 展示点清单（文件 / 行为 / 时机），能说明“用户在 Pi 里实际看到什么”；
2. 一份 DSH 展示面清单：每个面能读到的数据、渲染能力、是否需要 client 插件、是否随会话持久化；
3. 一张映射表：**信息 × 展示面 × 默认开闭 × 实现代价**，并给出推荐方案（最少改动、最大可观测性）；
4. 明确“不做”的部分与理由（例如：不做常驻状态栏 / 不做每步通知），避免为了展示而展示。

## collect：上游在 Pi 的 TUI 里显示什么

全部呈现逻辑集中在一个文件 `src/sol-pi/tui.ts`（约 90 行），只有两个出口：

```ts
const STATUS_KEY = "sol-pi-savings"; const STATUS_DURATION_MS = 4_000;

showSolPiSavings(ctx, mechanism, saving)   // mode !== 'tui' 直接返回
  → ctx.ui.notify(`⚡ SoL-Pi · ${mechanism}\nMoney saved · ${saving}`, "info")
  → ctx.ui.setStatus(STATUS_KEY, `⚡ ${mechanism} · ${saving}`)
  → 4 秒后自动清掉状态行（timer 只留最后一个）

renderSolPiTool(theme, mechanism, saving, base?)   // 返回一个 TUI Component
  → 标题行：⚡（warning 色）+ `SoL-Pi · ${mechanism}`（accent 粗体）
  → 副行：`Money saved · ${saving}`（success 色）
  → 末尾拼回原生 `base` 组件
```

格式化函数：`formatSavingsCount(n, "context tokens avoided")` → `1,234 context tokens avoided`；
`formatSavingsBytes(n)` → `12.3 KiB / 1.2 MiB removed from future prompts`（三档：B / KiB / MiB）。

各机制的调用点：

| 机制 | 工具卡 | 瞬时提示（4s 状态行 + toast） |
| --- | --- | --- |
| Action Fusion | 包住原生 edit/write 渲染：`renderSolPiTool(theme, "Action Fusion", "1 model round-trip avoided", base)`，且 `then_run` 存在、`isError` 为假才显示 | `showSolPiSavings("Action Fusion", "1 model round-trip avoided")`，仅 `status === "succeeded"` 且非嵌套调用（`toolCallId` 不是 `<id>/<n>`） |
| ObservationPack | `obs_recall` 声明 `renderShell: "self"` 并自绘：`renderSolPiTool(theme, "Observation Pack", "full observation replay avoided", base)` | 第一次把结果换成占位符时：`N context tokens avoided` |
| Evidence-Preserving Reducer | 无自定义卡（回执正文进结果；`details` 带 `sourceBytes/receiptBytes/evidenceCount`） | `applied` 时：`"Luna Delegating"` + `X KiB removed from future prompts` |
| Online Context Compact | 无自定义 UI，复用 Pi 原生 compaction 的会话显示 | 无 |

要点：**提示是瞬时的、不落的**；卡片是“原生卡片 + 两行横幅”，不是替换；节省量是**当时那一次**的
数字，不是累计值。没有面板、没有设置页、没有常驻状态栏。另外 `context.mode !== "tui"` 时全部静默
（`pi -p` 之类的非交互模式不显示）。

## collect：DSH 里对应的显示面

DSH 没有 TUI，主界面是 Web GUI。可用的“显示面”分两类：

### A. 工具定义自带的表现层（Host 侧，不需要 client 插件）

| 通道 | API | 是否进模型上下文 | 说明 |
| --- | --- | --- | --- |
| `output.render(args, value)` | 工具定义 | **是**（“Pure Native/model rendering”，模型看到的就是它） | 不能用来加横幅——每步都付费 |
| `presentCall(args)` | `ToolCallView`：`generic` / `terminal` / `diff` | **否**（display-only 渲染意图） | 只有工具定义的所有者能声明 |
| `presentResult(args, result)` | `ToolResultView`：`generic` / `terminal` / `diff` / `search` / `read` / `web` | **否** | 可改标题、可重排内容；不影响的模型看到的东西 |
| `output.presentationMeta(args, value)` | JSON，随会话日志持久化 | 否 | 供 `presentResult` 在重放时还原结构化信息 |

这三个正是上游 `renderCall/renderResult` 的对应物：**`present*` 是“只给 UI 看”的层**。

### B. Client 插件 slot（Web GUI，需要 `dsh.client` 入口）

从 `Slots.listSubTree` 里挑出的相关座位：

| Slot | 类型 | 能放什么 | `replaceRisk` |
| --- | --- | --- | --- |
| `tool.call.toolview` | keyed（工具名，开放域） | 某个工具的整张卡片 | 对已存在的工具名是 `shadows-shipped-ui`（覆盖内置卡片，没有“包一层”的 API） |
| `conversation.chat.turnTail` | list | 一轮结束时、动作行之前的一行 | none |
| `conversation.composer.dock` | list | 输入框下方常驻条 | none |
| `conversation.input.dock` | list | 输入框上方整宽条 | none |
| `conversation.input.left` / `.right` | list | 输入框工具行里的小控件 | none |
| `conversation.chat.commandview` | keyed（命令名，尚无占用） | 某条 slash 命令的结果卡 | none |
| `conversation.view` | list（session） | 整个会话主视图的另一种呈现 | none |
| `sidebar.panellist` / `sidebar.footer.action` | list | 左侧栏图标 / 底部动作 | none |
| `settings.section` | list | 一页设置 | none |

Client 侧能读的数据：`ctx.sessions.retain(...)` 拿到 `SessionReference`（会话记录），`ctx.slots` 注册座位；
没有 toast 服务（`workspace.toast` 的 key 是固定枚举，我们占不到）。

## collect：我们的实现现状（对照后才看得到的问题）

1. **`createFusedDefinition` 丢了原生表现层**：它只前置 `schema`、`render`、`presentationMeta`，
   没有转交 `base.presentCall` / `base.presentResult`。结果是熔合后的 `edit`/`write` 在 GUI 里
   **退化成通用卡**，原生 edit/write 的 diff 卡与 follow-along 文件定位都没了。这是遮蔽带来的显示回归，
   与上游“继承原生渲染器”的做法正好相反。
2. **`obs_recall` 没有 `presentCall`/`presentResult`**：只有 `output.render`（模型可见），卡片显示的就是
   那两行 header + 正文；上游在 TUI 里给它的是自带 `⚡ SoL-Pi · Observation Pack` 横幅的卡片。
3. **我们的 ObservationPack 改了存储内容，上游只改投影**：上游在 `pi.on("context")` 里替换克隆，
   会话日志保留原文，所以 TUI 里还能看到完整输出；我们在 `tools/post-execute` 替换后写入会话，
   **用户看到的直接就是占位符**，原文只能 `obs_recall` 或去归档目录找。这是展示层面最实质的差异。
4. **Reducer / Compact 的可见性已经够用**：回执正文自带 `sol_pi_evidence_receipt_v1` 头（含
   source/receipt 字节、条数），DSH 原生 compaction 有 `compaction` 节点；不需要额外做卡。

### 更正（collect 第 1 条写错了）

`createFusedDefinition` 其实**已经**转发表现层（`action-fusion.js:175-176`）：

```js
if (typeof base.presentCall === 'function') definition.presentCall = (args) => base.presentCall(args)
if (typeof base.presentResult === 'function') definition.presentResult = (args, result) => base.presentResult(args, result)
```

所以熔合后的 edit/write 仍然显示原生 diff 卡与 follow-along 定位，没有退化。上一版结论是凭“遮蔽可能丢字段”
推断的，没有对照当前代码；这里作废。真正的缺口只有两个：**没有徽标**、**`obs_recall` 没有 presenter**。

## 设计（hypothesize）：三层，只做第一层

| 层 | 手段 | 能显示什么 | 成本 | 决策 |
| --- | --- | --- | --- | --- |
| A. 工具表现层 | `presentCall` / `presentResult`（display-only，不进上下文） | 工具卡片的标题与正文排版 | 纯本地、零 token、无新入口 | **做** |
| B. Client 插件 slot | `conversation.chat.turnTail` / `conversation.composer.dock` 等 | 每轮汇总、会话常驻条、侧栏图标 | 新 client bundle、跨机制计数要另建数据通道 | 暂不做（记入后续） |
| C. 瞬时提示 | DSH 无服务端 toast；`workspace.toast` 的 key 是固定枚举 | 上游那种 4 秒状态行 | 只能靠 client 插件 + `shell.overlay` 自绘 | 不做 |

A 层的两个改动：

1. **Action Fusion**：`presentCall`/`presentResult` 在熔合且未失败时给 `title` 追加
   `⚡ 融合 · 省 1 次模型往返`；无 `then_run`、或结果 `isError` 时原样透传原生视图。
   只改 `title`，`card`/`diffs`/`content` 不动——diff 卡、终端卡、follow-along 全部保留。
2. **ObservationPack**：给 `obs_recall` 补 `output.presentationMeta`（字节/行数/下一页）+
   `presentCall`（在读哪个句柄）+ `presentResult`（标题 `obs_recall · 2.9 KiB · N 行（还有下一页）`，
   正文末尾一行 `⚡ ObservationPack · 大观测以句柄代替原文，未整段重放`）。

明确不做：

- **不给 `pwsh`/`edit` 之外的机制加卡片**：Reducer 的回执正文已经是信息载体（源字节、回执字节、条数），
  再包一层只是重复；Compact 用原生 compaction 节点。
- **不做每步/每轮的常驻状态条**：DSH 里做这件事要 client 插件 + 一条新的 Host→Client 数据通道，
  而收益（用户偶尔扫一眼）与升级风险不成比例；先看 A 层够不够。
- **不改 `output.render`**：那是模型可见层，加一个字符都要按请求付费，与“展示”目的冲突。

判定口径（怎么算这个 issue 做成了）：`then_run` 成功的 edit/write 卡片标题带徽标、失败的没有；
`obs_recall` 卡片标题带可读字节数与行数；`node tests/*.test.mjs` 全绿且模型可见内容里不出现 ⚡ 或横幅。

## 落地（apply）

- `plugin/lib/action-fusion.js`：新增 `FUSION_BADGE`、`withBadge(view, badge)`、`wantsFusion(args)`；
  `presentCall`/`presentResult` 改成“原生视图 + 条件徽标”，失败或没 `then_run` 时原样返回。
- `plugin/lib/observation-pack.js`：新增 `OBSERVATION_PACK_BADGE`、`formatBytes(bytes)`；
  `obs_recall` 的 `output` 增加 `presentationMeta`，工具定义增加 `presentCall`/`presentResult`。
- 测试：`tests/action-fusion.test.mjs` +3（徽标条件、无 presenter 时不造卡、`withBadge` 边界），
  `tests/observation-pack.test.mjs` +2（卡片标题/横幅、`formatBytes` 三档）；
  断言里特意检查 `output.render` 的产物**不含** ⚡ 与横幅，防止展示层漏进模型上下文。
- 全量：57 项测试通过（原 52 + 5）。


