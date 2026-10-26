/**
 * dsh-automation-monitor —— 自动化任务监视器（纯只读）
 *
 * 设计原则：
 *   1. 只读：本插件从不写任何别的插件/项目的数据文件。
 *   2. 可扩展：新增自动化只需在 automations.json 里加一条，或新增一个 probe 函数。
 *   3. 零依赖：不打包、不引第三方库，host 侧纯 Node。
 *
 * 分工：
 *   lib/index.js   host 半端 → GET /automation/status.json（只此一个接口）
 *   lib/client.js  浏览器半端 → 会话视图里注册「自动化」标签页，读上面那个接口
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

const BJ = 8 * 3600 * 1000
const DAY = 86400000
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }

const pad2 = (n) => String(n).padStart(2, '0')

/* ============================ 基础读取 ============================ */

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

function readTailText(p, maxBytes = 65536) {
  try {
    const st = fs.statSync(p)
    const start = Math.max(0, st.size - maxBytes)
    const fd = fs.openSync(p, 'r')
    const buf = Buffer.alloc(st.size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    return buf.toString('utf8')
  } catch { return '' }
}

/* ============================ 北京时间 ============================ */

function bjParts(ms) {
  const d = new Date(ms + BJ)
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }
}
function bjDayStart(ms) {
  const p = bjParts(ms)
  return Date.UTC(p.y, p.mo - 1, p.d) - BJ
}
const fmtDay = (ms) => { const p = bjParts(ms); return `${p.y}-${pad2(p.mo)}-${pad2(p.d)}` }
const fmtHM = (ms) => { const p = bjParts(ms); return `${pad2(p.h)}:${pad2(p.mi)}` }

