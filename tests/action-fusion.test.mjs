import test from 'node:test'
import assert from 'node:assert/strict'
import {
  attachActionFusion,
  createCommandRunner,
  createFusedDefinition,
  normalizeThenRun,
  parseExitCode,
  THEN_RUN_FAILED,
  THEN_RUN_SKIPPED,
  THEN_RUN_SUCCEEDED,
  withBadge,
  withThenRun,
} from '../plugin/lib/action-fusion.js'
import { createAgentScope, createRootContext } from './helpers.mjs'

function makeExec(overrides = {}) {
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    name: 'edit',
    arguments: {},
    signal: new AbortController().signal,
    deferContext() {},
    concludeTurn() {},
    ...overrides,
  }
}

function makeBase(name = 'edit') {
  return {
    name,
    description: 'Edit an existing UTF-8 text file by replacing literal text.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        file_path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (args) => [{ type: 'text', text: `The file ${args.file_path} has been updated successfully.` }],
      presentationMeta: (args) => ({ path: args.file_path }),
    },
    async execute(args) {
      assert.equal(Object.hasOwn(args, 'then_run'), false, 'then_run must be stripped before delegating')
      return { path: args.file_path, before: 'a', after: 'b' }
    },
  }
}

test('then_run 参数：合并进内建 schema，不改变原有必填项', () => {
  const base = makeBase()
  const parameters = withThenRun(base.parameters)
  assert.deepEqual(parameters.required, ['file_path', 'old_string', 'new_string'])
  assert.equal(parameters.properties.file_path.type, 'string')
  assert.equal(parameters.properties.then_run.properties.command.type, 'string')
  assert.deepEqual(parameters.properties.then_run.required, ['command'])
  // 原 schema 不被修改
  assert.equal(Object.hasOwn(base.parameters.properties, 'then_run'), false)
})

test('normalizeThenRun：缺省、秒转毫秒、非法值', () => {
  assert.equal(normalizeThenRun(undefined), undefined)
  assert.deepEqual(normalizeThenRun({ command: 'npm test', timeout: 30 }), {
    command: 'npm test',
    timeoutMs: 30_000,
    workdir: undefined,
    description: undefined,
  })
  assert.equal(normalizeThenRun({ command: 'x', timeoutMs: 500 }).timeoutMs, 500)
  assert.throws(() => normalizeThenRun({ command: '' }), /non-empty string/u)
  assert.throws(() => normalizeThenRun({ command: 'x', timeout: -1 }), /positive number of seconds/u)
  assert.throws(() => normalizeThenRun({ command: 'x', workdir: '' }), /workdir/u)
  assert.throws(() => normalizeThenRun('npm test'), /must be an object/u)
})

test('parseExitCode 读 DSH 的退出码标记', () => {
  assert.equal(parseExitCode('out\n[exit code: 0]'), 0)
  assert.equal(parseExitCode('boom\n[exit code: 1]'), 1)
  assert.equal(parseExitCode('no marker'), undefined)
  assert.equal(parseExitCode(undefined), undefined)
})

test('成功路径：编辑结果 + 命令输出在一次调用里，标记 succeeded', async () => {
  const base = makeBase()
  const definition = createFusedDefinition({
    name: 'edit',
    base,
    runCommand: async () => ({ failed: false, text: '3 passed\n[exit code: 0]' }),
  })
  const exec = makeExec()
  const value = await definition.execute(
    { file_path: 'a.txt', old_string: 'a', new_string: 'b', then_run: { command: 'npm test' } },
    exec,
  )
  assert.deepEqual(value, { path: 'a.txt', before: 'a', after: 'b' })
  assert.match(definition.description, /then_run/u)

  const content = definition.finalizeContent(exec, { content: base.output.render({ file_path: 'a.txt' }), isError: false })
  assert.equal(content.length, 2)
  assert.match(content[0].text, /updated successfully/u)
  assert.ok(content[1].text.startsWith(THEN_RUN_SUCCEEDED))
  assert.match(content[1].text, /3 passed/u)
  // 同一 exec 只追加一次
  assert.equal(definition.finalizeContent(exec, { content: [], isError: false }), undefined)
})

test('没有 then_run 时完全是内建行为', async () => {
  const base = makeBase()
  const definition = createFusedDefinition({ name: 'edit', base, runCommand: async () => ({ failed: false, text: 'x' }) })
  const exec = makeExec()
  await definition.execute({ file_path: 'a.txt', old_string: 'a', new_string: 'b' }, exec)
  assert.equal(definition.finalizeContent(exec, { content: [], isError: false }), undefined)
})

