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
    nextRunAtMs: next ? next.at : null,
    lastRunAtMs: Number.isFinite(lastMs) ? lastMs : null,
    runCount: runsToday,
    runCountText: '今日 ' + runsToday + ' 轮',
    origin: 'dsh-bili-scroll',
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
      nextRunAtMs: activeNow && nextMs ? nextMs : null,
      lastRunAtMs: Number.isFinite(lastMs) ? lastMs : null,
      runCount: hist.length,
      runCountText: hist.length ? '已投递 ' + hist.length + ' 次' : '',
      origin: 'DSH 内置提醒',
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
  const CLOSED = ['done', 'failed', 'cancelled', 'archived']
  const out = []
  for (const t of data.tasks) {
    if (!t || typeof t !== 'object') continue
    const sched = t.schedule || null
    if (!sched && !t.cron) continue
    const enabled = !!(sched && sched.enabled)
    // 已经结束的卡片（一次性跑完、被取消、归档）不是在跑的自动化，不列出来
    const settled = CLOSED.includes(t.status) || !!(sched && (sched.endedAt || sched.endedReason))
    if (settled && !enabled) continue

    const nextRaw = (sched && (sched.nextRun || sched.nextRunAt)) || t.nextRunAt || null
    const nextMs = nextRaw ? Date.parse(nextRaw) : null
    const lastRaw = (sched && sched.lastTriggeredAt) || t.lastRunAt || null
    const lastMs = lastRaw == null ? null : (typeof lastRaw === 'number' ? lastRaw : Date.parse(lastRaw))
    const cron = (sched && sched.cron) || t.cron || ''
    const mode = (sched && sched.mode) || ''

    const detail = []
    if (t.column) detail.push('列：' + t.column)
    if (sched && sched.runCount) detail.push('已运行 ' + sched.runCount + ' 次')
    if (t.description) detail.push(String(t.description).slice(0, 80))

    out.push({
      id: 'task:' + (t.id || ''),
      name: t.title || t.name || t.id || '任务板卡片',
      kind: '任务板',
      enabled,
      state: enabled ? 'scheduled' : 'disabled',
      stateText: enabled ? '已排期' : '已停用',
      scheduleText: cron ? 'cron ' + cron : (mode === 'once' ? '一次性' : (mode || '定时')),
      lastRunText: lastMs != null && !isNaN(lastMs) ? relText(lastMs, nowMs) : '未运行',
      nextRunText: nextMs != null && !isNaN(nextMs) ? relText(nextMs, nowMs) : '—',
      costText: '每次运行 1 个会话',
      nextRunAtMs: nextMs != null && !isNaN(nextMs) ? nextMs : null,
      lastRunAtMs: lastMs != null && !isNaN(lastMs) ? lastMs : null,
      runCount: (sched && Number(sched.runCount)) || 0,
      runCountText: (sched && sched.runCount) ? '已跑 ' + sched.runCount + ' 次' : '',
      origin: '任务板',
      detail: detail.filter(Boolean),
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
      nextRunAtMs: Number.isFinite(nextMs) ? nextMs : null,
      lastRunAtMs: Number.isFinite(lastMs) ? lastMs : null,
      runCount: Number(it.runCount) || 0,
      runCountText: it.runCount ? '已跑 ' + it.runCount + ' 次' : '',
      origin: it.origin || '手工登记',
      detail: it.note ? [String(it.note)] : [],
      sourceFile: 'automations.json',
    }
  })
}

/* ============================ probe: 通用发现 ============================ */

/**
 * 通用发现探针：不认识具体插件，只靠「字段名规律」去找。
 *
 * 为什么这样做：DSH 没有统一的自动化注册表，每个插件自己 setTimeout / setInterval，
 * 彼此看不见。但绝大多数插件都会把排期落在 $DSH_HOME 下的某个 JSON 里
 * （实测 11 个主流插件里 10 个用 nextRunAt / nextRun / runAt / fireAt 这套命名）。
 * 所以：扫一遍 $DSH_HOME，凡是带这些字段、又不是上面几个精准探针已经读过的文件，
 * 就当成「未知来源的自动化」列出来 —— 至少让人知道有东西在跑。
 */

