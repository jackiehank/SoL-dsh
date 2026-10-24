#!/usr/bin/env node
/**
 * 只读会话度量：把 DSH 的 session.v4.jsonl.zstd 与插件账本汇总成一张表。
 *
 * 不做任何模型调用、不写任何文件；只解码、计数、求和。
 *
 * 用法：
 *   node tools/measure-sessions.mjs                        # 全部工作区，文本表
 *   node tools/measure-sessions.mjs --workspace SoL-dsh    # 只看某个工作区
 *   node tools/measure-sessions.mjs --json                 # 机器可读
 *   node tools/measure-sessions.mjs --price 0.27,1.10,0.07 # 输入/输出/cache读 单价（$/1M token）
 *
 * 口径与偏差见 docs/issues/sol-dsh-efficacy.md。
 */

import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim().length > 0 ? process.env.DSH_HOME : join(homedir(), '.dsh')
}

/** 会话日志是“每批追加一个 zstd frame”的 JSONL；Node 的解码器只认第一个 frame，按魔数切分。 */
export function decodeSessionLog(buffer) {
  const starts = []
  let cursor = 0
  while ((cursor = buffer.indexOf(ZSTD_MAGIC, cursor)) !== -1) {
    starts.push(cursor)
    cursor += ZSTD_MAGIC.length
  }
  const parts = []
  for (let index = 0; index < starts.length; index += 1) {
    const end = index + 1 < starts.length ? starts[index + 1] : buffer.length
    try {
      parts.push(zstdDecompressSync(buffer.subarray(starts[index], end)))
    } catch {
      // 不完整的尾帧（会话正在写）跳过，不猜。
    }
  }
  return Buffer.concat(parts).toString('utf8')
}

function textOfMessage(message) {
  if (!Array.isArray(message?.content)) return ''
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/** 汇总一个会话的计数与 token；纯函数，便于测试。 */
export function summarizeEvents(events) {
  const summary = {
    turns: 0,
    steps: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    toolErrors: 0,
    tools: {},
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    fusionSucceeded: 0,
    fusionFailed: 0,
    observationPlaceholders: 0,
    todos: 0,
    compactions: 0,
    shadowedTokens: 0,
  }
  for (const event of events) {
    switch (event.type) {
      case 'turn/start': summary.turns += 1; break
      case 'step/start': summary.steps += 1; break
      case 'todo/write': summary.todos += 1; break
      case 'assistant/message': {
        summary.assistantMessages += 1
        const usage = event.data?.usage
        if (usage) {
          summary.inputTokens += usage.inputTokens ?? 0
          summary.outputTokens += usage.outputTokens ?? 0
          summary.cacheReadTokens += usage.cacheReadTokens ?? 0
          summary.cacheWriteTokens += usage.cacheWriteTokens ?? 0
          summary.totalTokens += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
        }
        break
      }
      case 'tool/call': {
        summary.toolCalls += 1
        const name = event.data?.name ?? event.data?.message?.name ?? 'unknown'
        summary.tools[name] = (summary.tools[name] ?? 0) + 1
        break
      }
      case 'tool/result': {
        summary.toolResults += 1
        if (event.data?.message?.isError === true) summary.toolErrors += 1
        const text = textOfMessage(event.data?.message)
        if (text.includes('[then_run:succeeded]')) summary.fusionSucceeded += 1
        if (text.includes('[then_run:failed]')) summary.fusionFailed += 1
        if (text.includes('[large tool result replaced')) summary.observationPlaceholders += 1
        break
      }
      default: {
        if (typeof event.type === 'string' && event.type.startsWith('compaction/')) {
          summary.compactions += event.type === 'compaction/summary' ? 1 : 0
          summary.shadowedTokens += event.data?.shadowedTokenCount ?? event.data?.shadowedTokens ?? 0
        }
      }
    }
  }
  return summary
}

function readLedgers() {
  const root = join(dshHome(), 'sol-pi')
  const totals = { observationPack: {}, reducer: {} }
  const files = {
    observationPack: join(root, 'observation-pack', 'ledger.jsonl'),
    reducer: join(root, 'evidence-preserving-reducer', 'ledger.jsonl'),
  }
  for (const [key, file] of Object.entries(files)) {
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue
      try {
        const entry = JSON.parse(line)
        const name = entry.event ?? 'unknown'
        totals[key][name] = (totals[key][name] ?? 0) + 1
      } catch {
        // 坏行跳过。
      }
    }
  }
  return totals
}

function findSessionLogs(root) {
  const found = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.jsonl.zstd')) found.push(full)
    }
  }
  walk(root)
  return found
}

function priceCost(summary, price) {
  if (price === undefined) return undefined
  return (summary.inputTokens * price.input
    + summary.outputTokens * price.output
    + summary.cacheReadTokens * (price.cacheRead ?? price.input)
    + summary.cacheWriteTokens * (price.cacheWrite ?? price.input)) / 1_000_000
}

function parseArgs(argv) {
  const options = { json: false, workspace: undefined, limit: undefined, price: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--workspace') options.workspace = argv[++index]
    else if (arg === '--limit') options.limit = Number(argv[++index])
    else if (arg === '--price') {
      const [input, output, cacheRead, cacheWrite] = String(argv[++index]).split(',').map(Number)
      if ([input, output].some((value) => !Number.isFinite(value))) throw new Error('--price 需要 "输入,输出[,cache读[,cache写]]"（$/1M token）')
      options.price = { input, output, cacheRead, cacheWrite }
    }
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const root = join(dshHome(), 'sessions')
  const logs = findSessionLogs(root).filter((file) => options.workspace === undefined || file.includes(options.workspace))
  const rows = []
  for (const file of logs) {
    const summary = summarizeEvents(decodeSessionLog(readFileSync(file)).split('\n').filter(Boolean).map((line) => JSON.parse(line)))
    const sessionDir = file.split(/[\\/]/u).slice(-2, -1)[0]
    rows.push({ session: sessionDir, bytes: statSync(file).size, ...summary, costUsd: priceCost(summary, options.price) })
  }
  rows.sort((left, right) => right.totalTokens - left.totalTokens)
  const limited = options.limit === undefined ? rows : rows.slice(0, options.limit)
  const ledgers = readLedgers()

  if (options.json) {
    console.log(JSON.stringify({ sessions: limited, ledgers }, null, 2))
    return
  }
  const header = ['session', 'turns', 'steps', 'calls', 'err', 'input', 'output', 'cacheR', 'total', 'fusion', 'pack', 'todos', 'compact']
  console.log(header.join('\t'))
  for (const row of limited) {
    console.log([
      row.session.slice(0, 20),
      row.turns,
      row.steps,
      row.toolCalls,
      row.toolErrors,
      row.inputTokens,
      row.outputTokens,
      row.cacheReadTokens,
      row.totalTokens,
      `${row.fusionSucceeded}/${row.fusionFailed}`,
      row.observationPlaceholders,
      row.todos,
      row.compactions,
    ].join('\t'))
  }
  console.log('ledgers:', JSON.stringify(ledgers))
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/gu, '/')}` || process.argv[1]?.endsWith('measure-sessions.mjs')) {
  main()
}
