# 四种机制的统一称呼：各展示面的详略与中英文规则

## 问题

同一种机制在不同地方叫法不一致，详略和语言也混着：

- README：`Action Fusion` / `ObservationPack` / `Evidence-Preserving Reducer` / `Online Context Compact`（只有英文全名）；
- 设置页：`Action Fusion · edit/write 的 then_run`（英文全名 + 中文短说明混排）；
- 每轮尾行：`融合 / 收纳 / 回执 / 压缩`（中文短名）；
- 输入框下方面板：中文环境用短名，英文环境却是 `Fused / Packed / Receipts / Compacted`（词性还不一致）；
- 日志与包元数据：又各有一套。

需要定下来：每个展示面详细到什么程度、什么时候用全名/短名、什么时候显示中文/英文（还是统一 i18n）。

## 验收

- 一张「机制 × 展示面」的称呼表，中文/英文各一列；
- 写清详略层级：README 最详细、设置页次之、尾行与面板最简；
- 写清语言规则：什么界面用中文、什么界面保留英文、UI 文案是否全部走 locale；
- 本轮只定规范，不改代码；确认后再落地。
