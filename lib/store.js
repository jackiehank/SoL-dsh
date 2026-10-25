/**
 * 观测归档：内容寻址、精确分页、失败可诊断。
 *
 * 归档根目录由插件配置决定（默认 <DSH_HOME>/sol-pi）。文件按 observation id 命名，
 * 写入用 O_EXCL，已存在时逐字节校验；读取按字节偏移，按 UTF-8 边界截断，绝不把
 * 一个多字节字符切成两半。
 */

import { constants } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
const CREATE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0)

/** 摘要工具：归档里所有的完整性判断都用它。 */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** 与上游一致的粗估：4 字符 ≈ 1 token。只用于展示“省了多少”，不用于计费。 */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}

/** 行数：不以换行结尾的最后一行也算一行。 */
export function countLines(text) {
  if (text.length === 0) return 0
  let lines = text.endsWith('\n') ? 0 : 1
  for (const character of text) {
    if (character === '\n') lines += 1
  }
  return lines
}

/** 从字节缓冲里数行，规则同上。 */
function countBufferLines(buffer) {
  if (buffer.length === 0) return 0
  let lines = buffer[buffer.length - 1] === 0x0a ? 0 : 1
  for (const byte of buffer) {
    if (byte === 0x0a) lines += 1
  }
  return lines
}

/** 把截断点回退到 UTF-8 字符边界，避免半个代理/多字节字符。 */
function trimUtf8End(buffer, limit) {
  let end = limit
  while (end > 0 && end < buffer.length && ((buffer[end] ?? 0) & 0xc0) === 0x80) end -= 1
  return end
}

/** observation id 的格式约束；召回入口用它拒绝任意路径。 */
export const OBSERVATION_ID_PATTERN = /^obs_[a-f0-9]{24}$/u

export function isObservationId(id) {
  return typeof id === 'string' && OBSERVATION_ID_PATTERN.test(id)
}

/**
 * 建一个归档存储。root 是插件级的（不是会话级的）：id 里已经编进了
 * 工具名、调用 id 与内容哈希，同一个 id 在所有会话里指向同一份字节。
 */
export function createStore({ root, ledger = true }) {
  const objectsDir = join(root, 'observation-pack', 'objects')
  const ledgerPath = join(root, 'observation-pack', 'ledger.jsonl')
  let directoryReady

  async function ensureDirectory() {
    if (directoryReady === undefined) {
      directoryReady = (async () => {
        await mkdir(objectsDir, { recursive: true, mode: 0o700 })
        const stats = await lstat(objectsDir)
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
          throw new Error(`归档目录不是普通目录：${objectsDir}`)
        }
      })()
      // 失败后允许下一次重试，而不是把这个 promise 永久钉死。
      directoryReady.catch(() => {
        directoryReady = undefined
      })
    }
    return directoryReady
  }

  function objectPath(id) {
    if (!isObservationId(id)) throw new Error(`未知的 observation id：${id}`)
    return join(objectsDir, `${id}.txt`)
  }

  return {
    root,
    objectsDir,
    objectPath,
    ensureDirectory,

    /**
     * 落一份归档。已存在时校验尺寸与哈希，不一致视为归档损坏（绝不当作缓存命中）。
     *
     * @param id - observation id。
     * @param text - 原始文本。
     * @param expected - { bytes, hash }，由调用方在切占位符前算好。
     */
    async save(id, text, expected) {
      const filePath = objectPath(id)
      await ensureDirectory()
      let handle
      try {
        handle = await open(filePath, CREATE_FLAGS, 0o600)
        await handle.writeFile(text, { encoding: 'utf8' })
        return
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
        const existingHandle = await open(filePath, READ_FLAGS)
        try {
          const stats = await existingHandle.stat()
          if (!stats.isFile()) throw new Error(`归档对象不是普通文件：${id}`)
          if (stats.size !== expected.bytes) throw new Error(`归档对象大小不一致：${id}`)
          const existing = await existingHandle.readFile()
          if (sha256(existing) !== expected.hash) throw new Error(`归档对象哈希不一致：${id}`)
        } finally {
          await existingHandle.close()
        }
      } finally {
        await handle?.close()
      }
    },

    /**
     * 读一页。偏移越界报错；到文件尾时 eof=true；行数/字节数两个上限都遵守。
     *
     * @param id - observation id。
     * @param offset - 起始字节偏移。
     * @param limits - { maxBytes, maxLines }。
     */
    async read(id, offset, limits) {
      const filePath = objectPath(id)
      const handle = await open(filePath, READ_FLAGS)
      try {
        const stats = await handle.stat()
        if (!stats.isFile()) throw new Error('归档对象不是普通文件')
        if (offset > stats.size) throw new Error(`偏移 ${offset} 超过观测大小 ${stats.size}`)

        const available = Math.max(0, stats.size - offset)
        const buffer = Buffer.alloc(Math.min(available, limits.maxBytes + 4))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
        let end = Math.min(bytesRead, limits.maxBytes)
        let newlineCount = 0

        for (let index = 0; index < end; index += 1) {
          if (buffer[index] !== 0x0a) continue
          newlineCount += 1
          if (newlineCount === limits.maxLines) {
            end = index + 1
            break
          }
        }

        end = trimUtf8End(buffer, end)
        const chunk = buffer.subarray(0, end)
        const nextOffset = offset + chunk.length
        return {
          text: chunk.toString('utf8'),
          bytes: chunk.length,
          lines: countBufferLines(chunk),
          nextOffset,
          eof: nextOffset >= stats.size,
        }
      } finally {
        await handle.close()
      }
    },

    /** 追加一条账本记录；记账失败不影响主流程。 */
    async appendLedger(entry) {
      if (!ledger) return
      try {
        await mkdir(dirname(ledgerPath), { recursive: true, mode: 0o700 })
        const handle = await open(ledgerPath, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND, 0o600)
        try {
          await handle.writeFile(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8')
        } finally {
          await handle.close()
        }
      } catch {
        // 账本是诊断材料，不是事实来源；写不进去就放弃这一条。
      }
    },
  }
}
