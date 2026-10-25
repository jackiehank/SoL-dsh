# 面板设计取舍：次数与 token 怎么排、要不要在面板里放开关

## 问题

输入框下方面板还有两处要定：

1. 每行现在是 `10 · 28.3k tok`，中间的圆点读起来别扭；需要一套更自然的“次数 + token”表达。
2. 面板里要不要给四个机制各放一个开关，直接在图形界面里开关。

## 需要收集的

- DSH 自己的对话框 / 状态条是怎么排“计数 + 数值”的（有没有可照抄的范式）；
- 一个数字为主、次数为辅时，哪些排法在窄面板里最稳；
- DSH 插件在图形界面里改配置有没有现成座位和持久化通道（`plugins.bundle.config`、
  `configForms`、`ctx.remote` 等），还是只能改 profile 的 `cordis.patch.yml`。

## 收集结果

### DSH 自己怎么排“计数 + 数值”

- stat dialog（`ui-chat`）：`<dl>` 两列 `minmax(76px,auto) minmax(0,1fr)`，`dt` 用 tertiary、
  `dd` 用 secondary 右对齐、tabular-nums。行是纯“标签 → 值”，例如
  `缓存命中 → 98%`、`未缓存输入 → 4,925,960 tok`。
- `UsagePill`：`234M tok · 缓存命中 98%`——圆点分隔的是**不同指标**，不是同一行的次数和 token。
- `ActivityPill`：`42 轮 751 步 · 140 tok/s`——次数用空格排，指标之间才用圆点。
- `TurnUsagePanel`：胶囊只显示紧凑 token，精确值放在标题。

结论：DSH 没有“次数 · token”这种同一行混排；次数要么进标签，要么是独立指标。

### 排法选项（次数 + token）

| 方案 | 形态 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A（推荐） | `收纳（10 次）` → `28.3k tok` | 数值列保持纯数字右对齐，次数仍可见，宽度不变 | 标签略长 |
| B | `收纳` → `28.3k tok` + 弱化小字 `10 次` | 标签干净，次数有层次 | `dd` 里要再拆两段，右对齐时不好对齐 |
| C | `收纳` → `28.3k tok`，次数省略 | 最干净 | 丢了“命中了几次”的信息 |
| D | 三列 `收纳 / 10 次 / 28.3k tok` | 信息最全 | 面板变宽，和 DSH 的两列范式不一致 |

### 图形化开关：DSH 有哪些现成座位

- `plugins.bundle.config`：keyed 座位，key 是 **bundle 的包名**，渲染在该 bundle 的
  Plugins 页配置区（`view: 'page'`）。
- 参考实现：
  - `dsh-experimental-client-ui-cot-translation`：`ctx.configForms.get(ns)` +
    `SettingsFormModel` + `settingsTextField`，注册 `plugins.bundle.config`
    （key `@deepseek-ai/dsh-experimental-cot-translation-bundle`），保存走 Host settings；
  - `dsh-experimental-client-ui-voice-input`：同一个座位 + 自己的 Remote
    （`ctx.remote.speech.configure`）与 `pluginNavigation.openBundle`。
- 客户端服务目录里直接可见的是 layout / locale / sessions / slots / theme / timer /
  uiWorkspace / workspaces；`remote`、`configForms`、`pluginNavigation` 需要在内置 bundle 的
  `dsh.client.inject` 里声明后使用。
- 我们的配置在 profile 的 `cordis.patch.yml`，改配置要走 Loader 的 configEditor 并重载插件行。

### 开关方案

| 方案 | 做法 | 成本 | 风险 |
| --- | --- | --- | --- |
| 1 | 不加开关，配置仍在 `cordis.patch.yml`，面板只读 | 零 | 用户要自己去改配置 |
| 2 | 原生 bundle 配置页：注册 `plugins.bundle.config`（key `@local/sol-dsh`），四个开关 + 保存 | 中高 | 需要 Host 侧读写配置 + 重载路径；`configForms`/`remote` 是否对 profile bundle 开放要验证 |
| 3 | 设置页（`settings.section`） | 高 | 整页开发，收益与 2 相同 |
| 4 | 面板里直接放四个开关 | 中高 | 持久化同 2，且把“读数”和“控制”混在一起；DSH 自己的用量面板是只读的 |

## 结论

1. **排法定 A**：次数放进标签（`收纳（10 次）` → `28.3k tok`），保留 DSH 的两列
   `dt/dd` 范式，数值列始终是纯数字、右对齐、tabular-nums；`融合` 保持 `11 次往返`，
   百分比单独一行。这是最小的视觉改动，不增加面板宽度。
2. **开关不要放进统计面板**：面板是只读读数，DSH 自己的用量胶囊也不带开关。
   如果要图形化配置，走**方案 2**——原生 `plugins.bundle.config` 座位
   （key 用 bundle 包名 `@local/sol-dsh`），和 cot / voice 两个内置 bundle 一致；
   需要 Host 侧配置读写 + 重载路径，且要先验证 `configForms` / `remote` 对 profile bundle 是否开放。
3. **下一步**：排法 A 可以直接落地（只改 `client.js` 的行渲染）；开关单开一个 issue 做
   `plugins.bundle.config` 的可行性验证，不混在统计面板里。

## 验收

- 给出 2–3 个可实施的方案，写清视觉、交互、持久化成本和风险；
- 给出推荐项与理由；
- 本轮不实现，等确认后再落地。