test('编辑失败：命令被跳过，错误里带 skipped 标记', async () => {
  const base = makeBase()
  base.execute = async () => {
    throw new Error('old_string not found')
  }
  const definition = createFusedDefinition({ name: 'edit', base, runCommand: async () => ({ failed: false, text: '' }) })
  await assert.rejects(
    () => definition.execute({ file_path: 'a.txt', then_run: { command: 'npm test' } }, makeExec()),
    (error) => {
      assert.match(error.message, /old_string not found/u)
      assert.match(error.message, new RegExp(escapeRegExp(THEN_RUN_SKIPPED)))
      return true
    },
  )
})

test('编辑失败且没有 then_run：原错误透传，不额外包装', async () => {
  const base = makeBase()
  base.execute = async () => {
    throw new Error('boom')
  }
  const definition = createFusedDefinition({ name: 'edit', base, runCommand: async () => ({ failed: false, text: '' }) })
  await assert.rejects(() => definition.execute({ file_path: 'a.txt' }, makeExec()), /^Error: boom$/u)
})

test('命令失败：编辑不回滚、不标失败，只追加 failed 标记与输出', async () => {
  const base = makeBase()
  const definition = createFusedDefinition({
    name: 'edit',
    base,
    runCommand: async () => ({ failed: true, text: 'FAIL src/a.test.ts\n[exit code: 1]' }),
  })
  const exec = makeExec()
  const value = await definition.execute({ file_path: 'a.txt', then_run: { command: 'npm test' } }, exec)
  assert.deepEqual(value, { path: 'a.txt', before: 'a', after: 'b' })
  const content = definition.finalizeContent(exec, { content: base.output.render({ file_path: 'a.txt' }), isError: false })
  assert.ok(content[1].text.startsWith(THEN_RUN_FAILED))
  assert.match(content[1].text, /exit code: 1/u)
})

test('命令执行器抛错：转成 failed 报告，编辑结果保留', async () => {
  const base = makeBase()
  const definition = createFusedDefinition({
    name: 'edit',
    base,
    runCommand: async () => {
      throw new Error('approval denied')
    },
  })
  const exec = makeExec()
  await definition.execute({ file_path: 'a.txt', then_run: { command: 'rm -rf /' } }, exec)
  const content = definition.finalizeContent(exec, { content: [], isError: false })
  assert.match(content[0].text, /approval denied/u)
  assert.ok(content[0].text.startsWith(THEN_RUN_FAILED))
})

test('输出 schema / 呈现委托给内建定义', async () => {
  const base = makeBase()
  const definition = createFusedDefinition({ name: 'edit', base, runCommand: async () => ({ failed: false, text: '' }) })
  assert.equal(definition.output.schema, base.output.schema)
  assert.deepEqual(definition.output.render({ file_path: 'z' }, { path: 'z' }), base.output.render({ file_path: 'z' }))
  assert.deepEqual(definition.output.presentationMeta({ file_path: 'z' }, { path: 'z' }), { path: 'z' })
  assert.equal(definition.timeoutMs, undefined)
})

test('createCommandRunner：走 pwsh 工具并按其 schema 过滤参数', async () => {
  const calls = []
  const pwsh = {
    name: 'pwsh',
    description: 'shell',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        command: { type: 'string' },
        description: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
      required: ['command', 'description'],
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: () => [] },
    async execute(args) {
      calls.push(args)
      return { exitCode: 0 }
    },
  }
  const root = createRootContext({ globalTools: [pwsh] })
  const runner = createCommandRunner(root)
  const outcome = await runner(makeExec(), { command: 'npm test', timeoutMs: 1234, description: 'run tests' })
  assert.equal(outcome.failed, false)
  assert.deepEqual(calls[0], { command: 'npm test', description: 'run tests', timeoutMs: 1234 })
})

test('createCommandRunner：没有 shell 工具时报错，而不是静默不跑', async () => {
  const root = createRootContext({ globalTools: [] })
  const runner = createCommandRunner(root)
  await assert.rejects(() => runner(makeExec(), { command: 'x' }), /no shell tool/u)
})

