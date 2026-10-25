# SoL-dsh

把 [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) 的四种效率机制适配为
**DeepSeek Harness（DSH）** 的 Cordis 插件包。四个机制**默认全关**，装好后在插件页逐个打开。

仓库 <https://github.com/jackiehank/SoL-dsh>（MIT），包名 `@jackiehank/sol-dsh`，
在 DSH **0.2.1-rc.3** 上实测。

| 机制 | 英文全名 | 短名 | 一句话 |
| --- | --- | --- | --- |
| 动作融合 | Action Fusion | 融合 | `edit`/`write` 后在同一调用里跑校验/构建命令，省一次模型往返 |
| 长输出寄存 | ObservationPack | 寄存 | 超大工具结果存到本地，上下文只留句柄，需要时精确分页召回 |
| 诊断日志回执 | Evidence-Preserving Reducer | 回执 | 构建/测试日志压成逐字可核验的回执，对不上就退回原文 |
| 在线上下文压缩 | Online Context Compact | 压缩 | 计划步骤完成点触发原生 compaction，压缩后同一 turn 继续 |

## 界面

启用后有两处常驻显示，都是加法、不覆盖 DSH 原有 UI：

- **每轮尾行**：一轮结束时一行
  `本轮：融合 1 · 寄存 1 · 回执 0 · 压缩 0`（四项全零时不显示）；
- **输入框下方**：`已省 12.3k tok · 16.8%`，点击展开本会话的节省明细
  （寄存 / 回执 / 压缩 / 融合与百分比）。数字来自 Host 侧按整条会话日志折叠的投影，
  分页、重启、关掉机制都不会把历史清零。

设置入口：插件页里 **SoL-dsh 效率包** 的详情 → **机制开关**，四个开关即时生效并写回
profile 配置。

## 安装

### 桌面端（DSH Desktop，0.2.1-rc.3 实测）

1. 侧栏打开 **插件**；
2. 点 **添加插件**（或旁边的箭头 → **安装第三方插件**）；
3. 填 Git 地址 `github:jackiehank/SoL-dsh`，安装；
4. 装完**刷新页面**——Client 半按包名进模块图，旧页面不会自己长出尾行、节省面板和开关。

装完四个机制都是关的，在插件页本包的 **机制开关** 里打开需要的机制。

桌面 profile 由 Electron 持有，CLI 会拒绝它的插件管理请求；桌面端就在应用内装，
不要手改 profile 目录。

### 其他 profile（web / headless）

```powershell
dsh plugin --profile web add github:jackiehank/SoL-dsh
```

### 本地开发

仓库根 `pnpm install`，再用 `plugin_manager` 的 `install_bundle` 指向仓库根（link 模式，
不是拷贝）；Host 半改动重载插件，Client 半改动刷新页面。

### 升级与卸载

- 桌面端没有“更新”按钮：包已经在 profile 里声明时，重复安装会被 `already-installed`
  拒绝。**先移除，再用同一个入口装新版本**。
- 卸载也在插件页做，会删掉依赖和组合包行；重装后如果开关回到默认关闭，在插件页重新打开即可。
- 升级或改过 Client 半之后都要**刷新页面**；Host 半改动则重载插件或重启 DSH。

## 配置

推荐用图形化开关；它等价于直接改 profile 的 `cordis.patch.yml`。手动配置时：

