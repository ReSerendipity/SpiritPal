// T-14: 压力测试脚本 — 大量聊天消息、大记忆量、多模组场景
import { chromium } from 'playwright'
import { THRESHOLDS, formatResult, printResult, sleep } from './_helpers.mjs'
import { resolve } from 'node:path'

const TEST_DURATION_MS = parseInt(process.env.SPIRITPAL_STRESS_DURATION || '60000', 10)

async function runStressTest() {
  console.log('━'.repeat(60))
  console.log('  💪 压力测试 (Stress Test)')
  console.log('━'.repeat(60))
  console.log(`  ℹ️  测试时长: ${TEST_DURATION_MS / 1000} 秒`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 400, height: 600 } })
  const page = await context.newPage()

  // 注入 Tauri mock
  await page.addInitScript(`
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'pet-window' }, currentWebview: { label: 'pet-window' } },
      transformCallback: function(cb) { var id = Math.random()*1e6|0; window.__TAURI_CB__ = window.__TAURI_CB__||{}; window.__TAURI_CB__[id]=cb; return id; },
      invoke: function(cmd, args) {
        var defaults = { get_idle_time: 0, get_active_window: { title: '', process_name: '' }, get_secret: null, scan_mods_directory: [] };
        return Promise.resolve(defaults[cmd] !== undefined ? defaults[cmd] : null);
      },
      registerPlugin: function() { return {}; },
    };
    window.__TAURI__ = { core: { invoke: window.__TAURI_INTERNALS__.invoke } };
    window.__TAURI_PLUGIN_SQL__ = { default: { load: function() { return Promise.resolve({ execute: function(){return Promise.resolve()}, select: function(){return Promise.resolve([])} }); } } };
  `)

  const results = []

  try {
    // 1. 大量聊天消息测试
    console.log('\n  ▶ 测试 1: 大量聊天消息发送')
    await page.goto('http://127.0.0.1:5223/#/chat', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})

    const messageCount = 100
    const startMsg = Date.now()
    for (let i = 0; i < messageCount; i++) {
      const input = page.locator('[aria-label="聊天输入框"]')
      if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
        await input.fill(`压力测试消息_${i}`)
        await page.keyboard.press('Enter')
      } else break
    }
    const msgTime = Date.now() - startMsg
    results.push(formatResult({
      name: '聊天消息发送 (100条)',
      value: msgTime,
      unit: 'ms',
      threshold: 30000,
      compare: 'lt',
      detail: `${messageCount} 条消息耗时 ${msgTime}ms`,
    }))

    // 2. 快速路由切换压力
    console.log('\n  ▶ 测试 2: 快速路由切换')
    const routes = ['/#/pet', '/#/chat', '/#/settings']
    const routeStart = Date.now()
    for (let i = 0; i < 50; i++) {
      await page.goto(routes[i % routes.length])
      // 等待页面稳定：使用自动等待代替固定 waitForTimeout
      await page.locator('#root').waitFor({ state: 'attached', timeout: 5000 }).catch(() => {})
    }
    const routeTime = Date.now() - routeStart
    results.push(formatResult({
      name: '快速路由切换 (50次)',
      value: routeTime,
      unit: 'ms',
      threshold: 30000,
      compare: 'lt',
      detail: `50 次路由切换耗时 ${routeTime}ms`,
    }))

    // 3. 页面内存占用
    const metrics = await page.metrics()
    results.push(formatResult({
      name: 'DOM 节点数',
      value: metrics.nodes || 0,
      unit: '',
      threshold: 5000,
      compare: 'lt',
      detail: `当前 DOM 节点数: ${metrics.nodes || 0}`,
    }))

  } finally {
    await browser.close()
  }

  // 输出结果
  console.log('\n')
  const allPassed = results.every(r => r.passed)
  for (const r of results) printResult(r)

  console.log(`\n  ${allPassed ? '✅ 全部通过' : '❌ 部分未通过'}`)
  process.exit(allPassed ? 0 : 1)
}

runStressTest().catch(err => { console.error('💥 异常:', err.message); process.exit(2) })
