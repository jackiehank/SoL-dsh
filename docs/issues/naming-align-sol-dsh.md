# 插件命名对齐：我们的插件叫 SoL-dsh

## 问题

插件身份目前沿用了上游名：包名 `@local/sol-pi-dsh`、Loader 行 id `sol-pi-dsh`、日志前缀
`[sol-pi-dsh]`、排障工具 `sol_pi_status`、环境变量 `DSH_SOL_PI_*`、locale 标题 “SoL-Pi Efficiency Pack”。
但我们的插件叫 **SoL-dsh**（仓库名也是 SoL-dsh）。需要逐项核对代码与文档，区分三类东西：

1. **插件身份**（包名、行 id、日志/错误前缀、工具名、环境变量、显示标题）——应对齐 SoL-dsh；
2. **协议常量**（如回执首行 `sol_pi_evidence_receipt_v1`）——是数据格式标识，改了会与上游/已有回执
   不一致，是否保留需要明确；
3. **上游引用与历史记录**（README 里对 NVlabs/SoL-Pi 的引用、`docs/issues/` 里过去动作的记录）——
   历史不应改写，上游名应保留。

## 验收

1. collect 给出三类清单：必须改的身份标识、建议保留的协议常量、保留的历史/上游引用；
2. 方案明确每一项的最终名字（含环境变量这种两难项），以及改名对已安装 bundle 的影响（需要重装）；
3. 落地后 `grep` 不再有我们自己的 `sol-pi-dsh` 身份标识；协议常量与历史记录按方案保留；
4. 测试与真机安装验证通过，旧命名不再出现在新代码/新文档里。

## Collect：命名清单（grep 全仓，67 处命中）

### A. 插件身份（应改成 SoL-dsh）

| 位置 | 现状 | 建议 |
| --- | --- | --- |
| `plugin/package.json` | `"name": "@local/sol-pi-dsh"` | `@local/sol-dsh` |
| `plugin/cordis.patch.yml` | `id: sol-pi-dsh`、`name: '@local/sol-pi-dsh'` | `id: sol-dsh` |
| `plugin/lib/index.js` | `export const name = 'sol-pi-dsh'`；日志前缀 `[sol-pi-dsh]` | `sol-dsh` |
| `plugin/lib/index.js` | 排障工具 `sol_pi_status` | `sol_dsh_status` |
| `plugin/lib/config.js` | 错误前缀 `sol-pi-dsh 配置错误` | `sol-dsh 配置错误` |
| 环境变量 | `DSH_SOL_PI_HOME`、`DSH_SOL_PI_DIAGNOSTICS` | 待定（见下） |
| `plugin/locale/{en,zh}.json` | “SoL-Pi Efficiency Pack” / “SoL-Pi 效率包” | “SoL-dsh …” |
| `plugin/README.md` 标题、根 `README.md`、`AGENTS.md` | `@local/sol-pi-dsh` / `sol_pi_status` | 改成新名 |
| `enable-bundle/`、`enable-reducer/`、`enable-reducer-flash/` | 包名 `@local/sol-pi-dsh-*`、patch 目标 id `sol-pi-dsh` | 改成 `@local/sol-dsh-*` / `sol-dsh` |

### B. 协议常量（建议保留，不改）

| 位置 | 常量 | 理由 |
| --- | --- | --- |
| `plugin/lib/reducer.js`、`observation-pack.js`、测试 | `sol_pi_evidence_receipt_v1` | 回执**数据格式**标识，与上游一致；改了会让旧回执无法被识别（ObsPack 靠它跳过二次打包） |

### C. 历史与上游引用（保留）

- `docs/issues/*.md` 里 40+ 处 `sol-pi-dsh`：是过去动作的**历史记录**，按 kiln 原则不改写；
- README/文档里对 `NVlabs/SoL-Pi` 的引用：是上游项目名，保留；
- 回执里的 `authority=Sol retains …` 文本：上游原文，保留。

### 待定项（hypothesize 定）

1. **环境变量**：`DSH_SOL_PI_HOME` → `DSH_SOL_DSH_HOME`？还是保留 `DSH_SOL_PI_*`（视作“SoL 系列”命名空间）？
   注意改名对已经设置过变量的用户是破坏性的。
2. **历史 issue 文档**：是否在旧文档顶部加一行“改名说明”，还是完全不动？
3. **重装影响**：行 id 从 `sol-pi-dsh` 改为 `sol-dsh` 后，profile 里旧的 bundle 行需要卸载重装，
   新行不会自动接管旧行配置。
