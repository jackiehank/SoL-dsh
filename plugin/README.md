# @local/sol-pi-dsh

SoL-Pi（<https://github.com/NVlabs/SoL-Pi>，MIT）效率机制的 DSH 移植。Host 半 bundle，
零外部依赖，四个机制默认全关。**配置键与上游 `sol-pi.json` 一致**，只有 8 个。

## 开关（`cordis.patch.yml` 的 `config`）

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `version` | `1` | 只支持 1 |
| `actionFusion` | `false` | `edit`/`write` 多一个可选 `then_run`，改完文件在同一调用里跑命令 |
| `observationPack` | `false` | 超过 10 KiB 的纯文本结果换成句柄，原文归档，`obs_recall` 分页召回 |
| `evidencePreservingReducer` | `false` | 诊断类命令的长输出压成“逐字可校验”的回执，原文归档 |
| `evidencePreservingReducerProvider` | 空 | 归约模型路由的 provider；留空 = 默认路由 |
| `evidencePreservingReducerModel` | 空 | 归约模型 id；留空 = 默认路由 |
| `onlineContextCompact` | `false` | 计划步骤完成点触发原生压缩（同一 turn 继续） |
| `cacheWriteReadRatio` | `12.5` | 与上游同名；当前实现保留并校验，暂未参与决策 |

未知键、类型错误、非法取值在插件装配阶段直接报错。**阈值不开放**：10 KiB 打包阈值、16 KiB/400 行召回、
4096 B/600k 字符/90s/2048 token 归约参数、compact 的保留尾部与冷却系数，都取与上游一致的内部默认。

## 环境变量（DSH 特有）

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `DSH_SOL_PI_HOME` | `<DSH_HOME>/sol-pi` | 归档根目录（目录 0700、对象 0600、明文日志） |
| `DSH_SOL_PI_DIAGNOSTICS=1` | 关 | 注册 `sol_pi_status`，报告 Action Fusion 的 per-agent 安装情况（排障用） |

## 行为要点

- **Action Fusion**：在内建 `edit`/`write` 的参数上追加可选
  `then_run: {command, timeout?, workdir?, description?}`。编辑成功→命令通过 `pwsh`
  （没有则 `bash`）执行，走同一套审批、沙箱、超时与输出截断；编辑失败→命令不执行，
  错误里带 `[then_run:skipped]`；命令非零退出→结果里追加 `[then_run:failed]` 与命令输出，
  **编辑不回滚**。命令报文的成功/失败看 `[then_run:...]` 与 `[exit code: N]`。
- **ObservationPack**：`tools/post-execute` 先把结果落日志的机会截下来——超过 10 KiB、纯文本、
  非错误、且不是 reducer 回执的结果，替换成带 `id`/原始尺寸/首尾完整行的占位符；`value`
  保持不动。原文按内容寻址写到 `<storageRoot>/observation-pack/objects/<id>.txt`，已存在则逐字节校验。
  `obs_recall {id, offset}` 返回一页（UTF-8 边界安全）与 `next_offset`/`eof`。
- **Evidence-Preserving Reducer**：只对 `pwsh`/`bash` 的诊断类命令（go test / cargo / pytest /
  npm test / make …）动手。正文 ≥ 4 KiB 且不含疑似密钥时，先把原文按内容寻址归档，
  再用 `ctx.llm` 做一次受限调用，要求模型只输出一个 JSON 回执；回执里的每条引文必须**逐字连续**
  出现在归档正文里，schema/source_sha256/status/证据条数/长度任何一项不符、失败日志缺 failure 证据、
  或回执不比原文小，都整体回退到原文。回执首行是 `sol_pi_evidence_receipt_v1`，带
  `source_artifact` 供按字节复核。归约调用固定温度 0、思考等级用适配器默认（实测
  `deepseek-v4.1-flash` 可用；需要更强模型就显式配 provider/model）。
- **Online Context Compact**：观察内建 `todo_write`，只有“旧步骤变 completed”才产生完成边界；
  在 `agent/pre-step` 里用 `ctx.tokenMeter.measure(session).nodes` 选区间（system 不入区间、按
  内部默认 20k token 留尾），经济性成立才调 `ctx.compaction.compactRegion`——压缩后同一
  turn 的下一 step 自然继续，不注入“继续工作”的消息。
- **失败开放**：归档写失败、模型不可用/超时/输出不合法、监听器异常都保留原结果，只打
  `[sol-pi-dsh]` 警告，并在 `evidence-preserving-reducer/ledger.jsonl` 记下原因（账本常开、KB 级）。

## 与上游的差异

DSH 没有 Pi 的 `context` 投影层（`agent/request` 不能改消息），因此 ObservationPack 在结果
落日志前替换，**没有“前两次发全文”这一档**；占位符第一次请求就生效。

Reducer 在 DSH 上以 `[exit code: N]` 为准（`pwsh` 非零退出通常不算 `isError`），且看不到
`then_run` 段——那一段由 `finalizeContent` 在 post-execute 之后才追加。Compact 用
`compactRegion` 而不是 Pi 的“注入续跑消息”，因此没有额外的模型往返；它的状态是进程内内存，
resume 后冷却从头开始。

上游把账本写进 session 事件；DSH 不允许插件新增事件类型，所以落到 `<storageRoot>/**/ledger.jsonl`。

## 启用与回退

1. 改 `cordis.patch.yml` 里对应的布尔值（配置键只有上面 8 个）；
2. 让 profile 重新加载插件（`plugin_manager` 重新安装，或重启 Harness）；
3. 回退 = 改回 `false` 并再次加载；拔插件后归档目录留在 `storageRoot`，可自行清理。

归档是本地明文，可能含日志里的敏感内容；`DSH_SOL_PI_HOME` 不要指向共享目录。
