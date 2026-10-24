/**
 * 测试用的最小 Cordis 替身：只实现本插件用到的那部分契约
 * （tools.register/get/schemas/execute、on/emit、effect、agent scope 遮蔽）。
 *
 * 这不是 DSH 的复刻：工具管线的 pre-execute/守卫/审批不在这里，机制级测试直接调
 * 监听器或工具定义，验证的是插件自己的逻辑。
 */

function createLayer(primary, fallback, onChange) {
  return {
    register(definition) {
      if (primary.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`)
      primary.set(definition.name, definition)
      onChange?.()
      return () => {
        if (primary.get(definition.name) === definition) primary.delete(definition.name)
        onChange?.()
      }
    },
    get(toolName) {
      return primary.get(toolName) ?? fallback?.get(toolName)
    },
    schemas() {
      const names = new Set([...primary.keys(), ...(fallback?.keys() ?? [])])
      return [...names].map((toolName) => {
        const definition = primary.get(toolName) ?? fallback?.get(toolName)
        return { name: definition.name, description: definition.description, parameters: definition.parameters }
      })
    },
    async execute(input) {
      const definition = primary.get(input.name) ?? fallback?.get(input.name)
      if (definition === undefined) throw new Error(`unknown tool ${input.name}`)
      const exec = {
        callId: input.callId,
        rootCallId: input.rootCallId ?? input.callId,
        name: input.name,
        arguments: input.arguments,
        agent: input.agent,
        parent: input.parent,
        signal: input.signal ?? new AbortController().signal,
        deferContext() {},
        concludeTurn() {},
      }
      const value = await definition.execute(input.arguments, exec)
      let content = definition.output.render(input.arguments, value)
      // 真实管线在 post-execute 之后跑定义自带的 finalizeContent；替身也要走这一步。
      if (typeof definition.finalizeContent === 'function') {
        const finalized = definition.finalizeContent(exec, { isError: false, value, content })
        if (finalized !== undefined) content = finalized
      }
      return {
        isError: false,
        value,
        content,
        meta: definition.output.presentationMeta?.(input.arguments, value),
      }
    },
  }
}

export function createRootContext({ globalTools = [], workingDirectory = process.cwd() } = {}) {
  const globals = new Map(globalTools.map((tool) => [tool.name, tool]))
  const listeners = new Map()

  function on(event, callback) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event).add(callback)
    return () => listeners.get(event)?.delete(callback)
  }

  function emit(event, payload) {
    for (const callback of [...(listeners.get(event) ?? [])]) callback(payload)
  }

  const tools = createLayer(globals, undefined, () => emit('tools/change'))

  const context = {
    _globals: globals,
    tools,
    on,
    emit,
    effect(callback) {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    get(name) {
      if (name === 'workingDirectory') return { defaultDirectory: workingDirectory }
      return undefined
    },
    logger: { info() {}, warn() {} },
  }
  return context
}

/** 建一个 agent 及其 scoped context；scoped 注册遮蔽 root 的全局工具。 */
export function createAgentScope(root, id = 'agent-1') {
  const scoped = new Map()
  const disposers = []
  const listeners = new Map()

  function on(event, callback) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event).add(callback)
    return () => listeners.get(event)?.delete(callback)
  }

  const scope = {
    tools: createLayer(scoped, root._globals, () => root.emit('tools/change')),
    // 真实 Harness 按 scope 过滤派发；测试里只关心事件能到达，统一挂到 root 的监听表。
    on: root.on,
    emit,
    effect(callback) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    get(name) {
      return root.get(name)
    },
    logger: root.logger,
  }

  function emit(event, payload) {
    for (const callback of [...(listeners.get(event) ?? [])]) callback(payload)
  }

  function dispose() {
    while (disposers.length > 0) {
      const disposer = disposers.pop()
      try {
        disposer?.()
      } catch {
        // 测试替身不追究单项失败。
      }
    }
  }

  return { agent: { id, ctx: scope }, scope, dispose, scoped }
}

/** 构造一个 tools/post-execute 的 accept 决策，方便驱动监听器。 */
export function acceptDecision(content) {
  return content === undefined ? { kind: 'accept' } : { kind: 'accept', content }
}
