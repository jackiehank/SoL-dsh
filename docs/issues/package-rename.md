# 包名从 @local/sol-dsh 改为 @jackiehank/sol-dsh 的影响

## 问题

`@local/sol-dsh` 是本地开发时的占位名。项目已开源、也从 GitHub 安装，插件页仍显示 `@local/sol-dsh`；
如果以后要发 npm，`@local` scope 也发不出去。改名会牵涉：

- `package.json` 的包名；
- `cordis.patch.yml` 插入行的 `name`；
- `client.js` 的模块 id 与 `plugins.bundle.config` 的 key；
- profile 的依赖项、`dsh.profile.bundles` 列表、用户 patch 里的覆盖行；
- README / docs 里的当前写法。

## 现状盘点

### 仓库内（当前代码与文档，不含历史 issue）

| 位置 | 当前值 |
| --- | --- |
| `package.json` | `"name": "@local/sol-dsh"` |
| `cordis.patch.yml` | 插入行 `name: '@local/sol-dsh'` |
| `client.js` | `__ModuleLoader__.load({ id: '@local/sol-dsh' })`；`plugins.bundle.config` 的第二个 key |
| `README.md` | 配置示例里的 `name` |
| `docs/plugin.md` | 标题 `# @local/sol-dsh` |
| `AGENTS.md` | 无包名硬编码 |

历史 issue 文档（`docs/issues/*.md`）保留旧名，它们是当时的记录，不改写。

### profile 现状

- 依赖：`"@local/sol-dsh": "github:jackiehank/SoL-dsh"`；
- `dsh.profile.bundles` 列表里有 `@local/sol-dsh`；
- 用户 patch 覆盖行：`id: sol-dsh`、`name: "@local/sol-dsh"`、四个开关全 `true`；
- `node_modules/@local/sol-dsh` 是 GitHub 安装的真实拷贝（不是 link）。

### 运行时约束

- Loader 插入行的 `name` 必须等于安装包名，否则 import 失败；
- Client 半的模块 id 要与包名一致（模块图按包名索引）；
- `plugins.bundle.config` 的 key 用包名，改名后不同步的话设置页不会出现配置区；
- settings 命名空间用的是 **entry id `sol-dsh`**，id 不改，所以四个开关的现有值可以保留。

### npm 前置

- `@jackiehank` scope 需要同名 npm 账号/组织且有发布权限；没有的话只能走 GitHub 安装；
- 如果不想依赖 npm scope，可以继续用 `@local/sol-dsh`（GitHub 安装不要求可发布名），
  或换一个可发布的未占用名。

## 验收

- 列出改名涉及的所有文件与运行时位置；
- 给出 profile 迁移顺序（必须保留四个机制的现有开关值）；
- 说明 npm 发布的前置条件（scope 归属）与不改名的替代方案；
- 本轮只出影响与步骤，不改代码。
