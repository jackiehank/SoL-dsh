/**
 * Online Context Compact for DSH — 计划步骤完成点触发原生压缩。
 *
 * 上游把“计划里已完成的一步”当作 compaction 候选点；这里沿用同一思路，但用 DSH 的机制：
 * - 计划来源是内建 `todo_write`（观察其参数，不另造计划工具）；
 * - 压缩用 `ctx.compaction.compactRegion(start, end, agent, signal)`，在 `agent/pre-step` 里调用，
 *   同一 turn 的下一 step 自然使用压缩后的 surface，不需要注入“继续工作”的消息；
 * - 区间选择与收益定价都用 `ctx.tokenMeter.measure(session)` 的按节点数据。
 *
 * 决策核心（边界判定 / 经济性 / 区间选择）是纯函数，便于测试；触发层只负责“条件满足才调用、
 * 任何失败都 fail-open”。DSH 的 compaction 要求 turn 打开且 surface 稳定，所以本机制只在
 * 明确的完成边界上尝试一次，绝不在普通步骤上反复触发。
 */

import { appendLedger } from './reducer.js'

const COMPLETED = 'completed'

/** 计划跟踪：用 todo 的 content 作稳定键（DSH 的 todo 没有 id）。 */
export function createPlanTracker() {
  let previous = new Map()
  let boundary = undefined

  return {
    /** 观察一次 todo_write 的完整列表，返回是否出现“旧步骤变成 completed”的完成边界。 */
    observe(todos) {
      const next = new Map()
      let crossed = false
      for (const todo of Array.isArray(todos) ? todos : []) {
        const content = todo?.content
        if (typeof content !== 'string') continue
        const status = todo?.status
        next.set(content, status)
        if (status === COMPLETED && previous.has(content) && previous.get(content) !== COMPLETED) crossed = true
      }
      previous = next
      const remaining = [...next.values()].filter((status) => status !== COMPLETED).length
      if (crossed) boundary = { at: Date.now(), remaining }
      return { boundary: crossed, remaining }
    },
    /** 取走一次待处理的完成边界（只消费一次）。 */
    takeBoundary() {
      const taken = boundary
      boundary = undefined
      return taken
    },
    remaining() {
      return [...previous.values()].filter((status) => status !== COMPLETED).length
    },
  }
}

/**
 * 经济性判断（保守版）：
 * - 净收益 = 可移除 token − 摘要成本；不为正就不压；
 * - breakeven = 摘要成本 / 净收益，必须落在“请求视界”内；
 * - 首次压缩放宽视界（× firstScale），后续要求额外 margin；
 * - 窗口压力可以越过经济性与冷却（但仍要求净收益为正）。
 */
export function decideCompaction(input) {
  const {
    removableTokens,
    summaryTokens,
    remainingSteps,
    requestsSinceLastCompaction,
    compactions,
    firstScale,
    margin,
    minRequests,
    pressure,
  } = input

  if (!(removableTokens > summaryTokens)) return { compact: false, reason: 'non-positive-saving' }

  const saving = removableTokens - summaryTokens
  const breakeven = summaryTokens / saving
  const horizonBase = 1 + Math.max(0, remainingSteps) * 2
  const horizon = compactions === 0 ? horizonBase * firstScale : horizonBase

  if (pressure === true) return { compact: true, reason: 'window-pressure', saving, breakeven, horizon }
  if (requestsSinceLastCompaction < minRequests) return { compact: false, reason: 'cooldown' }
  if (breakeven > horizon) return { compact: false, reason: 'over-horizon' }
  if (compactions > 0 && breakeven * margin > horizon) return { compact: false, reason: 'margin' }
  return { compact: true, reason: compactions === 0 ? 'first-boundary' : 'boundary', saving, breakeven, horizon }
}

/**
 * 从 tokenMeter 的节点里选一个“保留尾部、压掉前部”的区间。
 * 约定：节点 0 是 system/message，永远不压；从尾部往前累计到 keepRecentTokens 为止。
 */
