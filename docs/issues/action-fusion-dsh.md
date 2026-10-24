# Action Fusion：让 edit/write 在同一调用里跑后续命令

## 问题

上游 SoL-Pi 的 Action Fusion 把「改文件」和「跑一次校验/构建/启动命令」压进一个工具调用：
`edit` / `write` 多一个可选的 `then_run`（命令 + 可选超时），编辑成功后立即执行，返回一条
合并观测；编辑失败则跳过命令。省掉的是模型在两个回合之间的那一次决策。

DSH 现状：`edit` / `write` 只改文件，验证命令要另起一次 `pwsh`（或 terminal）调用，
模型至少要再走一轮。DSH 的工具管线给了一个可行落点：

- `ctx.tools.register()` 在 `agent.ctx` 上注册的同名工具**遮蔽**全局工具（scoped shadow）；
- `agent/created` 事件拿到 `agent.ctx`，注册随 agent 销毁自动撤销；
- 工具内部可以 `ctx.tools.execute({name:'pwsh', ...})` 走**同一条** pre-execute/guard/审批/沙箱管线。

## 目标

1. 开启 `actionFusion` 后，模型的 `edit` / `write` schema 多出可选 `then_run: {command, timeout?, workdir?}`；
2. 编辑/写入成功 → 在同一次工具调用内执行命令，返回「编辑内容 + 命令输出」；
3. 编辑/写入失败或抛错 → 不执行命令，错误里带 `[then_run:skipped]`；
4. 命令非零退出 → 结果标为错误并带 `[then_run:failed]` + 输出，但**编辑本身不回滚**；
5. 命令必须走 DSH 自己的 `pwsh` 工具（同一套策略、沙箱、审批、输出截断），不自己起进程；
6. 关闭 `actionFusion` 时 `edit`/`write` 与内建完全一致（schema、输出、呈现）。

## 约束

- 不复制内建 `edit`/`write` 的实现：通过全局视图取到定义并调用其 `execute`，
  输出 schema / `render` / `presentResult` 都委托给它，只在内容尾部追加命令报告；
- `then_run.command` 与普通 `pwsh` 命令同权：审批、沙箱、超时策略一律继承，
  插件不额外放宽；
- 命令的 cwd 默认取该会话的工作目录（`ctx.workingDirectory`），`workdir` 可覆盖；
- 嵌套调用（`exec.parent !== undefined`，PTC/子派发）不重复计节省，但功能保持不变；
- 执行前后校验目标文件未被并发改写（内容哈希），被改写则以 `[then_run:skipped]` 结束。

## 验收

- `edit` / `write` 的 schema 只在开启时出现 `then_run`；关闭时逐字节等于内建 schema；
- 成功路径一次调用完成编辑 + 命令，模型看到两段内容；
- 编辑失败、命令失败、命令超时、命令被审批拒绝四条路径都有确定文案，且编辑结果不丢；
- `node --test tests` 覆盖上述路径（用假的全局 `edit`/`write`/`pwsh` 定义驱动管线）。
