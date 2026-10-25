# 开源收尾：删测试 bundle、补 LICENSE、改成 GitHub 直装

## 问题

仓库已开源，但还有三处不像一个正常开源 DSH 插件：

1. 根目录留着 `enable-bundle/`、`enable-reducer/`、`enable-reducer-flash/` 三个测试用 bundle
   （都已 tracked），读者会困惑；
2. 没有 `LICENSE` 文件，README 只写了 MIT；
3. 安装方式仍要“先 cd plugin && pnpm install，再用 plugin_manager 指目录”，
   而其他开源 DSH 插件是 `dsh plugin add <npm/GitHub spec>` 一条命令装完。

## 方案

- 删除三个测试 bundle；
- 补 MIT `LICENSE`（版权人 Jackie Hank）；
- 把包清单从 `plugin/package.json` 上移到仓库根 `package.json`：
  - `exports`/`dsh.bundle.patch`/`dsh.client` 全部指向 `plugin/` 下的现有文件；
  - 依赖（schemastery/cosmokit）放根，`pnpm install` 在根执行；
  - `files` 只打包 `plugin/**`、README、LICENSE；
  - 这样 `github:jackiehank/SoL-dsh` 就是合法包，`dsh plugin add github:…` 可直接装，
    依赖由 pnpm 自动安装，不再需要手工 `pnpm install`。
- 包名保持 `@local/sol-dsh`，避免改 row name 破坏现有 profile 配置；
  将来要发 npm 时再改成 `@jackiehank/sol-dsh`。

## 验收

1. 三个测试目录从仓库消失；
2. `LICENSE` 为 MIT，版权人 Jackie Hank；
3. 根目录 `dsh plugin --profile desktop add github:jackiehank/SoL-dsh` 的安装路径成立
   （本地用 `install_bundle` 指向仓库根验证）；
4. 现有 profile 配置（动作融合/长输出寄存已开）在重装后保持；
5. 测试全绿，README 安装章节同步。

## 落地

- 删除 `enable-bundle/`、`enable-reducer/`、`enable-reducer-flash/`；
- 新增 MIT `LICENSE`（Copyright (c) 2026 Jackie Hank）；
- 包清单上移到仓库根：`lib/`、`client.js`、`cordis.patch.yml`、`locale/`、`icon.svg` 随之上移，
  `tests/` 的导入改成 `../lib/...`；
- 包名仍是 `@local/sol-dsh`，profile 里的配置行不用改；依赖上移到根，
  `pnpm-lock.yaml` 在根生成；
- **发现 DSH 的 bundle 入口约定**：Loader 从解析到的入口反推包目录
  （`<pkg>/lib/index.js` → `<pkg>`）。把包留在 `plugin/` 而入口写成 `plugin/lib/index.js` 时，
  反推出的包目录是 `plugin/`，再拼 `cordis.patch.yml` 就变成 `plugin/plugin/...`（ENOENT）。
  所以包必须放在仓库根、`lib/` 也在根；
- 本地验证：新进程 `require.resolve('@local/sol-dsh')` 指向根的 `lib/index.js`；
  旧 DSH 进程缓存了旧入口路径，重装后报 ENOENT，**需重启 DSH** 才能加载新布局；
- GitHub 直装：`dsh plugin --profile desktop add github:jackiehank/SoL-dsh`（依赖自动安装）。
