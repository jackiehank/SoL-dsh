# @local/sol-pi-dsh

SoL-Pi（<https://github.com/NVlabs/SoL-Pi>，MIT）效率机制的 DSH 移植。Host 半 bundle，
零外部依赖，四个机制默认全关。

## 开关（`cordis.patch.yml` 的 `config`）

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `actionFusion` | `false` | `edit`/`write` 多一个可选 `then_run`，改完文件在同一调用里跑命令 |
| `observationPack` | `false` | 超大纯文本结果换成句柄，原文归档，`obs_recall` 分页召回 |
| `observationPackThresholdBytes` | `10240` | 触发打包的 UTF-8 字节阈值 |
| `storageRoot` | `<DSH_HOME>/sol-pi` | 归档根目录（目录 0700、对象 0600） |
| `recallMaxBytes` | `16384` | 单次 `obs_recall` 上限（含头部） |
| `recallMaxLines` | `400` | 单次 `obs_recall` 行数上限 |
| `ledger` | `true` | 是否追加 `ledger.jsonl`（只记账，不进模型上下文） |
| `diagnostics` | `false` | 注册 `sol_pi_status`，报告各 agent 的 `then_run` 安装状态（排障用） |

未知键、类型错误、非法取值在插件装配阶段直接报错——不会“以为开了其实没开”。

## 行为要点

- **Action Fusion**：在内建 `edit`/`write` 的参数上追加可选
  `then_run: {command, timeout?, workdir?, description?}`。编辑成功→命令通过 `pwsh`
  （没有则 `bash`）执行，走同一套审批、沙箱、超时与输出截断；编辑失败→命令不执行，
  错误里带 `[then_run:skipped]`；命令非零退出→结果里追加 `[then_run:failed]` 与命令输出，
  **编辑不回滚**。命令报文的成功/失败看 `[then_run:...]` 与 `[exit code: N]`。
- **ObservationPack**：`tools/post-execute` 先把结果落日志的机会截下来——超过阈值、纯文本、
  非错误、且不是 reducer 回执的结果，替换成带 `id`/原始尺寸/首尾完整行的占位符；`value`
  保持不动。原文按内容寻址写到
  `<storageRoot>/observation-pack/objects/<id>.txt`，已存在则逐字节校验。
  `obs_recall {id, offset}` 返回一页（UTF-8 边界安全）与 `next_offset`/`eof`。
- **失败开放**：归档写失败、监听器异常都保留原结果，只打 `[sol-pi-dsh]` 警告。

## 与上游的差异

DSH 没有 Pi 的 `context` 投影层（`agent/request` 不能改消息），因此 ObservationPack 在结果
落日志前替换，**没有“前两次发全文”这一档**；占位符第一次请求就生效。上游的
Evidence-Preserving Reducer 与 Online Context Compact 尚未移植，方案见
`docs/issues/sol-pi-dsh.md`。

## 启用与回退

1. 改 `cordis.patch.yml` 里对应的布尔值；
2. 让 profile 重新加载插件（`plugin_manager` 重新安装，或重启 Harness）；
3. 回退 = 改回 `false` 并再次加载；拔插件后归档目录留在 `storageRoot`，可自行清理。

归档是本地明文，可能含日志里的敏感内容；`storageRoot` 不要指向共享目录。

