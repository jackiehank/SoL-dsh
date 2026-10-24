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

## 论文怎么证明有效性（arXiv:2609.20519v1，2026-09-17）

### 评测面与对照

- **任务集**：EdgeBench（51 个公开任务；11 个用于一次性验收，40 个留作最终泛化评估）、
  Terminal-Bench 4（63 个纯 CPU 任务）、IMO 2026（Lean 4 形式化验收）、kernel-optimization 多代理实验。
- **对照**：Codex、OpenSquilla、Oh-My-Pi、OpenCode、Oh-My-OpenCode、Pi（主基线）、EdgeBench 官方分数；
  另有 **Opus 5 作为留出后端**，验证“不改代码、跨模型迁移”。
- **纪律**：能力容差与效率指标在搜索前固定、与优化 agent 隔离；候选必须先过能力门、再过效率门；
  留出结果不回灌搜索；评测前冻结机制源码、配置、指标与接受规则。

### 指标（可直接借用）

| 指标 | 定义 | 论文里的用法 |
| --- | --- | --- |
| Recorded token traffic | 分 Input / Cache Read / Cache Write / Output / Total（十亿 token） | 主效率指标，单列 cache 读/写 |
| Token cost | 按固定日期（2026-08-17）API 价格折算的美元 | 主成本指标 |
| Avg. score | EdgeBench 任务平均分 | 能力指标（不是通过率） |
| Token efficiency | API cost ÷ 聚合任务分数（$/score） | 单一“性价比”数字 |
| Solved tasks / cost per solved | Terminal-Bench 的通过数与“每解一题成本” | 迁移评测 |
| Trigger rate / intensity | 机制在多少比例任务上触发 / 每个触发任务平均触发几次 | 机制激活画像，解释增益来源 |

### 关键数字（GPT-5.6 Sol，EdgeBench 51 任务）

| 配置 | Total tokens | Token cost | Avg score | $/score |
| --- | --- | --- | --- | --- |
| Pi | 2.1538 B | $1,339 | 44.833 | 0.5855 |
| SoL-Pi [Efficiency]（四机制全开） | 1.0990 B | $894 | 42.003 | 0.4174 |
| SoL-Pi [Performance]（只开 ObservationPack） | 2.0224 B | $1,271 | 47.208 | 0.5280 |

- 全开：token −49.0%、成本 −33.2%，保留 Pi 93.7% 的平均分；Opus 5 留出后端 token −44.7%、成本 −33.5%、
  保留 94.3% 平均分。
- 单机制消融（GPT-5.6 Sol / Opus 5）：四个机制**单独加**都能降 token；但分数有涨有跌
  （如 Opus 5 + Action Fusion 50.482 vs Pi 44.756，而 GPT-5.6 Sol + Online Context Compact 41.993 vs 44.833）。
- Cache 权衡：全开时 cache read 2.1326 B → 1.0605 B，cache write 0.0141 B → 0.0316 B，总成本仍降。
- 不利结果也照报：Terminal-Bench 4 上 SoL-Pi 解 15 题、Pi 解 18 题（总成本 −26.3%、每解题成本 −11.6%）；
  IMO 2026 通过 3/6，与 Pi 持平但每通过题成本更低（$20.90 vs $25.32）。

### 对我们的含义

1. 度量必须**分项**：input / cache read / cache write / output，否则压缩机制“省 input、涨 cache write”的
   权衡会被掩盖；总成本与 token efficiency 要同时报。
2. 必须有**能力门**：只看 token 下降没有意义；至少要有一个自带断言的正确性代理（测试通过率/任务分）。
3. 归因要**逐机制**：论文先报单机制、再报全栈，并附触发率/触发强度；我们本地也要“全关 / 单开 / 全开”三档。
4. 允许并展示**负结果**：分数下降、某机制不触发、cache write 上升都写进结论。

下载与引用：<https://arxiv.org/abs/2609.20519>（HTML: <https://arxiv.org/html/2609.20519v1>）。

## DSH 侧能观测到什么（已核对的服务与文件）

| 可观测量 | 来源 | 取法 | 已知偏差 |
| --- | --- | --- | --- |
| 总 token / surface token / 按节点 token | `ctx.tokenMeter`（`measure(session, header?)`、`estimateMessage`） | 插件内查；`nodes[{seq,tokens}]` 给区间定价 | 是“路由定价”的估计；跨模型切换后不可直接比 |
| 单条消息的 token | `estimateMessage` | 同上 | 粗估，非 provider 计数 |
| 输入/输出/cache 读/cache 写 | `assistant/message.usage`（`session/event` 流） | 折叠日志或读持久化投影 | DSH 是否记录 cache 分项取决于 provider；本会话未验证到分项 |
| 模型往返 / step / 工具调用数 | `agent/turn-stopping`、`tools/result`、`agent/request` | 事件计数 | 并行工具调用会一次 dispatch 内多次 `tools/result` |
| 压缩收益 | `ctx.compaction.compactRegion` 返回的 `shadowedTokenCount`（另有 `summary`/`shadowedRange`） | 插件内记账 | 只反映被 shadow 的区间，不等于实际省下的请求成本 |
| Action Fusion 触发次数 | `then_run` 标记（`[then_run:succeeded|failed]`）出现在工具结果里 | 扫日志/`tools/result` | 失败也计数，要分开统计 |
| ObservationPack 替换与召回 | 插件账本 `~/.dsh/sol-pi/observation-pack/ledger.jsonl`（本会话已验证有 `placeholder`/`recall` 记录，含 `removedTokens`） | 直接读 JSONL | 只在开启时产生；不含原始内容 |
| Reducer 生效/回退 | `~/.dsh/sol-pi/evidence-preserving-reducer/ledger.jsonl`（`candidate`/`applied`/`fallback`/`compacted`） | 直接读 JSONL | 原因分类有限；不含正文 |
| Compact 跳过/失败 | 同上，`scope=online-context-compact` | 直接读 JSONL | 只在开启时产生 |
| 会话原始记录 | 本 profile 只观察到 `~/.dsh/storages/.../session_projcache`；**没有找到** JSONL 会话文件 | 待下一条 collect 定位持久化后端（或改用服务读取） | 位置未确认，不能作为第一版数据源 |
| 成本（$） | 无现成服务 | 用 token × 单价表现算（单价写在脚本参数里） | 价格随时间和 provider 变；必须注明价格快照 |

可用的近似口径（第一版）：

1. **token**：直接报 tokenMeter 的 `totalTokens`；有 usage 事件时以 provider 上报为准，并注明是否含 cache；
2. **往返**：`tools/result` 计数 + turn/step 计数；Action Fusion 的节省按“融合调用数”估算被省掉的往返；
3. **正确性**：任务自带断言（脚本退出码/测试通过），不用模型自述；
4. **成本**：只给 token 与显式单价下的换算，不假装是账单。

尚缺的证据：本 profile 的会话持久化位置与 `assistant/message.usage` 的 cache 分项是否存在——下一动作先定位再写采集脚本。
