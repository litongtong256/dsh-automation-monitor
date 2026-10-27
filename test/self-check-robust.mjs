// test/self-check-robust.mjs
// ---------------------------------------------------------------------------
// 目的：证明**任何**宿主状态下 apply() 都不会把异常抛出去。
//
// 为什么这条最重要：宿主加载插件时如果 apply() 抛异常，轻则这个插件不工作，
// 重则整个 DSH 起不来（白屏 / 闪退）。所以「不抛」是底线，不是可选项。
//
// 这里故意喂各种坏输入：缺 API、坏 ctx、坏 webServer、自己会抛的 inject……
// 每一条都必须安静通过。
// ---------------------------------------------------------------------------

import plugin from '../lib/index.js'

let pass = 0
let fail = 0

function check(name, fn) {
  try {
    fn()
    console.log('  \u2713 ' + name)
    pass++
  } catch (e) {
    console.log('  \u2717 ' + name + ' — ' + ((e && e.message) || e))
    fail++
  }
}

// 探测期间把 warn 静音，避免刷屏（这些 warn 是预期行为）
const realWarn = console.warn
console.warn = () => {}

const cases = [
  ['root 是 undefined', () => plugin.apply(undefined)],
  ['root 是 null', () => plugin.apply(null)],
  ['root 是字符串', () => plugin.apply('nope')],
  ['root 是空对象（没有 inject）', () => plugin.apply({})],
  ['root.inject 不是函数', () => plugin.apply({ inject: 'nope' })],
  ['root.effect 自己会抛', () => plugin.apply({ inject() {}, effect() { throw new Error('effect boom') } })],
  ['root.inject 传 null ctx', () => plugin.apply({ inject: (deps, cb) => cb(null) })],
  ['root.inject 传空 ctx', () => plugin.apply({ inject: (deps, cb) => cb({}) })],
  ['webServer 没有 register', () => plugin.apply({ inject: (deps, cb) => cb({ webServer: {} }) })],
  ['webServer.register 自己会抛', () => plugin.apply({
    inject: (deps, cb) => cb({ webServer: { register() { throw new Error('register boom') } } }),
  })],
  ['root.inject 自己会抛', () => plugin.apply({ inject() { throw new Error('inject boom') } })],
  ['root.inject 不调用回调', () => plugin.apply({ inject() { /* 什么都不做 */ } })],
  ['正常宿主（对照）', () => plugin.apply({
    effect(fn) { fn() },
    inject(deps, cb) { cb({ webServer: { register(route) { return () => {} } } }) },
  })],
]

for (const [name, fn] of cases) check(name, fn)

console.warn = realWarn

console.log('')
if (fail === 0) {
  console.log('全部通过（' + pass + '/' + cases.length + '）—— 任何宿主状态都不会被本插件拖垮')
  process.exit(0)
} else {
  console.log('失败 ' + fail + ' 项')
  process.exit(1)
}
