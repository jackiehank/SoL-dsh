import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyEvent,
  assertStats,
  createStatsProjectionDefinition,
  emptyStats,
  PROJECTION_KEY,
  packSavings,
  receiptSavings,
  tokenCount,
} from '../plugin/lib/savings.js'

function packText() {
  return [
    '[large tool result replaced before it entered the context]',
    'id: obs_0123456789abcdef01234567',
    'tool: pwsh',
    'original_bytes: 12200',
    'original_lines: 300',
    'estimated_tokens: 3050',
    'retrieve: call obs_recall with {"id":"obs_0123456789abcdef01234567","offset":0}; continue with returned next_offset',
    '[first complete lines, up to 512 bytes]',
    'first line',
    '[middle omitted; last complete lines, up to 512 bytes]',
    'last line',
    '[12200 original bytes omitted]',
  ].join('\n')
}

function receiptText() {
  return [
    'sol_pi_evidence_receipt_v1',
    'schema: sol-pi-evidence-receipt/1',
    'command: go test ./...',
    'source_bytes=8400',
    'verified_evidence:',
    '- failure: "--- FAIL: TestX"',
  ].join('\n')
}

test('savings: 无关键事件返回同一引用', () => {
  const stats = emptyStats()
  assert.equal(applyEvent(stats, { type: 'turn/start', data: {} }), stats)
  assert.equal(applyEvent(stats, undefined), stats)
})

test('savings: 融合只计次数', () => {
  const text = 'edited\n[then_run:succeeded]\n[exit code: 0]'
  const next = applyEvent(emptyStats(), { type: 'tool/result', data: { message: { content: [{ type: 'text', text }] } } })
  assert.equal(next.fusion, 1)
  assert.equal(next.pack, 0)
  assert.equal(next.toolTokens, tokenCount(text))
})

test('savings: 占位符按 estimated_tokens 减自身', () => {
  const text = packText()
  const next = applyEvent(emptyStats(), { type: 'tool/result', data: { message: { content: [{ type: 'text', text }] } } })
  assert.equal(next.pack, 1)
  assert.equal(next.packTokens, 3050 - tokenCount(text))
  assert.equal(packSavings(text), 3050 - tokenCount(text))
})

test('savings: 回执按 source_bytes 减自身', () => {
  const text = receiptText()
  const next = applyEvent(emptyStats(), { type: 'tool/result', data: { message: { content: [{ type: 'text', text }] } } })
  assert.equal(next.receipt, 1)
  assert.equal(next.receiptTokens, Math.ceil((8400 - text.length) / 4))
  assert.equal(receiptSavings(text), Math.ceil((8400 - text.length) / 4))
})

test('savings: 同一条结果同时带融合与占位符', () => {
  const text = `${packText()}\n[then_run:succeeded]`
  const next = applyEvent(emptyStats(), { type: 'tool/result', data: { message: { content: [{ type: 'text', text }, { type: 'image', data: 'x' }] } } })
  assert.equal(next.fusion, 1)
  assert.equal(next.pack, 1)
  assert.equal(next.toolTokens, tokenCount(text))
})

test('savings: 压缩按 shadowedTokenCount 累计，非法值忽略', () => {
  const one = applyEvent(emptyStats(), { type: 'compaction/summary', data: { shadowedTokenCount: 23000 } })
  assert.equal(one.compact, 1)
  assert.equal(one.compactTokens, 23000)
  const ignored = applyEvent(one, { type: 'compaction/summary', data: { shadowedTokenCount: -5 } })
  assert.equal(ignored, one)
  const two = applyEvent(one, { type: 'compaction/summary', data: { shadowedTokenCount: 1000 } })
  assert.equal(two.compact, 2)
  assert.equal(two.compactTokens, 24000)
})

test('savings: 空文本结果不改变累计', () => {
  const stats = emptyStats()
  assert.equal(applyEvent(stats, { type: 'tool/result', data: { message: { content: [] } } }), stats)
})

test('savings: schema 拒绝非法计数', () => {
  assert.throws(() => assertStats(null), /must be an object/u)
  assert.throws(() => assertStats({ ...emptyStats(), fusion: -1 }), /non-negative integer/u)
  assert.throws(() => assertStats({ ...emptyStats(), packTokens: 1.5 }), /non-negative integer/u)
  assert.deepEqual(assertStats(emptyStats()), emptyStats())
})

test('savings: 投影定义形状', () => {
  const definition = createStatsProjectionDefinition()
  assert.equal(definition.key, PROJECTION_KEY)
  assert.equal(definition.stateVersion, 1)
  const initial = definition.init({}, 0)
  assert.deepEqual(initial, emptyStats())
  const next = definition.apply(initial, { type: 'tool/result', data: { message: { content: [{ type: 'text', text: '[then_run:succeeded]' }] } } })
  assert.equal(next.fusion, 1)
  assert.equal(definition.wire.view(next), next)
  assert.deepEqual(definition.wire.viewSchema.parse(next), next)
})
