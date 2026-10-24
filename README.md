# SoL-dsh

把 [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) 的四个效率机制（Action Fusion、
ObservationPack、Evidence-Preserving Reducer、Online Context Compact）适配为
**DeepSeek Harness (DSH)** 的 Cordis 插件包。

- 插件包：`plugin/`（`@local/sol-pi-dsh`，Host 半 bundle）
- 四个机制**默认全关**，按需在 `cordis.patch.yml` 的 `config` 里逐个打开
- 每个机制为什么这么移植，见 `docs/issues/` 与 `kiln path <issue>`

安装：用 DSH 的 `plugin_manager`（`install_bundle`，target 指 `plugin/` 目录），
不要手工改 profile。

开发：`node --test tests`。
