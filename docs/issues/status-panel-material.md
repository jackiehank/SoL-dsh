# 面板材质：补上 DSH 菜单的 backdrop-filter，别让半透明底看起来“全透明”

## 问题

输入框下方的节省面板展开后，背景是半透明的菜单色，但看起来几乎是全透明，和 DSH 自己的
「Token 用量」面板不一致。

原因：DSH 的 stat dialog 用的是 `background: var(--dsw-specific-menu)` + 
`backdrop-filter: var(--dsw-menu-backdrop-filter)`。在 Windows 上 `--dsw-specific-menu`
解析到 `#f8f9fa94`（约 58% 不透明度），没有 backdrop 模糊时，背后的会话内容会清晰地透出来。

## 方案

只改 `plugin/client.js` 的注入 CSS：

- `background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay))`；
- 同时加 `-webkit-backdrop-filter` 与 `backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%))`；
- 补 `--dsw-elevation-stroke-color: var(--dsw-alias-border-l1)`，让 0.5px 描边与 DSH 一致。

不改交互、不改数字口径、不改 Host 半。

## 验收

1. 面板背景呈毛玻璃质感，背后会话内容被模糊，和「Token 用量」面板观感一致；
2. 描边、圆角、阴影、字号与 DSH 的 stat dialog 对齐；
3. `node --check plugin/client.js` 通过，版本递增。
