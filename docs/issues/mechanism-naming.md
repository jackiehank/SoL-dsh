# 四种机制的统一称呼：各展示面的详略与中英文规则

## 问题

同一种机制在不同地方叫法不一致，详略和语言也混着：

- README：`Action Fusion` / `ObservationPack` / `Evidence-Preserving Reducer` / `Online Context Compact`（只有英文全名）；
- 设置页：`Action Fusion · edit/write 的 then_run`（英文全名 + 中文短说明混排）；
- 每轮尾行：`融合 / 收纳 / 回执 / 压缩`（中文短名）；
- 输入框下方面板：中文环境用短名，英文环境却是 `Fused / Packed / Receipts / Compacted`（词性还不一致）；
- 日志与包元数据：又各有一套。

需要定下来：每个展示面详细到什么程度、什么时候用全名/短名、什么时候显示中文/英文（还是统一 i18n）。

## 现状盘点

| 展示面 | 融合 | 收纳 | 回执 | 压缩 |
| --- | --- | --- | --- | --- |
| README 行为要点 | Action Fusion | ObservationPack | Evidence-Preserving Reducer | Online Context Compact |
| 设置页（zh） | Action Fusion · edit/write 的 then_run | ObservationPack · 大结果句柄 | Evidence-Preserving Reducer · 回执 | Online Context Compact · 完成点压缩 |
| 设置页（en） | Action Fusion · then_run for edit/write | ObservationPack · large-result handles | Evidence-Preserving Reducer · receipts | Online Context Compact · completion compaction |
| 尾行（zh） | 融合 | 收纳 | 回执 | 压缩 |
| 尾行（en） | fused | packed | receipts | compacted |
| 面板（zh） | 融合 | 收纳 | 回执 | 压缩 |
| 面板（en） | Fused | Packed | Receipts | Compacted |
| 日志 `MECHANISMS` | Action Fusion（edit/write 的 then_run） | ObservationPack（大结果句柄 + obs_recall） | Evidence-Preserving Reducer（诊断日志回执） | Online Context Compact（计划完成点压缩） |

问题：

1. 中文设置页夹英文全名 + 中文短语，四行长度、词性都不统一；
2. 英文尾行/面板用过去分词（fused/packed/compacted），和中文短名（名词）不对应；
3. README 只有英文全名，没有中文全名，读者要自己映射；
4. 日志、设置页、README 各自一套括注；
5. 英文 `receipts` 是复数，中文「回执」是单字，数量与单复数都不一致；
6. 包元数据（`locale/*.json`）只描述前两个机制，与四个机制的实际范围不符。

## 统一称呼

| 机制 | 中文全名 | 英文全名 | 中文短名 | 英文短名 |
| --- | --- | --- | --- | --- |
| `actionFusion` | 动作融合 | Action Fusion | 融合 | Fusion |
| `observationPack` | 观测收纳 | ObservationPack | 收纳 | Pack |
| `evidencePreservingReducer` | 证据回执 | Evidence-Preserving Reducer | 回执 | Receipt |
| `onlineContextCompact` | 在线上下文压缩 | Online Context Compact | 压缩 | Compact |

## 各展示面的详略

### README（最详细）

- 「行为要点」标题写成 `**动作融合（Action Fusion）**`，其余三个同理；
- 保留配置键名、实现细节、字节阈值；
- 尾行与面板示例继续用短名（不改）。

### 设置页（次详细）

- 中文：`动作融合（Action Fusion）· 编辑/写入后在同一调用里跑命令`；
- 英文：`Action Fusion · run a command after the edit`；
- 统一成「全名（英文全名）· 一句短说明」，四行结构一致。

### 尾行（最简）

- 中文：`本轮：融合 1 · 收纳 1 · 回执 0 · 压缩 0`；
- 英文：`This turn: fusion 1 · pack 1 · receipt 0 · compact 0`——
  用名词单数，不用 `fused/packed` 这类过去分词。

### 面板（最简）

- 中文：`融合 / 收纳 / 回执 / 压缩`；
- 英文：`Fusion / Pack / Receipt / Compact`；
- 数值列、`工具输出少写` / `Tool output saved` 不变。

### 日志与诊断

- 机制名用英文全名（方便搜索、对照上游），消息正文中文；
- `MECHANISMS` 表与 README 的英文全名一致。

### 包元数据

- `locale/zh.json` 与 `locale/en.json` 的 `description` 补全四个机制
  （现在只提了动作融合与观测收纳）。

## i18n 规则

1. 所有用户可见文案（尾行、pill、面板、设置页、错误提示）只通过 `ctx.locale`，
   中英各一份，不硬编码中文；
2. 中文界面**只有设置页**保留英文全名（对照 README / 上游用）；尾行、面板、pill 不夹英文，
   `tok` 视为单位保留；
3. 英文界面全英文，不出现中文；
4. README / docs 用中文；机制首次出现写「中文（English）」，之后用短名；
5. 两个语言字典同时维护，新增 key 一次加两份。

## 落地清单（确认后）

1. `plugin/client.js`：设置页四个 toggle 文案改成统一结构；英文尾行改名词单数；
2. `plugin/README.md`：四个机制标题补中文全名；
3. `plugin/lib/index.js`：`MECHANISMS` 用英文全名；
4. `plugin/locale/*.json`：description 补全四个机制；
5. 版本递增，刷新页面验收。

## 结论

1. **定名**：动作融合 / 观测收纳 / 证据回执 / 在线上下文压缩；短名固定为
   融合、收纳、回执、压缩（英文 Fusion / Pack / Receipt / Compact）。
2. **详略**：README 全名 + 细节；设置页全名（英文）+ 一句说明；尾行/面板只用短名。
3. **语言**：UI 全部走 locale；中文界面仅设置页保留英文全名；英文界面不用过去分词；
   README 中文、首次出现给英文全名。
4. 本轮只定规范，不改代码；确认后按「落地清单」一次改完。