export function selectRange(nodes, keepRecentTokens) {
  const list = Array.isArray(nodes) ? nodes.filter((node) => Number.isFinite(node?.seq) && Number.isFinite(node?.tokens)) : []
  if (list.length < 3) return undefined

  const systemSeq = list[0].seq
  let endIndex = list.length - 1
  let kept = 0
  while (endIndex > 1 && kept < keepRecentTokens) {
    kept += list[endIndex].tokens
    endIndex -= 1
  }
  if (endIndex <= 0) return undefined

  const start = list[1].seq
  const end = list[endIndex].seq
  if (!(end > start)) return undefined

  let removableTokens = 0
  for (let index = 1; index <= endIndex; index += 1) removableTokens += list[index].tokens
  if (removableTokens <= 0) return undefined
  return { start, end, removableTokens, systemSeq }
}

/** 价格摘要成本：配置值优先，否则一个保守常数。 */
export function summaryCost(summaryTokens) {
  return Number.isFinite(summaryTokens) && summaryTokens > 0 ? summaryTokens : 1000
}

/**
 * 装配：观察 todo_write、数请求、在 pre-step 里做一次压缩尝试。
 * 没有 compaction / tokenMeter 的 profile 里保持不激活。
 */
export function attachOnlineContextCompact(ctx, config) {
  const compaction = ctx.get?.('compaction')
  const tokenMeter = ctx.get?.('tokenMeter')
  if (compaction === undefined || typeof compaction.compactRegion !== 'function' || tokenMeter === undefined) {
    console.warn('[sol-pi-dsh] onlineContextCompact 已开启，但缺少 compaction/tokenMeter；本机制保持关闭')
    return undefined
  }

  const sessions = new Map()
  const stateFor = (agent) => {
    const key = String(agent.id)
    let state = sessions.get(key)
    if (state === undefined) {
      state = { tracker: createPlanTracker(), requests: 0, compactions: 0, lastCompactionRequest: 0, busy: false }
      sessions.set(key, state)
    }
    return state
  }

  const ledger = (entry) => appendLedger(config.storageRoot, { scope: 'online-context-compact', ...entry })

  // 计划来源：观察内建 todo_write 的入参（不改结果）。
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    try {
      if (exec?.name === 'todo_write' && exec.arguments !== undefined) {
        const state = stateFor(exec.agent)
        const { boundary, remaining } = state.tracker.observe(exec.arguments.todos)
        if (boundary) await ledger({ event: 'boundary', remaining })
      }
    } catch {
      // 观察失败不影响工具结果。
    }
    return decision
  })

  // 请求计数：用于冷却。
  ctx.on('agent/request', async (payload, next) => {
    try {
      stateFor(payload.agent).requests += 1
    } catch {
      // 计数失败不影响请求。
    }
    return next()
  })

  // 完成边界后的下一步之前尝试一次压缩；失败一律放行。
  ctx.on('agent/pre-step', async (payload, next) => {
    const state = stateFor(payload.agent)
    const boundary = state.tracker.takeBoundary()
    if (boundary === undefined || state.busy) return next()
    state.busy = true
    try {
      const measurement = tokenMeter.measure(payload.agent.session)
      const range = selectRange(measurement?.nodes, config.compactKeepRecentTokens)
      if (range === undefined) {
        await ledger({ event: 'skip', reason: 'no-range' })
        return next()
      }
      const decision = decideCompaction({
        removableTokens: range.removableTokens,
        summaryTokens: summaryCost(config.compactSummaryTokens),
        remainingSteps: boundary.remaining,
        requestsSinceLastCompaction: state.requests - state.lastCompactionRequest,
        compactions: state.compactions,
        firstScale: config.compactFirstScale,
        margin: config.compactMargin,
        minRequests: config.compactMinRequestsSinceLast,
        pressure: false,
      })
      if (!decision.compact) {
        await ledger({ event: 'skip', reason: decision.reason, ...decision })
        return next()
      }
      const result = await compaction.compactRegion(range.start, range.end, payload.agent, payload.signal)
      state.compactions += 1
      state.lastCompactionRequest = state.requests
      await ledger({
        event: 'compacted',
        reason: decision.reason,
        shadowedTokens: result?.shadowedTokenCount,
        start: range.start,
        end: range.end,
      })
    } catch (error) {
      await ledger({ event: 'fallback', message: error instanceof Error ? error.message : String(error) })
    } finally {
      state.busy = false
    }
    return next()
  })

  ctx.effect(() => () => {
    sessions.clear()
  })

  return { sessions }
}

