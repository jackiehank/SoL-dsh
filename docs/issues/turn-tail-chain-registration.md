# turnTail 没渲染：座位其实是 chain，不是 list

## 问题

`conversation.chat.turnTail` 的插件装好后（`@local/sol-dsh@0.3.0`），刷新页面看不到任何一行
`⚡ 本轮：融合 …`。于是回读运行时代码，发现注册方式错了：

- `cordis_inspect_query(client, Slots, listSubTree)` 报告这个座位是 `kind: 'list'`、`id` 必填；
- 但实际渲染它的是 ui-chat 的 `TurnTailNodeView`（`lib/client.js:3636` 起）：
  ```js
  const tail = renderSlotChain("conversation.chat.turnTail", { turn, seq, openFile })
  ```
  也就是说它是 **chain**，注册键是 `select`；`select(owner)` 的返回值会以 `matched` 传给组件。
  唯一在用的第三方占用者 `deliverables` 就是用 `select` 注册的，没有 `id`。
- 我们按 list 的 `id` 注册，`select` 缺失 → 该条目不会被这条 chain 取到，于是永远不渲染。

顺带确认组件能拿到什么：`renderSlotChain` 只传 owner（`turn`、`seq`、`openFile`），
session 标准 props（含 `useChat`、`t`）由会话上下文注入——`deliverables` 的组件就在用 `t`/`sessionId`/`useSessions`。

## 验收

1. 注册改成 `{ select: (owner) => owner, locale: NS }`（chain 语义）；
2. 组件用 `useChat` 读快照计数；`useChat` 缺失时安全返回 `null`，不抛错；
3. 加一个可选的调试开关（`localStorage['sol-dsh:debug'] === '1'`）：打开后即使本轮零命中也会渲染
   `⚡ sol-dsh 已加载（本轮无机制命中）`，用来区分“插件没加载”和“计数为 0”；
4. 重新安装并刷新页面后：命中轮次出现计数行，零命中轮次不出现（除非打开调试开关）。

## 落地

- `plugin/client.js` 的注册改为 chain 语义：
  ```js
  ctx.slots.register({ name: 'conversation.chat.turnTail', select: (owner) => owner, locale: NS }, TailRow)
  ```
- 组件兼容两种 owner 形状：`turn` 直接给，或从 `matched`（`select` 的返回值）里取 `turn.turn`；
- 计数读不到快照（`useChat` 缺失或抛错）时返回 `null`，绝不把错误抛进会话流；
- 新增调试开关：`localStorage['sol-dsh:debug'] = '1'` 时，零命中轮次也渲染一行
  `⚡ sol-dsh 已加载（本轮无机制命中）`／`（读不到会话快照）`，用来区分“插件没加载”和“计数为 0”；
- 版本 `0.3.1`，重新安装（`remove_bundle` → `install_bundle`，`application: applied`）。

## 验证与结论

- `node --check plugin/client.js` 通过；宿主半未改动，55 项测试维持全绿。
- **真机仍未确认**（需要页面重载）：刷新后若命中轮次出现计数行 → 修复成立；若打开调试开关后仍什么都没有 →
  说明 Client 半根本没被加载（下一步查 client bundle 构建与 `dsh.client.inject` 解析），而不是计数问题。
- 这次的教训记在这里：**不要用 inspect 报告的 `kind` 推断注册键**——`conversation.chat.turnTail` 在
  inspect 里是 `list`，运行时却按 `renderSlotChain` 渲染。判断依据应当是“谁在渲染它”的源码
  （`TurnTailNodeView`），以及唯一可用的第三方占用者（`deliverables` 用 `select`）的写法。

