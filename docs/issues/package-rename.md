# 包名从 @local/sol-dsh 改为 @jackiehank/sol-dsh 的影响

## 问题

`@local/sol-dsh` 是本地开发时的占位名。项目已开源、也从 GitHub 安装，插件页仍显示 `@local/sol-dsh`；
如果以后要发 npm，`@local` scope 也发不出去。改名会牵涉：

- `package.json` 的包名；
- `cordis.patch.yml` 插入行的 `name`；
- `client.js` 的模块 id 与 `plugins.bundle.config` 的 key；
- profile 的依赖项、`dsh.profile.bundles` 列表、用户 patch 里的覆盖行；
- README / docs 里的当前写法。

## 验收

- 列出改名涉及的所有文件与运行时位置；
- 给出 profile 迁移顺序（必须保留四个机制的现有开关值）；
- 说明 npm 发布的前置条件（scope 归属）与不改名的替代方案；
- 本轮只出影响与步骤，不改代码。
