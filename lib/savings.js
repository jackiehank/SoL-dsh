/**
 * 会话级节省统计：一个 Host 侧 session projection。
 *
 * 为什么不用客户端扫快照：会话快照是分页的，窗口外的旧轮次不在里面；机制关掉以后，
 * 面板会重新从 0 开始。投影由 DSH 的 `ctx.sessionProjections` 驱动，按提交事件折整条
 * 会话日志（不依赖当前窗口），所以分页、重启、开关变化都不影响历史累计。
 *
 * 口径与客户端一致：
 * - 收纳：占位符的 `estimated_tokens` - 占位符自身（4 字符/token）；
 * - 回执：回执头的 `source_bytes` - 回执自身；
 * - 压缩：`compaction/summary` 的 `shadowedTokenCount`；
 * - 融合：`[then_run:succeeded]` 次数（不折算 token）；
 * - `toolTokens`：所有工具结果文本的 token 估算，供百分比分母使用。
 */

export const FUSION_MARK = '[then_run:succeeded]'
export const PACK_MARK = '[large tool result replaced before it entered the context]'
export const RECEIPT_MARK = 'sol_pi_evidence_receipt_v1'
export const CHARS_PER_TOKEN = 4
/** 投影 key；客户端用 `useProjection("solDshStats")` 读取。 */
export const PROJECTION_KEY = 'solDshStats'

const STAT_KEYS = Object.freeze([
  'fusion',
  'pack',
  'receipt',
  'compact',
  'packTokens',
  'receiptTokens',
  'compactTokens',
  'toolTokens',
])

export function emptyStats() {
  return {
    fusion: 0,
    pack: 0,
    receipt: 0,
    compact: 0,
    packTokens: 0,
    receiptTokens: 0,
    compactTokens: 0,
    toolTokens: 0,
  }
}

/** 工具结果内容里的文本块拼接；非文本块跳过。 */
export function textOfContent(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const isText = block.type === 'text' || block.kind === 'text'
    if (isText && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

export function tokenCount(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** 占位符里带原文的 `estimated_tokens`；用它减去占位符自身。 */
export function packSavings(text) {
  const match = /(?:^|\n)estimated_tokens: (\d+)/.exec(text)
  if (match === null) return 0
  return Math.max(0, Number(match[1]) - tokenCount(text))
}

/** 回执头带原文字节数；回执自身长度按字符估算。 */
export function receiptSavings(text) {
  const match = /(?:^|\n)source_bytes=(\d+)/.exec(text)
  if (match === null) return 0
  return Math.max(0, Math.ceil((Number(match[1]) - text.length) / CHARS_PER_TOKEN))
}

function shadowedOf(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0
}

function add(stats, delta) {
  return {
    fusion: stats.fusion + delta.fusion,
    pack: stats.pack + delta.pack,
    receipt: stats.receipt + delta.receipt,
    compact: stats.compact + delta.compact,
    packTokens: stats.packTokens + delta.packTokens,
    receiptTokens: stats.receiptTokens + delta.receiptTokens,
    compactTokens: stats.compactTokens + delta.compactTokens,
    toolTokens: stats.toolTokens + delta.toolTokens,
  }
}

/**
 * 折叠一条会话事件。纯函数：没有变化时返回同一个引用（投影的变更通知依赖 `Object.is`）。
 *
 * @param stats - 当前累计。
 * @param event - 一条已提交的 `session/event`。
 * @returns 新的累计，或原引用。
 */
export function applyEvent(stats, event) {
  const type = event?.type
  if (type === 'tool/result') {
    const text = textOfContent(event.data?.message?.content)
    if (text.length === 0) return stats
    const delta = emptyStats()
    delta.toolTokens = tokenCount(text)
    if (text.includes(FUSION_MARK)) delta.fusion = 1
    if (text.includes(PACK_MARK)) {
      delta.pack = 1
      delta.packTokens = packSavings(text)
    }
    if (text.includes(RECEIPT_MARK)) {
      delta.receipt = 1
      delta.receiptTokens = receiptSavings(text)
    }
    return add(stats, delta)
  }
  if (type === 'compaction/summary') {
    const shadowed = shadowedOf(event.data?.shadowedTokenCount)
    if (shadowed === 0) return stats
    return {
      ...stats,
      compact: stats.compact + 1,
      compactTokens: stats.compactTokens + shadowed,
    }
  }
  return stats
}

/** 无外部依赖的 schema：只需实现投影注册表调用的 `.parse()`。 */
export function assertStats(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('sol-dsh stats must be an object')
  }
  for (const key of STAT_KEYS) {
    const count = value[key]
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(`sol-dsh stats.${key} must be a non-negative integer`)
    }
  }
  return value
}

export const statsSchema = Object.freeze({ parse: assertStats })

/** `ctx.sessionProjections.register()` 的定义。 */
export function createStatsProjectionDefinition() {
  return {
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema: statsSchema,
    init: () => emptyStats(),
    apply: applyEvent,
    wire: {
      viewSchema: statsSchema,
      view: (state) => state,
    },
  }
}
