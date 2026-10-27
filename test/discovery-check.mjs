/**
 * 通用发现探针的自检：
 * 在 $DSH_HOME 下临时造几种「别的插件会写」的排期文件，看探针能不能认出来。
 * 跑完全部删掉（try/finally）。
 */
import fs from 'node:fs'
import path from 'node:path'

const H = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '.', '.dsh')
const TMP = path.join(H, '__probe_test')
const { collect } = await import('../lib/index.js')

let pass = 0
let fail = 0
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ ' + msg) }
}

function write(rel, obj) {
  const p = path.join(TMP, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(obj, null, 2))
}

try {
  fs.rmSync(TMP, { recursive: true, force: true })

  const now = Date.now()
  const iso = (ms) => new Date(ms).toISOString()

  // ① 模拟 @mzzsfy/dsh-cron-board 的 cron-board/jobs.json
  write('cron-board/jobs.json', {
    jobs: [
      { id: 'j1', name: '每日构建', cron: '0 9 * * *', nextRunAt: iso(now + 3600e3), lastRunAt: iso(now - 7200e3), command: 'npm run build' },
      { id: 'j2', name: '周报生成', cron: '0 18 * * 5', nextRunAt: iso(now + 86400e3), prompt: '写一份周报', enabled: true },
    ],
  })

  // ② 模拟 @goodandready/dsh-cron 的 data/tasks.json
  write('data/tasks.json', [
    { id: 't1', title: '清理日志', intervalMs: 1800e3, nextRun: iso(now + 600e3), script: 'clean.sh' },
  ])

  // ③ 模拟 dsh-plugin-heartbeat 的 heartbeat.json（放在含 heartbeat 的目录里，好判断分类）
  write('heartbeat/heartbeat.json', {
    enabled: false,
    intervalSeconds: 1200,
    lastRunAt: iso(now - 300e3),
  })

  const r = collect(now)
  const auto = r.items.filter((i) => String(i.id).startsWith('auto:'))
  console.log('\n  探针发现 ' + auto.length + ' 条自动发现条目：')
  for (const a of auto) {
    console.log('    · ' + a.name + '  [' + a.categoryText + ']  ' + a.scheduleText +
      '  下次 ' + a.nextRunText + '  ' + a.stateText + '  ' + a.costText)
  }
  console.log('')

  ok(auto.some((a) => a.name === '每日构建'), '认出 cron-board 的任务')
  ok(auto.some((a) => a.name === '周报生成' && a.costText.includes('花 token')), '认出会花 token 的任务')
  ok(auto.some((a) => a.name === '清理日志' && a.costText.includes('不花 token')), '认出只跑脚本的任务')
  ok(auto.some((a) => a.name === '每日构建' && a.category === 'cron'), 'cron 分类正确')
  ok(auto.find((a) => a.name === '每日构建')?.scheduleText.includes('cron:'), 'cron 表达式被解析出来')
  ok(auto.find((a) => a.name === '清理日志')?.scheduleText.includes('30 分钟'), 'interval 被换算成分钟')
  ok(r.warnings.length === 0, '没有探针报错')
} finally {
  fs.rmSync(TMP, { recursive: true, force: true })
  console.log('\n  临时文件已清理：' + TMP)
}

console.log('\n通过 ' + pass + '，失败 ' + fail)
if (fail) process.exit(1)
