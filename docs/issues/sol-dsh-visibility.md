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

