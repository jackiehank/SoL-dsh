# 怎样证明 sol-dsh 有效：可观测量与实验口径

## 问题

四个机制都已落地（`action-fusion`、`observation-pack`、`evidence-reducer`、`context-compact`），
但“有效”目前只有机制级证据（测试、单次真机冒烟）。需要回答两件事：

1. **能观测到什么？** DSH 里哪些数字可以稳定、可重复地反映“省了 token / 省了往返 / 没牺牲正确性”。
2. **怎么归因？** 同任务、同模型、同沙箱下，全关 vs 单开一个机制，差异是否落在预期方向，且能排除
   缓存、随机性、任务难度漂移。

上游论文给出了一套口径（任务集 + 分数 + token/cost），但它的 benchmark 规模与本仓不在一个量级。
本 issue 的目标是**先定义可观测、可复现的本地口径**，再谈大规模对比；不追求复刻论文数字。

## 候选可观测量（待 collect 后细化）

- **记录 token**：`ctx.tokenMeter.measure(session)` 的 `totalTokens` / `surfaceTokens`；
  session log 里 `assistant/message.usage` 的输入/输出/cache 读写；
- **模型往返**：每 turn 的 step 数、工具调用数（`tools/result` 计数）、Action Fusion 生效次数
  （`then_run` 标记出现次数）；
- **上下文占用**：同一任务结束时 surface token 峰值、ObservationPack 替换条数与 `removedTokens`、
  Compact 的 `shadowedTokenCount`；
- **证据保真**：Reducer 的 `applied` vs `fallback` 计数、回退原因分布、`obs_recall` 次数；
- **正确性代理**：任务自带断言（脚本退出码/测试通过）、人工评分表、返工次数；
- **成本口径**：provider 计价的 input/output/cache 分项，或至少 token × 单价的近似；
- **反向指标**：fail-open 次数、压缩失败、工具结果被替换后的二次召回量（召回越多，说明替换越激进）。

## 实验设计约束

- 每个机制**单独开**与全关对照，避免四个机制互相掩盖；
- 固定模型、推理强度、沙箱权限、任务集与顺序；每个任务至少 N 次重复，报告均值与区间；
- 任务必须自带**可判定成功**的检查（测试/断言），不能只看“模型说完成了”；
- 同一任务的 warm cache 会影响 token 数：要么清缓存，要么把 cache read/write 分项单独报告；
- 记录原始 session 文件与 ledger，测量脚本只做读取与汇总，不重写会话。

## 验收

1. `docs/` 里有一页“可观测量表”：指标、数据来源（服务/事件/文件）、采集方式、已知偏差；
2. 一个可复现的采集脚本（只读 session 与 ledger），能对一组 session 输出每个机制的计数与 token 汇总；
3. 至少跑一轮小样本 A/B（例如 3 个任务 × 2 组 × 2 次），给出方向性结论与置信度说明；
4. 结论里必须包含“没有效果/负效果”的可能性与判据，而不是只挑有利数字；
5. 所有动作继续走 kiln（collect → test → conclude/apply）。
