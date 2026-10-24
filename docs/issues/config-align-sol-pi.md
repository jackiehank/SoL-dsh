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

## Collect：上游到底暴露了什么

来源：克隆的 `NVlabs/SoL-Pi`（`sol-pi.example.json`、`docs/configuration.md`、`src/sol-pi/config.ts`）。

**上游配置键：8 个**

```json
{
  "version": 1,
  "actionFusion": false,
  "observationPack": false,
  "evidencePreservingReducer": false,
  "evidencePreservingReducerProvider": "provider-id",
  "evidencePreservingReducerModel": "model-id",
  "onlineContextCompact": false,
  "cacheWriteReadRatio": 12.5
}
```

关键规则（docs 原文）：功能键可省略→false；`cacheWriteReadRatio` 可省略→12.5，必须是有限非负数；
reducer provider/model 可省略→内置路由；**未知键、版本不符、非法布尔/比例/模型字段会直接让扩展加载失败**。

**硬编码在上游源码里的（不可配）**：ObservationPack 阈值 10 KiB、`FULL_SENDS=2`、占位符摘录 1 KiB、
召回 16 KiB/400 行；Reducer 最小 4096 B、最大 600k 字符、90s 超时、2048 输出 token、
12 条证据/每条 600 字符、诊断命令与密钥正则、默认 reducer 路由；Compact 的
`keepRecentTokens/reserveTokens` 跟随 Pi 自身设置、冷却 2 请求、首次视界×2、后续 margin×1.5。

**我们的 23 个键 ↔ 上游**

| 我们的键 | 上游对应 | 处置建议 |
| --- | --- | --- |
| `version`、四个机制开关 | 同名 | **保留** |
| `reducerProvider` / `reducerModel` | `evidencePreservingReducerProvider` / `…Model` | **改名对齐** |
| `observationPackThresholdBytes`、`recallMaxBytes`、`recallMaxLines` | 硬编码 10 KiB / 16 KiB / 400 | **硬编码** |
| `reducerMinBytes`、`reducerMaxChars`、`reducerTimeoutMs`、`reducerMaxOutputTokens` | 硬编码 4096 / 600k / 90s / 2048 | **硬编码** |
| `reducerReasoningEffort`、`reducerTemperature` | 上游固定用高层级（未暴露） | **硬编码默认**（温度 0；effort 取适配器默认，实测 flash 可用） |
| `compactKeepRecentTokens`、`compactMinRequestsSinceLast`、`compactFirstScale`、`compactMargin`、`compactSummaryTokens` | 跟随宿主/硬编码 | **硬编码**（保留现有默认） |
| `storageRoot` | 无（Pi 有 session 目录） | DSH 特有：默认 `<DSH_HOME>/sol-pi`，是否保留待定 |
| `ledger` | 无（上游写 session 事件） | DSH 特有调试项，建议移出用户配置面 |
| `diagnostics` | 无 | DSH 特有排障项，建议移出用户配置面 |
| `cacheWriteReadRatio` | 有，12.5 | 我们未使用；**要么接入 economics，要么不暴露**（待定） |

### 待定的三个设计点（hypothesize 里定）

1. `storageRoot` / `ledger` / `diagnostics`：保留为少数 DSH 扩展键，还是改成环境变量/内部默认？
2. 实验调优（compact 五个参数、reducer effort/温度）：放进独立 `labs` 配置块、走环境变量，
   还是实验时直接 patch 常量？
3. 旧键兼容：直接报错并提示新键名，还是一次性别名过渡？

## 方案（hypothesize）

按你的决定，对外配置**严格等于上游 8 键**：

1. **保留 8 键**：`version`、`actionFusion`、`observationPack`、`evidencePreservingReducer`、
   `evidencePreservingReducerProvider`、`evidencePreservingReducerModel`、`onlineContextCompact`、
   `cacheWriteReadRatio`（命名与上游一致）。
2. **阈值全部硬编码**：10 KiB 打包、16 KiB/400 行召回、4096 B/600k 字符/90s/2048 token 归约、
   compact 的 20k 保留尾部/冷却 2/首次×2/余量 1.5/摘要 1000 —— 与上游同款内部默认。
3. **DSH 特有走环境变量**：`DSH_SOL_PI_HOME`（归档根目录）、`DSH_SOL_PI_DIAGNOSTICS=1`（排障工具）；
   `ledger` 常开、删键。
4. **实验用常量**：测试与实验直接复制 `resolveConfig()` 的冻结结果再覆盖字段（`{ ...cfg, reducerMinBytes: 16 }`），
   不再为实验保留配置键。
5. **旧键直接报错**：错误信息列出可用的 8 个键与环境变量，不做别名过渡。

风险与已知代价：

- 之前文档里的调优键（`reducerTemperature`、compact 五参数等）不再可配；想改只能改代码或测试里覆盖常量；
- `cacheWriteReadRatio` 目前只为兼容保留并校验，**不参与决策**（我们的 economics 尚未用它），README 明说。
