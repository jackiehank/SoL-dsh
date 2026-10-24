/**
 * ObservationPack for DSH — 大工具结果换句柄 + 精确分页召回。
 *
 * 与上游最重要的差别：DSH 没有 Pi 的 `context` 投影层（`agent/request` 明确不能改消息），
 * 所以替换发生在 `tools/post-execute`——结果落进会话日志之前。代价是模型第一次请求就看
 * 不到全文（上游允许前两次），换来的是零重放。原文进归档，`value` 不动（程序调用方仍拿
 * 到规范值），模型用 `obs_recall` 按字节偏移精确读回。
 *
 * 一切失败都 fail-open：插件自身出错时返回原结果。
 */

import { createStore, countLines, estimateTokens, isObservationId, sha256 } from './store.js'

/** 只处理超过该字节数的纯文本结果（10 KiB，与上游一致）。 */
export const DEFAULT_THRESHOLD_BYTES = 10 * 1024
/** 占位符里首尾摘录的总预算（首尾各一半，整行）。 */
export const PLACEHOLDER_EXCERPT_BYTES = 1024
/** reducer 回执不该再被打包：它本身就是长日志的缩减。 */
const RECEIPT_PREFIX = 'sol_pi_evidence_receipt_v1'
const CHARS_PER_TOKEN = 4

/** 卡片横幅：只出现在 `presentResult` 里，不增加模型上下文（上游 TUI 横幅的对应物）。 */
export const OBSERVATION_PACK_BADGE = '⚡ ObservationPack · 大观测以句柄代替原文，未整段重放'

