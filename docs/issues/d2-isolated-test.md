# 在不影响现有 DSH 的前提下测试 D2（Compact 端到端）

## 问题

D2（Online Context Compact 真机验证）卡在环境上：desktop profile 没有挂载 compaction 后端，
`ctx.compaction` 不可用，插件按设计不激活。直接给 desktop 启用 `compaction-basic` 会改变**所有会话**
的压缩行为，不能这么干。

需要找到一个隔离环境：能让 `compactRegion` 真实运行、能触发一次摘要调用，同时
**不修改 desktop profile、不影响正在运行的会话**。

## 约束

- desktop profile 的 bundle 列表、patch 与运行中的会话都不动；
- 全部写入落在工作区或一次性临时目录，可整体删除；
- 需要真实模型凭据（摘要调用），但不把凭据写进仓库；
- 结果要能被现有 `tools/measure-sessions.mjs` 读到（会话日志格式不变）。

## 验收

1. 在隔离环境里跑完 D2 任务（todo 完成边界 → 同 turn 继续），会话里出现 `compaction/*`；
2. desktop profile 的 `package.json` / `cordis.patch.yml` 与运行中会话零改动（前后 diff 为空）；
3. 隔离环境可一键删除，不残留 profile、凭据或会话；
4. 过程、失败原因与成本写回 issue，继续用 kiln 记录。

## Collect：可行的隔离路径

### 已核实

1. **仓库里能直接跑 CLI**：`node .dsh-src/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js --help`
   正常输出；支持 `--profile <name>`、`--from-default-profile <name>`、`--patch <path>`（可叠加）、
   `--dump-config`、`dsh plugin --profile <name> …`。`dsh` 没在 PATH 上，但入口就是这个 `bin.js`。
2. **`headless` 模板已随 CLI 安装**：`dsh-headless/cordis.patch.yml` 只挂 `dsh-base` + 一次性 runner，
   **不挂 Host/HTTP/Web/浏览器**，并关闭 hmr、credentials、authorization、deepseek-account
   （一次性任务用“launch-time credentials”）。适合做隔离实验。
3. **在真实 DSH_HOME 下新建 profile 会被沙箱挡住**：
   `node …/bin.js headless --dump-config` → `EPERM: mkdir 'C:\Users\jacki\.dsh\profiles\headless'`。
   即“新 profile 方案”需要一次显式授权（写 `~/.dsh/profiles`），或者换 DSH_HOME。
4. `@deepseek-ai/dsh-compaction-basic` 是 CLI 包依赖，`dsh-base` README 写明默认启用压缩；
   但 `headless` 组合里是否真的挂上，需要在目标 home 里用 `--dump-config` 实地确认（未验证）。

### 选项对比

| 方案 | 隔离度 | 真实性 | 成本/阻碍 |
| --- | --- | --- | --- |
| A. 工作区内 `DSH_HOME=.tmp/dsh-lab` + `headless` + `--patch` 叠加我们的插件 | 完全隔离（profile/session/凭据都在工作区） | 真实 compaction + 真实摘要调用（若 base 挂了 compaction-basic） | 需要解决 headless 的“launch-time credentials”来源；首次要在 lab home 里装我们的 bundle（`dsh plugin … add <dir>`） |
| B. 真实 `DSH_HOME` 下新建 profile（`--from-default-profile headless`） | 与 desktop 共享 home，但 profile 独立 | 同上，且凭据现成 | 需要一次写 `~/.dsh/profiles` 的授权；有共享 home 的污染风险 |
| C. `--profile sdk`（JSON-RPC stdio app） | 完全隔离（新 home） | 完整 | 需要自己写 JSON-RPC 客户端，工程量最大 |
| D. 假 `compaction` 服务桩（只实现 `compactRegion` 记录） | 完全隔离 | 只验接线（调用点/区间/账本/同 turn 继续），不验摘要质量 | 零真实压缩、零模型调用；需要一个宿主（A/B 的 headless 即可） |
| E. 给 desktop 启用 `compaction-basic` | 无 | 真实 | **否决**：影响所有会话 |

### 建议

- **首选 A**：`DSH_HOME` 指到工作区，`dsh-headless` + 一层 `--patch` 把 `@local/sol-pi-dsh` 插进去并
  打开 `onlineContextCompact`；跑完删掉 `.tmp/dsh-lab` 即可。风险只在“headless 凭据怎么给”。
- **兜底 D**：若 A 的凭据/依赖卡住，先用假 `compaction` 桩验证我们的接线（调用参数、账本、
  fail-open），把“真实摘要”留到后续。
- **不建议 B/C**：B 需要额外授权且共享 home；C 工程量与本次验证目标不匹配。

### 待确认（下一步 collect/test 前）

1. headless 的 launch-time credential 具体从哪读（环境变量名 / settings）；
2. `dsh --profile <lab> --dump-config` 里是否有 `compaction` 与 `token-meter`；
3. 把本地目录 bundle 装进 lab profile 的命令形式（`dsh plugin --profile lab add <绝对路径>`）。
