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

    function TailRow(props) {
      const { turn, useChat, t } = props
      // 两个稳定选择器：快照变了才重渲染，避免每次取新数组。
      const locations = useChat((snapshot) => snapshot.locations)
      const nodes = useChat((snapshot) => snapshot.nodes)
      const counts = countsOf(locations.getTurn(turn.turn), nodes)
      if (counts.fusion + counts.pack + counts.receipt + counts.compact === 0) return null
      const label = typeof t === 'function' ? t('tail', counts) : formatFallback(counts)
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

        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'sol-dsh',
          order: 5,
          locale: NS,
        }, TailRow))
      },
    }
  },
})
