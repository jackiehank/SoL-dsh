# AGENTS.md — SoL-dsh

本仓库用 **kiln** 管理 issue：功能、缺陷、调研都由带 `issue:` + `action:` 的提交记录。
代码在 diff 里，**为什么这么做只能在提交历史里找到**。仓库里的 AGENTS.md 是接手入口。

- kiln 手册：本机 `~/kiln/README.md`；上游 <https://github.com/jackiehank/kiln>
- issue 文档：`docs/issues/`
- 配置：`.kilnconfig.jsonc`

## 1. 项目定位

把上游 **NVlabs/SoL-Pi**（Pi 的独立扩展，四个效率机制）适配为 **DSH** 的 Cordis 插件包：

| 上游机制 | 作用 | 本仓落点 |
| --- | --- | --- |
| Action Fusion | 编辑/写入后同一工具调用里跑后续校验命令，省一次模型往返 | 遮蔽 `edit`/`write` 的 scoped 工具 |
| ObservationPack | 超大工具结果换成稳定句柄 + 精确分页召回 | `tools/post-execute` + `obs_recall` + 归档 |
| Evidence-Preserving Reducer | 长诊断日志压成“逐字可校验”的回执 | `tools/post-execute` + 模型/子代理归约 |
| Online Context Compact | 计划步骤完成点触发原生 compaction | `tools/post-execute` 观察 `todo_write` + `ctx.compaction` |

上游仓库：<https://github.com/NVlabs/SoL-Pi>（MIT）。适配的原则与上游一致：

1. **不打补丁**：只用 DSH 公开的 Service / Event / 工具注册接口；
2. **显式 opt-in**：配置缺省时四个机制全部关闭；
3. **证据不丢**：原始观测落在本地归档里，召回是精确分页的；
4. **失败开放**：插件出错时保留原工具结果，不阻断任务。

与上游的关键差异（Pi 有投影层、DSH 没有）写在 `docs/issues/` 对应的 issue 文档里，不写状态。

## 2. kiln 是什么（一句话）

kiln 把“问题 → 动作 → 结论”编码成 git commit 的 trailer，`kiln path <issue>` 按时间重放整条研究路径。
识别规则只有一条：**一个提交是 kiln 动作，当且仅当同时带 `issue:` 与 `action:`**；普通提交被忽略。

二进制在 PATH 上（`kiln --version` 确认）。安装：`go install github.com/jackiehank/kiln/cmd/kiln@latest`。

## 3. 核心原则

1. **功能、缺陷、调研一律走 kiln**。普通 `git commit` 只用于仓库初始化、依赖升级这类与 issue 无关的杂务，且**不写** `issue:` / `action:`。
2. **一个提交 = 一个 issue 的一个动作**。
3. **issue id 用小写 kebab-case**；对已有 `ask` 的 issue 再 `ask` 会被拒绝。
4. **trailer 是事实来源**，`docs/issues/<issue>.md` 是解释与验收；文档**不写状态**。
5. **标题写结论**：这一步学到了什么、落地了什么，不要写文件名。
6. 中文优先：标题、文档、说明用中文；标识符与代码注释按项目语言习惯。
7. **不伪造动作**：没有改代码就 `conclude`，不要写 `apply`。

## 4. 标准流程

```text
ask → (hypothesize | collect | test)* → conclude | apply
```

```powershell
kiln status
git status --short

# 开题：先写 issue 文档，只提交文档
kiln commit <issue> ask --title "<问题一句话>" --domain <domain> `
    --target docs/issues/<issue>.md --only docs/issues/<issue>.md

# 中间动作：先改文件，再提交
kiln commit <issue> collect --title "<收到了什么、关键数字>" --domain <domain> --refs "docs/issues/<issue>.md, probe.log"

# 收尾：apply = 已落地；只有结论用 conclude
kiln commit <issue> apply --title "<落地了什么、怎么验证>" --target plugin/lib/foo.js
```

`kiln commit` 默认提交**整个工作区**（快照）。提交前 `git status --short`，只提交一部分用 `--only <paths>`。

## 5. 项目结构

```text
plugin/                    @local/sol-pi-dsh：DSH bundle（Host 半）
  package.json             dsh.bundle.patch 指向 cordis.patch.yml
  cordis.patch.yml         插入插件行 + 默认配置（四个机制全关）
  lib/index.js             apply(ctx, config)：装配四个机制
  lib/config.js            配置读取与校验（未知键、类型错误直接报错）
  lib/action-fusion.js     遮蔽 edit/write，加 then_run
  lib/observation-pack.js  post-execute 替换大结果 + obs_recall
  lib/store.js             归档与精确分页
  locale/{en,zh}.json      展示元数据
  icon.svg
tests/                     node --test，纯函数 + 机制级测试
docs/issues/               kiln issue 文档
```

## 6. 开发命令

```powershell
node --test tests            # 单元/机制测试
node --check plugin/lib/index.js
```

插件安装走 DSH 的 `plugin_manager`（`install_bundle` 指向 `plugin/` 目录），不要手工改 profile。

## 7. 实测踩坑

1. **默认快照整个工作区**：忘 `--only` 会把无关文件卷进动作，提交前 `git status`。
2. **空仓库不能先跑 kiln**：先有初始 `chore:` 提交。
3. **重复 `ask` 被拒**：要继续用其他动作。
4. **`collect` 不是终点**：停在 `collect` 的 issue 会一直报“缺少终点动作”。
5. **没有 `--message`**：只有 `--title` 等结构 flag。

## 8. 提交信息示例

```text
让 DSH 的 edit/write 支持 then_run

issue: action-fusion-dsh
action: apply
title: 让 DSH 的 edit/write 在同一调用里跑 then_run（scoped 遮蔽 + pwsh 管线）
domain: tooling
target: plugin/lib/action-fusion.js
refs: docs/issues/action-fusion-dsh.md
scope: DSH tool pipeline
tags: tools, fusion
```