function relText(ms, now) {
  if (!ms) return ''
  const dd = Math.round((bjDayStart(ms) - bjDayStart(now)) / DAY)
  const day = dd === 0 ? '今天' : dd === 1 ? '明天' : dd === -1 ? '昨天' : fmtDay(ms)
  return `${day} ${fmtHM(ms)}`
}
function relFromText(ms, now) {
  const diff = ms - now
  if (diff <= 60000) return '马上'
  const m = Math.round(diff / 60000)
  if (m < 60) return `${m} 分钟后`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h} 小时 ${r} 分后` : `${h} 小时后`
}

/* ============================ probe: 刷B站 ============================ */

const BILI_DIR = path.join(DSH_HOME, 'bili-duty')

/**
 * 下次真正会起跑的时刻。
 * dsh-bili-scroll 的 tick 每 60s 一次，窗口 key = `日历日:noon|night`，
 * 所以「夜间跨零点」会被拆成 18:00–24:00 与 00:00–09:00 两段、各自独立起跑一次。
 */
function biliNextSlot(nowMs, cfg, state) {
  const perDay = Number(cfg.perDay || 0)
  if (perDay > 0 && state && state.day === fmtDay(nowMs) && Number(state.picked || 0) >= perDay) return null
  const slots = []
  if (cfg.noon) slots.push({ key: 'noon', from: 12 * 60, to: 14 * 60, label: '中午 12:00–14:00' })
  if (cfg.night) {
    slots.push({ key: 'night', from: 0, to: 9 * 60, label: '凌晨 00:00–09:00（夜间跨零点段）' })
    slots.push({ key: 'night', from: 18 * 60, to: 24 * 60, label: '夜间 18:00–24:00' })
  }
  const wins = (state && state.windows) || {}
  const cands = []
  for (let d = 0; d < 3; d++) {
    const base = bjDayStart(nowMs) + d * DAY
    for (const s of slots) {
      const start = base + s.from * 60000
      const end = base + s.to * 60000
      if (end <= nowMs) continue
      if (wins[fmtDay(base) + ':' + s.key]) continue
      cands.push({ at: Math.max(start, nowMs), label: s.label })
    }
  }
  cands.sort((a, b) => a.at - b.at)
  return cands[0] || null
}

function probeBili(nowMs) {
  const cfg = readJSON(path.join(BILI_DIR, 'config.json'))
  const state = readJSON(path.join(BILI_DIR, 'state.json'))
  if (!cfg && !state) return []
  const c = cfg || {}
  const st = state || {}
  const next = biliNextSlot(nowMs, c, st)
  const lastMs = st.lastRunAt ? Date.parse(st.lastRunAt) : null
  const today = fmtDay(nowMs)
  const runsToday = st.day === today ? Number(st.count || 0) : 0
  const pickedToday = st.day === today ? Number(st.picked || 0) : 0

  const winOn = []
  if (c.noon) winOn.push('中午')
  if (c.night) winOn.push('夜间')
  const windowsOff = winOn.length === 0

  const detail = []
  detail.push(`今日已跑 ${runsToday} 轮、挑 ${pickedToday} 条（额度 perDay=${c.perDay ?? '不限'}）`)
  detail.push('窗口：' + (winOn.length ? winOn.join(' + ') : '全部关闭 → 不会自动跑'))
  if (c.autoComment) detail.push('自动评论并 @ 主人：开')
  if (c.dmMode && c.dmMode !== 'off') detail.push('私信：' + c.dmMode + '（每 1 分钟查一次，纯代码不花 token）')
  if (c.transcribe) detail.push('本地转写：开（吃 CPU，不吃 token）')

  const outDir = path.join(BILI_DIR, 'out')
  let report = ''
  try {
    const files = fs.readdirSync(outDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort()
    if (files.length) report = path.join(outDir, files[files.length - 1])
  } catch { /* 目录不存在就算了 */ }
  if (report) detail.push('最近报告：' + report)

  const logTail = readTailText(path.join(BILI_DIR, 'duty.log'), 32 * 1024)
  const lines = logTail.split(/\r?\n/).filter((l) => l.trim())
  const lastLog = lines.length ? lines[lines.length - 1].slice(0, 220) : ''

  let stateText = '已排期'
  let stateKey = 'scheduled'
  if (windowsOff) { stateKey = 'disabled'; stateText = '窗口关闭' }
  else if (next && next.at - nowMs <= 65000) { stateKey = 'running'; stateText = '即将起跑' }
  else if (!next) { stateKey = 'idle'; stateText = '今日已跑完' }

  return [{
    id: 'bili-scroll',
    name: '刷B站（dsh-bili-scroll）',
    kind: '自动化',
    enabled: !windowsOff,
    state: stateKey,
    stateText,
    scheduleText: windowsOff ? '全部窗口已关闭'
      : (next ? relText(next.at, nowMs) + ' · ' + next.label : '今天不会再跑'),
    lastRunText: lastMs ? relText(lastMs, nowMs) : '无记录',
    nextRunText: next
      ? relText(next.at, nowMs) + '（' + relFromText(next.at, nowMs) + '）'
      : (windowsOff ? '—' : '今天不再运行'),
    costText: '每轮约 1–6 万 token',
    detail,
    lastLog,
    sourceFile: BILI_DIR,
  }]
}

/* ============================ probe: 会话提醒 ============================ */

function scheduleTextOf(rec) {
  const k = String(rec.kind || '')
  const tz = rec.timeZone ? ' · ' + rec.timeZone : ''
  const hm = String(rec.time || '').slice(0, 5)
  if (k === 'daily') return `每天 ${hm}${tz}`
  if (k === 'weekly') return `每周 ${(rec.weekdays || []).join(',')} ${hm}${tz}`
  if (k === 'cron') return `cron ${rec.expression || ''}${tz}`
  if (rec.at) return `一次性 ${fmtDay(Date.parse(rec.at))} ${fmtHM(Date.parse(rec.at))}`
  return k || '未知'
}

function probeSchedule(nowMs) {
  const data = readJSON(path.join(DSH_HOME, 'storages', 'schedule.json'))
  const tasks = data && data.tables && data.tables.tasks
  if (!tasks || typeof tasks !== 'object') return []
  const out = []
  for (const [id, row] of Object.entries(tasks)) {
    if (!row || typeof row !== 'object') continue
    const rec = row.record || {}
    const status = String(row.status || 'active')
    const active = status === 'active' || status === 'paused' === false
    const nextMs = rec.scheduledAt ? Date.parse(rec.scheduledAt) : null
    const hist = (row.deliveryHistory && row.deliveryHistory.records) || []
    const lastRec = hist.length ? hist[hist.length - 1] : null
    const lastMs = lastRec ? Date.parse(lastRec.deliveredAt || lastRec.scheduledAt) : null
    const activeNow = status === 'active'
    out.push({
      id: 'schedule:' + id,
      name: rec.title || id,
      kind: '提醒',
      enabled: activeNow,
      state: activeNow ? (nextMs && nextMs - nowMs <= 65000 ? 'running' : 'scheduled') : 'disabled',
      stateText: activeNow ? (nextMs && nextMs - nowMs <= 65000 ? '即将触发' : '已排期') : '已停用',
      scheduleText: scheduleTextOf(rec),
      lastRunText: lastMs ? relText(lastMs, nowMs) : '未触发过',
      nextRunText: activeNow && nextMs ? relText(nextMs, nowMs) : (activeNow ? '待定' : '—'),
      costText: '每触发 1 个对话轮次',
      detail: [
        rec.prompt ? '内容：' + String(rec.prompt).slice(0, 90) : '',
        '会话：' + String(row.sessionId || '').slice(0, 26) + '…',
        '已投递 ' + hist.length + ' 次',
      ].filter(Boolean),
      sourceFile: 'storages/schedule.json',
    })
  }
  return out
}

/* ============================ probe: 任务板 ============================ */

function probeTaskBoard(nowMs) {
  const data = readJSON(path.join(DSH_HOME, 'task-board', 'ledger-v2.json'))
  if (!data || !Array.isArray(data.tasks)) return []
  const out = []
  for (const t of data.tasks) {
    if (!t || typeof t !== 'object') continue
    const sched = t.schedule || null
    if (!sched && !t.cron) continue
    const enabled = !!(sched && sched.enabled)
    const nextMs = sched && sched.nextRun ? Date.parse(sched.nextRun) : null
    out.push({
      id: 'task:' + (t.id || ''),
      name: t.title || t.name || t.id || '任务板卡片',
      kind: '任务板',
      enabled,
      state: enabled ? 'scheduled' : 'disabled',
      stateText: enabled ? '已排期' : '未启用',
      scheduleText: sched ? (sched.cron ? 'cron ' + sched.cron : (sched.mode || '定时')) : '—',
      lastRunText: t.lastRunAt ? relText(Date.parse(t.lastRunAt), nowMs) : '未运行',
      nextRunText: nextMs ? relText(nextMs, nowMs) : '—',
      costText: '每次运行 1 个会话',
      detail: [t.column ? '列：' + t.column : '', t.description ? String(t.description).slice(0, 80) : ''].filter(Boolean),
      sourceFile: 'task-board/ledger-v2.json',
    })
  }
  return out
}

/* ============================ probe: 自定义登记 ============================ */

const CUSTOM_CANDIDATES = [
  path.join(DSH_HOME, 'automations.json'),
  path.join(PKG_ROOT, 'automations.json'),
]

function loadCustom() {
  for (const p of CUSTOM_CANDIDATES) {
    const d = readJSON(p)
    if (d && Array.isArray(d.items)) return { file: p, items: d.items }
  }
  return { file: CUSTOM_CANDIDATES[0], items: [] }
}

function probeCustom(nowMs) {
  const { items } = loadCustom()
  return items.map((it, i) => {
    const enabled = it.enabled !== false
    const nextMs = it.nextRun ? Date.parse(it.nextRun) : null
    const lastMs = it.lastRun ? Date.parse(it.lastRun) : null
    return {
      id: 'custom:' + (it.id || i),
      name: it.name || it.id || '自定义条目',
      kind: it.kind || '自定义',
      enabled,
      state: !enabled ? 'disabled' : (nextMs && nextMs - nowMs <= 65000 ? 'running' : 'scheduled'),
      stateText: !enabled ? '已停用' : (nextMs && nextMs - nowMs <= 65000 ? '即将触发' : '已排期'),
      scheduleText: it.scheduleText || (nextMs ? relText(nextMs, nowMs) : '—'),
      lastRunText: lastMs ? relText(lastMs, nowMs) : '—',
      nextRunText: nextMs ? relText(nextMs, nowMs) : '—',
      costText: it.costText || '—',
      detail: it.note ? [String(it.note)] : [],
      sourceFile: 'automations.json',
    }
  })
}

/* ============================ 汇总 ============================ */

function readUsage() {
  const u = readJSON(path.join(DSH_HOME, '.dshw-usage.json'))
  if (!u) return null
  return {
    date: u.date || null,
    todayUsage: typeof u.todayUsage === 'number' ? u.todayUsage : null,
    lastBalance: typeof u.lastBalance === 'number' ? u.lastBalance : null,
  }
}

export function collect(nowMs) {
  const items = []
  const warnings = []
  const probes = [
    ['bili-scroll', probeBili],
    ['schedule', probeSchedule],
    ['task-board', probeTaskBoard],
    ['custom', probeCustom],
  ]
  for (const [id, fn] of probes) {
    try {
      const r = fn(nowMs)
      if (Array.isArray(r)) items.push(...r)
    } catch (err) {
      warnings.push(id + ' 读取失败：' + String((err && err.message) || err))
    }
  }
  const rank = { running: 0, scheduled: 1, idle: 2, disabled: 3 }
  items.sort((a, b) => {
    const ra = rank[a.state] ?? 9, rb = rank[b.state] ?? 9
    if (ra !== rb) return ra - rb
    return String(a.name).localeCompare(String(b.name), 'zh')
  })
  return {
    generatedAt: new Date(nowMs).toISOString(),
    generatedAtText: fmtDay(nowMs) + ' ' + fmtHM(nowMs),
    nowMs,
    dshHome: DSH_HOME,
    usage: readUsage(),
    items,
    warnings,
    customFile: loadCustom().file,
  }
}

/* ============================ 插件本体 ============================ */

export default {
  name: 'automation-monitor',
  apply(root) {
    const disposers = []
    root.effect(() => () => {
      for (const d of disposers) { try { d() } catch { /* ignore */ } }
    })

    // 只读接口：会话视图里的「自动化」标签页从这里取数据
    root.inject(['webServer'], (ctx) => {
      try {
        disposers.push(ctx.webServer.register({
          kind: 'exact',
          path: '/automation/status.json',
          handler: async (req, res) => {
            try {
              const payload = collect(Date.now())
              res.writeHead(200, JSON_HEADERS)
              res.end(JSON.stringify(payload))
            } catch (err) {
              res.writeHead(500, JSON_HEADERS)
              res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }))
            }
          },
        }))
      } catch (err) {
        try { console.warn('[automation-monitor] 路由注册失败：' + String((err && err.message) || err)) } catch { /* ignore */ }
      }
    })
  },
}

