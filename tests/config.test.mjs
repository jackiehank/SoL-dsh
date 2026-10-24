import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { resolveConfig } from '../plugin/lib/config.js'

test('缺省配置：四个机制全关，归档根落在 <DSH_HOME>/sol-pi', () => {
  const config = resolveConfig(undefined)
  assert.equal(config.version, 1)
  assert.equal(config.actionFusion, false)
  assert.equal(config.observationPack, false)
  assert.equal(config.observationPackThresholdBytes, 10 * 1024)
  assert.equal(config.recallMaxBytes, 16 * 1024)
  assert.equal(config.recallMaxLines, 400)
  assert.ok(config.storageRoot.endsWith(`${join('', 'sol-pi')}`))
  assert.ok(config.storageRoot.includes('.dsh') || config.storageRoot.length > 0)
  assert.ok(Object.isFrozen(config))
})

test('显式 storageRoot 被保留，空串回落默认', () => {
  assert.equal(resolveConfig({ storageRoot: 'D:/tmp/solpi' }).storageRoot, 'D:/tmp/solpi')
  assert.notEqual(resolveConfig({ storageRoot: '   ' }).storageRoot, '   ')
})

test('未知配置键直接报错（不静默忽略拼错的开关）', () => {
  assert.throws(() => resolveConfig({ actionfusion: true }), /未知配置键 "actionfusion"/)
})

test('类型与取值校验', () => {
  assert.throws(() => resolveConfig({ version: 2 }), /不支持的 version/)
  assert.throws(() => resolveConfig({ actionFusion: 'yes' }), /actionFusion 必须是布尔值/)
  assert.throws(() => resolveConfig({ observationPackThresholdBytes: 0 }), /observationPackThresholdBytes/)
  assert.throws(() => resolveConfig({ observationPackThresholdBytes: 1.5 }), /observationPackThresholdBytes/)
  assert.throws(() => resolveConfig({ recallMaxBytes: 100 }), /recallMaxBytes/)
  assert.throws(() => resolveConfig({ recallMaxLines: 2 }), /recallMaxLines/)
  assert.throws(() => resolveConfig({ storageRoot: 7 }), /storageRoot 必须是字符串/)
  assert.throws(() => resolveConfig([]), /config 必须是对象/)
})

test('打开单个机制不影响其它键', () => {
  const config = resolveConfig({ actionFusion: true })
  assert.equal(config.actionFusion, true)
  assert.equal(config.observationPack, false)
  assert.equal(config.ledger, true)
})
