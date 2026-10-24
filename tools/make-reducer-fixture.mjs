#!/usr/bin/env node
/**
 * Reducer 实验素材（真实形态）：生成 >4 KiB 的构建日志 + 一个会失败的 python unittest 包装。
 *
 * 与 t4 的“80 行重复 nnn…”不同：这里每行长度不同、失败行短且唯一，
 * 用来判断之前的 `unverifiable-quote` 是否被合成日志放大。
 *
 * 用法：node tools/make-reducer-fixture.mjs [--root <目录>]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const argIndex = process.argv.indexOf('--root')
const root = argIndex === -1 ? '.tmp/efficacy/t5' : process.argv[argIndex + 1]
mkdirSync(root, { recursive: true })

const lines = ['module build output (realistic fixture)']
for (let index = 0; index < 90; index += 1) {
  const suffix = index % 3 === 0 ? ' (cached)' : index % 3 === 1 ? '' : ' — retrying once'
  lines.push(`ok ${index + 1} - src/modules/mod${String(index).padStart(3, '0')}.test.ts${suffix}`)
  if (index % 7 === 0) lines.push(`#   duration_ms: ${12 + (index % 9)}.${index}`)
}
lines.push(
  'not ok 91 - auth/login rejects expired tokens',
  '  ---',
  '  error: FAIL src/auth/login.test.ts:42: token expired after 3 retries',
  '  expected: 401',
  '  actual: 500',
  '  ...',
  '1..91',
  '# tests 91',
  '# pass 90',
  '# fail 1',
  'FAILED (failures=1)',
)

const text = `${lines.join('\n')}\n`
writeFileSync(join(root, 'build.log'), text)

const py = [
  'import unittest',
  '',
  'class BuildTests(unittest.TestCase):',
  '    def test_build(self):',
  `        print("""${text}""")`,
  "        self.fail('FAIL src/auth/login.test.ts:42: token expired after 3 retries')",
  '',
  "if __name__ == '__main__':",
  '    unittest.main()',
  '',
].join('\n')
writeFileSync(join(root, 'test_build.py'), py)

console.log(JSON.stringify({
  bytes: Buffer.byteLength(text),
  failure: 'error: FAIL src/auth/login.test.ts:42: token expired after 3 retries',
}))
if (Buffer.byteLength(text) < 4097) process.exitCode = 1
