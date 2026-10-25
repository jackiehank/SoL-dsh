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

## 验收

- 一张「机制 × 展示面」的称呼表，中文/英文各一列；
- 写清详略层级：README 最详细、设置页次之、尾行与面板最简；
- 写清语言规则：什么界面用中文、什么界面保留英文、UI 文案是否全部走 locale；
- 本轮只定规范，不改代码；确认后再落地。