```yaml
- id: sol-dsh
  name: '@jackiehank/sol-dsh'
  config:
    version: 1
    actionFusion: false
    observationPack: false
    evidencePreservingReducer: false
    evidencePreservingReducerProvider: ''
    evidencePreservingReducerModel: ''
    onlineContextCompact: false
    cacheWriteReadRatio: 12.5
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `version` | `1` | 只支持 1 |
| `actionFusion` | `false` | 动作融合 |
| `observationPack` | `false` | 长输出寄存 |
| `evidencePreservingReducer` | `false` | 诊断日志回执 |
| `evidencePreservingReducerProvider` | 空 | 回执用的 provider；留空 = 默认路由 |
| `evidencePreservingReducerModel` | 空 | 回执用的模型；留空 = 默认路由 |
| `onlineContextCompact` | `false` | 在线上下文压缩 |
| `cacheWriteReadRatio` | `12.5` | 与上游同名；当前保留并校验，暂未参与决策 |

阈值不开放（10 KiB 寄存阈值、16 KiB/400 行召回、4 KiB 归约下限、20k token 压缩留尾等）。
DSH 特有的两件事走环境变量：

- `DSH_SOL_DSH_HOME`：归档根目录（默认 `<DSH_HOME>/sol-pi`）；
- `DSH_SOL_DSH_DIAGNOSTICS=1`：注册 `sol_dsh_status` 排障工具。

## 工作方式

- **动作融合**：在每个 agent 的 scope 注册遮蔽版 `edit`/`write`，schema 继承内建定义再加可选
  `then_run`；命令走 `pwsh`/`bash` 的同一套审批、沙箱与输出截断。
- **长输出寄存**：`tools/post-execute` 在结果落日志前替换 `content`，`value` 不动；原文按内容寻址
  归档，`obs_recall {id, offset}` 按字节分页读回。
- **诊断日志回执**：只处理 `pwsh`/`bash` 的构建/测试类命令输出（≥ 4 KiB、无疑似密钥），
  先归档再用 `ctx.llm` 做一次受限调用；回执里的每条引文必须逐字出现在原文里，
  否则整体退回原文。
- **在线上下文压缩**：观察 `todo_write`，在“旧步骤变 completed”的边界用 `ctx.tokenMeter`
  选区间，经济性成立才调 `ctx.compaction.compactRegion`，不注入“继续工作”的消息。

细节与取舍见 [`docs/plugin.md`](docs/plugin.md) 和 [`docs/issues/`](docs/issues/)。

## 兼容性与边界

- 只针对 DSH **0.2.1-rc.3** 验证；更老版本没有 `sessionProjections` 时，历史统计退回扫当前快照；
  `settings`/`configForms` 缺失时没有图形开关，机制仍可用 yml 配置；
- Host 半改动要重载插件；Client 半改动要**刷新页面**；
- 归档是本地明文，可能含日志里的敏感内容，`DSH_SOL_DSH_HOME` 不要指向共享目录；
- 回执有硬约束：逐字校验失败、疑似密钥、回执不比原文小都会回退，不硬压；
- `then_run` 的输出在 post-execute 之后追加，回执机制看不到它。

## 常见问题

- **插件页没有「机制开关」**：确认本包在插件列表里已启用；配置区只为声明了
  `plugins.bundle.config` 的包显示，Client 半没加载时刷新页面。
- **尾行不显示**：四项全零时不渲染；先打开机制，再跑一轮真的有命中的会话。
- **长输出寄存没触发**：只处理超过 10 KiB 的纯文本工具结果，`value` 和二进制结果不动。
- **回执没生成**：只对 `pwsh`/`bash` 的构建/测试类命令、输出 ≥ 4 KiB、且没有疑似密钥；
  逐字校验失败、回执不比原文小都会退回原文。
- **压缩没发生**：经济性不成立（省下的 token 抵不掉摘要成本或缓存失效）就不压。
- **升级后行为没变**：卸载再安装，然后刷新页面；桌面端没有原地更新。
- **排障**：`DSH_SOL_DSH_DIAGNOSTICS=1` 启动会注册 `sol_dsh_status` 工具，报告动作融合
  在各 agent 上的安装情况（`then_run` 是否可见、scoped 注册是否生效）。

## 开发

```powershell
pnpm install              # 在仓库根装依赖（schemastery/cosmokit）
node --test tests         # 纯函数 + 机制级测试
node --check client.js
```

目录：

```text
package.json             DSH bundle 清单（exports / dsh.bundle.patch / dsh.client）
lib/                     Host 半：四个机制、配置、会话节省投影
client.js                Client 半：插件页开关、每轮尾行、节省面板
cordis.patch.yml         插入插件行 + 默认配置（四个机制全关）
locale/                  包元数据（中/英）
icon.svg
tests/                   node --test
docs/issues/             kiln issue 文档（设计与真机记录）
LICENSE                  MIT
```

## 文档与 issue

仓库用 **kiln** 管理 issue：一个提交 = 一个问题的一个动作（`ask` / `collect` / `test` /
`conclude` / `apply`），`kiln path <issue>` 可重放整条研究路径。规则见 [`AGENTS.md`](AGENTS.md)，
文档在 [`docs/issues/`](docs/issues/)。

## License

MIT。上游 [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) 为 MIT；
依赖 `@deepseek-ai/schemastery`、`@deepseek-ai/cosmokit` 亦为 MIT。
