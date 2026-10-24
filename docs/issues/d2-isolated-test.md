# 在不影响现有 DSH 的前提下测试 D2（Compact 端到端）

## 问题

D2（Online Context Compact 真机验证）卡在环境上：desktop profile 没有挂载 compaction 后端，
`ctx.compaction` 不可用，插件按设计不激活。直接给 desktop 启用 `compaction-basic` 会改变**所有会话**
的压缩行为，不能这么干。

需要找到一个隔离环境：能让 `compactRegion` 真实运行、能触发一次摘要调用，同时
**不修改 desktop profile、不影响正在运行的会话**。

## 约束

- desktop profile 的 bundle 列表、patch 与运行中的会话都不动；
- 全部写入落在工作区或一次性临时目录，可整体删除；
- 需要真实模型凭据（摘要调用），但不把凭据写进仓库；
- 结果要能被现有 `tools/measure-sessions.mjs` 读到（会话日志格式不变）。

## 验收

1. 在隔离环境里跑完 D2 任务（todo 完成边界 → 同 turn 继续），会话里出现 `compaction/*`；
2. desktop profile 的 `package.json` / `cordis.patch.yml` 与运行中会话零改动（前后 diff 为空）；
3. 隔离环境可一键删除，不残留 profile、凭据或会话；
4. 过程、失败原因与成本写回 issue，继续用 kiln 记录。
