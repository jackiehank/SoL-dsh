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

## 方案 A 首次尝试：搭起来了，但卡在两处

已完成的隔离搭建（全部在 `.tmp`，未触碰 desktop）：

1. `DSH_HOME=.tmp/dsh-lab`，用 `dsh --profile solpi-lab --from-default-profile headless` 生成了独立 profile；
2. `--dump-config` 确认组合里**确实有** `token-meter`、`compaction-basic`、
   `compaction-tool-result-pruner`、`compaction-image-offload`，以及 `headless-runner`；
3. 把 `plugin/` 复制进 lab profile 的 `node_modules/@local/sol-pi-dsh`，用一层
   `--patch .tmp/lab-overlay.yml` 插入插件并打开 `onlineContextCompact`；
   `--dump-config` 能看到 `id: sol-pi-dsh / onlineContextCompact: true`。

跑一条最小任务时暴露两个阻断：

- **凭据**：headless 用“launch environment → `<cwd>/.env` → `$DSH_HOME/.env`”的路线，
  桌面里保存的登录被忽略。当前环境没有 `DEEPSEEK_API_KEY`，直接
  `MISSING_CREDENTIAL: llm-deepseek … provider route "deepseek-official"`。
- **插件看不到 compaction 服务**：启动日志出现
  `[sol-pi-dsh] onlineContextCompact 已开启，但缺少 compaction/tokenMeter；本机制保持关闭`，
  尽管 dump-config 里有 `compaction-basic`。说明 `attachOnlineContextCompact` 在 `apply()` 时
  用 `ctx.get('compaction')` 取服务太早（服务尚未就绪/未声明 inject）。正确做法是
  `ctx.inject(['compaction', 'tokenMeter'], …)` 让激活等待依赖，而不是一次性的 `ctx.get`。

### 下一步（二选一）

- **A1（真实）**：在 lab 的 `.env` 或启动环境提供 `DEEPSEEK_API_KEY`（或换一个可用的 API-key 路由），
  先修 `ctx.inject` 的激活时序，再跑真实 D2；
- **A2（零凭据）**：在 lab overlay 里加一个假 `compaction` 服务桩（只实现 `compactRegion`，
  记录参数并返回 `shadowedTokenCount`），验证“完成边界 → 区间选择 → 调用 → 账本 → 同 turn 继续”，
  不花模型 token、不外发日志。

两种都需要先把 `ctx.inject` 时序修掉——这是本轮发现的真实缺陷，与凭据无关。

## A1 复测（2026-10-24 晚）

- 用 `ctx.inject(['compaction','tokenMeter'], …)` 改激活时序后，headless 启动**仍然**打印
  “缺少 compaction/tokenMeter”。关键事实：`--dump-config` 里 `compaction-basic` 与 `token-meter`
  两行都在、无 `disabled`；inject 回调确实执行了（否则不会走到 attach 的告警），但回调里
  `ctx.get('compaction')` 仍读不到服务——根因未定位，下一步需要打印 inject 回调拿到的服务表 /
  检查 compaction-basic 是否在依赖就绪前失败（它可能还依赖 settings/session）。
- 凭据仍是硬阻断：headless 忽略桌面登录，`MISSING_CREDENTIAL: … deepseek-official`；
  仓库与进程环境里都没有 `DEEPSEEK_API_KEY`，凭据文件里也没有可搬运的明文键。

### 结论

方案 A 的**隔离壳子已经可用**（lab profile、overlay、dump-config 全部打通），剩下两件事：
1. 提供 `DEEPSEEK_API_KEY`（lab `.env` 或启动环境）——需要你给；
2. 定位 compaction 服务在注入后仍读不到的原因（下一动作：打印注入上下文的可用服务键）。

代码改动（`ctx.inject` 时序）暂未提交，先保留在工作区，等验证通过再落。

## 真实环境 D2：方案与恢复办法（hypothesize）

### 目标

在 **desktop profile** 上真实触发一次 `compactRegion`，同时保证可以**确定性回滚**。
disabled 的 `compaction-basic` 需要打开；这是 profile 级变更，会影响所有会话，因此按“最小开启窗口”执行。

### 为什么不能手改 profile

`dsh --profile desktop --dump-config` 直接拒绝：*"profile desktop is managed exclusively by the
Electron application"*。所以不改 `~/.dsh/profiles/desktop/*`，而是走**工作区 bundle + `plugin_manager`
安装/卸载**这条受支持的开关路径（与之前装 `@local/sol-pi-dsh` 同一机制）。

### 变更物（只新增，不改现有文件）

新建 `enable-bundle/`（提交进仓库，作为可复用的实验开关）：

```yaml
# cordis.patch.yml
- id: compaction-basic          # ← 第一步先探这个 id；不生效再试 include:compaction-basic
  disabled: false
- id: sol-pi-dsh
  config:                       # 覆盖式替换，必须给全量键
    version: 1
    actionFusion: false
    observationPack: false
    evidencePreservingReducer: false
    onlineContextCompact: true
    compactKeepRecentTokens: 1500
    compactSummaryTokens: 300
    compactMinRequestsSinceLast: 0
    compactFirstScale: 1
    compactMargin: 1
    storageRoot: ''
    ledger: true
    diagnostics: true
```

