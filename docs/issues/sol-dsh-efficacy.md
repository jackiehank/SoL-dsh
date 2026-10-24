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

## 小样本采集（只读，未花模型 token）

`tools/measure-sessions.mjs`：解码 `~/.dsh/sessions/<workspace>/<session>/session.v4.jsonl.zstd`
（按 zstd 魔数切帧，Node 只解第一帧），汇总 turn/step/工具调用/错误/分项 token/融合标记/占位符/压缩，
并聚合 `~/.dsh/sol-pi/**/ledger.jsonl`。不做模型调用、不写文件。

本工作区现有 4 个会话的输出：

| session | turns | steps | calls | err | input | output | cacheR | total | fusion | pack | compact |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 521694f9（本会话，含真机冒烟） | 5 | 241 | 289 | 3 | 1,144,280 | 184,399 | 57,084,672 | 58,413,351 | 5/5 | 4 | 0 |
| 1ec4fc50（compact 调研子代理） | 1 | 47 | 65 | 6 | 317,641 | 28,507 | 4,879,232 | 5,225,380 | 0/0 | 0 | 0 |
| e2f58a16（reducer 调研子代理） | 1 | 17 | 29 | 0 | 86,063 | 16,455 | 768,640 | 871,158 | 1/1 | 0 | 0 |
| 45e967fd（冒烟子代理） | 1 | 19 | 28 | 1 | 43,004 | 10,317 | 359,808 | 413,129 | 0/0 | 1 | 0 |

账本：`observation-pack` `{placeholder: 4, recall: 3}`；`reducer` 空（机制从未真机打开）。

读数时注意：

- **cache read 占绝对多数**（57.1M / 58.4M）：任何“省 token”的结论必须分项，否则会被 cache read 淹没；
- 本会话日志在持续写，数字是采集时刻的快照；`fusion 5/5` 来自本轮与冒烟脚本的真实 `then_run` 标记，
  `pack 4` 与账本的 4 次 placeholder 对得上，可作交叉校验；
- `todos` 计数为 0：事件类型不是 `todo/write`（或该会话没用 todo_write），采集器里这一列暂不可信；
- `reducer` 无数据：不能据此判断它无效，只能说“未启用、未观测”。

## 上游的两档推荐（collect）

README 原文把四个开关分成两档：

1. **保守档（只开两个本地机制）**：`actionFusion: true` + `observationPack: true`。
   原文理由：*"enables only the two local mechanisms that make no additional model calls and do not stop
   an active run"* —— 不新增模型调用，也不打断正在进行的运行。
2. **激进档（另外两个）**：`evidencePreservingReducer` + `onlineContextCompact`。README 要求
   *"Enable additional mechanisms only after reviewing their configuration and security implications."*
   `SECURITY.md` 写明了两条具体风险：
   - Reducer：把符合条件的长日志通过配置的 reducer 模型发出去（Pi 管理的鉴权）；`likely-secret`
     只是启发式，不是完整密钥扫描器；对“日志必须留在本机”的工作负载不应开启。
   - Compact：计划与压缩状态写进会话日志，含路径、命令名、设计笔记，敏感度等同对话本身；
     压缩成功后会写一条隐藏的通用消息让助手重建计划。

映射到本仓（DSH）：

| 档位 | 机制 | DSH 侧开销 / 风险 |
| --- | --- | --- |
| 保守 | Action Fusion | 本地；命令走 `pwsh` 的同一条审批/沙箱管线（可能弹审批，不新增模型调用） |
| 保守 | ObservationPack | 本地；在结果落日志前替换 content（不新增模型调用，不可逆地少发原文，但可 `obs_recall`） |
| 激进 | Evidence-Preserving Reducer | 每次候选日志触发一次 `ctx.llm` 调用（成本 + 日志出机 + 需要配 provider/model） |
| 激进 | Online Context Compact | 在 `agent/pre-step` 触发一次压缩/摘要调用，改变后续 surface，影响正在进行的运行 |

结论：实验顺序应与上游推荐一致——先在保守档拿信号，再决定是否为激进档花成本。

## 实验方案（hypothesize）

### 目的与假设

- H1（ObservationPack）：同一任务里，大工具输出被替换后，**总 token 与 cache read 下降**，而任务正确性不变。
- H2（Action Fusion）：同一任务里，“改文件→跑验证”合并成一次调用后，**工具调用数/step 数下降 1～2 次**，
  正确性不变。
- H3（激进档，单点）：Reducer 能把一条长失败日志换成更小的回执且校验通过；Compact 能在完成边界压缩一次
  并让同一 turn 继续。**这两条只验证机制跑通，不做收益对比**（成本高、样本小没有统计意义）。

### 任务（小样本，全部本地、自带断言）

| 任务 | 内容 | 触发机制 | 正确性判据 |
| --- | --- | --- | --- |
| T1 | 读一个约 40 KB 的本地日志，回答其中第 N 行的错误码 | ObservationPack | 回答包含准确错误码 |
| T2 | 修改一个函数并运行 `node --test`（或等价断言脚本） | Action Fusion | 测试退出码 0 |
| T3 | 运行一个会失败的测试脚本，读取其长日志并说出首个失败用例 | Reducer | 说出正确用例名 |

### 矩阵与重复

| 组 | 配置 | 任务 | 目的 |
| --- | --- | --- | --- |
| A0 | 全关 | T1 | 基线 |
| A1 | 只开 observationPack | T1 | H1 |
| B0 | 全关 | T2 | 基线 |
| B1 | 只开 actionFusion | T2 | H2 |
| C1 | 只开 reducer | T3 | H3（单点） |
| D1 | 只开 compact | 长会话（可用现有长会话续聊） | H3（单点） |

每个组合 1 次（成本优先）；若 A1/B1 出现方向性差异，再决定是否加第 2 次重复。模型、推理强度、沙箱权限、
任务文本全部固定。

### 观测与判定

- 采集：`node tools/measure-sessions.mjs --workspace <ws> --json`（只读），对比 A1−A0、B1−B0 的
  `input / cacheRead / total / toolCalls / steps / fusion / placeholders`；
- 通过条件：正确性全对 **且** 预期指标方向正确（H1：total 下降；H2：calls 或 steps 下降）；
- 反证条件：指标无变化、变差，或正确性失败 → 记为“未证明有效”，如实写进结论；
- 成本上限：每次 run 输入 token 上限 40k，超过即中止并记录；总预算约 4 次短任务。

### 执行约束与已知麻烦

- 切配置要重装 bundle（`plugin_manager remove+install`），影响面是全 profile；两次切换 = 4 次操作，
  不花模型 token，但会短暂改变当前会话行为——跑 A/B 期间不要在别处并发使用；
- 采集器 `todos` 列目前恒 0（事件名不对），B/D 组前先修；
- T3 的 Reducer 需要先配 `reducerProvider/reducerModel`（或用 `agentDefaultModel` 默认路由），
  属于“日志出机”的敏感路径，执行前再确认一次。
