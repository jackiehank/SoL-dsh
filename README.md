# SoL-dsh

把 [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) 的效率机制适配为 **DeepSeek Harness (DSH)**
的 Cordis 插件包（bundle）。

当前交付两个机制，**默认全关**，按需在 `plugin/cordis.patch.yml` 的 `config` 里打开：

| 机制 | 作用 | 抓点 |
| --- | --- | --- |
| Action Fusion | `edit`/`write` 多一个可选 `then_run`：改完文件，同一次工具调用里跑校验/构建/启动命令 | `agent.ctx` 注册同名 scoped 工具遮蔽内建定义；命令走 `pwsh` 的同一套审批与沙箱 |
| ObservationPack | 超过阈值的纯文本工具结果换成稳定句柄，原文归档，用 `obs_recall` 按字节精确分页读回 | `tools/post-execute` 替换 content；`value` 不动 |

另外两个机制（Evidence-Preserving Reducer、Online Context Compact）的适配方案与 DSH 抓手记在
[`docs/issues/sol-pi-dsh.md`](docs/issues/sol-pi-dsh.md)，实现走各自的 issue。

## 安装

用 DSH 的 `plugin_manager` 安装本目录下的 `plugin/`（`install_bundle`，target 指 `plugin/` 目录），
不要手工改 profile。装完默认不改变任何行为；要启用某个机制，改那一行的 `config` 并让 profile 重新加载。

## 开发

```powershell
node tests/config.test.mjs
node tests/observation-pack.test.mjs
node tests/action-fusion.test.mjs
```

测试用 `node --test tests` 会在本机沙箱里因 spawn 管道受限失败，直接按文件跑即可。

## 排障

打开 `diagnostics: true` 后多一个 `sol_pi_status` 工具，报告每个 agent 的 `editHasThenRun`
与安装失败阶段（`no-agent-scope` / `bases-not-found` / `register` / `backfill`）。

## 仓库约定

- issue 全部由 **kiln** 管理（`kiln status` / `kiln path <issue>`），见 [`AGENTS.md`](AGENTS.md)；
- 插件包零外部依赖（只用 Node 内置模块），配置在 bundle 的 patch 行里；
- 每个机制的取舍与差异写在 `docs/issues/<issue>.md`，不写状态。

