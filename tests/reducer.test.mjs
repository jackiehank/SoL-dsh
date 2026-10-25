import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  candidateOf,
  createArchive,
  createReducerHandler,
  lineNumberOf,
  MAX_EVIDENCE_ITEMS,
  RECEIPT_SCHEMA,
  reducerInstructions,
  sha256,
  stripCodeFence,
  validateReceipt,
} from '../lib/reducer.js'
import { resolveConfig } from '../lib/config.js'

const BODY = [
  'go test ./...',
  ...Array.from({ length: 30 }, (_, index) => `ok   example.com/pkg${index}  0.0${index % 10}s`),
  '--- FAIL: TestLogin (0.02s)',
  '    login_test.go:42: unexpected token 拒绝: 中文与 emoji 😀',
  'FAIL',
  'exit status 1',
].join('\n')
const FAIL_LINE = lineNumberOf(BODY, '--- FAIL: TestLogin (0.02s)')

function archiveFor(body) {
  return { hash: sha256(body), bytes: Buffer.byteLength(body, 'utf8'), lines: 6, path: 'C:/tmp/archive.txt' }
}

function receipt(overrides = {}) {
  return JSON.stringify({
    schema: RECEIPT_SCHEMA,
    source_sha256: sha256(BODY),
    status: 'failure',
    uncertain: false,
    evidence: [{ kind: 'fatal', quote: '--- FAIL: TestLogin (0.02s)' }],
    ...overrides,
  })
}

function validate(raw, body = BODY, isError = true) {
  return validateReceipt(raw, archiveFor(body), body, isError)
}

test('candidateOf：pwsh 的退出标记是唯一真源，没有标记时退回 isError', () => {
  const exec = { name: 'pwsh', arguments: { command: 'go test ./...' } }
  const ok = candidateOf(exec, { isError: false }, [{ type: 'text', text: 'ok [exit code: 0]' }])
  assert.deepEqual([ok.command, ok.exitFailed], ['go test ./...', false])

  const failed = candidateOf(exec, { isError: false }, [{ type: 'text', text: 'boom [exit code: 1]' }])
  assert.equal(failed.exitFailed, true)

  const noMarker = candidateOf(exec, { isError: true }, [{ type: 'text', text: 'no marker here' }])
  assert.equal(noMarker.exitFailed, true)

  assert.equal(candidateOf(exec, { isError: false }, [{ type: 'text', text: 'no marker' }]), undefined)
  assert.equal(candidateOf({ name: 'edit', arguments: {} }, {}, [{ type: 'text', text: 'x' }]), undefined)
  assert.equal(candidateOf({ name: 'pwsh', arguments: {} }, {}, [{ type: 'text', text: 'x' }]), undefined)
  assert.equal(candidateOf(exec, {}, [{ type: 'image', data: 'x' }]), undefined)
})

test('validateReceipt：正例，跨行/CJK/emoji/首尾行都通过并给出正确行号', () => {
  const body = BODY
  const multi = 'ok   example.com/pkg10  0.00s\nok   example.com/pkg11  0.01s'
  const raw = JSON.stringify({
    schema: RECEIPT_SCHEMA,
    source_sha256: sha256(body),
    status: 'failure',
    uncertain: true,
    evidence: [
      { kind: 'fatal', quote: 'unexpected token 拒绝: 中文与 emoji 😀' },
      { kind: 'failure', quote: multi },
      { kind: 'summary', quote: 'go test ./...' },
      { kind: 'warning', quote: 'exit status 1' },
    ],
  })
  const result = validateReceipt(raw, archiveFor(body), body, true)
  assert.equal(result.ok, true)
  assert.equal(result.value.evidence.length, 4)
  assert.equal(result.value.evidence[0].line, lineNumberOf(body, 'unexpected token 拒绝: 中文与 emoji 😀'))
  assert.equal(result.value.evidence[1].line, lineNumberOf(body, multi))
  assert.equal(result.value.evidence[2].line, 1)
  assert.equal(result.value.evidence[3].line, lineNumberOf(body, 'exit status 1'))
  assert.equal(result.value.evidence[0].quoteSha256, sha256('unexpected token 拒绝: 中文与 emoji 😀'))
})

