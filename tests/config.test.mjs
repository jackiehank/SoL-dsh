import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { INTERNAL_DEFAULTS, PUBLIC_KEYS, resolveConfig } from '../lib/config.js'

function withEnv(changes, run) {
  const saved = {}
  for (const [key, value] of Object.entries(changes)) {
    saved[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return run()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('对外只有上游那 8 个键，缺省全关', () => {
  const config = resolveConfig(undefined)
  assert.deepEqual([...PUBLIC_KEYS], [
    'version',
    'actionFusion',
    'observationPack',
    'evidencePreservingReducer',
    'evidencePreservingReducerProvider',
    'evidencePreservingReducerModel',
    'onlineContextCompact',
    'cacheWriteReadRatio',
  ])
  assert.equal(config.version, 1)
  assert.equal(config.actionFusion, false)
  assert.equal(config.observationPack, false)
  assert.equal(config.evidencePreservingReducer, false)
  assert.equal(config.onlineContextCompact, false)
  assert.equal(config.cacheWriteReadRatio, 12.5)
  assert.equal(config.evidencePreservingReducerProvider, '')
  assert.equal(config.evidencePreservingReducerModel, '')
  assert.ok(Object.isFrozen(config))
})

test('内部默认值与上游硬编码一致', () => {
  const config = resolveConfig({})
  assert.equal(config.observationPackThresholdBytes, 10 * 1024)
  assert.equal(config.recallMaxBytes, 16 * 1024)
  assert.equal(config.recallMaxLines, 400)
  assert.equal(config.reducerMinBytes, 4_096)
  assert.equal(config.reducerMaxChars, 600_000)
  assert.equal(config.reducerTimeoutMs, 90_000)
  assert.equal(config.reducerMaxOutputTokens, 2_048)
  assert.equal(config.reducerTemperature, 0)
  assert.equal(INTERNAL_DEFAULTS.compactKeepRecentTokens, 20_000)
  assert.equal(config.compactKeepRecentTokens, 20_000)
  assert.equal(config.ledger, true)
})

test('reducer provider/model 用上游长键名，内部映射到短名', () => {
  const config = resolveConfig({
    evidencePreservingReducerProvider: 'opencode-go',
    evidencePreservingReducerModel: 'deepseek-v4.1-flash',
  })
  assert.equal(config.evidencePreservingReducerProvider, 'opencode-go')
  assert.equal(config.reducerProvider, 'opencode-go')
  assert.equal(config.reducerModel, 'deepseek-v4.1-flash')
})

test('storageRoot 走 DSH_SOL_DSH_HOME，否则 <DSH_HOME>/sol-pi', () => {
  withEnv({ DSH_SOL_DSH_HOME: 'D:/tmp/solpi', DSH_HOME: 'D:/tmp/home' }, () => {
    assert.equal(resolveConfig({}).storageRoot, 'D:/tmp/solpi')
  })
  withEnv({ DSH_SOL_DSH_HOME: undefined, DSH_HOME: 'D:/tmp/home' }, () => {
    assert.equal(resolveConfig({}).storageRoot, join('D:/tmp/home', 'sol-pi'))
  })
})

test('diagnostics 只由环境变量开启', () => {
  withEnv({ DSH_SOL_DSH_DIAGNOSTICS: undefined }, () => {
    assert.equal(resolveConfig({}).diagnostics, false)
  })
  withEnv({ DSH_SOL_DSH_DIAGNOSTICS: '1' }, () => {
    assert.equal(resolveConfig({}).diagnostics, true)
  })
})

test('未知键（含旧键名）直接报错并列出可用的 8 个键', () => {
  for (const key of ['storageRoot', 'observationPackThresholdBytes', 'reducerProvider', 'reducerReasoningEffort', 'compactKeepRecentTokens']) {
    assert.throws(() => resolveConfig({ [key]: 1 }), /未知配置键/)
  }
  assert.throws(() => resolveConfig({ actionfusion: true }), /未知配置键 "actionfusion"/)
})

test('取值校验：version / 布尔 / 字符串 / 比例', () => {
  assert.throws(() => resolveConfig({ version: 2 }), /不支持的 version/)
  assert.throws(() => resolveConfig({ actionFusion: 'yes' }), /actionFusion 必须是布尔值/)
  assert.throws(() => resolveConfig({ onlineContextCompact: 1 }), /onlineContextCompact 必须是布尔值/)
  assert.throws(() => resolveConfig({ evidencePreservingReducerProvider: 1 }), /evidencePreservingReducerProvider 必须是字符串/)
  assert.throws(() => resolveConfig({ cacheWriteReadRatio: -1 }), /cacheWriteReadRatio/)
  assert.throws(() => resolveConfig({ cacheWriteReadRatio: Number.NaN }), /cacheWriteReadRatio/)
  assert.throws(() => resolveConfig([]), /config 必须是对象/)
  assert.equal(resolveConfig({ cacheWriteReadRatio: 0 }).cacheWriteReadRatio, 0)
})

test('打开单个机制不影响其它键', () => {
  const config = resolveConfig({ actionFusion: true })
  assert.equal(config.actionFusion, true)
  assert.equal(config.observationPack, false)
  assert.equal(config.evidencePreservingReducer, false)
})