// 精准探针已经读过的文件，通用扫描跳过，避免重复
const CLAIMED_PATHS = [
  'bili-duty/config.json',
  'bili-duty/state.json',
  'storages/schedule.json',
  'task-board/ledger-v2.json',
  'automations.json',
].map((p) => path.join(...p.split('/')))

const DISCOVERY_SKIP = new Set([
  'node_modules', 'dsh-runtimes', 'dependencies', 'attachments',
  'sessions', 'logs', 'cache', 'profiles',
  // 已知同类「监视面板」插件的数据目录：里面是事件流 / 系统采样，不是排期。
  // 实测过不会误报（它们没有 nextRunAt 那套字段），跳过只是省 IO、也防以后改格式误报。
  'observability',        // dsh-my-observability: audit.json(L) 事件审计
  'system-monitor-plugin', // dsh-system-monitor-plugin: env.json 时钟节拍缓存
  'token-monitor',        // dsh-token-monitor: 配置（在 storages 下，本来也进不来）
])

const NEXT_KEYS = ['nextRunAt', 'nextRun', 'nextAt', 'fireAt', 'scheduledAt', 'runAt', 'dueAt', 'nextFireAt']
const LAST_KEYS = ['lastRunAt', 'lastRun', 'lastFiredAt', 'lastFinishedAt']
const INTERVAL_KEYS = ['intervalMs', 'intervalSeconds', 'repeatEvery', 'everyMs', 'periodMs']
const CRON_KEYS = ['cron', 'cronExpression', 'cronExpr', 'expression', 'schedule']

function agoText(ms, now) {
  const diff = now - ms
  if (diff < 60000) return '刚刚'
  const m = Math.round(diff / 60000)
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  return Math.floor(h / 24) + ' 天前'
}

function pickTime(obj, keys) {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      if (v > 1e12) return v            // 毫秒时间戳
      if (v > 1e9) return v * 1000      // 秒时间戳
    }
    if (typeof v === 'string' && v.length >= 4) {
      const t = Date.parse(v)
      if (!Number.isNaN(t)) return t
    }
  }
  return null
}

function pickCron(obj) {
  for (const k of CRON_KEYS) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim() && /\s/.test(v.trim())) return v.trim().slice(0, 60)
  }
  return null
}

function pickInterval(obj) {
  for (const k of INTERVAL_KEYS) {
    const v = obj[k]
    if (typeof v === 'number' && v > 0) return k === 'intervalSeconds' ? v * 1000 : v
  }
  return null
}

// 在任意 JSON 结构里找「像排期的对象」
function findScheduleEntries(node, out, depth, parent) {
  if (!node || typeof node !== 'object' || depth > 4 || out.length >= 40) return
  if (Array.isArray(node)) {
    for (const v of node.slice(0, 200)) findScheduleEntries(v, out, depth + 1, parent)
    return
  }
  const next = pickTime(node, NEXT_KEYS)
  const last = pickTime(node, LAST_KEYS)
  const cron = pickCron(node)
  const iv = pickInterval(node)
  if (next || cron || iv) {
    // 排期常常藏在子对象里（比如 taskboard 的 execution:{mode,cron,nextRunAt}），
    // 名字却在父对象上（tasks[].title）。往上借一层名字，别让整条只剩文件名。
    const named = { ...node }
    if (parent) {
      if (!named.name && typeof parent.name === 'string') named.name = parent.name
      if (!named.title && typeof parent.title === 'string') named.title = parent.title
    }
    out.push({ node: named, next, last, cron, iv })
    return
  }
  for (const k of Object.keys(node)) findScheduleEntries(node[k], out, depth + 1, node)
}

// 扫描 $DSH_HOME 浅层（≤2 层）的所有 JSON
function scanJsonFiles(root, maxDepth = 3) {
  const found = []
  const walk = (dir, depth) => {
    if (depth > maxDepth || found.length >= 600) return
    let ents
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!DISCOVERY_SKIP.has(e.name) && !e.name.startsWith('.')) walk(p, depth + 1)
        continue
      }
      if (e.name.endsWith('.json')) found.push(p)
    }
  }
  walk(root, 0)
  return found
}

