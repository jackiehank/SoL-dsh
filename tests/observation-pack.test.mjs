import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore, countLines, sha256 } from '../lib/store.js'
import {
  completeLineExcerpt,
  createObservation,
  createPostExecuteHandler,
  createRecallDefinition,
  placeholderFor,
  textOfContent,
} from '../lib/observation-pack.js'

const exec = Object.freeze({
  name: 'pwsh',
  callId: 'call-1',
  rootCallId: 'call-1',
  arguments: {},
  signal: new AbortController().signal,
})

async function tempStore(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sol-pi-obs-'))
  return { root, store: createStore({ root, ledger: options.ledger ?? false }) }
}

function textResult(text, isError = false) {
  return { isError, content: [{ type: 'text', text }], value: { ok: true } }
}

test('textOfContent 只接受纯文本块', () => {
  assert.equal(textOfContent([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb')
  assert.equal(textOfContent([{ type: 'image', data: 'x' }]), undefined)
  assert.equal(textOfContent([]), undefined)
  assert.equal(textOfContent(undefined), undefined)
})

test('observation id 稳定、可辨识，且不受无关字段影响', () => {
  const first = createObservation(exec, [{ type: 'text', text: 'x'.repeat(20000) }])
  const second = createObservation(exec, [{ type: 'text', text: 'x'.repeat(20000) }])
  const other = createObservation({ ...exec, callId: 'call-2' }, [{ type: 'text', text: 'x'.repeat(20000) }])
  assert.match(first.id, /^obs_[a-f0-9]{24}$/u)
  assert.equal(first.id, second.id)
  assert.notEqual(first.id, other.id)
  assert.equal(first.bytes, 20000)
  assert.equal(first.lines, 1)
})

test('占位符带 id、原始尺寸与首尾完整行', () => {
  const lines = [
    'HEAD-LINE-1 with some text',
    'HEAD-LINE-2 with some text',
    ...Array.from({ length: 40 }, (_, index) => `middle-${index}-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`),
    'TAIL-LINE-1 with some text',
  ]
  const text = lines.join('\n')
  const observation = createObservation(exec, [{ type: 'text', text }])
  const placeholder = placeholderFor(observation)
  assert.match(placeholder, /id: obs_[a-f0-9]{24}/u)
  assert.match(placeholder, new RegExp(`original_bytes: ${Buffer.byteLength(text, 'utf8')}`))
  assert.ok(placeholder.includes('HEAD-LINE-1'))
  assert.ok(placeholder.includes('TAIL-LINE-1'))
  assert.ok(!placeholder.includes('middle-20-'))
  assert.ok(placeholder.includes(`retrieve: call obs_recall with {"id":"${observation.id}","offset":0}`))
})

test('completeLineExcerpt 不切半行、严格遵守字节预算', () => {
  const text = 'aaaa\nbbbb\ncccc\ndddd\n'
  assert.equal(completeLineExcerpt(text, 10, false), 'aaaa\nbbbb\n')
  assert.equal(completeLineExcerpt(text, 10, true), 'cccc\ndddd\n')
  assert.equal(completeLineExcerpt(text, 4, false), '')
})

test('post-execute：大结果被换成占位符，原文逐字节归档，value 不动', async () => {
  const { root, store } = await tempStore()
  try {
    const handler = createPostExecuteHandler({ store, thresholdBytes: 64 })
    const big = `${Array.from({ length: 400 }, (_, index) => `line-${String(index).padStart(4, '0')}-${'x'.repeat(20)}`).join('\n')}\ntail-line`
    const result = textResult(big)
    const decision = await handler(exec, result, async () => ({ kind: 'accept' }))

    assert.equal(decision.kind, 'accept')
    assert.ok(!Object.hasOwn(decision, 'value'))
    const placeholder = decision.content[0].text
    assert.match(placeholder, /large tool result replaced/u)
    const id = /id: (obs_[a-f0-9]{24})/u.exec(placeholder)?.[1]
    assert.ok(id !== undefined)
    const stored = await readFile(join(store.objectsDir, `${id}.txt`), 'utf8')
    assert.equal(stored, big)

    // 原文不再整体出现在交给模型的内容里：占位符更短，中段行被省掉，首尾仍在。
    assert.ok(placeholder.length < big.length)
    assert.ok(placeholder.includes('line-0000-'))
    assert.ok(placeholder.includes('tail-line'))
    assert.ok(!placeholder.includes('line-0200-'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('post-execute：小结果、错误结果、回执、非文本都不动', async () => {
  const { root, store } = await tempStore()
  try {
    const handler = createPostExecuteHandler({ store, thresholdBytes: 64 })
    const accept = async () => ({ kind: 'accept' })

    const small = textResult('short')
    const smallDecision = await handler(exec, small, accept)
    assert.equal(smallDecision.kind, 'accept')
    assert.equal(smallDecision.content, undefined)

    const failed = textResult('x'.repeat(500), true)
    const failedDecision = await handler(exec, failed, accept)
    assert.equal(failedDecision.kind, 'accept')
    assert.equal(failedDecision.content, undefined)

    const receipt = textResult(`sol_pi_evidence_receipt_v1\n${'x'.repeat(500)}`)
    const receiptDecision = await handler(exec, receipt, accept)
    assert.equal(receiptDecision.content, undefined)

    const image = { isError: false, content: [{ type: 'image', data: 'x' }] }
    const imageDecision = await handler(exec, image, accept)
    assert.equal(imageDecision.content, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('post-execute：尊重更早的 block 决定与 value 替换', async () => {
  const { root, store } = await tempStore()
  try {
    const handler = createPostExecuteHandler({ store, thresholdBytes: 1 })
    const block = { kind: 'block', feedback: [{ type: 'text', text: 'no' }] }
    assert.equal(await handler(exec, textResult('x'.repeat(100)), async () => block), block)

    const replaced = { kind: 'accept', value: { replaced: true } }
    assert.equal(await handler(exec, textResult('x'.repeat(100)), async () => replaced), replaced)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('post-execute：归档写不进去时 fail-open，返回原决定', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sol-pi-obs-'))
  const blocker = join(root, 'not-a-directory')
  await writeFile(blocker, 'x', 'utf8')
  try {
    const store = createStore({ root: blocker, ledger: false })
    const handler = createPostExecuteHandler({ store, thresholdBytes: 1 })
    const decision = await handler(exec, textResult('y'.repeat(200)), async () => ({ kind: 'accept' }))
    assert.equal(decision.kind, 'accept')
    assert.equal(decision.content, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('obs_recall：分页拼接后与原文逐字节相等，UTF-8 不被切半', async () => {
  const { root, store } = await tempStore()
  try {
    const text = [
      '第一行：中文内容',
      'emoji 😀😀 and accents éèê',
      'x'.repeat(4000),
      '最后一行',
    ].join('\n')
    const id = `obs_${sha256('paging').slice(0, 24)}`
    await store.save(id, text, { bytes: Buffer.byteLength(text, 'utf8'), hash: sha256(text) })

    const recall = createRecallDefinition({ store, maxBytes: 2048, maxLines: 12 })
    let offset = 0
    let collected = ''
    let guard = 0
    for (;;) {
      const value = await recall.execute({ id, offset }, exec)
      assert.ok(Buffer.byteLength(value.header) + Buffer.byteLength(value.text) <= 2048)
      assert.ok(!value.text.includes('\uFFFD'))
      collected += value.text
      if (value.eof) break
      offset = value.nextOffset
      assert.ok(++guard < 100, '分页没有推进')
    }
    assert.equal(collected, text)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('obs_recall：未知 id、非法 id、越界 offset 都报错', async () => {
  const { root, store } = await tempStore()
  try {
    const recall = createRecallDefinition({ store })
    await assert.rejects(() => recall.execute({ id: `obs_${'f'.repeat(24)}` }, exec), /Unknown observation id/u)
    await assert.rejects(() => recall.execute({ id: '../escape' }, exec), /Unknown observation id/u)

    const id = `obs_${sha256('short').slice(0, 24)}`
    await store.save(id, 'short', { bytes: 5, hash: sha256('short') })
    await assert.rejects(() => recall.execute({ id, offset: 999 }, exec), /超过观测大小/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('展示层：obs_recall 的 presentationMeta 带字节/行数，且只在 meta 里（不进模型内容）', async () => {
  const { root, store } = await tempStore()
  try {
    const text = 'x'.repeat(3000)
    const id = `obs_${sha256('card').slice(0, 24)}`
    await store.save(id, text, { bytes: Buffer.byteLength(text, 'utf8'), hash: sha256(text) })
    const recall = createRecallDefinition({ store })
    const value = await recall.execute({ id }, exec)

    // 投影随结果持久化（客户端以 meta 收到），只给 UI 用
    const meta = recall.output.presentationMeta({}, value)
    assert.equal(meta.id, id)
    assert.equal(meta.bytes, 3000)
    assert.equal(meta.lines, value.lines)
    assert.equal(meta.eof, value.eof)

    // 模型看到的内容只有 header + 正文，没有额外展示文案
    const rendered = recall.output.render({}, value)
    assert.equal(rendered.length, 1)
    assert.equal(rendered[0].text, `${value.header}\n${value.text}`)

    // 卡片的 title 不在本机消费（present* 无消费者），因此工具定义里不再声明 presenter
    assert.equal(recall.presentCall, undefined)
    assert.equal(recall.presentResult, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('归档已存在：同内容复用，异内容报损坏（不是缓存命中）', async () => {
  const { root, store } = await tempStore()
  try {
    const id = `obs_${sha256('object').slice(0, 24)}`
    await store.save(id, 'content-A', { bytes: 9, hash: sha256('content-A') })
    await store.save(id, 'content-A', { bytes: 9, hash: sha256('content-A') })
    await assert.rejects(
      () => store.save(id, 'content-B', { bytes: 9, hash: sha256('content-B') }),
      /大小不一致|哈希不一致/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('countLines 与 store 分块行数一致', () => {
  assert.equal(countLines(''), 0)
  assert.equal(countLines('a'), 1)
  assert.equal(countLines('a\n'), 1)
  assert.equal(countLines('a\nb'), 2)
})
