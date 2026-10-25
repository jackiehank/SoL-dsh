# README 的英文版

## 问题

仓库已开源，README 只有中文。DSH 的机制名、包名、CLI 与界面文案都是英文，英文读者拿到包
却读不到安装路径、阈值和边界。命名规范要求 README 用完整英文名（Action Fusion /
ObservationPack / Evidence-Preserving Reducer / Online Context Compact），英文版必须沿用
同一套称呼，不能另起译名。

## 验收

1. `README.en.md` 与 `README.md` 结构一一对应：界面 / 安装（桌面端、其他 profile、本地开发、
   升级卸载）/ 配置 / 工作方式 / 兼容性与边界 / 常见问题 / 开发 / 文档与 issue / License；
2. 机制名用英文全名，短名 Fusion / Pack / Reducer / Compact；尾行、节省面板示例用英文 UI 文案；
3. 安装路径与中文版一致：桌面端走插件页的 Add plugin，CLI 只写给其他 profile；
4. 两个 README 顶部互加语言链接；
5. 不改代码。
