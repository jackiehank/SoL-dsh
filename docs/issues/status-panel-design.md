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

## test 验证（图形化开关是否值得做）

1. **座位确实存在**：Plugins 页由 `plugin-manager` 客户端渲染
   `renderSlot("plugins.bundle.config", { view: "page" }, { entryKey: pkg.name })`，
   所以 bundle 可以在自己的页面里放配置区。
2. **表单数据来自插件 Config schema**：`dsh-settings` 用插件的
   `entry.fiber.config` / `runtime.Config` 生成 `schema.toJSON()` 表单；
   没有 `Config` 的插件不会出现在 `configForms.describe()` 里。
3. **我们的插件没有 `Config`**：只有手写的 `resolveConfig` 校验，因此 Plugins 页不会给出
   任何可编辑控件——开关不是“注册一个座位”就有的。
4. **客户端服务可用**：`plugin-manager` 客户端 `inject` 里有 `configForms`，
   可用 `ctx.configForms.get(id)` + `SettingsFormModel` 读写表单。
5. **依赖验证**：在 `plugin/` 下执行 `import('@deepseek-ai/schemastery')` 与 `import('zod')`
   都返回 `ERR_MODULE_NOT_FOUND`——profile 里的本地 bundle 拿不到 DSH 安装目录里的包。
6. **结论**：图形化开关可做，但需要额外成本：
   - 2a：给插件加 schemastery `Config`（8 个键 + volatile），再注册
     `plugins.bundle.config`；**需要新增依赖**或自带 schema 适配层；
   - 2b：自建 RPC/路由 + 自绘配置页；成本更高；
   - 1：面板只读，配置继续放在 `cordis.patch.yml`。
   当前建议维持 1；若要做，先决定 2a 的依赖来源。

## collect（第二轮：原生配置链，针对 DSH 0.2.1-rc.3）

版本：DSH desktop/runtime `0.2.1-rc.3`，cordis `4.0.5`，schemastery `~3.18.5`。

### 原生配置是这么串起来的

1. 插件声明 `static Config = z.object({ ... .volatile() })`（schemastery）。cordis 的
   `resolveConfig(runtime, config)` 用 `runtime.Config["~standard"].validate(config)` 校验并归一化。
2. 默认 `settings.configure({ auto: true })`；`dsh-settings` 的 `describe()` 对每个 entry
   调 `volatileForm(schema)`，**只保留带 volatile 的字段**，生成 `schema.toJSON()` 表单。
3. 客户端 `configForms` 服务（`dsh-client-ui-settings` 提供）用 `get(entryId)` 返回
   `ConfigFormController`，`set/unset/mutate` 排队写回 Host settings；Plugins 页的
   `configure` 控件和 `plugins.bundle.config` 座位都消费它。
4. 结论：**只要 Config 里有 volatile 字段，原生设置页就会自动生成表单**；自定义
   `plugins.bundle.config` 只是换外观，不是必需。

### 依赖问题

- profile 里的本地 bundle 解析不到 `@deepseek-ai/schemastery`（`ERR_MODULE_NOT_FOUND`）。
- 选项：
  - **a（推荐）**：`plugin/package.json` 加 `"@deepseek-ai/schemastery": "~3.18.5"`，
    由 `install_bundle` 的 pnpm 安装（需要 registry 与供应链策略允许）；
  - b：vendor 一份 schemastery（需确认许可证与体积）；
  - c：手写 Standard Schema + `toJSON/meta/dict` 适配层——`volatileForm` 会用
    `new z(schema.toJSON())` 和 `z.object(dict)` 重建 schema，兼容面大，不推荐。

### 实现成本与真正的难点

- Host：把 8 个配置键写成 `Config`，四个机制布尔值加 `.volatile()`；
  `apply` 改读 `config.actionFusion.get()` 这类 observable。
- Client：0 改动，原生表单渲染开关。
- **难点**：volatile 字段是“运行中可改”，而 `volatileForm` 会过滤掉非 volatile 字段——
  也就是说**表单里能出现的字段必须 volatile**，改完要立即生效。我们现在的四个机制是在
  `apply` 时一次性 `ctx.effect`/`ctx.on` 挂上去的；要让开关实时生效，得把每个机制改成
  “跟随配置值的可挂载/卸载单元”（每个机制一个子 effect 或子 Context），否则会出现
  “开关拨了但机制没变”。
- 兼容性：`resolveConfig` 不再手写，未知键/类型错误的文案会变；README 的配置表要同步。

## 落地（0.7.2）

- **Host**：`Config` 用 schemastery 声明 8 个键，四个机制布尔 + 归约 provider/model + ratio
  标 `.volatile()`；`apply` 把每个机制挂在**子 fiber**（`ctx.plugin`）上，监听
  `loader/volatile-update` 后按新值重挂，不重载整个插件。
- **Client**：`plugins.bundle.config` 同时注册两个 key（行 id `sol-dsh` 与包名 `@local/sol-dsh`）；
  组件用 `ctx.get('configForms')` 找命名空间，先按 `actionFusion` 字段匹配、再对 schema 信封做
  文本回退；四个开关直接 `form.set(field, checked)`。
- **验证**：开关 ObservationPack → Host 收到 `volatile-update paths:[["observationPack"]]`；
  同一条 27 KB 输出，开时换成 `obs_…` 句柄，关时原样返回，再开又换成新句柄。
- **依赖**：`@deepseek-ai/schemastery@3.18.5` + `@deepseek-ai/cosmokit@1.8.6`（lockfile 已提交）；
  这是唯一新增的运行时依赖。

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
