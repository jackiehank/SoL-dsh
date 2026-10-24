# 配置文件对齐上游 sol-pi 的格式

## 问题

我们的 bundle 配置目前有 23 个键（含大量阈值与实验调优项）；上游 sol-pi 的配置文件只有 8 个键，
阈值/正则/超时全部硬编码在源码里。用户希望**配置文件格式对齐上游**：默认只暴露“开哪几个机制 +
归约路由”这类少量选项，而不是让使用者面对一屏阈值。

## 现状（待 collect 核实）

- 上游：`version` + 四个布尔开关 + `evidencePreservingReducerProvider`/`…Model` + `cacheWriteReadRatio`
  （`sol-pi.example.json` 与 `docs/configuration.md` 的 schema 一致；未知键、非法值直接加载失败）；
- 我们：4 个开关之外还有 `observationPackThresholdBytes`、`recallMaxBytes`、`recallMaxLines`、
  `storageRoot`、`ledger`、`diagnostics`、`reducerMinBytes`、`reducerMaxChars`、`reducerTimeoutMs`、
  `reducerMaxOutputTokens`、`reducerReasoningEffort`、`reducerTemperature`、
  `compactKeepRecentTokens`、`compactMinRequestsSinceLast`、`compactFirstScale`、`compactMargin`、
  `compactSummaryTokens`，以及命名不同的 `reducerProvider`/`reducerModel`。
- 其中一部分是实验jacks（compact 的四个参数、reducer 的 effort/温度），一部分是 DSH 特有
  （`storageRoot`、`ledger`、`diagnostics`）——对齐时需要区分“用户该看见的”和“实验/内部默认”。

## 约束

- 对外配置**尽量收敛到上游那 8 个键**；命名与上游一致（含 reducer provider/model 的键名）；
- 其余阈值取上游同款硬编码默认（10 KiB、16 KiB/400 行、4096 B、600k 字符、90s、2048 tokens 等）；
- 严格校验保留：未知键、类型错误、非法值仍在装配阶段直接失败；
- 实验需要的调优能力不能凭空消失，但也不该占据默认配置面——具体形态在 hypothesize 里定；
- 兼容/迁移要写清楚：旧键名怎么处理（报错并给出新键名，或一次性别名）。

## 验收

1. collect 给出“上游 8 键 ↔ 我们 23 键”的逐项对照与处置建议；
2. 设计方案明确：哪些键保留、哪些改名、哪些硬编码、实验旋钮放哪、旧配置如何报错/迁移；
3. 落地后默认配置只有上游那几项；`docs` 与 `plugin/README.md` 的配置表同步；
4. 现有测试与真机行为不回归（四机制开关、reducer 路由、compact 默认值不变）。
