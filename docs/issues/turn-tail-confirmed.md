# turnTail 真机确认：三个形状错误全部修好后计数正确

## 问题

`turn-tail-node-shape` 之前的四轮修改都在猜客户端快照的形状，真机结果是 0。这一条只做两件事：
记录最终的真机结论，并把三处形状误判写进 `plugin/README.md` 的踩坑清单，免得下次重犯。

## 真机结果（2026-10-25）

装 `@local/sol-dsh@0.3.5`、机制开 `actionFusion + observationPack`、调试开关打开时，
制造了两种事件（带 `then_run` 的 edit；12,200 字节的 pwsh 输出被换成 `obs_dd12c93f…` 句柄），
刷新后该轮底部显示：

```
⚡ 本轮：融合 1 · 收纳 1 · 回执 0 · 压缩 0
```

控制台无 `sol-dsh` 相关报错；`conversation.composer.dock` 的调试探针只用于区分加载状态，默认关闭。

## 验收

1. README 增加「每轮一行：turnTail」与「客户端踩坑」两节，写清计数来源、调试开关、三处形状契约；
2. README 头部把「Host 半 bundle」改为「Host 半 + 一个 Web GUI 的每轮状态行（Client 半）」；
3. 不再把 `presentCall`/`presentResult` 当作可用的展示层（本 build 无消费者）。
