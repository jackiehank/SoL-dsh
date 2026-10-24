/**
 * SoL-Pi for DSH — Host 半 bundle 入口。
 *
 * 四个机制全部 opt-in：配置缺省时这里不注册任何工具、不挂任何 post-execute 改写。
 * 配置非法（未知键、类型错误）在装配阶段直接抛错，避免“以为开了其实没开”。
 */

import { resolveConfig } from './config.js'
import { attachActionFusion } from './action-fusion.js'
import { attachObservationPack } from './observation-pack.js'
import { attachEvidencePreservingReducer } from './reducer.js'
import { attachOnlineContextCompact } from './compact.js'

/** Cordis 函数插件名；与包名一致，便于在日志和插件列表里对号入座。 */
export const name = 'sol-dsh'

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
 * 装配入口。
 *
 * @param ctx - 插件上下文；所有注册都挂在它（或 agent scope）的 effect 名下。
 * @param rawConfig - cordis.patch.yml 中该行 `config` 的原始值。
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const active = []
  const diagnosticsInfo = {}
  let fusion

  if (config.actionFusion) {
    fusion = attachActionFusion(ctx, config)
    active.push('actionFusion')
  }
  if (config.observationPack) {
    attachObservationPack(ctx, config)
    active.push('observationPack')
  }
  // 顺序有意：ObservationPack 在前（它先 next()），Reducer 在后才能看到原始长日志，
  // 并把回执交回给 ObservationPack 判断“是否还需要打包”。
  if (config.evidencePreservingReducer) {
    const reducer = attachEvidencePreservingReducer(ctx, config)
    if (reducer !== undefined) {
      diagnosticsInfo.reducer = { provider: reducer.route.provider, model: reducer.route.model }
      active.push('evidencePreservingReducer')
    }
  }
  if (config.onlineContextCompact) {
    const compact = attachOnlineContextCompact(ctx, config)
    if (compact !== undefined) active.push('onlineContextCompact')
  }
  if (config.diagnostics && fusion !== undefined) {
    ctx.effect(() => ctx.tools.register(createStatusTool(ctx, fusion, diagnosticsInfo)))
  }

  if (active.length === 0) {
    ctx.logger?.info?.('[sol-dsh] 四个机制均未开启（opt-in），不注册任何扩展')
    return
  }
  ctx.logger?.info?.(`[sol-dsh] 已开启：${active.map((key) => MECHANISMS[key]).join('；')}`)
}



