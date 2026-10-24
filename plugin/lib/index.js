/**
 * SoL-Pi for DSH — Host 半 bundle 入口。
 *
 * 四个机制全部 opt-in：配置缺省时这里不注册任何工具、不挂任何 post-execute 改写。
 * 配置非法（未知键、类型错误）在装配阶段直接抛错，避免“以为开了其实没开”。
 */

import { resolveConfig } from './config.js'
import { attachActionFusion } from './action-fusion.js'
import { attachObservationPack } from './observation-pack.js'

/** Cordis 函数插件名；与包名一致，便于在日志和插件列表里对号入座。 */
export const name = 'sol-pi-dsh'

/** 依赖工具注册表；没有 tools 服务的 profile 里本插件保持不激活。 */
export const inject = ['tools']

const MECHANISMS = Object.freeze({
  actionFusion: 'Action Fusion（edit/write 的 then_run）',
  observationPack: 'ObservationPack（大结果句柄 + obs_recall）',
})

/**
 * 装配入口。
 *
 * @param ctx - 插件上下文；所有注册都挂在它（或 agent scope）的 effect 名下。
 * @param rawConfig - cordis.patch.yml 中该行 `config` 的原始值。
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const active = []

  if (config.actionFusion) {
    attachActionFusion(ctx, config)
    active.push('actionFusion')
  }
  if (config.observationPack) {
    attachObservationPack(ctx, config)
    active.push('observationPack')
  }

  if (active.length === 0) {
    ctx.logger?.info?.('[sol-pi-dsh] 四个机制均未开启（opt-in），不注册任何扩展')
    return
  }
  ctx.logger?.info?.(`[sol-pi-dsh] 已开启：${active.map((key) => MECHANISMS[key]).join('；')}`)
}

export default apply
