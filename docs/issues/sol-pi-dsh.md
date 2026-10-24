# 把 SoL-Pi 的四个效率机制移植到 DSH

## 问题

上游 [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) 是 Pi 的独立扩展（MIT），把四个
“省上下文、省往返、不丢证据”的机制打包在一起。DSH 与 Pi 的扩展面不同：Pi 有 `context`
投影事件可以只改“发给模型的那份消息”，DSH 的会话日志是唯一事实来源，没有等价的投影层。
直接照搬会写错层，所以要先定“每个机制在 DSH 落在哪个公开扩展点”。

四个机制与 DSH 现有能力的对应：

| 机制 | Pi 抓手 | DSH 候选抓手 | 备注 |
| --- | --- | --- | --- |
| Action Fusion | 替换 `edit`/`write`，加 `then_run`（Pi Bash） | `agent.ctx` 注册同名 scoped 工具遮蔽全局；命令走 `ctx.tools.execute('pwsh')` | 必须复用同一策略管线，不能绕过沙箱/审批 |
| ObservationPack | `context` 事件统计“已发过几次”，第 3 次起换成占位符 | `tools/post-execute` 替换 content（`value` 保留给程序调用方）+ 归档 + `obs_recall` | DSH 无投影层：替换发生在结果落日志之前，因此没有“前两次发全文”这一档 |
| Evidence-Preserving Reducer | `tool_result` handler + 受限模型调用 | `tools/post-execute` + `ctx.llm` 受限调用；回执对 `toolResultPruner` 豁免 | 引文必须逐字匹配归档，失败保留原文 |
| Online Context Compact | `update_plan` + Pi 原生 compaction + hidden `triggerTurn` | `tools/post-execute` 观察 `todo_write` + `ctx.compaction.compactNow` + 续跑机制 | DSH 已有 `todo_write`，不重复造计划工具 |

## 约束与边界

1. **只用公开扩展点**：Service/Event/工具注册，不 vendor DSH 源码、不打补丁。
2. **显式 opt-in**：配置缺省四个机制全关；打开某个机制不改变其余行为。
3. **证据不丢**：任何替换都必须先把原文落到本地归档，且归档可精确分页读回。
4. **失败开放**：机制自身异常时保留原结果，不得把工具调用变成失败。
5. **可卸载**：所有注册都在 `ctx.effect` / `agent.ctx.effect` 名下，拔插件零残留。
6. **插件包零外部依赖**：bundle 只 import Node 内置模块（与 `dsh-kiln` 同策略），
   避免 profile 内的模块解析问题；配置在 `cordis.patch.yml` 的 `config` 里给。

## 交付物

- `plugin/`：`@local/sol-pi-dsh` bundle（Host 半），`cordis.patch.yml` 默认全关；
- 机制级实现与测试：`plugin/lib/*.js`、`tests/*.test.mjs`；
- `docs/issues/*.md`：每个机制为什么落在那个扩展点、否决了哪些方案；
- 安装与配置说明（README / locale 元数据）。

## 验收

1. `plugin_manager install_bundle`（target=`plugin/`）成功，插件行可见、四个开关默认关；
2. 只开 Action Fusion：`edit`/`write` schema 里出现 `then_run`，命令与编辑在同一次工具调用里完成，
   命令输出与编辑 diff 都回到模型；命令失败不吞掉编辑结果；
3. 只开 ObservationPack：大结果被替换为稳定句柄，`obs_recall` 能按字节偏移精确分页读回原文，
   归档在进程重启后仍可读；小结果不受影响；
4. 全关时行为与未安装一致（`tools/change` 无额外工具、无 post-execute 改写）；
5. `node --test tests` 全绿，覆盖上面每个机制的正例与反例；
6. `kiln check` 通过，`kiln path <issue>` 能重放每个决策。
