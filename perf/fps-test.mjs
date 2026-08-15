// perf/fps-test.mjs — Live2D 帧率测试脚本
//
// 测试目标（PRD v0.2）：Live2D 渲染帧率 ≥ 30 fps
//
// 实现方案：
//   1. 使用 Playwright 启动 Chromium 浏览器
//   2. 加载 perf/fps-test.html 页面
//   3. 页面内通过 pixi.js + pixi-live2d-display 渲染 Live2D 模型
//   4. 页面内使用 requestAnimationFrame 测量 5 秒内的帧率
//   5. 通过 window.__perfFpsResult 读取结果
//   6. 判断平均 FPS 是否 ≥ 30
//
// 依赖：playwright（需 npx playwright install chromium）
//
// 环境变量：
//   SPIRITPAL_FPS_DURATION — 测量时长（ms，默认 5000）
//   SPIRITPAL_FPS_MODEL    — 自定义 Live2D 模型 URL
//   SPIRITPAL_FPS_HEADLESS — 是否无头模式（1=无头，0=有头，默认 1）
//
// 运行方式：
//   node perf/fps-test.mjs
//   pnpm perf:fps

import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THRESHOLDS, formatResult, printResult } from './_helpers.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')

// ============================================================
// 主测试函数
// ============================================================
async function runFpsTest() {
  console.log('━'.repeat(60))
  console.log('  🎬 Live2D 帧率测试 (FPS Test)')
  console.log('━'.repeat(60))

  const duration = parseInt(process.env.SPIRITPAL_FPS_DURATION || '5000', 10)
  const headless = process.env.SPIRITPAL_FPS_HEADLESS !== '0'
  const modelUrl = process.env.SPIRITPAL_FPS_MODEL || ''

  console.log(`  ℹ️  测量时长: ${duration / 1000} 秒`)
  console.log(`  ℹ️  浏览器:  Chromium (${headless ? '无头' : '有头'}模式)`)

  // 构建页面 URL
  const htmlPath = resolve(__dirname, 'fps-test.html')
  const url = new URL('file:///' + htmlPath.replace(/\\/g, '/'))
  url.searchParams.set('duration', String(duration))
  if (modelUrl) {
    url.searchParams.set('model', modelUrl)
  }
  const pageUrl = url.toString()

  console.log(`  ℹ️  页面:    ${pageUrl}`)
  console.log(`  ℹ️  启动浏览器...`)

  // --- 1. 启动浏览器 ---
  const browser = await chromium.launch({
    headless,
    args: [
      '--use-gl=swiftshader', // 软件渲染兜底，确保 WebGL 可用
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ],
  })

  const context = await browser.newContext({
    viewport: { width: 400, height: 500 },
  })

  const page = await context.newPage()

  // 收集控制台日志
  page.on('console', (msg) => {
    const text = msg.text()
    if (msg.type() === 'error') {
      console.log(`  [页面错误] ${text}`)
    } else if (msg.type() === 'warning') {
      console.log(`  [页面警告] ${text}`)
    }
  })

  try {
    // --- 2. 加载页面 ---
    console.log('  ℹ️  加载测试页面...')
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // 等待 Pixi 和 Live2D 库加载
    await page.waitForFunction(
      () => typeof window.PIXI !== 'undefined' && typeof window.PIXI.live2d !== 'undefined',
      { timeout: 15000 },
    ).catch(() => {
      console.log('  ⚠️  pixi-live2d-display 库加载超时，将使用回退模式')
    })

    // --- 3. 等待测量完成 ---
    console.log(`  ℹ️  等待 FPS 测量完成（约 ${duration / 1000 + 10} 秒）...`)

    const result = await page.waitForFunction(
      () => {
        return window.__perfFpsResult !== null
      },
      { timeout: duration + 30000 }, // 测量时长 + 加载缓冲
    ).then(() => page.evaluate(() => window.__perfFpsResult))

    // --- 4. 输出结果 ---
    if (result.error) {
      console.log(`  ❌ 页面测量失败: ${result.error}`)
      const testResult = formatResult({
        name: 'Live2D 帧率',
        value: 0,
        unit: 'fps',
        threshold: THRESHOLDS.fps,
        compare: 'gte',
        detail: `页面错误: ${result.error}`,
      })
      printResult(testResult)
      return testResult
    }

    console.log(`  ℹ️  模型加载: ${result.modelLoaded ? '成功' : '失败（回退模式）'}`)
    console.log(`  ℹ️  总帧数:   ${result.frames}`)
    console.log(`  ℹ️  Ticker FPS: ${result.tickerFps}`)

    const testResult = formatResult({
      name: 'Live2D 帧率',
      value: result.fps,
      unit: 'fps',
      threshold: THRESHOLDS.fps,
      compare: 'gte',
      detail: `requestAnimationFrame FPS: ${result.fps} | Pixi Ticker FPS: ${result.tickerFps} | ${result.modelLoaded ? 'Live2D 模型' : '回退动画'}`,
    })
    printResult(testResult)
    return testResult
  } finally {
    await browser.close()
  }
}

// ============================================================
// 入口
// ============================================================
try {
  const result = await runFpsTest()
  process.exit(result.passed ? 0 : 1)
} catch (err) {
  console.error('\n  💥 测试发生异常:', err.message)
  console.error(err.stack)
  process.exit(2)
}
