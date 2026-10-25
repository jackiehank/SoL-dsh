# README 刷新：图形化开关上线、开源后的安装/配置/边界说明

## 问题

根 `README.md` 和 `plugin/README.md` 都停在“两个机制 + 手工改 `cordis.patch.yml`”的阶段：

- 根 README 写“当前交付两个机制”，实际是四个；
- 写“插件包零外部依赖”，实际依赖 `@deepseek-ai/schemastery`（+ cosmokit）；
- 没有提图形化开关（Plugins → SoL-dsh → 机制开关），也没有提尾行/节省面板；
- 安装步骤没写 `pnpm install` 前置；
- 没写兼容的 DSH 版本、已知边界、许可证/上游归属；
- 仓库已在 GitHub 开源，根 README 是门面，需要能直接照着装、照着用。

## 验收

1. 根 README：项目定位、四机制定名表、界面（设置/尾行/面板）、安装（含依赖）、
   图形化配置与 yml 回退、抓点、兼容性与边界、开发、文档、License；
2. `plugin/README.md`：补安装步骤与兼容版本，把图形化配置提为推荐路径；
3. 过时的“两个机制 / 零外部依赖”说法清除；
4. 不改代码，只改文档。
