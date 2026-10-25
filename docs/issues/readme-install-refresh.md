# README 的安装路径按应用内插件页重写，并补升级与排障

## 问题

README 和 `docs/plugin.md` 的安装段让读者执行：

```powershell
dsh plugin --profile desktop add github:jackiehank/SoL-dsh
```

但桌面端 0.2.1-rc.3 的 `desktop` profile 由 Electron 持有，npm CLI 会拒绝它的插件管理请求
（`@deepseek-ai/dsh` README 原文：`desktop` 名称保留给 Electron 持有的 profile）。实际可用的入口是
侧栏**插件**页的**添加插件**（Git 地址 / 包名 / 压缩包 / 本地目录），安装本身走应用内的
`pluginManager.installBundle`。README 现在把唯一走不通的路径写成了主路径。

同时缺三块：

1. 装完要**刷新页面**——Client 半按包名进模块图，旧页面不会长出尾行、节省面板和开关；
2. **升级/卸载**：桌面端没有原地更新入口，包已在 profile 里声明时重复安装会被拒，只能先移除再装；
3. **常见问题**：开关不出现、尾行不显示、寄存/回执/压缩不触发、排障开关，读者要翻 issue 文档才知道。

## 验收

1. 安装以应用内路径为主（插件页 → 添加插件 → 填 `github:jackiehank/SoL-dsh` → 装完刷新）；
2. CLI 只写给非桌面 profile，并注明桌面 profile 会被拒；
3. 补升级与卸载、常见问题（尾行/开关/阈值/排障）；
4. `docs/plugin.md` 的安装段同步，不再出现 `--profile desktop add`；
5. 不改代码。
