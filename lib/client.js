/**
 * dsh-automation-monitor —— 浏览器半端：会话视图里的一个「自动化」标签页
 * ============================================================================
 * 结构（抄 dsh-bili-scroll/client.js 的官方约定，2026-10-27）：
 *
 *   window.__ModuleLoader__.load({
 *     id: '<必须等于 package.json 的 name>',
 *     factory: (require) => { ... return { inject: ['slots'], apply(ctx) {...} } },
 *   })
 *
 * 会话头 tab 不是自己画按钮，而是往 `conversation.view` 槽位注册：
 *
 *   slots.inject('conversation.view', () => slots.register({
 *     name: 'conversation.view', id: '...', order: 25, label: '自动化', scope: 'session',
 *   }, () => h(AutomationTab)))
 *
 * 数据全部来自 host 侧的只读接口 `GET /automation/status.json`，
 * 这个页面**只显示、不控制** —— 不启动、不停止、不改任何设置。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-automation-monitor',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/automation/status.json'
    const POLL_MS = 20000

    const CSS = `
[data-am-page]{display:flex;flex-direction:column;gap:12px;padding:14px 18px 22px;box-sizing:border-box;
  height:100%;overflow:auto;font-size:13px;color:var(--dsw-alias-label-primary,inherit);}
[data-am-head]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-am-title]{font-size:15px;font-weight:600;}
[data-am-hint]{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e);}
[data-am-spacer]{flex:1;min-width:0;}
[data-am-btn]{font:inherit;font-size:12px;padding:5px 12px;border-radius:8px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.28));
  background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit);}
[data-am-btn]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));}
[data-am-btn]:disabled{opacity:.55;cursor:default;}
[data-am-meta]{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;
  color:var(--dsw-alias-label-secondary,#9aa0a6);}
[data-am-meta] b{font-weight:600;color:var(--dsw-alias-label-primary,inherit);}
[data-am-table]{display:flex;flex-direction:column;border-radius:10px;overflow:hidden;
  border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.22));}
[data-am-th],[data-am-tr]{display:grid;align-items:center;gap:10px;padding:9px 12px;
  grid-template-columns:minmax(150px,1.5fr) 88px 118px 165px 118px;}
[data-am-th]{font-size:11px;font-weight:600;letter-spacing:.03em;
  color:var(--dsw-alias-label-tertiary,#8b949e);
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07));}
[data-am-tr]{cursor:pointer;border-top:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.16));}
[data-am-th]+div [data-am-tr]:first-child{border-top:0;}
[data-am-tr]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.09));}
[data-am-tr][data-open]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.09));}
[data-am-name] b{font-weight:600;}
[data-am-name] em{display:block;font-style:normal;font-size:11px;margin-top:2px;
  color:var(--dsw-alias-label-tertiary,#8b949e);}
[data-am-chips]{display:flex;flex-wrap:wrap;gap:6px;}
[data-am-chip]{font:inherit;font-size:11px;padding:2px 9px;border-radius:99px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.22));
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07));
  color:var(--dsw-alias-label-secondary,#9aa0a6);}
[data-am-chip]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));}
[data-am-chip][data-on]{background:rgba(56,139,253,.18);color:#4493f8;
  border-color:rgba(56,139,253,.45);}
[data-am-cell]{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--dsw-alias-label-secondary,#9aa0a6);}
[data-am-state]{font-style:normal;font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;
  background:rgba(127,127,127,.16);color:var(--dsw-alias-label-secondary,#9aa0a6);white-space:nowrap;}
[data-am-state][data-state=running]{background:rgba(46,160,67,.18);color:#3fb950;}
[data-am-state][data-state=scheduled]{background:rgba(56,139,253,.18);color:#4493f8;}
[data-am-state][data-state=idle]{background:rgba(127,127,127,.16);color:#9aa0a6;}
[data-am-state][data-state=disabled]{background:rgba(127,127,127,.10);color:#6e7681;}
[data-am-detail]{padding:4px 12px 12px 12px;font-size:12px;line-height:19px;
  border-top:1px dashed var(--dsw-alias-border-subtle,rgba(127,127,127,.22));
  background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-secondary,#9aa0a6);}
[data-am-line]{white-space:pre-wrap;}
[data-am-log]{margin:8px 0 0;padding:8px 10px;border-radius:8px;max-height:180px;overflow:auto;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:17px;
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.09));
  color:var(--dsw-alias-label-tertiary,#8b949e);white-space:pre-wrap;word-break:break-all;}
[data-am-src]{margin-top:8px;font-size:11px;color:var(--dsw-alias-label-tertiary,#6e7681);word-break:break-all;}
[data-am-empty]{padding:28px 4px;font-size:12px;line-height:20px;
  color:var(--dsw-alias-label-tertiary,#8b949e);}
[data-am-warn]{font-size:11px;line-height:18px;padding:8px 10px;border-radius:8px;
  background:rgba(187,128,9,.14);color:#d29922;}
[data-am-foot]{font-size:11px;color:var(--dsw-alias-label-tertiary,#6e7681);}
`

    const money = (n) => (typeof n !== 'number' || !isFinite(n))
      ? '—'
      : (n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2)) + ' 元'

    const clock = (ms) => {
      if (!ms) return '—'
      const d = new Date(ms)
      const p = (x) => String(x).padStart(2, '0')
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
    }

    /** 拉 `/automation/status.json`，20 秒自动刷新；卸载时清掉定时器 */
    function useStatus() {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [at, setAt] = React.useState(0)
      const alive = React.useRef(true)

      const load = React.useCallback(async () => {
        setBusy(true)
        try {
          const res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const json = await res.json()
          if (!alive.current) return
          setData(json)
          setErr('')
        } catch (e) {
          if (alive.current) setErr(String((e && e.message) || e))
        } finally {
          if (alive.current) {
            setBusy(false)
            setAt(Date.now())
          }
        }
      }, [])

      React.useEffect(() => {
        alive.current = true
        load()
        const t = setInterval(load, POLL_MS)
        return () => {
          alive.current = false
          clearInterval(t)
        }
      }, [load])

      return { data, err, busy, at, load }
    }

    function Row({ item, open, onToggle }) {
      return h('div', null,
        h('div', {
          'data-am-tr': '',
          'data-open': open ? '' : undefined,
          onClick: onToggle,
          title: open ? '点一下收起' : '点一下看详情',
        },
          h('span', { 'data-am-name': '' }, h('b', null, item.name || item.id),
            (item.kind || item.categoryText)
              ? h('em', null, [item.kind, item.categoryText].filter(Boolean).join(' · '))
              : null),
          h('span', null, h('i', {
            'data-am-state': '',
            'data-state': item.state || 'idle',
          }, item.stateText || item.state || '—')),
          h('span', { 'data-am-cell': '' }, item.lastRunText || '—'),
          h('span', { 'data-am-cell': '' }, item.nextRunText || '—'),
          h('span', { 'data-am-cell': '' }, item.costText || '—'),
        ),
        open ? h('div', { 'data-am-detail': '' },
          (item.detail || []).map((line, i) => h('div', { 'data-am-line': '', key: i }, '· ' + line)),
          item.lastLog ? h('pre', { 'data-am-log': '' }, item.lastLog) : null,
          item.sourceFile ? h('div', { 'data-am-src': '' }, '数据来源：' + item.sourceFile) : null,
        ) : null,
      )
    }

    function AutomationTab() {
      const { data, err, busy, at, load } = useStatus()
      const [openId, setOpenId] = React.useState(null)
      const [cat, setCat] = React.useState('all')
      const items = (data && data.items) || []
      const usage = (data && data.usage) || {}

      const cats = React.useMemo(() => {
        const m = new Map()
        for (const it of items) {
          const c = it.category || 'unknown'
          const cur = m.get(c) || { id: c, label: it.categoryText || c, n: 0 }
          cur.n++
          m.set(c, cur)
        }
        return [...m.values()].sort((a, b) => b.n - a.n)
      }, [items])

      const shown = cat === 'all' ? items : items.filter((it) => (it.category || 'unknown') === cat)

      const head = h('div', { 'data-am-head': '' },
        h('span', { 'data-am-title': '' }, '自动化监视'),
        h('span', { 'data-am-hint': '' }, '只读 · 不会启动、暂停或修改任何任务'),
        h('span', { 'data-am-spacer': '' }),
        h('button', { 'data-am-btn': '', onClick: load, disabled: busy }, busy ? '刷新中…' : '刷新'),
      )

      if (!data) {
        return h('div', { 'data-am-page': '' }, head,
          h('div', { 'data-am-empty': '' },
            err ? '读取失败：' + err : '正在读取自动化任务…'),
        )
      }

      return h('div', { 'data-am-page': '' },
        head,
        h('div', { 'data-am-meta': '' },
          h('span', null, '生成时间 ', h('b', null, data.generatedAtText || clock(data.generatedAt))),
          h('span', null, '今日全局花费 ', h('b', null, money(usage.todayUsage))),
          h('span', null, '余额 ', h('b', null, money(usage.lastBalance))),
          h('span', null, '共 ', h('b', null, String(items.length)), ' 项'),
        ),
        err ? h('div', { 'data-am-warn': '' }, '这次刷新失败：' + err + '（下面是上一次的数据）') : null,
        items.length === 0
          ? h('div', { 'data-am-empty': '' },
            '还没有登记任何自动化任务。',
            h('br'),
            '新任务可以写进 ', h('code', null, '$DSH_HOME/automations.json'),
            ' 的 ', h('code', null, 'items'), ' 数组里，刷新一下就会出现。')
          : h('div', null,
            cats.length > 1 ? h('div', { 'data-am-chips': '' },
              [{ id: 'all', label: '全部', n: items.length }, ...cats].map((c) =>
                h('button', {
                  key: c.id,
                  'data-am-chip': '',
                  'data-on': cat === c.id ? '' : undefined,
                  onClick: () => setCat(c.id),
                }, c.label + ' ' + c.n))) : null,
            h('div', { 'data-am-table': '' },
              h('div', { 'data-am-th': '' },
                h('span', null, '名称'), h('span', null, '状态'),
                h('span', null, '上次运行'), h('span', null, '下次运行'), h('span', null, '花费')),
              h('div', null, shown.map((item) => h(Row, {
                key: item.id,
                item,
                open: openId === item.id,
                onToggle: () => setOpenId(openId === item.id ? null : item.id),
              }))),
            ),
          ),
        (data.warnings && data.warnings.length)
          ? h('div', { 'data-am-warn': '' }, '探针警告：' + data.warnings.join('；'))
          : null,
        h('div', { 'data-am-foot': '' },
          '刷新于 ' + (clock(at) || '—') + ' · 每 20 秒自动刷新 · 点一行看详情'),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-automation-monitor')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-automation-monitor: 面板样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return

        // ⭐ 会话头部那个 tab（老版本没有这个槽位就静默跳过）
        try {
          slots.inject('conversation.view', () => slots.register({
            name: 'conversation.view',
            id: 'automation-monitor',
            order: 25,
            label: '自动化',
            scope: 'session',
          }, () => h(AutomationTab)))
        } catch (e) { /* 没有 conversation.view 槽位就算了 */ }
      },
    }
  },
})
