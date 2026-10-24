/**
 * Action Fusion for DSH — 把「改文件」和它的后续校验命令压进同一次工具调用。
 *
 * DSH 没有“替换内建工具”的补丁接口，但工具注册是分层的：在 `agent.ctx` 上注册的同名工具
 * 遮蔽全局工具。所以我们在每个 agent 创建时注册 scoped 的 `edit`/`write`：schema 继承内建
 * 定义再加一个可选 `then_run`，实现委托给内建定义的 `execute`，输出、呈现、超时都沿用内建。
 *
 * 命令不自己起进程：走 `ctx.tools.execute('pwsh'|'bash')`，审批、沙箱、输出截断与普通命令
 * 完全同一套。命令失败不回滚编辑，也不把整次调用标成失败（DSH 的 edit 结果与命令结果是
 * 两条观测）；失败以 `[then_run:failed]` + 命令自带的 `[exit code: N]` 呈现。
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const THEN_RUN_SUCCEEDED = '[then_run:succeeded]'
export const THEN_RUN_FAILED = '[then_run:failed]'
export const THEN_RUN_SKIPPED = '[then_run:skipped]'

const SKIPPED_REASON = 'The file mutation did not complete successfully; the command was not run.'

const THEN_RUN_DESCRIPTION =
  'Optional command to run in the same call after this mutation succeeds (test, build, start/restart, install, or check). ' +
  'Skipped when the mutation fails; a non-zero exit is reported without undoing the mutation.'

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/** 把调用方给的对象收敛成可信的 then_run；字段缺失 = 不跑命令，字段非法 = 直接报错。 */
export function normalizeThenRun(raw) {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('then_run must be an object')
  const command = raw.command
  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new Error('then_run.command must be a non-empty string')
  }
  const timeoutMs = raw.timeoutMs ?? (typeof raw.timeout === 'number' ? raw.timeout * 1000 : undefined)
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new Error('then_run timeout must be a positive number of seconds')
  }
  if (raw.workdir !== undefined && (typeof raw.workdir !== 'string' || raw.workdir.length === 0)) {
    throw new Error('then_run.workdir must be a non-empty string')
  }
  if (raw.description !== undefined && typeof raw.description !== 'string') {
    throw new Error('then_run.description must be a string')
  }
  return {
    command,
    timeoutMs,
    workdir: raw.workdir,
    description: raw.description,
  }
}

/** 内建 edit/write 的参数 schema 上加一个可选 then_run（保持其它字段原样）。 */
export function withThenRun(parameters) {
  const schema = parameters !== null && typeof parameters === 'object' ? parameters : { type: 'object', properties: {} }
  const properties = { ...(schema.properties ?? {}) }
  properties.then_run = {
    type: 'object',
    additionalProperties: false,
    description: THEN_RUN_DESCRIPTION,
    properties: {
      command: { type: 'string', description: 'Shell command to run after the mutation succeeds.' },
      timeout: { type: 'number', description: 'Optional timeout in seconds for the command.' },
      workdir: { type: 'string', description: 'Optional working directory; defaults to the session directory.' },
      description: { type: 'string', description: 'Optional one-line description for the command row.' },
    },
    required: ['command'],
  }
  return {
    ...schema,
    properties,
    ...(Array.isArray(schema.required) ? { required: [...schema.required] } : {}),
  }
}

/** 从命令输出里读 DSH 的退出码标记；没有标记返回 undefined。 */
export function parseExitCode(text) {
  const match = /\[exit code: (-?\d+)\]/u.exec(text ?? '')
  return match === null ? undefined : Number(match[1])
}

function contentText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

async function fileSha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

/**
 * 在命令开始前确认目标文件没有被并发改写。解析不到路径时跳过（这是安全网，不是主流程）。
 */
export async function assertUnchangedBeforeCommand(resolvePath, exec, filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return
  const absolutePath = resolvePath === undefined ? undefined : resolvePath(filePath, exec)
  if (absolutePath === undefined) return
  try {
    const before = await fileSha256(absolutePath)
    await new Promise((resolve) => setImmediate(resolve))
    const after = await fileSha256(absolutePath)
    if (before !== after) throw new Error('target content changed after the fused mutation')
  } catch (error) {
    if (error instanceof Error && error.message === 'target content changed after the fused mutation') throw error
    // 文件不存在/不可读：交给命令自己去暴露问题。
  }
}

/**
 * 生成遮蔽用的工具定义。
 *
 * @param options.name - 被遮蔽的工具名（edit / write）。
 * @param options.base - 全局视图里的内建定义。
 * @param options.runCommand - `(exec, thenRun) => {failed, text}`。
 * @param options.resolveFilePath - 可选：把模型给的相对路径解析成绝对路径（给并发校验用）。
 */
