/**
 * 模拟 cordis 上下文，验证 host 半端只注册了一个只读接口、不碰别的通道。
 * 跑：node test/self-check-apply.mjs
 */
import plugin from '../lib/index.js'

const calls = { routes: [], onEvents: [], injectTables: [], injectDeps: [] }
const handlers = {}

const fakeWebServer = {
  register(route) {
    calls.routes.push(route.path)
    handlers[route.path] = route.handler
    return () => {}
  },
}

const fakeRoot = {
  effect(fn) {
    const d = fn()
    if (typeof d !== 'function') throw new Error('effect 回调没有返回 disposer')
    return d
  },
  on(ev, cb) {
    calls.onEvents.push(ev)
    const table = []
    cb(table)
    calls.injectTables.push(table)
    return () => {}
  },
  inject(deps, cb) {
    if (!Array.isArray(deps)) throw new Error('inject 依赖不是数组')
    calls.injectDeps.push(deps.join(','))
    cb({ webServer: fakeWebServer })
  },
}

plugin.apply(fakeRoot)

let bad = 0
const ok = (cond, label) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label)
  if (!cond) bad++
}

console.log('插件名：', plugin.name)
ok(plugin.name === 'automation-monitor', '插件名正确')
ok(calls.routes.length === 1 && calls.routes[0] === '/automation/status.json', '只注册了 /automation/status.json')
ok(!calls.routes.includes('/automation/panel.js'), '不再有 panel.js 路由（浮层已废弃）')
ok(calls.onEvents.length === 0, '不再挂 webserver/index-inject 注入行')
ok(calls.injectDeps.join(';') === 'webServer', '只依赖 webServer')

const res = {
  statusCode: 0,
  headers: null,
  body: '',
  writeHead(code, h) { this.statusCode = code; this.headers = h },
  end(b) { this.body = String(b || '') },
}
await handlers['/automation/status.json']({ method: 'GET', headers: {} }, res)
const parsed = JSON.parse(res.body)
console.log('\nstatus.json 状态码：', res.statusCode)
ok(res.statusCode === 200, 'HTTP 200')
ok(Array.isArray(parsed.items), 'items 是数组')
ok(parsed.items.length >= 1, '至少有 1 个条目')
ok(typeof parsed.generatedAtText === 'string', '有生成时间文案')
ok(typeof parsed.usage === 'object' && parsed.usage !== null, '有 usage')
console.log('条目：', parsed.items.map((i) => i.name + '[' + i.state + ']').join(' / '))
console.log('使用量：', JSON.stringify(parsed.usage), '警告：', parsed.warnings.length)

console.log(bad === 0 ? '\n全部通过' : '\n有 ' + bad + ' 项失败')
process.exit(bad === 0 ? 0 : 1)