test('validateReceipt：元数据与结构负例', () => {
  assert.equal(validate('not json').reason, 'invalid-json')
  assert.equal(validate(receipt({ schema: 'other/1' })).reason, 'schema-mismatch')
  assert.equal(validate(receipt({ source_sha256: 'deadbeef' })).reason, 'schema-mismatch')
  assert.equal(validate(receipt({ status: 'success' })).reason, 'schema-mismatch')
  assert.equal(validate(receipt({ uncertain: 'false' })).reason, 'schema-mismatch')
  assert.equal(validate(receipt({ evidence: 'nope' })).reason, 'schema-mismatch')
  const tooMany = Array.from({ length: MAX_EVIDENCE_ITEMS + 1 }, () => ({ kind: 'summary', quote: 'FAIL' }))
  assert.equal(validate(receipt({ evidence: tooMany })).reason, 'schema-mismatch')
  assert.equal(validate('[]').reason, 'schema-mismatch')
})

test('validateReceipt：引文逐字匹配才是硬约束（空白/大小写/归一化/拆分都拒绝）', () => {
  const cases = [
    { kind: 'fatal', quote: '---FAIL: TestLogin (0.02s)' },
    { kind: 'fatal', quote: '--- FAIL: TestLogin (0.02s) ' },
    { kind: 'fatal', quote: '--- fail: TestLogin (0.02s)' },
    { kind: 'fatal', quote: '--- FAIL: TestLogin\n(0.02s)' },
    { kind: 'fatal', quote: '--- FAIL: TestLogin (0.02s)  ' },
    { kind: 'fatal', quote: '' },
    { kind: 'fatal', quote: 'x'.repeat(601) },
    { kind: 'bogus', quote: 'FAIL' },
  ]
  for (const item of cases) {
    assert.equal(validate(receipt({ evidence: [item] })).reason, 'unverifiable-quote', JSON.stringify(item))
  }

  // NFC/NFD 也不能被当作同一串引文。
  const body = 'café failed'
  const nfd = 'cafe\u0301 failed'
  const raw = JSON.stringify({
    schema: RECEIPT_SCHEMA,
    source_sha256: sha256(body),
    status: 'failure',
    uncertain: false,
    evidence: [{ kind: 'failure', quote: nfd }],
  })
  const result = validateReceipt(raw, archiveFor(body), body, true)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'unverifiable-quote')
})

test('validateReceipt：失败日志必须带 failure 证据；重复引文只留第一条', () => {
  const failingBody = 'build failed\nnote: something went wrong\n'
  const raw = JSON.stringify({
    schema: RECEIPT_SCHEMA,
    source_sha256: sha256(failingBody),
    status: 'failure',
    uncertain: false,
    evidence: [{ kind: 'summary', quote: 'note: something went wrong' }],
  })
  const noFailure = validateReceipt(raw, archiveFor(failingBody), failingBody, true)
  assert.equal(noFailure.reason, 'missing-failure-evidence')

  const dup = validate(receipt({
    evidence: [
      { kind: 'fatal', quote: '--- FAIL: TestLogin (0.02s)' },
      { kind: 'fatal', quote: '--- FAIL: TestLogin (0.02s)' },
    ],
  }))
  assert.equal(dup.ok, true)
  assert.equal(dup.value.evidence.length, 1)
})

test('lineNumberOf：按首个匹配位置数行', () => {
  assert.equal(lineNumberOf('a\nb\nc', 'c'), 3)
  assert.equal(lineNumberOf('a\nb\nc', 'zzz'), undefined)
  assert.equal(lineNumberOf('a\r\nb', 'b'), 2)
})

test('reducerInstructions 明确“不可信数据”与逐字引文', () => {
  const text = reducerInstructions()
  assert.match(text, /untrusted data/u)
  assert.match(text, /byte-for-byte/u)
  assert.match(text, /schema must equal sol-pi-evidence-receipt\/1/u)
})

function fakeLlm(raw, { finish = 'stop' } = {}) {
  return {
    prepareCall: async () => ({
      stream: () => (async function* stream() {
        yield { type: 'text-delta', index: 0, text: raw }
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }
        yield { type: 'finish', reason: { kind: finish } }
      })(),
    }),
  }
}

function makeHandler({ config, llmRaw, finish = 'stop', route = { provider: 'test', model: 'm' } }) {
  const archive = createArchive(config.storageRoot)
  const ctx = { get: (name) => (name === 'llm' ? fakeLlm(llmRaw, { finish }) : undefined) }
  return createReducerHandler({ ctx, config, route, archive })
}

function resultFor(body, isError = false) {
  return { isError, content: [{ type: 'text', text: body }] }
}

function execFor(command, extra = {}) {
  return {
    name: 'pwsh',
    callId: 'call-1',
    arguments: { command },
    signal: new AbortController().signal,
    parent: undefined,
    ...extra,
  }
}