/** 人类可读字节数，仅用于展示层。 */
export function formatBytes(bytes) {
  const value = Number.isFinite(bytes) ? Math.max(0, Math.round(bytes)) : 0
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1).replace(/\.0$/u, '')} MiB`
  if (value >= 1024) return `${(value / 1024).toFixed(1).replace(/\.0$/u, '')} KiB`
  return `${value} B`
}

export { DEFAULT_THRESHOLD_BYTES as THRESHOLD_BYTES }

/** 结果内容是否是“纯文本、非错误”——只有这种才参与打包。 */
export function isPackableResult(result) {
  if (result === undefined || result === null) return false
  if (result.isError === true) return false
  const content = result.content
  if (!Array.isArray(content) || content.length === 0) return false
  return content.every((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
}

/** 把 content 块拼成原文；非纯文本返回 undefined。 */
export function textOfContent(content) {
  if (!Array.isArray(content) || content.length === 0) return undefined
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') return undefined
    parts.push(block.text)
  }
  return parts.join('\n')
}

function containsReceipt(text) {
  return text.split('\n').some((line) => line === RECEIPT_PREFIX)
}

/**
 * 为一条工具结果构造归档描述。返回 undefined 表示这条结果不参与打包。
 *
 * @param exec - tools/post-execute 的执行视图（需要 name、callId）。
 * @param content - 最终 content 块。
 */
export function createObservation(exec, content) {
  const text = textOfContent(content)
  if (text === undefined) return undefined
  if (containsReceipt(text)) return undefined
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= 0) return undefined
  const contentHash = sha256(text)
  const id = `obs_${sha256(`${exec.name}\u0000${exec.callId}\u0000${contentHash}`).slice(0, 24)}`
  return {
    id,
    contentHash,
    toolName: exec.name,
    callId: String(exec.callId),
    text,
    bytes,
    lines: countLines(text),
    tokens: Math.ceil(text.length / CHARS_PER_TOKEN),
  }
}

/** 取前（或后）若干完整行，预算按字节算，不切半行。 */
export function completeLineExcerpt(text, budgetBytes, fromEnd) {
  const lines = text.split(/(?<=\n)/u)
  const selected = []
  let selectedBytes = 0
  let index = fromEnd ? lines.length - 1 : 0

  while (index >= 0 && index < lines.length) {
    const line = lines[index]
    if (line === undefined) break
    const lineBytes = Buffer.byteLength(line, 'utf8')
    if (selectedBytes + lineBytes > budgetBytes) break
    if (fromEnd) selected.unshift(line)
    else selected.push(line)
    selectedBytes += lineBytes
    index += fromEnd ? -1 : 1
  }

  return selected.join('')
}

/**
 * 占位符：稳定 id、原始尺寸、首尾完整行摘录、召回指引。
 * 这段文字会替代原文进入模型上下文，因此不包含任何“猜测”的内容。
 */
export function placeholderFor(observation) {
  const headBudget = Math.floor(PLACEHOLDER_EXCERPT_BYTES / 2)
  const tailBudget = PLACEHOLDER_EXCERPT_BYTES - headBudget
  const head = completeLineExcerpt(observation.text, headBudget, false)
  const tail = completeLineExcerpt(observation.text, tailBudget, true)
  return [
    `[large tool result replaced before it entered the context]`,
    `id: ${observation.id}`,
    `tool: ${observation.toolName}`,
    `original_bytes: ${observation.bytes}`,
    `original_lines: ${observation.lines}`,
    `estimated_tokens: ${observation.tokens}`,
    `retrieve: call obs_recall with {"id":"${observation.id}","offset":0}; continue with returned next_offset`,
    `[first complete lines, up to ${headBudget} bytes]`,
    head,
    `[middle omitted; last complete lines, up to ${tailBudget} bytes]`,
    tail,
    `[${observation.bytes} original bytes omitted]`,
  ].join('\n')
}

/**
 * 构造 post-execute 监听器。先 `next()` 拿到更早监听器的决定，只在自己这一层追加替换；
 * 别人已经替换了 value 的，一律不碰。
 */
export function createPostExecuteHandler({ store, thresholdBytes = DEFAULT_THRESHOLD_BYTES }) {
  return async function observationPackPostExecute(exec, result, next) {
    const decision = await next()
    if (decision === undefined || decision.kind !== 'accept') return decision
    if (exec === undefined || exec.name === 'obs_recall') return decision
    if (Object.hasOwn(decision, 'value')) return decision
    if (!isPackableResult(result)) return decision

    const content = decision.content ?? result.content
    const text = textOfContent(content)
    if (text === undefined) return decision

    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes <= thresholdBytes) return decision

    try {
      const observation = createObservation(exec, content)
      if (observation === undefined) return decision
      await store.save(observation.id, observation.text, { bytes: observation.bytes, hash: observation.contentHash })
      const placeholder = placeholderFor(observation)
      await store.appendLedger({
        event: 'placeholder',
        id: observation.id,
        tool: observation.toolName,
        callId: observation.callId,
        originalBytes: bytes,
        originalLines: observation.lines,
        placeholderBytes: Buffer.byteLength(placeholder, 'utf8'),
        removedTokens: Math.max(0, estimateTokens(observation.text) - estimateTokens(placeholder)),
      })
      return { ...decision, content: [{ type: 'text', text: placeholder }] }
    } catch (error) {
      // fail-open：打包失败绝不吞掉观测。
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(`[sol-dsh] observation-pack fail-open: ${reason}`)
      return decision
    }
  }
}

/**
 * `obs_recall` 工具定义。输出是结构化值，`render` 负责给模型一段带偏移信息的文本。
 */
export function createRecallDefinition({ store, maxBytes = 16 * 1024, maxLines = 400 }) {
  const headerReserveBytes = 512
  const headerReserveLines = 2
  const limits = {
    maxBytes: maxBytes - headerReserveBytes,
    maxLines: maxLines - headerReserveLines,
  }

  return {
    name: 'obs_recall',
    description:
      'Read a stored large tool result by observation id and byte offset. Returns a bounded page and the next_offset to continue from.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'Observation id from a placeholder (obs_...).' },
        offset: { type: 'integer', description: 'Byte offset to start from; defaults to 0.' },
      },
      required: ['id'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          offset: { type: 'integer' },
          bytes: { type: 'integer' },
          lines: { type: 'integer' },
          nextOffset: { type: 'integer' },
          eof: { type: 'boolean' },
          text: { type: 'string' },
          header: { type: 'string' },
        },
        required: ['id', 'offset', 'bytes', 'lines', 'nextOffset', 'eof', 'text', 'header'],
      },
      render(_args, value) {
        return [{ type: 'text', text: `${value.header}\n${value.text}` }]
      },
      // 只给 UI 用的投影（随会话日志持久化），模型看不到；presentResult 靠它还原字节/行数。
      presentationMeta(_args, value) {
        return {
          id: value.id,
          offset: value.offset,
          bytes: value.bytes,
          lines: value.lines,
          nextOffset: value.nextOffset,
          eof: value.eof,
        }
      },
    },
    /** 待执行状态：标题写清楚在读哪个句柄、从哪一页开始。 */
    presentCall(args) {
      const id = typeof args?.id === 'string' && args.id.length > 0 ? args.id : 'obs_…'
      const offset = Number.isInteger(args?.offset) ? args.offset : 0
      return { card: 'generic', title: `读取归档观测 ${id}`, kind: 'read', rawInput: { id, offset } }
    },
    /** 完成状态：标题带本页字节/行数，正文末尾加一句“原文未重放”的说明（不进模型上下文）。 */
    presentResult(_args, result) {
      const meta = result?.meta ?? {}
      const bytes = Number.isFinite(meta.bytes) ? meta.bytes : 0
      const lines = Number.isFinite(meta.lines) ? meta.lines : 0
      const title = `obs_recall · ${formatBytes(bytes)} · ${lines} 行${meta.eof === false ? '（还有下一页）' : ''}`
      return {
        card: 'generic',
        title,
        content: [
          ...(Array.isArray(result?.content) ? result.content : []),
          { type: 'text', text: OBSERVATION_PACK_BADGE },
        ],
      }
    },
    async execute(args, exec) {
      const id = args?.id
      if (!isObservationId(id)) throw new Error(`Unknown observation id: ${id}`)
      const offset = args?.offset ?? 0
      if (!Number.isInteger(offset) || offset < 0) throw new Error(`offset must be a non-negative integer, got ${offset}`)
      let chunk
      try {
        chunk = await store.read(id, offset, limits)
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          throw new Error(`Unknown observation id: ${id}`)
        }
        throw error
      }
      const header = [
        `[obs_recall id=${id} offset=${offset} next_offset=${chunk.nextOffset} eof=${chunk.eof}]`,
        `[chunk_bytes=${chunk.bytes} chunk_lines=${chunk.lines}; use next_offset to continue]`,
      ].join('\n')
      const totalBytes = Buffer.byteLength(header) + Buffer.byteLength(chunk.text)
      if (totalBytes > maxBytes || chunk.lines + headerReserveLines > maxLines) {
        throw new Error('recall output exceeded its hard limit')
      }
      await store.appendLedger({
        event: 'recall',
        id,
        offset,
        callId: exec === undefined ? undefined : String(exec.callId),
        bytes: chunk.bytes,
        lines: chunk.lines,
        nextOffset: chunk.nextOffset,
        eof: chunk.eof,
      })
      return {
        id,
        offset,
        bytes: chunk.bytes,
        lines: chunk.lines,
        nextOffset: chunk.nextOffset,
        eof: chunk.eof,
        text: chunk.text,
        header,
      }
    },
  }
}

/** 把 ObservationPack 装进一个插件上下文：注册工具 + post-execute 监听。 */
export function attachObservationPack(ctx, config) {
  const store = createStore({ root: config.storageRoot, ledger: config.ledger })
  ctx.effect(() => ctx.tools.register(createRecallDefinition({
    store,
    maxBytes: config.recallMaxBytes,
    maxLines: config.recallMaxLines,
  })))
  ctx.on('tools/post-execute', createPostExecuteHandler({
    store,
    thresholdBytes: config.observationPackThresholdBytes,
  }))
  return store
}