test('agent scope 遮蔽：全局仍是内建，scoped 是带 then_run 的融合版', async () => {
  const pwsh = {
    name: 'pwsh',
    description: 'shell',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { command: { type: 'string' }, description: { type: 'string' } },
      required: ['command', 'description'],
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: () => [] },
    async execute() {
      return { exitCode: 0 }
    },
  }
  const root = createRootContext({ globalTools: [makeBase('edit'), pwsh] })
  const { agent, scope, dispose } = createAgentScope(root)
  try {
    attachActionFusion(root, {})
    root.emit('agent/created', { agent, source: 'test' })

    const scopedEdit = scope.tools.get('edit')
    assert.ok(scopedEdit !== undefined)
    assert.ok(Object.hasOwn(scopedEdit.parameters.properties, 'then_run'))
    assert.equal(Object.hasOwn(root.tools.get('edit').parameters.properties, 'then_run'), false)

    const result = await scope.tools.execute({
      callId: 'c9',
      name: 'edit',
      arguments: { file_path: 'a.txt', old_string: 'a', new_string: 'b', then_run: { command: 'npm test' } },
      agent,
    })
    assert.equal(result.isError, false)
    // 假 shell 没有输出：命令报告只有状态标记。
    assert.equal(result.content[1]?.text, THEN_RUN_SUCCEEDED)
  } finally {
    dispose()
  }
})

test('全局工具晚于本插件注册时，靠 tools/change 补装遮蔽', async () => {
  const root = createRootContext({ globalTools: [] })
  const { agent, scope, dispose } = createAgentScope(root)
  try {
    attachActionFusion(root, {})
    root.emit('agent/created', { agent, source: 'test' })
    assert.equal(scope.tools.get('edit'), undefined)

    root.tools.register(makeBase('edit'))
    const scopedEdit = scope.tools.get('edit')
    assert.ok(scopedEdit !== undefined)
    assert.ok(Object.hasOwn(scopedEdit.parameters.properties, 'then_run'))
  } finally {
    dispose()
  }
})

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

test('基线工具只挂在 agent scope 时也要装得上（不能只看全局视图）', () => {
  const root = createRootContext({ globalTools: [] })
  const { agent, scope, preset, dispose } = createAgentScope(root)
  try {
    // 复刻真实布局：内建 edit 注册在 agent preset 的层里，全局层没有它。
    preset.register(makeBase('edit'))
    attachActionFusion(root, {})
    root.emit('agent/created', { agent, source: 'test' })

    assert.equal(root.tools.get('edit'), undefined)
    const scopedEdit = scope.tools.get('edit')
    assert.ok(scopedEdit !== undefined)
    assert.ok(Object.hasOwn(scopedEdit.parameters.properties, 'then_run'))
  } finally {
    dispose()
  }
})

test('展示层：融合徽标只加在 presentCall/presentResult，失败调用不给', () => {
  const diff = () => ({
    card: 'diff',
    title: 'Edit a.txt',
    diffs: [{ path: 'a.txt', oldText: 'a', newText: 'b' }],
  })
  const withPresenters = { ...makeBase(), presentCall: diff, presentResult: diff }
  const definition = createFusedDefinition({
    name: 'edit',
    base: withPresenters,
    runCommand: async () => ({ failed: false, text: '' }),
  })

  // 没有 then_run：原生渲染意图原样透传（diff 卡、标题都不动）
  assert.deepEqual(definition.presentCall({ file_path: 'a.txt' }), diff())

  // 有 then_run：标题追加徽标，card 与 diffs 保持不变
  const callView = definition.presentCall({ file_path: 'a.txt', then_run: { command: 'npm test' } })
  assert.equal(callView.card, 'diff')
  assert.match(callView.title, /⚡ 融合/u)
  assert.deepEqual(callView.diffs, diff().diffs)

  const okView = definition.presentResult(
    { file_path: 'a.txt', then_run: { command: 'npm test' } },
    { content: [], isError: false },
  )
  assert.match(okView.title, /⚡ 融合/u)

  // 命令失败不算省下往返，和上游一样不显示横幅
  const failedView = definition.presentResult(
    { file_path: 'a.txt', then_run: { command: 'npm test' } },
    { content: [], isError: true },
  )
  assert.equal(failedView.title, 'Edit a.txt')
})

test('展示层：基线没有 presenter 时不凭空造卡片', () => {
  const definition = createFusedDefinition({ name: 'edit', base: makeBase(), runCommand: async () => ({ failed: false, text: '' }) })
  assert.equal(definition.presentCall, undefined)
  assert.equal(definition.presentResult, undefined)
})

test('withBadge：缺卡片或缺徽标时原样返回，空标题用徽标兜底', () => {
  assert.equal(withBadge(undefined, '⚡'), undefined)
  assert.equal(withBadge(null, '⚡'), null)
  const view = { card: 'generic', title: '' }
  assert.equal(withBadge(view, undefined), view)
  assert.deepEqual(withBadge(view, '⚡'), { card: 'generic', title: '⚡' })
})


