# 每轮一行“省了什么”：turnTail 展示面

## 问题

`sol-dsh-visibility` 的结论是“上游的卡片横幅对应 DSH 的 `presentCall`/`presentResult`”，并按此给融合 edit/write
加了 ⚡ 标题徽标。真机上**看不到任何变化**。

排查结论（对照安装包，不是推断）：

- 聊天里的工具行标题由客户端按 locale 生成：`tool-call-model.d.ts` 里
  `titleKey = VARIANT_TITLE_KEYS[classifyTool(toolName)]`，`edit → tool.title.edit`、`write → tool.title.write`；
  行内其余部分是 `filePath`、`diffStat`、`summary`，全部从 **args / result content** 推导；
- 客户端拿到的结果节点 `ToolResultNode` 只有 `content` / `isError` / `error` / `meta`（`records.d.ts:151-175`），
  **没有 `card` / `title`**；
- 在已安装的包里逐个查过消费者（`dsh-client-ui-tool|chat|conversation`、`dsh-api-gateway`、`dsh-web-app`、
  `dsh-agent-tool-presentation`、`dsh-acp*`、`dsh-headless`、`dsh-sdk-app`）：**没有任何包读取
  `presentCall`/`presentResult`**。它们只有 `dsh-tools` 自己的定义与包装（`index.js:842-876`），在这个 build 里
  是没有消费者的接缝。

所以要换展示面，并且先撤掉无效改动。目标：**每轮结束在会话流里加一行“这轮省了什么”**，additive、
不覆盖任何内置 UI、不增加模型上下文。

## 展示面：`conversation.chat.turnTail`

- 契约：`kind: 'list'`，session scope，`replaceRisk: none`；每个条目收到 `TurnTailOwnerProps`
  （`turn: TurnLocation`、`seq`、`openFile`）与 session 标准 props（含 `useChat`）；
  “entries without content return null”，所以没有可显示内容时可以整条不渲染。
- 现有占用：`deliverables`、`plan`、`schedule-created` 三家用同一个座位，我们加第四条不会影响它们。
- 数据来源：只读会话快照，按 turn 取节点，数标记——
  - 融合：结果文本含 `[then_run:succeeded]`；
  - 收纳：结果文本含 `[large tool result replaced before it entered the context]`；
  - 回执：结果文本含 `sol_pi_evidence_receipt_v1`；
  - 压缩：`kind === 'compaction'` 的节点。
  这些标记都是机制在结果里本来就会写的字面量，解析它们不额外花 token，也不新增 Host→Client 通道。

## 约束

- 只在四个计数都非零时才渲染，默认安静；
- 不覆盖 `tool.call.toolview` 之类会接管内置卡的座位；
- 不改 `output.render`（模型可见、按请求付费）；
- 文案走 Client locale（`ctx.locale.register` + 注册项 `locale`），中英各一份；
- 客户端失败必须退化为“不显示”，不能破坏会话流。

## 验收

1. 撤掉 `presentCall`/`presentResult` 的无效徽标，保留 `obs_recall` 的 `presentationMeta`
   （`meta` 是真实到达客户端的字段，diff/read/search 卡都靠它）；
2. `@local/sol-dsh` 增加 client 半：`dsh.client` + `./client` 导出 + 注册 `conversation.chat.turnTail`；
3. 段落形如 `⚡ 融合 1 · 收纳 1 · 回执 1 · 压缩 1`，四计数全零时返回 null；
4. 主机侧测试仍全绿；client 半可语法检查（`node --check`）；
5. 真机验证需要重载 Web 客户端（页面刷新或重启应用），在跑过融合/收纳的一轮之后应出现该行。

## 落地

### 撤掉无效改动（宿主半）

- `plugin/lib/action-fusion.js`：删掉 `FUSION_BADGE`/`withBadge`/`wantsFusion`，`presentCall`/`presentResult`
  恢复成原样转发（`definition.presentCall = (args) => base.presentCall(args)`）；
- `plugin/lib/observation-pack.js`：删掉 `presentCall`/`presentResult`/`OBSERVATION_PACK_BADGE`/`formatBytes`，
  **保留** `output.presentationMeta`（客户端真的会收到 `meta`，diff/read/search 卡靠它）；
- 测试相应调整：`present*` 的断言改成“原样转发、不增删字段”，`obs_recall` 只断言 meta 与模型可见内容不变。

### 新增 Client 半（每轮一行）

- `plugin/package.json`：版本 `0.3.0`；`exports` 增加 `./client`；`files` 加入 `client.js`；
  `dsh.client = { platform: 'web', immediately: true, inject: [locale, ui-chat, ui-conversation, ui-renderer] }`。
- `plugin/client.js`：`window.__ModuleLoader__.load({ id: '@local/sol-dsh', factory })`，
  - 在 `apply` 里 `ctx.locale.register('sol-dsh', { zh, en })` 注册文案；
  - `ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({ name, id: 'sol-dsh', order: 5, locale: 'sol-dsh' }, TailRow))`；
  - `TailRow` 用两个稳定选择器读快照（`s.locations`、`s.nodes`），按 `turn.turn` 取本轮节点计数；
    四个计数全为 0 时返回 `null`（整条不渲染）；
  - 文案：`⚡ 本轮：融合 {fusion} · 收纳 {pack} · 回执 {receipt} · 压缩 {compact}`（占位符缺失时用固定串兜底）。

### 计数口径

| 计数 | 判据（本轮任一工具结果的文本里） |
| --- | --- |
| 融合 | `[then_run:succeeded]`（只算跑成功的，失败/跳过不算省往返） |
| 收纳 | `[large tool result replaced before it entered the context]` |
| 回执 | `sol_pi_evidence_receipt_v1` |
| 压缩 | 本轮存在 `kind === 'compaction'` 的节点（DSH 原生压缩，含我们触发的） |

## 验证

- 宿主半：`node tests/*.test.mjs` 全绿（55 项；删掉 2 项徽标测试、新增 1 项原样转发测试）；
- Client 半：`node --check plugin/client.js` 通过；重新安装为 `@local/sol-dsh@0.3.0`（`application: applied`）；
- **真机未验证**：Client 半要等 Web 页面重载（刷新或重启应用）才会加载新 bundle。
  判据：跑一轮带 `then_run` 的 edit 或一条 >10 KiB 的命令，本轮结尾（动作行之前）应出现
  `⚡ 本轮：融合 1 · 收纳 1 · 回执 0 · 压缩 0`；没有触发任何机制的轮次不应出现该行。

