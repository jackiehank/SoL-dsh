import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  attachOnlineContextCompact,
  createPlanTracker,
  decideCompaction,
  selectRange,
} from '../plugin/lib/compact.js'
import { resolveConfig } from '../plugin/lib/config.js'

test('计划跟踪：只有“旧步骤变成 completed”才算边界，新引入的 completed 只是历史', () => {
  const tracker = createPlanTracker()
  assert.deepEqual(tracker.observe([
    { content: 'a', status: 'completed' },
    { content: 'b', status: 'in_progress' },
  ]), { boundary: false, remaining: 1 })

  // 同一个 content 从 in_progress → completed：边界。
  assert.deepEqual(tracker.observe([
    { content: 'a', status: 'completed' },
    { content: 'b', status: 'completed' },
    { content: 'c', status: 'pending' },
  ]), { boundary: true, remaining: 1 })

  assert.deepEqual(tracker.takeBoundary()?.remaining, 1)
  assert.equal(tracker.takeBoundary(), undefined)

  // 重排/新增 completed 不算边界（旁边没有旧步骤跨过）。
  assert.deepEqual(tracker.observe([
    { content: 'e', status: 'completed' },
    { content: 'd', status: 'completed' },
  ]), { boundary: false, remaining: 0 })
})

test('经济性：净收益、视界、冷却、margin 与窗口压力', () => {
  const base = {
    removableTokens: 10_000,
    summaryTokens: 1_000,
    remainingSteps: 3,
    requestsSinceLastCompaction: 5,
    compactions: 0,
    firstScale: 2,
    margin: 1.5,
    minRequests: 2,
    pressure: false,
  }
  assert.equal(decideCompaction(base).compact, true)
  assert.equal(decideCompaction(base).reason, 'first-boundary')

  // 净收益不为正：永远不压。
  assert.equal(decideCompaction({ ...base, removableTokens: 1_000 }).reason, 'non-positive-saving')

  // 冷却。
  assert.equal(decideCompaction({ ...base, requestsSinceLastCompaction: 1 }).reason, 'cooldown')

  // 视界不够。
  assert.equal(decideCompaction({ ...base, remainingSteps: 0, firstScale: 1, summaryTokens: 9_000 }).reason, 'over-horizon')

  // 非首次要过 margin。
  const subsequent = { ...base, compactions: 1, firstScale: 1, remainingSteps: 0, summaryTokens: 5_000 }
  assert.equal(decideCompaction(subsequent).reason, 'margin')

  // 窗口压力可以越过冷却。
  assert.equal(decideCompaction({ ...base, requestsSinceLastCompaction: 0, pressure: true }).reason, 'window-pressure')
})

test('区间选择：system 永不入区间，尾部保留 keepRecentTokens', () => {
  const nodes = [
    { seq: 0, tokens: 800 },
    { seq: 1, tokens: 500 },
    { seq: 2, tokens: 5_000 },
    { seq: 3, tokens: 3_000 },
  ]
  assert.deepEqual(selectRange(nodes, 3_000), { start: 1, end: 2, removableTokens: 5_500, systemSeq: 0 })
  assert.equal(selectRange(nodes, 100_000), undefined)
  assert.equal(selectRange([{ seq: 0, tokens: 1 }], 10), undefined)
  assert.equal(selectRange(undefined, 10), undefined)
})

function fakeCtx({ compaction, tokenMeter, storageRoot }) {
  const listeners = new Map()
  const ctx = {
    get(name) {
      if (name === 'compaction') return compaction
      if (name === 'tokenMeter') return tokenMeter
      return undefined
    },
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(callback)
      return () => {}
    },
    effect(callback) {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    emit: async (event, ...args) => {
      let result
      for (const callback of listeners.get(event) ?? []) result = await callback(...args)
      return result
    },
    listeners,
    config: { storageRoot },
  }
  return ctx
}

