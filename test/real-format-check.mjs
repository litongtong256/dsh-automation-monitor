// test/real-format-check.mjs
// ---------------------------------------------------------------------------
// 用 @mzzsfy/dsh-cron-board 和 @michengai/dsh-automation **源码里的真实字段名**
// 造出它们会写的文件，验证本插件认不认。
//
// 为什么不直接让它们自己写：这两个插件都要求用户先在 UI 里建任务才落盘，
// 建了就可能真跑、真花钱。所以这里按它们的真实 schema 造 fixture。
//
// 安全：全部 enabled:false，跑完立刻删（try/finally 保证）。
// ---------------------------------------------------------------------------

import fs from 'node:fs'
import path from 'node:path'

const HOME = process.env.DSH_HOME || 'E:/dsh-home'
const created = []

function write(rel, obj) {
  const p = path.join(HOME, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(obj, null, 2))
  created.push(p)
}

function cleanup() {
  for (const p of created) { try { fs.unlinkSync(p) } catch { /* ignore */ } }
  try { fs.rmdirSync(path.join(HOME, 'cron-board')) } catch { /* 非空或不存在就算了 */ }
}

const now = Date.now()

try {
  // ── @mzzsfy/dsh-cron-board → cron-board/jobs.json
  //    真实字段：title / name / enabled / schedule|cron / nextRunAt / prompt|command
  write('cron-board/jobs.json', {
    version: 1,
    jobs: [
      { id: 'j1', title: '每天清理日志', name: 'clean-logs', enabled: false, schedule: '0 3 * * *', nextRunAt: now + 3600000, prompt: '清理 7 天前的日志' },
      { id: 'j2', title: '每小时探活', enabled: false, cron: '0 * * * *', nextRunAt: now + 600000, command: 'curl http://127.0.0.1:3000/ping' },
    ],
  })

  // ── @michengai/dsh-automation → automation-settings.json
  //    真实字段：name / enabled / runtime / nextRunAt / prompt|command
  write('automation-settings.json', {
    version: 1,
    tasks: [
      { id: 'a1', name: '每周代码巡检', enabled: false, runtime: 'llm', prompt: '检查最近一周的提交', nextRunAt: now + 7200000 },
      { id: 'a2', name: '每日备份', enabled: false, runtime: 'script', command: 'backup.sh', nextRunAt: null },
    ],
  })
} catch (e) {
  cleanup()
  console.error('造 fixture 失败：', e)
  process.exit(1)
}

const mod = await import(new URL('../lib/index.js', import.meta.url).href)
const r = mod.collect(now)
cleanup()

const hits = r.items.filter((it) => {
  const f = it.sourceFile || ''
  return f.startsWith('cron-board/') || f === 'automation-settings.json'
})

console.log('\n=== 由这两个插件的真实格式造出来的条目 ===')
if (!hits.length) console.log('  （一条都没认出来 —— 这算失败）')
for (const it of hits) {
  console.log('  [' + (it.categoryText || '?') + '] ' + it.name
    + ' | ' + it.stateText
    + ' | 下次: ' + (it.nextRunText || '—')
    + ' | 来源: ' + it.origin
    + ' | 花费: ' + it.costText
    + ' | runCount: ' + it.runCount)
}

const cronOk = hits.some((h) => (h.sourceFile || '').startsWith('cron-board/')
  && /cron 调度/.test(h.categoryText || ''))
const autoOk = hits.some((h) => h.sourceFile === 'automation-settings.json'
  && /自动化|定时任务/.test(h.categoryText || ''))
// 名字要用人能读的 title，不是 slug 形式的 name
const nameOk = hits.some((h) => h.name === '每天清理日志')

console.log('\n=== 判定 ===')
console.log('  @mzzsfy/dsh-cron-board    ', cronOk ? '\u2713 认出来了，分类 cron 调度' : '\u2717 没认出来')
console.log('  @michengai/dsh-automation ', autoOk ? '\u2713 认出来了，分类自动化/定时任务' : '\u2717 没认出来')
console.log('  显示名用 title 而不是 slug ', nameOk ? '\u2713' : '\u2717（显示了 clean-logs 之类）')
console.log('  临时文件已清理            ', created.every((p) => !fs.existsSync(p)) ? '\u2713' : '\u2717')

process.exit(cronOk && autoOk && nameOk ? 0 : 1)
