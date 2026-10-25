# turnTail 计数恒为 0：客户端内容块用 kind 不是 type

## 问题

座位已经通了（调试开关下每轮都能看到 `⚡ sol-dsh 已加载（…）`），但制造了真实事件的那一轮仍然显示
“本轮无机制命中”。而那一轮确实有两件事：带 `then_run` 的 edit 成功（结果里是 `[then_run:succeeded]`），
以及一条 12,200 字节的 pwsh 输出被换成了 `obs_…` 句柄。

原因在读取方式：客户端会话快照里的内容块判别字段是 **`kind`**，不是宿主侧的 `type`。

```js
// @deepseek-ai/dsh-client-ui-chat/lib/client.js:3617（渲染器自己的写法）
return blocks.flatMap((block) => block.kind === "text" ? [block.text] : []).join("");
```

我们的 `textOf` 写的是 `block.type === 'text'`，在浏览器里永远为假 → 每个结果节点的文本都拼成空串 →
三个 `includes(marker)` 全不命中 → 计数恒为 0。这解释了“加载成功、计数为 0”的现象。

## 验收

1. `textOf` 同时接受 `kind` 与 `type`（宿主/客户端两种形状都能读）；
2. 版本推进到 `0.3.4` 并重装；
3. 刷新页面后，**已经发生过的轮次**（带融合与收纳的那一轮）应显示
   `⚡ 本轮：融合 1 · 收纳 1 · 回执 0 · 压缩 0`，无需再制造新事件。