function guessCategory(rel) {
  const r = rel.toLowerCase()
  if (/bili/.test(r)) return { id: 'fetch', label: '内容抓取' }
  if (/heartbeat|pulse|aura/.test(r)) return { id: 'heartbeat', label: '心跳常驻' }
  if (/cron/.test(r)) return { id: 'cron', label: 'cron 调度' }
  if (/taskboard/.test(r)) return { id: 'taskboard', label: '任务板' }
  if (/automation|scheduler|schedule|job|task/.test(r)) return { id: 'scheduler', label: '定时任务' }
  if (/remind|notify/.test(r)) return { id: 'reminder', label: '定时提醒' }
  return { id: 'unknown', label: '未知来源' }
}

function guessOrigin(rel) {
  const r = rel.toLowerCase()
  if (/^bili-duty/.test(r)) return 'dsh-bili-scroll'
  if (/^data\/cron/.test(r)) return '@goodandready/dsh-cron'
  if (/^cron-board/.test(r)) return '@mzzsfy/dsh-cron-board'
  if (/^heartbeat/.test(r)) return 'dsh-plugin-heartbeat'
  if (/^kanade|^profile_rhythm/.test(r)) return '@kanadego/dsh-heartbeat'
  if (/^automation/.test(r)) return '自动化插件（automation/*）'
  if (/^task-board/.test(r)) return '任务板'
  if (/^storages\//.test(r)) return 'DSH 内置'
  if (/^observability/.test(r)) return 'dsh-my-observability'
  return rel.split('/')[0] + '/'
}

function guessCost(entry) {
  const node = entry.node || {}
  const blob = JSON.stringify(node).slice(0, 4000)
  const hasPrompt = /"(prompt|message|instructions|agent|session|model|llm)"/.test(blob)
  const hasShell = /"(command|script|shell|exec|cmd|code)"/.test(blob)

  // 1) 有的插件（如 @goodandready/dsh-cron）用 type/runtime 明确声明跑什么，这个最准
  const rt = String(node.type || node.runtime || node.executor || node.mode || '').toLowerCase()
  if (/^(llm|agent|skill|workflow|ai|prompt)$/.test(rt)) {
    return { risk: 'high', text: '会起 agent 会话（花 token）' }
  }
  if (/^(script|node|python|http|ssh|docker|bash|shell|cmd|powershell|curl|webhook)$/.test(rt)) {
    return { risk: 'low', text: '只跑脚本（不花 token）' }
  }

  // 2) 没有明确声明就按字段名猜
  if (hasPrompt && !hasShell) return { risk: 'high', text: '会起 agent 会话（花 token）' }
  if (hasShell && !hasPrompt) return { risk: 'low', text: '只跑脚本（不花 token）' }
  if (hasPrompt && hasShell) return { risk: 'high', text: '可能跑脚本或起会话' }
  return { risk: 'unknown', text: '未知' }
}

const FRIENDLY_DIR = {
  heartbeat: '心跳（heartbeat）',
  automation: '自动化任务',
  'cron-board': 'cron 看板',
  cron: 'cron 调度',
  data: '定时任务',
  scheduler: '定时任务',
  taskboard: '任务板',
}

function friendlyName(rel, i) {
  const first = rel.split('/')[0].replace(/\.json$/i, '')
  const base = FRIENDLY_DIR[first] || first
  return base + (i > 0 ? ' · 第 ' + (i + 1) + ' 项' : '')
}

function probeDiscovery(nowMs) {
  const out = []
  const files = scanJsonFiles(DSH_HOME, 3)
  for (const file of files) {
    const rel = path.relative(DSH_HOME, file)
    if (CLAIMED_PATHS.includes(rel)) continue
    let st
    try { st = fs.statSync(file) } catch { continue }
    if (st.size > 512 * 1024) continue
    const data = readJSON(file)
    if (!data) continue
    const entries = []
    try { findScheduleEntries(data, entries, 0) } catch { continue }
    if (!entries.length) continue

    const relPosix = rel.split(path.sep).join('/')
    const cat = guessCategory(relPosix)

    for (const [i, ent] of entries.slice(0, 5).entries()) {
      const n = ent.node
      const label = n.name || n.title || n.label || n.id || n.taskName ||
        friendlyName(relPosix, i)
      const enabled = n.enabled !== false && n.active !== false && n.paused !== true && n.disabled !== true
      const nextMs = ent.next
      const lastMs = ent.last
      const cost = guessCost(ent)

      const schedBits = []
      if (ent.cron) schedBits.push('cron: ' + ent.cron)
      if (ent.iv) {
        const mins = ent.iv / 60000
        schedBits.push('每 ' + (mins >= 1 ? Math.round(mins) + ' 分钟' : Math.round(ent.iv / 1000) + ' 秒'))
      }
      if (!schedBits.length && nextMs) schedBits.push('单次')

      out.push({
        id: 'auto:' + relPosix + '#' + i,
        name: String(label).replace(/\s+/g, ' ').slice(0, 60),
        kind: '自动发现',
        category: cat.id,
        categoryText: cat.label,
        enabled,
        state: !enabled ? 'disabled' : (nextMs && nextMs - nowMs <= 65000 ? 'running' : 'scheduled'),
        stateText: !enabled ? '已停用' : (nextMs && nextMs - nowMs <= 65000 ? '即将触发' : '已排期'),
        scheduleText: schedBits.join(' · ') || '—',
        lastRunText: lastMs ? relText(lastMs, nowMs) + '（' + agoText(lastMs, nowMs) + '）' : '—',
        nextRunText: nextMs ? relText(nextMs, nowMs) + '（' + relFromText(nextMs, nowMs) + '）' : '—',
        costText: cost.text,
        risk: cost.risk,
        nextRunAtMs: Number.isFinite(nextMs) ? nextMs : null,
        lastRunAtMs: Number.isFinite(lastMs) ? lastMs : null,
        runCount: Number(n.runCount || n.runs || n.executedCount || 0) || 0,
        runCountText: (n.runCount || n.runs) ? '已跑 ' + (n.runCount || n.runs) + ' 次' : '',
        origin: guessOrigin(relPosix),
        detail: ['来源文件：$DSH_HOME/' + relPosix, '分类：' + cat.label, '字段线索：' + (ent.cron ? 'cron' : ent.iv ? 'interval' : 'nextRun')],
        sourceFile: relPosix,
      })
    }
  }
  return out
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

const PROBE_CATEGORY = {
  'bili-scroll': ['fetch', '内容抓取'],
  schedule: ['reminder', '定时提醒'],
  'task-board': ['taskboard', '任务板'],
  custom: ['custom', '手工登记'],
}

export function collect(nowMs) {
  const items = []
  const warnings = []
  const probes = [
    ['bili-scroll', probeBili],
    ['schedule', probeSchedule],
    ['task-board', probeTaskBoard],
    ['custom', probeCustom],
    ['discovery', probeDiscovery],
  ]
  for (const [id, fn] of probes) {
    try {
      const r = fn(nowMs)
      if (!Array.isArray(r)) continue
      for (const it of r) {
        if (!it.category) {
          const c = PROBE_CATEGORY[id] || ['unknown', '未知来源']
          it.category = c[0]
          it.categoryText = c[1]
        }
        // 结构化字段兜底：前端排序/倒计时依赖它们，缺一个就退化成「无法比较」
        if (typeof it.origin !== 'string' || !it.origin) it.origin = '未知来源'
        if (typeof it.runCount !== 'number' || !Number.isFinite(it.runCount)) it.runCount = 0
        if (!Number.isFinite(it.nextRunAtMs)) it.nextRunAtMs = null
        if (!Number.isFinite(it.lastRunAtMs)) it.lastRunAtMs = null
        items.push(it)
      }
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