export function createFusedDefinition({ name, base, runCommand, resolveFilePath }) {
  if (base === undefined || base === null) throw new Error(`cannot fuse unknown tool "${name}"`)
  const reports = new WeakMap()

  const output = {
    schema: base.output.schema,
    render: (args, value) => base.output.render(args, value),
  }
  if (typeof base.output.presentationMeta === 'function') {
    output.presentationMeta = (args, value) => base.output.presentationMeta(args, value)
  }

  const definition = {
    name,
    description: `${base.description} Optionally run a follow-up command on this file in the same call via then_run; its output is appended to this result.`,
    parameters: withThenRun(base.parameters),
    output,
    async execute(args, exec) {
      const thenRun = normalizeThenRun(args?.then_run)
      const rest = { ...args }
      delete rest.then_run

      let value
      try {
        value = await base.execute(rest, exec)
      } catch (error) {
        if (thenRun === undefined) throw error
        throw new Error(`${errorText(error)}\n\n${THEN_RUN_SKIPPED} ${SKIPPED_REASON}`)
      }
      if (thenRun === undefined) return value

      try {
        await assertUnchangedBeforeCommand(resolveFilePath, exec, rest.file_path)
        const outcome = await runCommand(exec, thenRun)
        const text = typeof outcome?.text === 'string' ? outcome.text.replace(/\s+$/u, '') : ''
        const marker = outcome?.failed === true ? THEN_RUN_FAILED : THEN_RUN_SUCCEEDED
        reports.set(exec, text.length > 0 ? `${marker}\n${text}` : marker)
      } catch (error) {
        reports.set(exec, `${THEN_RUN_FAILED}\n${errorText(error)}`)
      }
      return value
    },
    finalizeContent(exec, result) {
      const report = reports.get(exec)
      if (report === undefined) return undefined
      reports.delete(exec)
      return [...result.content, { type: 'text', text: report }]
    },
  }

  if (base.timeoutMs !== undefined) definition.timeoutMs = base.timeoutMs
  if (typeof base.isConcurrencySafe === 'function') definition.isConcurrencySafe = (args) => base.isConcurrencySafe(args)
  if (typeof base.presentCall === 'function') definition.presentCall = (args) => base.presentCall(args)
  if (typeof base.presentResult === 'function') definition.presentResult = (args, result) => base.presentResult(args, result)

  return definition
}

/**
 * 真实命令执行器：调用 DSH 的 shell 工具，列参数按工具自己的 schema 过滤。
 * 不认识的 shell 工具（既无 pwsh 也无 bash）直接报错，而不是悄悄不跑。
 */
export function createCommandRunner(ctx) {
  return async function runCommand(exec, thenRun) {
    // shell 工具与内建 edit/write 一样挂在 agent preset 的 scope 里，必须按该 agent 的视角取。
    const scope = exec?.agent
    const shellName = ctx.tools.get('pwsh', scope) !== undefined ? 'pwsh' : (ctx.tools.get('bash', scope) !== undefined ? 'bash' : undefined)
    if (shellName === undefined) throw new Error('no shell tool (pwsh/bash) is available to run then_run')
    const definition = ctx.tools.get(shellName, scope)
    const properties = definition?.parameters?.properties ?? {}
    const args = {
      command: thenRun.command,
      description: thenRun.description ?? `then_run: ${thenRun.command}`,
    }
    if (thenRun.timeoutMs !== undefined && Object.hasOwn(properties, 'timeoutMs')) args.timeoutMs = thenRun.timeoutMs
    if (thenRun.workdir !== undefined && Object.hasOwn(properties, 'workdir')) args.workdir = thenRun.workdir

    const result = await ctx.tools.execute({
      callId: `${exec.callId}:then_run`,
      name: shellName,
      arguments: args,
      agent: exec.agent,
      signal: exec.signal,
    })
    const text = contentText(result.content)
    const exitCode = parseExitCode(text)
    const failed = result.isError === true || (exitCode !== undefined && exitCode !== 0)
    return { failed, text }
  }
}

function resolveFilePathFactory(ctx) {
  const workingDirectory = ctx.get?.('workingDirectory')
  return (filePath) => {
    if (typeof filePath !== 'string' || filePath.length === 0) return undefined
    if (/^[A-Za-z]:[\\/]/u.test(filePath) || filePath.startsWith('/') || filePath.startsWith('\\\\')) return filePath
    try {
      const base = workingDirectory?.defaultDirectory
      return base === undefined ? undefined : `${base.replace(/[\\/]+$/u, '')}/${filePath}`
    } catch {
      return undefined
    }
  }
}

