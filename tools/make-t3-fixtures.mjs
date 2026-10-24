#!/usr/bin/env node
/**
 * T3（ObservationPack 长会话实验）素材生成器 —— 确定性，重复运行产生同样字节。
 *
 * 产出：
 *   .tmp/efficacy/t3/data.json          约 100 KB；第 7 条含 VALUE=7K9，末行 TRAILER=OK-42
 *   .tmp/efficacy/t3/parts/p1..p8.txt   8 个小文件（用于制造后续独立请求）
 *
 * 设计约束：VALUE 必须落在文件前 512 字节内、TRAILER 必须落在最后 512 字节内——
 * ObservationPack 的占位符只摘录首/尾各 512 字节完整行，这样实验不强制 obs_recall。
 *
 * 用法：node tools/make-t3-fixtures.mjs [--root <目录>]
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const argIndex = process.argv.indexOf('--root')
const root = argIndex === -1 ? '.tmp/efficacy/t3' : process.argv[argIndex + 1]

mkdirSync(join(root, 'parts'), { recursive: true })

const lines = []
for (let index = 1; index <= 4000; index += 1) {
  lines.push(index === 7
    ? JSON.stringify({ i: index, needed: 'VALUE=7K9' })
    : JSON.stringify({ i: index, v: 'x'.repeat(8) }))
}
lines.push('TRAILER=OK-42')
const data = `${lines.join('\n')}\n`
writeFileSync(join(root, 'data.json'), data)

const sha256 = []
for (let index = 1; index <= 8; index += 1) {
  const content = `part ${index}: ${'p'.repeat(100)}\n`
  writeFileSync(join(root, `parts/p${index}.txt`), content)
  sha256.push(createHash('sha256').update(content).digest('hex').toUpperCase())
}

const expected = { value: '7K9', trailer: 'OK-42', sha256 }
const checks = {
  bytes: Buffer.byteLength(data),
  valueInHead: data.slice(0, 512).includes('VALUE=7K9'),
  trailerInTail: data.slice(-512).includes('TRAILER=OK-42'),
}
writeFileSync(join(root, 'expected.json'), `${JSON.stringify({ ...checks, expected }, null, 2)}\n`)
console.log(JSON.stringify({ ...checks, expected }, null, 1))
if (!checks.valueInHead || !checks.trailerInTail) process.exitCode = 1
