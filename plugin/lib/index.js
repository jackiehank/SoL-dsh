/**
 * SoL-Pi for DSH — Host 半 bundle 入口。
 *
 * 四个机制全部 opt-in：配置缺省时这里不注册任何工具、不挂任何 post-execute 改写。
 * 配置非法（未知键、类型错误）在装配阶段直接抛错，避免“以为开了其实没开”。
 */

import z from '@deepseek-ai/schemastery'
import { resolveConfig } from './config.js'
import { attachActionFusion } from './action-fusion.js'
import { attachObservationPack } from './observation-pack.js'
import { attachEvidencePreservingReducer } from './reducer.js'
import { attachOnlineContextCompact } from './compact.js'
import { createStatsProjectionDefinition } from './savings.js'

/** Cordis 函数插件名；与包名一致，便于在日志和插件列表里对号入座。 */
export const name = 'sol-dsh'

/**
 * 插件配置 schema。
 *
 * 声明 `Config` 后，DSH 设置页会用 `volatileForm` 自动生成表单：带 `.volatile()` 的字段
 * 会出现在表单里并可运行时修改。`version` 不开放编辑，所以不加 volatile。
 *
 * 注意：volatile 字段在 `apply` 里拿到的是可观察值（用 `.get()` 读取），见 `plainValues`。
 */
export const Config = z.object({
  version: z.number().default(1),
  actionFusion: z.boolean().default(false).volatile(),
  observationPack: z.boolean().default(false).volatile(),
  evidencePreservingReducer: z.boolean().default(false).volatile(),
  evidencePreservingReducerProvider: z.string().default('').volatile(),
  evidencePreservingReducerModel: z.string().default('').volatile(),
  onlineContextCompact: z.boolean().default(false).volatile(),
  cacheWriteReadRatio: z.number().default(12.5).volatile(),
})

/** 依赖工具注册表；没有 tools 服务的 profile 里本插件保持不激活。 */
export const inject = ['tools']

const MECHANISMS = Object.freeze({
  actionFusion: 'Action Fusion（edit/write 的 then_run）',
  observationPack: 'ObservationPack（大结果句柄 + obs_recall）',
  evidencePreservingReducer: 'Evidence-Preserving Reducer（诊断日志回执）',
  onlineContextCompact: 'Online Context Compact（计划完成点压缩）',
})

/**
 * 诊断工具：报告 Action Fusion 在各 agent 上的安装情况。
 *
 * 只在 `diagnostics: true` 时注册；用来回答“为什么模型没看到 then_run”这类问题——
 * 是 agent/created 没到、是基线工具没拿到、还是 scoped 注册没生效。
 */
function createStatusTool(ctx, fusion, diagnosticsInfo) {
  return {
    name: 'sol_dsh_status',
    description: 'Report this plugin’s mechanism state (diagnostics only).',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute() {
      const agents = (() => {
        try {
          return ctx.get?.('agents')?.list?.() ?? []
        } catch {
          return []
        }
      })()
      const seen = []
      for (const agent of agents) {
        let editHasThenRun = false
        let lookupError
        try {
          editHasThenRun = ctx.tools.get('edit', agent)?.parameters?.properties?.then_run !== undefined
        } catch (error) {
          lookupError = error instanceof Error ? error.message : String(error)
        }
        seen.push({
          id: String(agent.id),
          hasCtx: agent.ctx !== undefined,
          editHasThenRun,
          ...(lookupError === undefined ? {} : { lookupError }),
        })
      }
      return {
        actionFusion: {
          config: fusion.config.actionFusion,
          handles: fusion.installedAgents(),
          state: fusion.state,
          ...diagnosticsInfo,
        },
        agents: seen,
      }
    },
  }
}

/**
 * 把 volatile 字段的可观察值拆成普通值（cordis 会按 Config 把它们包一层）。
 *
 * 例：`config.actionFusion.get()` → `config.actionFusion`。开关拨动后 Loader 只会
 * 改写 observable、不会重跑 apply；所以这里每次 sync 都重新读一遍。
 */
function plainValues(raw) {
  if (raw === null || typeof raw !== 'object') return raw
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    out[key] = value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
  }
  return out
}

/**
 * 装配入口。
 *
 * 四个机制各自挂在一个子插件（子 fiber）上：开关变化时只销毁/重建受影响的机制，
 * 不去重载整个插件。切换由 Loader 的 `loader/volatile-update` 事件驱动。
 *
 * @param ctx - 插件上下文；所有注册都挂在它（或 agent scope）的 effect 名下。
 * @param rawConfig - cordis.patch.yml 中该行 `config` 的原始值。
 */
export function apply(ctx, rawConfig) {
  const diagnosticsInfo = {}
  const mounts = new Map()
  let fusion
  let statusToolRegistered = false

  // 会话级节省统计与开关无关：即使四个机制全关，历史累计也要能显示。
  // 用 inject 等 sessionProjections 就绪；没有这个服务的 profile 里静默跳过。
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.effect(
      () => projectionCtx.sessionProjections.register(createStatsProjectionDefinition()),
      'sol-dsh: session savings projection',
    )
  })

  const unmount = (key) => {
    const dispose = mounts.get(key)
    if (dispose === undefined) return
    mounts.delete(key)
    try {
      dispose()
    } catch (error) {
      ctx.logger?.warn?.(`[sol-dsh] unmount ${key} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const unmountAll = () => {
    for (const key of [...mounts.keys()]) unmount(key)
    fusion = undefined
  }

  const mount = (key, attach) => {
    const handle = ctx.plugin({
      name: `sol-dsh:${key}`,
      apply: (child) => attach(child),
    })
    mounts.set(key, () => {
      Promise.resolve(handle.dispose?.()).catch(() => {})
    })
  }

  const sync = () => {
    unmountAll()
    const config = resolveConfig(plainValues(rawConfig))
    const active = []

    if (config.actionFusion) {
      mount('actionFusion', (child) => {
        fusion = attachActionFusion(child, config)
      })
      active.push('actionFusion')
    }
    if (config.observationPack) {
      mount('observationPack', (child) => attachObservationPack(child, config))
      active.push('observationPack')
    }
    // 顺序有意：ObservationPack 在前（它先 next()），Reducer 在后才能看到原始长日志，
    // 并把回执交回给 ObservationPack 判断“是否还需要打包”。
    if (config.evidencePreservingReducer) {
      mount('evidencePreservingReducer', (child) => {
        const reducer = attachEvidencePreservingReducer(child, config)
        if (reducer !== undefined) {
          diagnosticsInfo.reducer = { provider: reducer.route.provider, model: reducer.route.model }
        }
      })
      active.push('evidencePreservingReducer')
    }
    if (config.onlineContextCompact) {
      mount('onlineContextCompact', (child) => attachOnlineContextCompact(child, config))
      active.push('onlineContextCompact')
    }
    if (config.diagnostics && fusion !== undefined && !statusToolRegistered) {
      statusToolRegistered = true
      ctx.effect(() => ctx.tools.register(createStatusTool(ctx, fusion, diagnosticsInfo)))
    }

    if (active.length === 0) {
      ctx.logger?.info?.('[sol-dsh] 四个机制均未开启（opt-in），只保留会话节省投影')
      return
    }
    ctx.logger?.info?.(`[sol-dsh] 已开启：${active.map((key) => MECHANISMS[key]).join('；')}`)
  }

  sync()
  // 开关只在 volatile 字段上；Loader 更新 observable 后发这个事件，我们按新值重挂机制。
  ctx.on('loader/volatile-update', () => sync())
}



