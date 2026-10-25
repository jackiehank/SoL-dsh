# @local/sol-dsh

SoL-Pi（<https://github.com/NVlabs/SoL-Pi>，MIT）效率机制的 DSH 移植。Host 半 + 两个 Web GUI
状态面（Client 半：每轮尾行 + 输入框下方可点开的节省面板），零外部依赖，四个机制默认全关。
**配置键与上游 `sol-pi.json` 一致**，只有 8 个。

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
| `DSH_SOL_DSH_HOME` | `<DSH_HOME>/sol-pi` | 归档根目录（目录 0700、对象 0600、明文日志） |
| `DSH_SOL_DSH_DIAGNOSTICS=1` | 关 | 注册 `sol_dsh_status`，报告 Action Fusion 的 per-agent 安装情况（排障用） |

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
  `[sol-dsh]` 警告，并在 `evidence-preserving-reducer/ledger.jsonl` 记下原因（账本常开、KB 级）。

## 两个状态面（Client 半）

`plugin/client.js` 注册两个座位，都不改 Host 半、不新增 Host→Client 通道。

### 尾行：`conversation.chat.turnTail`

每轮结束、动作行（复制 / 点赞 / 用量 / 时间）之前一行，灰色线性闪电 + 四类计数：

```
本轮：融合 1 · 收纳 1 · 回执 0 · 压缩 0
```

- 只读、不可点、没有悬停提示；
- **四计数全零时不渲染**；
- 排障开关：DevTools 里 `localStorage['sol-dsh:debug'] = '1'` 后刷新，零命中轮次也会显示
  `sol-dsh 已加载（本轮无机制命中）`（或 `读不到会话快照`），并在控制台打印
  `[sol-dsh] turn N keys M kinds …`；关掉用 `localStorage.removeItem('sol-dsh:debug')`。

### 输入框下方：`conversation.composer.dock`

常驻一行 `已省 12.3k tok · 16.8%`（和 DSH 自己的「Token 用量」同一座位），点击向上展开面板：

```
本会话                        34,567 tok
────────────────────────────────────────
收纳                3 · 9,800 tok
回执                1 · 1,200 tok
压缩                1 · 23,567 tok
融合                2 次往返
工具输出少写        16.8%
```

- 0 项也显示（不隐藏零行）；点外部 / Esc / 再次点击关闭；
- 数字全部从会话快照算：
  - 收纳 = 占位符 `estimated_tokens` - 占位符自身；
  - 回执 = 回执头 `source_bytes` - 回执自身；
  - 压缩 = compaction 节点的 `shadowedTokenCount`（`manual-compaction` 取 `data.compaction`）；
  - 融合 = `[then_run:succeeded]` 次数，不折算 token；
  - 百分比 = (收纳 + 回执) / (收纳 + 回执 + 工具结果实际写入 token)。
- 口径是 4 字符 ≈ 1 token 的估算，只计首次写入、不含后续缓存读取；
- 扫描范围是本会话**已加载**的轮次（快照分页时不含未加载页）。

与上游的对应关系：上游 Pi 的 `tui.ts` 用 `ctx.ui.setStatus` + `ctx.ui.notify` 做 4 秒瞬时提示，
DSH 没有服务端 toast（`workspace.toast` 的 key 是固定枚举），卡片标题也不可插（`presentCall`/`presentResult`
在本 build 没有消费者），所以这里换成“每轮一行 + 可点开的会话累计”。

## 客户端踩坑（真机记录）

写 Client 半时踩过的三处形状误判，都是“拿宿主侧的字段名去读客户端快照”：

1. **座位注册要 `id`**：`list slot "conversation.chat.turnTail" requires options.id`。
   `renderSlotChain` 只是**取用**方式，注册契约仍是 list 的 `id`；只给 `select` 会直接抛错。
2. **内容块用 `kind`**：客户端会话块是 `block.kind === 'text'`（ui-chat 自己的渲染器就这么写），
   不是宿主侧的 `block.type`。按 `type` 判断会永远拼出空串。
3. **工具结果在 `data.root`**：Chat 快照里没有 `tool-result` 节点，工具调用是 `kind: 'tool-call'`
   的节点，结果挂在 `data.root` 上（落定后才是 `kind: 'tool-result'` 的块），嵌套调用在 `subCalls`。
   压缩节点是 `compaction`／`manual-compaction`。
4. **composer.dock 的 standard props 里也有 `useChat`**：DSH 自己的 `ActivityPill` 与 `UsagePill`
   就注册在同一个座位，前者同时用 `useChat` + `useProjection`。`snapshot.timeline.turnOrder`
   是轮次列表，配合 `locations.getTurn(turn)` / `nodes` 可扫全量（已加载）轮次。

Client 半改动要**页面刷新**才生效（Host 侧重载带不上浏览器模块）。

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

归档是本地明文，可能含日志里的敏感内容；`DSH_SOL_DSH_HOME` 不要指向共享目录。
