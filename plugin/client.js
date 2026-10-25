/**
 * SoL-dsh 的 Client 半：在每轮结束处加一行“这轮省了什么”。
 *
 * 只占 `conversation.chat.turnTail`（list、replaceRisk none），不覆盖任何内置卡；
 * 四个计数全部为 0 时整条不渲染，所以默认是安静的。
 *
 * 数据来源是会话快照里已经存在的字面量标记（机制本来就会写进结果文本）：
 * - `[then_run:succeeded]`：Action Fusion 真的把后续命令跑成功了；
 * - `[large tool result replaced before it entered the context]`：ObservationPack 换了句柄；
 * - `sol_pi_evidence_receipt_v1`：Reducer 用回执替换了长日志；
 * - `kind === 'compaction'` 的节点：DSH 原生压缩（含我们的完成边界压缩）。
 *
 * 读这些标记不产生任何模型 token，也不需要 Host→Client 的新通道。
 */

window.__ModuleLoader__.load({
  id: '@local/sol-dsh',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'sol-dsh'
    const FUSION_MARK = '[then_run:succeeded]'
    const PACK_MARK = '[large tool result replaced before it entered the context]'
    const RECEIPT_MARK = 'sol_pi_evidence_receipt_v1'

    /** 结果节点的文本拼接（只读）。 */
    /**
     * 结果节点的文本拼接（只读）。
     *
     * 注意：会话快照里的内容块用 `kind` 判别（ui-chat 自己的渲染器就写 `block.kind === "text"`），
     * 而宿主侧的工具结果是 `type`。两种形状都接受，免得在浏览器里恒为空。
     */
    function textOf(node) {
      const content = node?.content
      if (!Array.isArray(content)) return ''
      let out = ''
      for (const block of content) {
        if (block === null || typeof block !== 'object') continue
        const isText = block.kind === 'text' || block.type === 'text'
        if (isText && typeof block.text === 'string') out += `${block.text}\n`
      }
      return out
    }

    /**
     * 一轮里的四类事件计数。
     *
     * 关键形状：Chat 快照里的工具节点是 `kind: 'tool-call'`，真正的结果在 `data.root` 里
     * （`ToolCallBlock` 联合：运行中是 RunningToolCall，落定后是 `kind: 'tool-result'`）。
     * 没有 `tool-result` 这一层级的 Chat 节点，所以必须从 `data.root` 往下找。
     */
    function countsOf(keys, nodes) {
      const counts = { fusion: 0, pack: 0, receipt: 0, compact: 0 }
      const countText = (text) => {
        if (text.includes(FUSION_MARK)) counts.fusion += 1
        if (text.includes(PACK_MARK)) counts.pack += 1
        if (text.includes(RECEIPT_MARK)) counts.receipt += 1
      }
      const walk = (block) => {
        if (block === null || typeof block !== 'object') return
        if (block.kind === 'tool-result') {
          countText(textOf(block))
          for (const sub of Array.isArray(block.subCalls) ? block.subCalls : []) walk(sub)
        }
      }
      for (const key of keys) {
        const node = nodes.get(key)
        if (node === undefined) continue
        if (node.kind === 'compaction' || node.kind === 'manual-compaction') {
          counts.compact += 1
          continue
        }
        if (node.kind !== 'tool-call') continue
        walk(node.data?.root)
      }
      return counts
    }

    function formatFallback(counts) {
      return `⚡ 融合 ${counts.fusion} · 收纳 ${counts.pack} · 回执 ${counts.receipt} · 压缩 ${counts.compact}`
    }

    /** 调试开关：`localStorage['sol-dsh:debug'] = '1'` 时零命中轮次也渲染一行，用来确认插件是否加载。 */
    function debugEnabled() {
      try {
        return window.localStorage.getItem('sol-dsh:debug') === '1'
      } catch {
        return false
      }
    }

    function TailRow(props) {
      const { turn, useChat, t, matched } = props
      const owner = matched ?? props
      const turnNo = typeof turn?.turn === 'number' ? turn.turn : owner?.turn?.turn
      const debug = debugEnabled()
      let counts = { fusion: 0, pack: 0, receipt: 0, compact: 0 }
      let counted = false
      // list 座位的 owner 直接给 turn；标准 props 里带 useChat。
      if (typeof useChat === 'function' && typeof turnNo === 'number') {
        try {
          const locations = useChat((snapshot) => snapshot.locations)
          const nodes = useChat((snapshot) => snapshot.nodes)
          const keys = locations.getTurn(turnNo)
          counts = countsOf(keys, nodes)
          counted = true
          if (debug) {
            // 排障：把这一轮的节点形状打到控制台，一眼能看出是“没节点”还是“节点形状不对”。
            const kinds = keys.map((key) => {
              const node = nodes.get(key)
              return node === undefined ? 'undefined' : node.kind
            })
            console.debug('[sol-dsh] turn', turnNo, 'keys', keys.length, 'kinds', kinds.join(',') || '(none)')
          }
        } catch (error) {
          counted = false
          if (debug) console.debug('[sol-dsh] count failed', error)
        }
      }
      const total = counts.fusion + counts.pack + counts.receipt + counts.compact
      if (total === 0 && !debug) return null

      let label
      if (total === 0) {
        label = counted ? '⚡ sol-dsh 已加载（本轮无机制命中）' : '⚡ sol-dsh 已加载（读不到会话快照）'
      } else {
        label = typeof t === 'function' ? t('tail', counts) : formatFallback(counts)
      }
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '2px 0',
            fontSize: '12px',
            lineHeight: '18px',
            color: 'var(--dsw-alias-label-tertiary)',
            userSelect: 'none',
          },
          title: label,
        },
        label,
      )
    }

    /**
     * 排障用座位：`conversation.composer.dock` 是模板里验证过的 list 座位。
     * 只在调试开关打开时渲染一行，用来区分“Client 半没加载”和“turnTail 座位没注册上”。
     */
    function DebugDock() {
      if (!debugEnabled()) return null
      return h(
        'div',
        { style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' } },
        '⚡ sol-dsh 客户端已加载（debug）',
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, {
          zh: { tail: '⚡ 本轮：融合 {fusion} · 收纳 {pack} · 回执 {receipt} · 压缩 {compact}' },
          en: { tail: '⚡ this turn: fused {fusion} · packed {pack} · receipts {receipt} · compacted {compact}' },
        }), 'sol-dsh: turn-tail dictionary')

        // 运行时校验要求这个座位必须带 `id`（`list slot "…" requires options.id`），
        // 由 owner 的 chain 渲染逐个取用；显不显示由组件自己返回 null 决定。
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'sol-dsh',
          order: 5,
          locale: NS,
        }, TailRow))

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'sol-dsh-debug',
          order: 90,
        }, DebugDock))
      },
    }
  },
})
