# 插件装配：为什么“代码对、单测绿”却在真机装不上

## 问题

`action-fusion-dsh` 与 `observation-pack-dsh` 的机制级测试全绿之后，把 bundle 装进 desktop
profile 做真机验收，出现了单测替身覆盖不到的三类装配失败：

1. **`inject` 不生效**：`index.js` 同时 `export function apply` 和 `export default apply` 时，
   loader 把 default 函数当成插件本体，`export const inject = ['tools']` 被忽略；一旦代码访问
   `ctx.tools`，Cordis 直接抛 `cannot get property "tools" without inject`，整行 entry 不激活。
   —— 关闭两个机制时是“假通过”：`apply` 只写了日志，根本没碰 `ctx.tools`。
2. **基线工具取错层**：内建 `edit`/`write`/`pwsh` 由 agent preset 注册在**每个 agent 自己的 scope**
   里，`ctx.tools.get(name)`（全局视图）返回 `undefined`。于是遮蔽版永远装不上，
   模型看到的 `edit` 没有 `then_run`，而插件对此毫无报错。
3. **生命周期事件收不到**：`agent/created` / `agent/disposed` 的派发带 scope 过滤，插件 ctx 与
   agent scope 不在同一条链上时监听器收不到；即使收到，插件晚于 agent 加载（热装、恢复会话）
   也不会回头补装已有 agent。

## 约束

- 不加 default 导出，只用 `export function apply` + `export const inject` + `export const name`；
- 一切工具查表都按目标 agent 的视角（`ctx.tools.get(name, agent)`），包括 shell 工具；
- 生命周期监听用 `{ global: true }`，并在装配时按 `agents.list()` 回溯一次；
- 遮蔽注册要幂等：注册本身会触发 `tools/change`，重入不能重复注册同名工具；
- 排障必须有可见入口：一个默认关闭的 `diagnostics` 开关，开启后注册 `sol_pi_status`，
  报告每个 agent 的 `editHasThenRun` 与安装失败原因（阶段 + 错误文本）。

## 验收

1. 开启 `actionFusion` 后，`sol_pi_status` 对每个 live agent 报 `editHasThenRun: true`；
2. 真机 `edit + then_run` 三条路径（成功 / 命令失败 / 编辑失败）都得到预期标记；
3. 关闭 `actionFusion` 与 `diagnostics` 后，工具列表里没有 `obs_recall`/`sol_pi_status`，
   `edit` 的 schema 与内建逐字节一致；
4. 回归测试：内建 `edit` 只存在于 preset 层（全局层为空）时，遮蔽版仍能装上；
   构造“全局层为空 + preset 层有 edit”的替身，断言 scoped `edit` 带 `then_run`。
