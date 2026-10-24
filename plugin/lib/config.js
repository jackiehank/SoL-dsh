/**
 * SoL-Pi for DSH — 配置读取与校验。
 *
 * 与上游一致：一个有效配置，未知键、类型错误、非法取值都在装配阶段直接报错，
 * 不做“猜你想要”的静默降级。缺省值 = 四个机制全关。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** 支持的配置键及其缺省值。键名与上游 sol-pi.json 保持同名，方便对照。 */
export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  actionFusion: false,
  observationPack: false,
  /** 超过该 UTF-8 字节数的纯文本工具结果才会被换成句柄。 */
  observationPackThresholdBytes: 10 * 1024,
  /** 归档根目录；留空 = <DSH_HOME>/sol-pi。 */
  storageRoot: '',
  /** 单次 obs_recall 的最大字节数与行数（含头部预留）。 */
  recallMaxBytes: 16 * 1024,
  recallMaxLines: 400,
  /** 是否把每次 full/placeholder/recall 记到 ledger.jsonl（只记账，不进上下文）。 */
  ledger: true,
  /** 诊断开关：注册一个 `sol_pi_status` 工具，报告 agent 安装状态与最近错误。 */
  diagnostics: false,
  /** Evidence-Preserving Reducer：把诊断日志压成逐字可校验的回执。 */
  evidencePreservingReducer: false,
  /** 归约用的 provider/model；留空则用 agentDefaultModel 的当前选择。 */
  reducerProvider: '',
  reducerModel: '',
  reducerMinBytes: 4096,
  reducerMaxChars: 600_000,
  reducerTimeoutMs: 90_000,
  reducerMaxOutputTokens: 2_048,
})

const KNOWN_KEYS = new Set(Object.keys(DEFAULT_CONFIG))

function fail(message) {
  throw new Error(`sol-pi-dsh 配置错误：${message}`)
}

/** 校验一个非负整数，越界即报错。 */
function positiveInteger(name, value, min = 0) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    fail(`${name} 必须是 >= ${min} 的整数，收到 ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * 把 bundle 行里的原始 config 收敛成一份完整、可信的配置。
 *
 * @param raw - cordis.patch.yml 中 `config` 的原始值（可以是 undefined）。
 * @returns 冻结后的完整配置。
 */
export function resolveConfig(raw) {
  if (raw === undefined || raw === null) raw = {}
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('config 必须是对象')

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) fail(`未知配置键 "${key}"（可用：${[...KNOWN_KEYS].join(', ')}）`)
  }

  const config = { ...DEFAULT_CONFIG, ...raw }

  if (config.version !== 1) fail(`不支持的 version ${JSON.stringify(config.version)}（只支持 1）`)
  for (const key of ['actionFusion', 'observationPack', 'ledger', 'diagnostics', 'evidencePreservingReducer']) {
    if (typeof config[key] !== 'boolean') fail(`${key} 必须是布尔值`)
  }
  for (const key of ['reducerProvider', 'reducerModel']) {
    if (typeof config[key] !== 'string') fail(`${key} 必须是字符串`)
  }
  positiveInteger('reducerMinBytes', config.reducerMinBytes, 1)
  positiveInteger('reducerMaxChars', config.reducerMaxChars, config.reducerMinBytes)
  positiveInteger('reducerTimeoutMs', config.reducerTimeoutMs, 1_000)
  positiveInteger('reducerMaxOutputTokens', config.reducerMaxOutputTokens, 64)
  positiveInteger('observationPackThresholdBytes', config.observationPackThresholdBytes, 1)
  // 头部要留出 512 字节给 id/尺寸/召回指引，正文预算必须为正。
  positiveInteger('recallMaxBytes', config.recallMaxBytes, 1024)
  positiveInteger('recallMaxLines', config.recallMaxLines, 4)
  if (typeof config.storageRoot !== 'string') fail('storageRoot 必须是字符串')
  if (config.storageRoot.trim().length === 0) {
    const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.trim().length > 0
      ? process.env.DSH_HOME
      : join(homedir(), '.dsh')
    config.storageRoot = join(home, 'sol-pi')
  }

  return Object.freeze(config)
}


