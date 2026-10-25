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
