# turnTail 注册必须带 id：控制台实证与修正

## 问题

上一轮（`turn-tail-chain-registration`）的结论是“运行时按 chain 渲染，所以用 `select` 注册”，
真机刷新后控制台直接推翻了这个推断：

```
Uncaught Error: list slot "conversation.chat.turnTail" requires options.id
    at SI.register (index-BXV-oxvX.js:120:94587)
    at Proxy._register (client.js:1611:1)
    at Object.apply (index-BXV-oxvX.js:2:8554)
```

同时 `conversation.composer.dock` 的探针（模板里验证过的座位）正常显示
`⚡ sol-dsh 客户端已加载（debug）`，说明 **Client 半加载成功**，问题只在 turnTail 的注册参数上。

结论修正：这个座位在**注册期**按 list 校验（必须有 `id`），渲染期由 owner 的 chain 取用。
两件事不矛盾——`renderSlotChain` 是取用方式，`id` 是注册契约。

## 验收

1. 注册改为 `{ name, id: 'sol-dsh', order: 5, locale }`；
2. 组件在 `useChat` 缺失、`turn.turn` 缺失、读取抛错时都返回 `null`（不再可能把错误抛进 React 树）；
3. 调试开关打开时，本轮零命中也要能区分三种状态：
   - `⚡ 本轮：融合 …`（计数成功）
   - `⚡ sol-dsh 已加载（本轮无机制命中）`（读到了快照，只是这一轮没有机制触发）
   - `⚡ sol-dsh 已加载（读不到会话快照）`（座位没给 `useChat`）