test('handler：可校验回执替换原文，原文进归档，账本记录 applied', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sol-pi-reducer-'))
  try {
    const config = { ...resolveConfig({ evidencePreservingReducer: true }), reducerProvider: 'test', reducerModel: 'm', reducerMinBytes: 16, storageRoot: root }
    const handler = makeHandler({ config, llmRaw: receipt() })
    const decision = await handler(execFor('go test ./...'), resultFor(BODY, true), async () => ({ kind: 'accept' }))

    assert.equal(decision.kind, 'accept')
    const text = decision.content[0].text
    assert.ok(text.startsWith('sol_pi_evidence_receipt_v1'))
    assert.match(text, /source_sha256=/u)
    assert.match(text, /source_artifact=/u)
    assert.match(text, new RegExp(`- kind=fatal line=${FAIL_LINE}`))

    const artifact = /source_artifact=(.+)/u.exec(text)[1].trim()
    assert.equal((await readFile(artifact, 'utf8')), BODY)
    const ledger = await readFile(join(root, 'evidence-preserving-reducer', 'ledger.jsonl'), 'utf8')
    assert.match(ledger, /"event":"candidate"/u)
    assert.match(ledger, /"event":"applied"/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('handler：引文不匹配、模型失败、非诊断命令、太小、疑似密钥都保留原文', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sol-pi-reducer-'))
  try {
    const config = { ...resolveConfig({ evidencePreservingReducer: true }), reducerProvider: 'test', reducerModel: 'm', reducerMinBytes: 16, storageRoot: root }
    const mismatch = receipt({ evidence: [{ kind: 'fatal', quote: 'FAIL: NotThere' }] })
    const plain = resultFor(BODY, true)
    const accept = async () => ({ kind: 'accept' })

    const wrongQuote = await makeHandler({ config, llmRaw: mismatch })(execFor('go test ./...'), plain, accept)
    assert.equal(wrongQuote.content, undefined)

    const llmError = await makeHandler({ config, llmRaw: receipt(), finish: 'error' })(execFor('go test ./...'), plain, accept)
    assert.equal(llmError.content, undefined)

    const notDiagnostic = await makeHandler({ config, llmRaw: receipt() })(execFor('ls -la'), plain, accept)
    assert.equal(notDiagnostic.content, undefined)

    const tooSmall = await makeHandler({ config, llmRaw: receipt() })(execFor('go test ./...'), resultFor('ok', false), accept)
    assert.equal(tooSmall.content, undefined)

    const secretBody = `${BODY}\nAPI_KEY=sk-live-1234567890`
    const secret = await makeHandler({ config, llmRaw: receipt() })(execFor('go test ./...'), resultFor(secretBody, true), accept)
    assert.equal(secret.content, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('handler：嵌套调用与“回执不比原文小”不替换', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sol-pi-reducer-'))
  try {
    const config = { ...resolveConfig({ evidencePreservingReducer: true }), reducerProvider: 'test', reducerModel: 'm', reducerMinBytes: 1, storageRoot: root }
    const accept = async () => ({ kind: 'accept' })

    const nested = await makeHandler({ config, llmRaw: receipt() })(
      execFor('go test ./...', { parent: Symbol('parent') }),
      resultFor(BODY, true),
      accept,
    )
    assert.equal(nested.content, undefined)

    const tinyBody = 'FAIL'
    const raw = JSON.stringify({
      schema: RECEIPT_SCHEMA,
      source_sha256: sha256(tinyBody),
      status: 'failure',
      uncertain: false,
      evidence: [{ kind: 'fatal', quote: 'FAIL' }],
    })
    const notSmaller = await makeHandler({ config, llmRaw: raw })(execFor('go test ./...'), resultFor(tinyBody, true), accept)
    assert.equal(notSmaller.content, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('archive：同内容复用，异内容同路径报完整性错误', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sol-pi-reducer-'))
  try {
    const archive = createArchive(root)
    const first = await archive.save(BODY)
    const second = await archive.save(BODY)
    assert.equal(first.hash, second.hash)
    assert.equal(await readFile(first.path, 'utf8'), BODY)
    assert.equal(first.bytes, Buffer.byteLength(BODY, 'utf8'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})



test('stripCodeFence：剥掉 Markdown 围栏，但 JSON 与逐字引文的约束不变', () => {
  assert.equal(stripCodeFence('```json\n{"a":1}\n```'), '{"a":1}')
  assert.equal(stripCodeFence('```\n{"a":1}\n```'), '{"a":1}')
  assert.equal(stripCodeFence('  {"a":1}  '), '{"a":1}')
  assert.equal(stripCodeFence('```json\n{"a":1}'), '{"a":1}')
})
