/**
 * 不启动 DSH，用 mock 的 window/document/React 把 client.js 跑一遍：
 * 验证它进了 __ModuleLoader__、注册到 conversation.view 槽位、组件能渲染出第一屏。
 * 跑：node test/self-check-client.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(HERE, '..', 'lib', 'client.js'), 'utf8')

let bad = 0
const ok = (cond, label) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label)
  if (!cond) bad++
}

/* ---------- mock 浏览器 ---------- */
let loaded = null
const win = { __ModuleLoader__: { load(def) { loaded = def } } }

const styleTags = []
const doc = {
  head: { appendChild(el) { styleTags.push(el) } },
  createElement(tag) {
    return {
      tag, textContent: '', attrs: {},
      setAttribute(k, v) { this.attrs[k] = v },
      remove() { const i = styleTags.indexOf(this); if (i >= 0) styleTags.splice(i, 1) },
    }
  },
}

const React = {
  createElement(type, props, ...children) { return { type, props: props || {}, children } },
  useState(init) { return [typeof init === 'function' ? init() : init, () => {}] },
  useRef(v) { return { current: v } },
  useCallback(f) { return f },
  useEffect() {},
  useMemo(f) { return f() },
}
const fakeRequire = (n) => {
  if (n === 'react') return React
  throw new Error('client.js 不该 require 别的模块：' + n)
}
const fakeFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ items: [], usage: {}, generatedAtText: 'x' }),
})

new Function('window', 'document', 'fetch', src)(win, doc, fakeFetch)

/* ---------- 断言 ---------- */
console.log('模块自注册：')
ok(!!loaded, '__ModuleLoader__.load 被调用')
ok(loaded && loaded.id === 'dsh-automation-monitor', "id === 'dsh-automation-monitor'")
ok(typeof (loaded && loaded.factory) === 'function', 'factory 是函数')

const mod = loaded.factory(fakeRequire)
console.log('\n模块导出：')
ok(Array.isArray(mod.inject) && mod.inject.includes('slots'), "inject 含 'slots'")
ok(typeof mod.apply === 'function', 'apply 是函数')

/* ---------- 模拟 slots 槽位 ---------- */
const injected = []
const registered = []
const slots = {
  inject(name, cb) { injected.push(name); cb() },
  register(cfg, renderer) { registered.push({ cfg, renderer }); return { dispose() {} } },
}
const ctx = {
  get(k) { return k === 'slots' ? slots : undefined },
  effect(fn) { const d = fn(); return d },
}

mod.apply(ctx)

console.log('\n槽位注册：')
ok(injected.includes('conversation.view'), "注入 'conversation.view' 槽位")
ok(registered.length === 1, '只注册了 1 个视图')
const reg = registered[0] || { cfg: {}, renderer: null }
ok(reg.cfg.name === 'conversation.view', "cfg.name === 'conversation.view'")
ok(reg.cfg.id === 'automation-monitor', "cfg.id === 'automation-monitor'")
ok(reg.cfg.label === '自动化', "标签页文字是「自动化」")
ok(reg.cfg.scope === 'session', "scope === 'session'")

console.log('\n样式注入：')
ok(styleTags.length === 1, '注入了 1 个 <style>')
ok(styleTags[0] && styleTags[0].textContent.includes('data-am-page'), 'CSS 里有 [data-am-page]')

/* ---------- 渲染第一屏 ---------- */
console.log('\n组件渲染（无数据时的首屏）：')
let tree = null
try {
  const el = reg.renderer()
  ok(typeof el.type === 'function', 'renderer 返回一个组件元素')
  tree = el.type(el.props)   // 直接调用函数组件（hooks 已 mock）
  ok(tree && tree.props && tree.props['data-am-page'] === '', '渲染出 [data-am-page] 容器')
  const text = JSON.stringify(tree, (k, v) => (typeof v === 'function' ? '<fn>' : v))
  ok(text.includes('自动化监视'), '首屏含标题「自动化监视」')
  ok(text.includes('正在读取自动化任务'), '无数据时显示读取中')
} catch (e) {
  ok(false, '渲染抛错：' + (e && e.message))
}

console.log(bad === 0 ? '\n全部通过' : '\n有 ' + bad + ' 项失败')
process.exit(bad === 0 ? 0 : 1)