安装后：`sol-pi-dsh` 行配置变成 compact 开启；`compaction-basic` 若被成功启用，插件启动时会写
`{"scope":"online-context-compact","event":"attached"}` 到
`~/.dsh/sol-pi/evidence-preserving-reducer/ledger.jsonl` —— 这就是“服务真的可用了”的判据。

### 执行顺序

1. **快照**（只读，存 `.tmp/d2-snapshots/`）：`~/.dsh/profiles/desktop/{package.json,cordis.patch.yml,cordis.yml}`
   的副本 + sha256；`Tool.listTools` 名称集合；`plugin_manager list_plugins` 结果；
2. 建 `enable-bundle/` 并 `install_bundle`；
3. **探针**：跑一个空任务（或直接看 ledger）确认 `attached` 出现；没出现就换 `include:compaction-basic` 再试一次；
4. 子代理跑 D2 任务（3 步 todo → 完成边界 → 8 个 SHA256），随后检查：
   `compaction/*` 事件、账本 `compacted`/`skipped`、同 turn 是否继续、8 个 hash 是否正确；
5. **恢复**：`plugin_manager remove_bundle <enable-bundle>` → 立即确认：
   - `sol-pi-dsh` 行配置回到全关（bundle patch 的默认值）；
   - 工具列表与快照一致；
   - profile 三个文件 sha256 与快照一致（安装/卸载不应触碰用户 patch 层）；
6. 若恢复失败：先 `set_bundle enabled:false`；仍不行则重启 Harness；最后手段用快照副本回填
   （仅这三个文件），并把结果写回 ledger/issue。

### 风险与止损

- 打开 compaction-basic 会影响**所有会话**的压缩行为；测试窗口保持短（一次 D2），期间不在别处并发使用；
- 若出现 compaction 循环、会话报错或工具列表异常：立即第 5 步回滚；
- 压缩本身会调用一次摘要模型（真实成本，约一次上下文摘要量级）。

## 真实环境 D2：结果与回滚

### 执行

1. 快照 desktop 的 `package.json` / `cordis.patch.yml` / `cordis.yml` 到 `.tmp/d2-snapshots/`（sha256 已记）；
2. `install_bundle enable-bundle`（覆盖 `compaction-basic: disabled=false` + `sol-pi-dsh` 开 compact），
   应用成功；启动后账本出现 `{"scope":"online-context-compact","event":"attached"}` → 服务真的可用；
3. 子代理跑 D2（3 步 todo → 完成边界 → 8 个 SHA256）；
4. `remove_bundle enable-bundle` 回滚；三个 profile 文件 sha256 与快照**逐字节一致**。

### 结果

- 账本：第一次完成边界 `remaining=2` → `skip: no-range`（上下文还太小）；第二次边界 `remaining=0`
  → **`compacted`**，`reason=first-boundary`，`shadowedTokens=1660`，区间 `start=8 end=10`；
- 会话事件：`compaction/start`(seq 94) → `compaction/summary`(95) → `compaction/end`(97)；
- **同一 turn 继续**：`turn/start` 只有 1 次，summary 之后仍有 2 条 assistant 消息与工具结果；
- 正确性：8 个 SHA256 全部与 `expected.json` 一致；
- 账本另有一条更早的 `boundary`（`remaining=2`）对应首次 `todo_write` 更新，证明边界判定与冷却都按预期工作。

### 判读

- D2 的接线（完成边界 → 区间选择 → `compactRegion` → 账本 → 同 turn 继续）在真实 profile 上**全部成立**；
- `no-range` 分支被真实触发过，说明“上下文不足时不压缩”的守卫有效；
- 本次压缩 `shadowedTokens=1660` 很小，属于机制验证而非收益测量。

### 回滚清单（已执行）

| 项 | 结果 |
| --- | --- |
| `remove_bundle @local/sol-pi-dsh-enable` | applied |
| `~/.dsh/profiles/desktop/package.json` | sha256 与快照一致 |
| `~/.dsh/profiles/desktop/cordis.patch.yml` | sha256 与快照一致 |
| `~/.dsh/profiles/desktop/cordis.yml` | sha256 与快照一致 |
| `sol-pi-dsh` 行配置 | 退回 bundle 默认（全关） |

## 落地

`enable-bundle/`（工作区 bundle）作为可复用的实验开关提交：patch 里覆盖 `compaction-basic` 为启用、
并给出 `sol-pi-dsh` 的完整 compact 配置。用法：

```powershell
# 打开（需要 approval）
plugin_manager install_bundle <仓库>/enable-bundle
# 跑实验
# 回滚
plugin_manager remove_bundle @local/sol-pi-dsh-enable
```

注意：`compaction-basic` 只在这一行被覆盖时生效；`sol-pi-dsh` 的 config 是**覆盖式**的，
因此 patch 里写全量键。回滚以 profile 文件 sha256 与快照一致为准（本次已验证）。
