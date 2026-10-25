# SoL-dsh

把 [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) 的四种效率机制适配为
**DeepSeek Harness（DSH）** 的 Cordis 插件包。四个机制**默认全关**，装好后在设置页逐个打开。

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

设置入口：**Plugins → SoL-dsh → 机制开关**，四个开关即时生效并写回 profile 配置。

## 安装

像其他开源 DSH 插件一样，直接从 GitHub 仓库安装（依赖由 pnpm 自动装好）：

```powershell
dsh plugin --profile desktop add github:jackiehank/SoL-dsh
```

也可以在 DSH 的 **Plugins → 安装** 对话框里填同一个 spec：

```text
github:jackiehank/SoL-dsh
```

装完默认全关；在 **Plugins → SoL-dsh → 机制开关** 里打开需要的机制。

- 需要 **DSH 0.2.1-rc.3**（桌面版实测；更老版本没有 `sessionProjections`，
  历史统计会退回扫当前快照）；
- 本地开发：在仓库根 `pnpm install`，再用 `plugin_manager` 的 `install_bundle` 指向仓库根。

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

- 只针对 DSH **0.2.1-rc.3** 验证；`sessionProjections`、`settings`、`configForms` 都是该版本的接口；
- Host 半改动要重载插件；Client 半改动要**刷新页面**；
- 归档是本地明文，可能含日志里的敏感内容，`DSH_SOL_DSH_HOME` 不要指向共享目录；
- 回执有硬约束：逐字校验失败、疑似密钥、回执不比原文小都会回退，不硬压；
- `then_run` 的输出在 post-execute 之后追加，回执机制看不到它。

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
client.js                Client 半：设置页开关、每轮尾行、节省面板
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