async function tempConfig(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sol-pi-compact-'))
  const config = resolveConfig({
    onlineContextCompact: true,
    storageRoot: root,
    compactKeepRecentTokens: 3_000,
    compactSummaryTokens: 100,
    compactMinRequestsSinceLast: 0,
    compactFirstScale: 1,
    compactMargin: 1,
    ...overrides,
  })
  return { root, config }
}

test('装配：完成边界后的 pre-step 调一次 compactRegion，同一 turn 继续', async () => {
  const { root, config } = await tempConfig()
  const calls = []
  const compaction = {
    async compactRegion(start, end, agent, signal) {
      calls.push({ start, end, agentId: agent.id, hasSignal: signal !== undefined })
      return { shadowedTokenCount: 5_500 }
    },
  }
  const tokenMeter = {
    measure: () => ({ nodes: [
      { seq: 0, tokens: 800 },
      { seq: 1, tokens: 500 },
      { seq: 2, tokens: 5_000 },
      { seq: 3, tokens: 3_000 },
    ] }),
  }
  const ctx = fakeCtx({ compaction, tokenMeter, storageRoot: root })
  const attached = attachOnlineContextCompact(ctx, config)
  assert.ok(attached !== undefined)

  const agent = { id: 'session-1', session: {} }
  const accept = async () => ({ kind: 'accept' })
  await ctx.emit('agent/request', { agent }, async () => ({ provider: 'p', model: 'm' }))
  await ctx.emit('tools/post-execute',
    { name: 'todo_write', arguments: { todos: [{ content: 'a', status: 'in_progress' }] }, agent },
    { isError: false, content: [] }, accept)
  await ctx.emit('tools/post-execute',
    { name: 'todo_write', arguments: { todos: [{ content: 'a', status: 'completed' }] }, agent },
    { isError: false, content: [] }, accept)

  const decision = await ctx.emit('agent/pre-step', { agent, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
  assert.deepEqual(calls, [{ start: 1, end: 2, agentId: 'session-1', hasSignal: true }])

  // 没有新的完成边界：不再压缩。
  await ctx.emit('agent/pre-step', { agent, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(calls.length, 1)

  const ledger = await readFile(join(root, 'evidence-preserving-reducer', 'ledger.jsonl'), 'utf8')
  assert.match(ledger, /"event":"compacted"/u)
  await rm(root, { recursive: true, force: true })
})

test('装配：无 compaction/tokenMeter 时不激活；压缩失败 fail-open', async () => {
  const { root, config } = await tempConfig()
  assert.equal(attachOnlineContextCompact(fakeCtx({ storageRoot: root }), config), undefined)

  const ctx = fakeCtx({
    storageRoot: root,
    compaction: {
      async compactRegion() {
        throw new Error('busy')
      },
    },
    tokenMeter: { measure: () => ({ nodes: [{ seq: 0, tokens: 1 }, { seq: 1, tokens: 5_000 }, { seq: 2, tokens: 5_000 }, { seq: 3, tokens: 5_000 }] }) },
  })
  attachOnlineContextCompact(ctx, config)
  const agent = { id: 'session-2', session: {} }
  const accept = async () => ({ kind: 'accept' })
  await ctx.emit('tools/post-execute',
    { name: 'todo_write', arguments: { todos: [{ content: 'x', status: 'in_progress' }] }, agent },
    { isError: false, content: [] }, accept)
  await ctx.emit('tools/post-execute',
    { name: 'todo_write', arguments: { todos: [{ content: 'x', status: 'completed' }] }, agent },
    { isError: false, content: [] }, accept)
  const decision = await ctx.emit('agent/pre-step', { agent, signal: new AbortController().signal }, async () => ({ kind: 'enter' }))
  assert.deepEqual(decision, { kind: 'enter' })

  const ledger = await readFile(join(root, 'evidence-preserving-reducer', 'ledger.jsonl'), 'utf8')
  assert.match(ledger, /"event":"fallback"/u)
  await rm(root, { recursive: true, force: true })
})


