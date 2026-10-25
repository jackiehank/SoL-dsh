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
    function textOf(node) {
      const content = node?.content
      if (!Array.isArray(content)) return ''
      let out = ''
      for (const block of content) {
        if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
          out += `${block.text}\n`
        }
      }
      return out
    }

    /** 一轮里的四类事件计数。 */
    function countsOf(keys, nodes) {
      const counts = { fusion: 0, pack: 0, receipt: 0, compact: 0 }
      for (const key of keys) {
        const node = nodes.get(key)
        if (node === undefined) continue
        if (node.kind === 'compaction') {
          counts.compact += 1
          continue
        }
        if (node.kind !== 'tool-result') continue
        const text = textOf(node)
        if (text.includes(FUSION_MARK)) counts.fusion += 1
        if (text.includes(PACK_MARK)) counts.pack += 1
        if (text.includes(RECEIPT_MARK)) counts.receipt += 1
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
      // chain 座位把 select 的返回值作为 `matched` 传入；标准 props 里带 useChat。
      if (typeof useChat === 'function' && typeof turnNo === 'number') {
        try {
          const locations = useChat((snapshot) => snapshot.locations)
          const nodes = useChat((snapshot) => snapshot.nodes)
          counts = countsOf(locations.getTurn(turnNo), nodes)
          counted = true
        } catch {
          counted = false
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

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, {
          zh: { tail: '⚡ 本轮：融合 {fusion} · 收纳 {pack} · 回执 {receipt} · 压缩 {compact}' },
          en: { tail: '⚡ this turn: fused {fusion} · packed {pack} · receipts {receipt} · compacted {compact}' },
        }), 'sol-dsh: turn-tail dictionary')

        // 这个座位在运行时按 chain 渲染（ui-chat 的 TurnTailNodeView 用 renderSlotChain 调它），
        // 注册键是 `select` 而不是 list 的 `id`：select 拿到 owner 即接受，是否显示由组件自己决定。
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          select: (owner) => owner,
          locale: NS,
        }, TailRow))
      },
    }
  },
})