/**
 * 每个 agent 创建时，在它的 scope 上注册 edit/write 的遮蔽版本。
 *
 * 内建工具在内建插件里可能比本插件更晚注册，所以拿不到基线时先挂一次 `tools/change` 重试。
 */
export function attachActionFusion(ctx, config) {
  const handles = new Map()
  const state = { created: 0, attempts: 0, installed: 0, skipped: [], errors: [] }
  const skippedKeys = new Set()
  const recordSkip = (id, reason) => {
    const token = `${id}:${reason}`
    if (skippedKeys.has(token)) return
    skippedKeys.add(token)
    state.skipped.push({ id, reason })
  }

  const installForAgent = (agent) => {
    state.attempts += 1
    const scope = agent?.ctx
    if (scope === undefined || scope.tools === undefined) {
      recordSkip(String(agent?.id), 'no-agent-scope')
      return false
    }
    const key = String(agent.id)
    if (handles.has(key)) return true
    const runCommand = createCommandRunner(ctx)
    const resolveFilePath = resolveFilePathFactory(ctx)

    const dispose = scope.effect(() => {
      const disposers = []
      let installed = false
      let changeOff

      const tryInstall = () => {
        if (installed) return true
        let baseEdit
        let baseWrite
        try {
          // 内建 edit/write 由 agent preset 在各自的 scope 里注册，全局层没有它们；
          // 必须按该 agent 的视角取基线，且要在注册遮蔽版之前取（否则拿到的是自己）。
          baseEdit = ctx.tools.get('edit', agent)
          baseWrite = ctx.tools.get('write', agent)
        } catch (error) {
          state.errors.push({ id: key, phase: 'lookup', message: errorText(error) })
          return false
        }
        if (baseEdit === undefined && baseWrite === undefined) {
          recordSkip(key, 'bases-not-found')
          return false
        }
        // 先立标再注册：注册本身会触发 tools/change，若重入会重复注册同名工具。
        installed = true
        try {
          if (baseEdit !== undefined) {
            disposers.push(scope.tools.register(createFusedDefinition({ name: 'edit', base: baseEdit, runCommand, resolveFilePath })))
          }
          if (baseWrite !== undefined) {
            disposers.push(scope.tools.register(createFusedDefinition({ name: 'write', base: baseWrite, runCommand, resolveFilePath })))
          }
        } catch (error) {
          installed = false
          state.errors.push({ id: key, phase: 'register', message: errorText(error) })
          throw error
        }
        changeOff?.()
        changeOff = undefined
        return true
      }

      if (!tryInstall()) {
        changeOff = scope.on('tools/change', () => {
          try {
            tryInstall()
          } catch {
            // 错误已经记进 state；保留监听器以便下一次工具变更重试。
          }
        })
      }

      return () => {
        changeOff?.()
        for (const disposer of disposers) {
          try {
            disposer?.()
          } catch {
            // 逐个撤销，单个失败不影响其余。
          }
        }
        disposers.length = 0
      }
    })

    handles.set(key, dispose)
    state.installed = handles.size
    return true
  }

  ctx.on('agent/created', ({ agent }) => {
    state.created += 1
    try {
      installForAgent(agent)
    } catch (error) {
      state.errors.push({ id: String(agent?.id), phase: 'created', message: errorText(error) })
      console.warn(`[sol-pi-dsh] action-fusion install failed: ${errorText(error)}`)
    }
  }, { global: true })

  ctx.on('agent/disposed', ({ agent }) => {
    const key = String(agent?.id)
    const dispose = handles.get(key)
    if (dispose === undefined) return
    handles.delete(key)
    state.installed = handles.size
    try {
      dispose()
    } catch {
      // agent 已经销毁；这里只是清账。
    }
  }, { global: true })

  // 插件晚于 agent 加载时（典型：热装、恢复会话）补装已有 agent，
  // 否则它们会一直用没有 then_run 的内建 edit/write。
  try {
    for (const agent of ctx.get?.('agents')?.list?.() ?? []) installForAgent(agent)
  } catch (error) {
    state.errors.push({ id: '*', phase: 'backfill', message: errorText(error) })
    console.warn(`[sol-pi-dsh] action-fusion backfill skipped: ${errorText(error)}`)
  }

  // 插件卸载时把还活着的 agent 注册一起撤掉。
  ctx.effect(() => () => {
    for (const dispose of handles.values()) {
      try {
        dispose?.()
      } catch {
        // 忽略单项失败。
      }
    }
    handles.clear()
    state.installed = 0
  })

  return {
    installedAgents: () => handles.size,
    state,
    installForAgent,
    config,
  }
}

