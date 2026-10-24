/**
 * SoL-Pi for DSH — 配置读取与校验。
 *
 * 与上游 sol-pi 对齐：对外只暴露 8 个键（`version`、四个机制开关、归约 provider/model、
 * `cacheWriteReadRatio`）。其余阈值全部取上游同款硬编码默认；DSH 特有的两件事走环境变量：
 *
 * - `DSH_SOL_PI_HOME`：归档根目录（默认 `<DSH_HOME>/sol-pi`）；
 * - `DSH_SOL_PI_DIAGNOSTICS=1`：注册 `sol_pi_status` 排障工具。
 *
 * 未知键、类型错误、非法值都在装配阶段直接报错，不做静默降级。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** 对外可配置的键，与上游 `sol-pi.example.json` 完全一致。 */
export const PUBLIC_KEYS = Object.freeze([
  'version',
  'actionFusion',
  'observationPack',
  'evidencePreservingReducer',
  'evidencePreservingReducerProvider',
  'evidencePreservingReducerModel',
  'onlineContextCompact',
  'cacheWriteReadRatio',
])

/** 对外配置的缺省值（与上游一致）。 */
export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  actionFusion: false,
  observationPack: false,
  evidencePreservingReducer: false,
  evidencePreservingReducerProvider: '',
  evidencePreservingReducerModel: '',
  onlineContextCompact: false,
  cacheWriteReadRatio: 12.5,
})

/**
 * 内部默认值（上游把这些写死在源码里，不开放配置）。
 * 实验需要临时改阈值时，直接在自己的脚本里覆盖解析后的对象，不再暴露配置键。
 */
export const INTERNAL_DEFAULTS = Object.freeze({
  observationPackThresholdBytes: 10 * 1024,
  recallMaxBytes: 16 * 1024,
  recallMaxLines: 400,
  reducerMinBytes: 4_096,
  reducerMaxChars: 600_000,
  reducerTimeoutMs: 90_000,
  reducerMaxOutputTokens: 2_048,
  reducerReasoningEffort: '',
  reducerTemperature: 0,
  compactKeepRecentTokens: 20_000,
  compactMinRequestsSinceLast: 2,
  compactFirstScale: 2,
  compactMargin: 1.5,
  compactSummaryTokens: 1_000,
})

const KNOWN_KEYS = new Set(PUBLIC_KEYS)

function fail(message) {
  throw new Error(`sol-pi-dsh 配置错误：${message}`)
}

function dshHome() {
  const home = process.env.DSH_HOME
  return home !== undefined && home.trim().length > 0 ? home : join(homedir(), '.dsh')
}

/** 环境变量开关：`1` 或 `true` 视为开启。 */
function envFlag(name) {
  const value = process.env[name]
  return value === '1' || value === 'true'
}

/** 归档根目录：`DSH_SOL_PI_HOME` 优先，否则 `<DSH_HOME>/sol-pi`。 */
export function resolveStorageRoot() {
  const configured = process.env.DSH_SOL_PI_HOME
  if (configured !== undefined && configured.trim().length > 0) return configured
  return join(dshHome(), 'sol-pi')
}

/**
 * 把 bundle 行里的原始 config 收敛成一份完整、可信的配置。
 *
 * @param raw - cordis.patch.yml 中 `config` 的原始值（可以是 undefined）。
 * @returns 冻结后的完整配置（含内部默认值与 DSH 环境派生项）。
 */
export function resolveConfig(raw) {
  if (raw === undefined || raw === null) raw = {}
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('config 必须是对象')

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      fail(`未知配置键 "${key}"（只支持：${PUBLIC_KEYS.join(', ')}；阈值不可配，DSH 目录/排障用环境变量 DSH_SOL_PI_HOME / DSH_SOL_PI_DIAGNOSTICS）`)
    }
  }

  const config = { ...DEFAULT_CONFIG, ...raw }

  if (config.version !== 1) fail(`不支持的 version ${JSON.stringify(config.version)}（只支持 1）`)
  for (const key of ['actionFusion', 'observationPack', 'evidencePreservingReducer', 'onlineContextCompact']) {
    if (typeof config[key] !== 'boolean') fail(`${key} 必须是布尔值`)
  }
  for (const key of ['evidencePreservingReducerProvider', 'evidencePreservingReducerModel']) {
    if (typeof config[key] !== 'string') fail(`${key} 必须是字符串`)
  }
  if (!Number.isFinite(config.cacheWriteReadRatio) || config.cacheWriteReadRatio < 0) {
    fail(`cacheWriteReadRatio 必须是 >= 0 的有限数，收到 ${JSON.stringify(config.cacheWriteReadRatio)}`)
  }

  return Object.freeze({
    ...config,
    ...INTERNAL_DEFAULTS,
    // 内部沿用短名字，避免各模块跟着上游长键名改一遍。
    reducerProvider: config.evidencePreservingReducerProvider,
    reducerModel: config.evidencePreservingReducerModel,
    storageRoot: resolveStorageRoot(),
    ledger: true,
    diagnostics: envFlag('DSH_SOL_PI_DIAGNOSTICS'),
  })
}
