/**
 * SoL-dsh 的 Client 半：两个状态面。
 *
 * 1. `conversation.chat.turnTail` —— 每轮结束前的一行“这轮命中了什么”，只读、不可点；
 * 2. `conversation.composer.dock` —— 输入框下方常驻的“本会话已省”，点击可展开明细。
 *
 * 所有数字都从会话快照算：不新增 Host→Client 通道，也不花模型 token。
 * - 寄存：占位符里的 `estimated_tokens` - 占位符自身；
 * - 回执：回执头的 `source_bytes` - 回执自身；
 * - 压缩：compaction 节点的 `shadowedTokenCount`；
 * - 融合：`[then_run:succeeded]` 次数（不折算 token）；
 * - 百分比：(寄存 + 回执) / (寄存 + 回执 + 工具输出实际写入 token)。
 *
 * 估算口径是 4 字符 ≈ 1 token，只计首次写入，不含后续缓存读取。
 */

window.__ModuleLoader__.load({
  id: '@jackiehank/sol-dsh',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'sol-dsh'
    const FUSION_MARK = '[then_run:succeeded]'
    const PACK_MARK = '[large tool result replaced before it entered the context]'
    const RECEIPT_MARK = 'sol_pi_evidence_receipt_v1'
    const CHARS_PER_TOKEN = 4
    /** Host 侧 `solDshStats` 投影的 key；与 `plugin/lib/savings.js` 保持一致。 */
    const PROJECTION_KEY = 'solDshStats'

    /**
     * 结果节点的文本拼接（只读）。
     *
     * 会话快照里的内容块用 `kind` 判别（ui-chat 自己的渲染器就写 `block.kind === "text"`），
     * 宿主侧的工具结果是 `type`。两种形状都接受，免得在浏览器里恒为空。
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

    function tokenCount(text) {
      return Math.ceil(text.length / CHARS_PER_TOKEN)
    }

    function emptySummary() {
      return { fusion: 0, pack: 0, receipt: 0, compact: 0, packTokens: 0, receiptTokens: 0, compactTokens: 0, toolTokens: 0 }
    }

    function shadowedOf(data) {
      const value = data?.shadowedTokenCount
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0
    }

    /** `estimated_tokens` 是原文的估算；占位符自身也占 token。 */
    function packSavings(text) {
      const match = /(?:^|\n)estimated_tokens: (\d+)/.exec(text)
      if (match === null) return 0
      return Math.max(0, Number(match[1]) - tokenCount(text))
    }

    /** 回执头带原文字节数；回执自身长度按字符估算。 */
    function receiptSavings(text) {
      const match = /(?:^|\n)source_bytes=(\d+)/.exec(text)
      if (match === null) return 0
      return Math.max(0, Math.ceil((Number(match[1]) - text.length) / CHARS_PER_TOKEN))
    }

    /** 结果节点是 `kind: 'tool-result'`，其结果挂在工具调用节点的 `data.root` 下。 */
    function walkResults(block, visitor) {
      if (block === null || typeof block !== 'object') return
      if (block.kind !== 'tool-result') return
      visitor(block)
      const subCalls = Array.isArray(block.subCalls) ? block.subCalls : []
      for (const sub of subCalls) walkResults(sub, visitor)
    }

    function addNode(node, acc) {
      if (node === undefined || node === null || typeof node !== 'object') return
      if (node.kind === 'compaction') {
        acc.compact += 1
        acc.compactTokens += shadowedOf(node.data)
        return
      }
      if (node.kind === 'manual-compaction') {
        acc.compact += 1
        acc.compactTokens += shadowedOf(node.data?.compaction)
        return
      }
      if (node.kind !== 'tool-call') return
      walkResults(node.data?.root, (block) => {
        const text = textOf(block)
        if (text.includes(FUSION_MARK)) acc.fusion += 1
        if (text.includes(PACK_MARK)) {
          acc.pack += 1
          acc.packTokens += packSavings(text)
        }
        if (text.includes(RECEIPT_MARK)) {
          acc.receipt += 1
          acc.receiptTokens += receiptSavings(text)
        }
        acc.toolTokens += tokenCount(text)
      })
    }

    /** 一轮的汇总（尾行用）。 */
    function summarizeTurn(keys, nodes) {
      const acc = emptySummary()
      for (const key of Array.isArray(keys) ? keys : []) {
        addNode(nodes?.get?.(key), acc)
      }
      return acc
    }

    /** 本会话的汇总（dock 用）：遍历已加载窗口里的每一轮。 */
    function summarizeSession(snapshot) {
      const acc = emptySummary()
      const timeline = snapshot?.timeline
      const locations = snapshot?.locations
      const nodes = snapshot?.nodes
      const turns = Array.isArray(timeline?.turnOrder) ? timeline.turnOrder : []
      if (nodes === undefined || locations === undefined || typeof locations.getTurn !== 'function') return acc
      const seen = new Set()
      for (const turn of turns) {
        let keys
        try {
          keys = locations.getTurn(turn)
        } catch {
          continue
        }
        if (!Array.isArray(keys)) continue
        for (const key of keys) {
          if (seen.has(key)) continue
          seen.add(key)
          addNode(nodes.get?.(key), acc)
        }
      }
      return acc
    }

    function totalsOf(summary) {
      const toolSaved = summary.packTokens + summary.receiptTokens
      const saved = toolSaved + summary.compactTokens
      const denominator = toolSaved + summary.toolTokens
      const percent = denominator === 0 ? 0 : (toolSaved / denominator) * 100
      return { saved, percent }
    }

    function compactNumber(value) {
      if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
      if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
      return String(value)
    }

    function exactNumber(value) {
      try {
        return value.toLocaleString('en-US')
      } catch {
        return String(value)
      }
    }

    function formatPercent(value) {
      if (!Number.isFinite(value) || value <= 0) return '0'
      return value >= 10 ? String(Math.round(value)) : value.toFixed(1)
    }

    /** 灰色线性闪电：与 DSH 的线性图标同风格，颜色继承 `currentColor`。 */
    function LightningIcon({ size = 14 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { flex: 'none' },
        },
        h('path', { d: 'M8.6 1.4 2.4 9.2h4.4l-.6 5.4 6.4-7.8H8.2l.4-5.4Z' }),
      )
    }

    /** 调试开关：`localStorage['sol-dsh:debug'] = '1'` 时零命中轮次也渲染尾行。 */
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

      const locations = typeof useChat === 'function' ? useChat((snapshot) => snapshot.locations) : undefined
      const nodes = typeof useChat === 'function' ? useChat((snapshot) => snapshot.nodes) : undefined

      let keys
      try {
        keys = typeof turnNo === 'number' && locations !== undefined ? locations.getTurn(turnNo) : undefined
      } catch {
        keys = undefined
      }

      const summary = React.useMemo(() => {
        if (!Array.isArray(keys)) return null
        try {
          return summarizeTurn(keys, nodes)
        } catch {
          return null
        }
      }, [keys, nodes])

      const counts = {
        fusion: summary?.fusion ?? 0,
        pack: summary?.pack ?? 0,
        receipt: summary?.receipt ?? 0,
        compact: summary?.compact ?? 0,
      }
      const total = counts.fusion + counts.pack + counts.receipt + counts.compact
      if (total === 0 && !debug) return null

      let label
      if (total === 0) {
        label = summary === null ? 'sol-dsh 已加载（读不到会话快照）' : 'sol-dsh 已加载（本轮无机制命中）'
      } else if (typeof t === 'function') {
        label = t('tail', counts)
      } else {
        label = `本轮：融合 ${counts.fusion} · 寄存 ${counts.pack} · 回执 ${counts.receipt} · 压缩 ${counts.compact}`
      }

      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '2px 0',
            fontSize: '12px',
            lineHeight: '18px',
            color: 'var(--dsw-alias-label-tertiary)',
            userSelect: 'none',
          },
        },
        h(LightningIcon),
        h('span', null, label),
      )
    }

    /**
     * 输入框下方常驻的一行：本会话累计节省，点击展开明细。
     *
     * 数据优先取 Host 的 `solDshStats` 投影——它按整条会话日志折叠，分页、重启、
     * 机制开关都不影响历史累计；投影不可用（老版本）时退回扫描已加载快照。
     */
    function DockRow(props) {
      const { useChat, useProjection, t } = props
      const timeline = useChat((snapshot) => snapshot.timeline)
      const locations = useChat((snapshot) => snapshot.locations)
      const nodes = useChat((snapshot) => snapshot.nodes)
      const projected = typeof useProjection === 'function' ? useProjection(PROJECTION_KEY) : undefined

      const summary = React.useMemo(() => {
        if (projected !== undefined && projected !== null) return projected
        try {
          return summarizeSession({ timeline, locations, nodes })
        } catch {
          return emptySummary()
        }
      }, [projected, timeline, locations, nodes])

      const [open, setOpen] = React.useState(false)
      const rootRef = React.useRef(null)

      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        const onPointerDown = (event) => {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [open])

      if (typeof t !== 'function') return null

      const { saved, percent } = totalsOf(summary)
      const percentText = formatPercent(percent)
      const label = t('pill', { tokens: compactNumber(saved), percent: percentText })

      const rows = [
        [t('rowFusion'), t('fusionValue', { count: summary.fusion })],
        [t('rowWithCount', { label: t('rowPack'), count: summary.pack }), `${compactNumber(summary.packTokens)} tok`],
        [t('rowWithCount', { label: t('rowReceipt'), count: summary.receipt }), `${compactNumber(summary.receiptTokens)} tok`],
        [t('rowWithCount', { label: t('rowCompact'), count: summary.compact }), `${compactNumber(summary.compactTokens)} tok`],
        [t('rowPercent'), `${percentText}%`],
      ]

      return h(
        'div',
        { ref: rootRef, className: 'sol-dsh-dock' },
        h(
          'button',
          {
            type: 'button',
            className: 'sol-dsh-pill',
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-label': t('pillAria'),
            onClick: () => setOpen((value) => !value),
          },
          h(LightningIcon),
          h('span', { className: 'sol-dsh-pill-label' }, label),
        ),
        open
          ? h(
              'div',
              { className: 'sol-dsh-panel', role: 'dialog', 'aria-label': t('panelTitle') },
              h(
                'div',
                { className: 'sol-dsh-panel-title' },
                h('span', { className: 'sol-dsh-panel-title-label' }, h(LightningIcon), t('panelTitle')),
                h('span', { className: 'sol-dsh-panel-value' }, `${exactNumber(saved)} tok`),
              ),
              h('div', { className: 'sol-dsh-rule', 'aria-hidden': 'true' }),
              h(
                'dl',
                { className: 'sol-dsh-grid' },
                rows.flatMap(([term, value]) => [h('dt', { key: `t-${term}` }, term), h('dd', { key: `d-${term}` }, value)]),
              ),
              h('div', { className: 'sol-dsh-foot' }, t('footnote')),
            )
          : null,
      )
    }

    /**
     * 原生 bundle 配置页：四个机制开关。
     *
     * DSH 的 Plugins 页只为**注册了 `plugins.bundle.config` 的 bundle** 显示配置区
     * （plugin-manager 的 ledger 按这个座位的 key 收集）。git-panel 的做法是：
     * 无条件注册座位，组件里用 `ctx.get('configForms')` 找自己的命名空间
     * （按 schema 字段名匹配，不猜 entry id），再订阅它的快照。
     */
    function BundleConfig(props) {
      const { ctx, t } = props
      const [, bump] = React.useState(0)
      const configForms = typeof ctx?.get === 'function' ? ctx.get('configForms') : undefined
      const mirror = configForms?.describe?.()

      React.useEffect(() => {
        if (mirror === undefined) return undefined
        const off = mirror.subscribe(() => bump((value) => value + 1))
        Promise.resolve(mirror.ensure()).catch(() => {})
        return off
      }, [mirror])

      const view = mirror?.getSnapshot()?.view
      const namespaces = Array.isArray(view?.namespaces) ? view.namespaces : []
      const ns = React.useMemo(() => {
        const found = namespaces.find((entry) => {
          const dict = entry?.schema?.dict
          if (dict !== undefined && 'actionFusion' in dict) return true
          // schema 可能是 schemastery 的 {uid, refs} 信封；字段名不在 dict 时退回文本匹配。
          try {
            return JSON.stringify(entry?.schema).includes('actionFusion')
          } catch {
            return false
          }
        })
        return found?.ns
      }, [view])

      const form = ns !== undefined && configForms !== undefined ? configForms.get(ns) : undefined
      React.useEffect(() => {
        if (form === undefined) return undefined
        const off = form.subscribe(() => bump((value) => value + 1))
        return off
      }, [form])

      if (typeof t !== 'function') return null
      if (form === undefined) return h('div', { className: 'sol-dsh-config-note' }, t('configUnavailable'))

      const snapshot = form.getSnapshot()
      const ready = snapshot.status === 'ready'
      const value = ready ? snapshot.value ?? {} : {}
      const note = ready
        ? t('configHint')
        : snapshot.status === 'unavailable'
          ? t('configUnavailable')
          : t('configLoading')
      const rows = [
        ['actionFusion', t('toggleFusion')],
        ['observationPack', t('togglePack')],
        ['evidencePreservingReducer', t('toggleReducer')],
        ['onlineContextCompact', t('toggleCompact')],
      ]
      return h(
        'div',
        { className: 'sol-dsh-config' },
        h('div', { className: 'sol-dsh-config-title' }, t('configTitle')),
        h('div', { className: 'sol-dsh-config-note' }, note),
        rows.map(([field, label]) =>
          h(
            'label',
            { className: 'sol-dsh-switch', key: field },
            h('input', {
              type: 'checkbox',
              checked: Boolean(value[field]),
              disabled: !ready || snapshot.writable === false,
              onChange: (event) => {
                form.set(field, event.target.checked)
              },
            }),
            h('span', { className: 'sol-dsh-switch-track', 'aria-hidden': 'true' }),
            h('span', { className: 'sol-dsh-switch-label' }, label),
          ),
        ),
      )
    }

    const CSS = `
.sol-dsh-dock { position: relative; display: inline-flex; align-items: center; }
.sol-dsh-pill { box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; max-width: 100%; margin: 0; padding: 1px 8px; border: 0; border-radius: var(--dsw-radius-sm); background: none; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px); line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px)); font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer; }
.sol-dsh-pill:hover, .sol-dsh-pill[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.sol-dsh-pill svg { width: 14px; height: 14px; flex: none; }
.sol-dsh-pill-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.sol-dsh-panel { position: absolute; bottom: calc(100% + 8px); left: 50%; z-index: 1100; box-sizing: border-box; width: max-content; min-width: min(300px, calc(100vw - 24px)); max-width: min(420px, calc(100vw - 24px)); padding: 16px; border: 0; border-radius: var(--dsw-radius-lg); background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay)); -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%)); backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%)); --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); box-shadow: var(--dsw-elevation-prominent); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; transform: translateX(-50%); }
.sol-dsh-panel-title { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 8px; color: var(--dsw-alias-label-primary); font-weight: 500; }
.sol-dsh-panel-title-label { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.sol-dsh-panel-title-label svg { width: 14px; height: 14px; flex: none; }
.sol-dsh-panel-value { font-variant-numeric: tabular-nums; }
.sol-dsh-rule { border-top: 0.5px solid var(--dsw-alias-border-l2); margin-bottom: 10px; }
.sol-dsh-grid { display: grid; grid-template-columns: minmax(76px, auto) minmax(0, 1fr); gap: 6px 16px; margin: 0; color: var(--dsw-alias-label-tertiary); }
.sol-dsh-grid dt, .sol-dsh-grid dd { margin: 0; min-width: 0; }
.sol-dsh-grid dd { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; text-align: right; }
.sol-dsh-foot { margin-top: 10px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.sol-dsh-config { display: flex; flex-direction: column; gap: 10px; max-width: 760px; }
.sol-dsh-config-title { margin: 0; color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 600; line-height: 22px; }
.sol-dsh-config-note { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.sol-dsh-switch { display: flex; align-items: center; gap: 10px; cursor: pointer; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }
.sol-dsh-switch input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.sol-dsh-switch-track { position: relative; flex: none; width: 32px; height: 18px; border-radius: 9px; background: var(--dsw-alias-border-l2); transition: background .15s; }
.sol-dsh-switch-track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .15s; }
.sol-dsh-switch input:checked + .sol-dsh-switch-track { background: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.sol-dsh-switch input:checked + .sol-dsh-switch-track::after { transform: translateX(14px); }
.sol-dsh-switch input:disabled + .sol-dsh-switch-track { opacity: .5; }
.sol-dsh-switch:has(input:focus-visible) .sol-dsh-switch-track { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
`

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () =>
            ctx.locale.register(NS, {
              zh: {
                tail: '本轮：融合 {fusion} · 寄存 {pack} · 回执 {receipt} · 压缩 {compact}',
                pill: '已省 {tokens} tok · {percent}%',
                pillAria: 'sol-dsh 本会话节省明细',
                configTitle: '机制开关',
                configHint: '开关立即生效，并写入 profile 配置。',
                configLoading: '正在读取配置…',
                configUnavailable: 'Host 没有暴露该配置命名空间，请重载插件或检查 DSH 版本。',
                toggleFusion: '动作融合（Action Fusion）· 编辑/写入后在同一调用里跑命令',
                togglePack: '长输出寄存（ObservationPack）· 大结果存本地，凭句柄分页取回',
                toggleReducer: '诊断日志回执（Evidence-Preserving Reducer）· 构建/测试日志压成逐字可核验的回执',
                toggleCompact: '在线上下文压缩（Online Context Compact）· 计划步骤完成点触发压缩',
                panelTitle: '本会话',
                rowPack: '寄存',
                rowReceipt: '回执',
                rowCompact: '压缩',
                rowFusion: '融合',
                rowPercent: '工具输出少写',
                rowWithCount: '{label}（{count} 次）',
                fusionValue: '{count} 次往返',
                footnote: '估算：4 字符 ≈ 1 token；只计首次写入，不含后续缓存读取。',
              },
              en: {
                tail: 'This turn: fusion {fusion} · pack {pack} · reducer {receipt} · compact {compact}',
                pill: 'Saved {tokens} tok · {percent}%',
                pillAria: 'sol-dsh session savings details',
                configTitle: 'Mechanism switches',
                configHint: 'Switch changes apply immediately and persist to the profile config.',
                configLoading: 'Reading configuration…',
                configUnavailable: 'The Host does not expose this configuration namespace; reload the plugin or check the DSH version.',
                toggleFusion: 'Action Fusion · run a command after the edit',
                togglePack: 'ObservationPack · large results become local handles',
                toggleReducer: 'Evidence-Preserving Reducer · build/test logs become verbatim receipts',
                toggleCompact: 'Online Context Compact · compaction at plan boundaries',
                panelTitle: 'This session',
                rowPack: 'Pack',
                rowReceipt: 'Reducer',
                rowCompact: 'Compact',
                rowFusion: 'Fusion',
                rowPercent: 'Tool output saved',
                rowWithCount: '{label} ({count}×)',
                fusionValue: '{count} round-trips',
                footnote: 'Estimated at 4 chars per token; counts the first write only, not later cache reads.',
              },
            }),
          'sol-dsh: status dictionary',
        )

        ctx.effect(
          () => {
            const style = document.createElement('style')
            style.dataset.solDsh = 'status'
            style.textContent = CSS
            document.head.appendChild(style)
            return () => style.remove()
          },
          'sol-dsh: status styles',
        )

        // list 座位必须带 `id`，由 owner 的 chain 逐个取用；显不显示由组件自己决定。
        ctx.slots.inject('conversation.chat.turnTail', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.turnTail',
              id: 'sol-dsh',
              order: 5,
              locale: NS,
            },
            TailRow,
          ),
        )

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'sol-dsh-status',
              order: 90,
              locale: NS,
            },
            DockRow,
          ),
        )

        // 原生 bundle 配置页：DSH 只为注册了 `plugins.bundle.config` 的 bundle 显示配置区。
        // 无条件注册（不依赖 configForms 就绪），两个 key 都登记：行 id 与包名——
        // git-panel 也是这么覆盖不同入口的 key 解析。
        ctx.effect(
          () =>
            ctx.slots.inject('plugins.bundle.config', () => {
              const disposers = ['sol-dsh', '@jackiehank/sol-dsh'].map((key) =>
                ctx.slots.register(
                  {
                    name: 'plugins.bundle.config',
                    key,
                    locale: NS,
                  },
                  (props) => h(BundleConfig, { ...props, ctx }),
                ),
              )
              return () => {
                for (const dispose of disposers.reverse()) {
                  try {
                    dispose()
                  } catch {
                    // 卸载时忽略单条失败
                  }
                }
              }
            }),
          'sol-dsh: bundle config page',
        )
      },
    }
  },
})
