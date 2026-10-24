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

## 当前交付范围

- 已适配并落地：**Action Fusion**（`plugin/lib/action-fusion.js`）与
  **ObservationPack**（`plugin/lib/observation-pack.js` + `plugin/lib/store.js`），
  对应 issue `action-fusion-dsh`、`observation-pack-dsh`。
- 未适配（各自的 issue 另行开题，本文件不预写结论）：
  **Evidence-Preserving Reducer** 与 **Online Context Compact**。已核对的 DSH 抓手：
  - reducer：`tools/post-execute` + `ctx.llm` 受限调用（provider/model 由配置给），回执需对
    `ctx.toolResultPruner` 豁免；引用必须逐字匹配归档，失败保留原文。
  - compact：复用内建 `todo_write`（不另造计划工具），在 `agent/pre-step` 里调
    `ctx.compaction.compactRegion` 可做到“同一 turn 下一 step 用压缩后的 surface 继续”，
    比注入续跑消息更干净；状态应放 `ctx.sessionProjections`，不写会话日志。
- bundle 骨架：`plugin/package.json` + `plugin/cordis.patch.yml`（一行插入，四个开关默认关）+
  `plugin/locale/{en,zh}.json` + `plugin/icon.svg`；`lib/index.js` 只做装配，配置非法在装配阶段报错。
- 测试：`tests/{config,observation-pack,action-fusion}.test.mjs`，31 项通过；测试替身
  `tests/helpers.mjs` 只模拟本插件用到的契约（工具分层/tool 管线/finalizeContent），
  真实管线行为仍需装到 profile 后验证。

## 实测（装进 desktop profile，两个机制临时打开）

- **三个真实装配缺陷**（都是在真机上才暴露的，单测替身覆盖不到）：
  1. `export default apply` 和 `export const inject` 同时存在时，loader 取 default 函数，`inject` 不生效；
     一旦代码访问 `ctx.tools` 就报 `cannot get property "tools" without inject`。去掉 default 导出即恢复。
  2. 内建 `edit`/`write`/`pwsh` 由 agent preset 注册在**各自 agent 的 scope** 里，`ctx.tools.get(name)`
     的全局视图拿不到 → `then_run` 永远装不上（诊断工具显示 `bases-not-found`）。改成 `ctx.tools.get(name, agent)`。
  3. `agent/created` / `agent/disposed` 要带 `{ global: true }` 才能跨 scope 收到；插件晚于 agent
     加载时还要按 `agents.list()` 回溯补装，否则已有会话永远用不上。
- **ObservationPack**：6143 B / 6531 B / 37694 B 三档输出被替换为 `obs_...` 句柄，原文落在
  `~/.dsh/sol-pi/observation-pack/objects/`，ledger 记下 placeholder 与 recall；`obs_recall`
  首页返回 `next_offset=15872 eof=false`，按偏移继续读能推进；关掉开关后同样的输出不再被替换。
- **Action Fusion**（第 2 条修复后，连当前会话的 agent 也补装成功）：`edit + then_run` 成功路径返回
  `[then_run:succeeded]` + 命令输出；命令非零退出返回 `[then_run:failed]` + `[exit code: N]` 且编辑保留；
  `old_string` 不匹配时返回 `[then_run:skipped]`，命令未执行。工具体内嵌套 `ctx.tools.execute('pwsh')`
  没有出现调度互等。
- **验证边界**：Reducer 与 Context Compact 未实现；`obs_recall` 的“多页拼回逐字节相等”只在单测里验证，
  真机只验证了分页推进与 eof。
