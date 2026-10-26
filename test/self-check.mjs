import { collect } from '../lib/index.js'

const r = collect(Date.now())
console.log(JSON.stringify(r, null, 2))
console.log('\n--- 摘要 ---')
console.log('条目数：', r.items.length, ' 警告：', r.warnings.length)
for (const it of r.items) {
  console.log(`[${it.state}] ${it.name} | 上次 ${it.lastRunText} | 下次 ${it.nextRunText}`)
}
