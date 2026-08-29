// perf/drag-fps.mjs — 拖拽帧率测试脚本
//
// 测试目标（B-4-2）：宠物窗口「拖拽」交互帧率 ≥ 30 fps
//
// 与 fps-test.mjs（Live2D 渲染帧率）互补：本脚本测的是**拖拽交互**这一高频
// 用户操作场景下的渲染帧率（每帧更新宠物位置 translate3d + 装饰部件摆动）。
//
// 实现方案：
//   1. 使用 Playwright 启动 Chromium 浏览器
//   2. 加载 perf/drag-fps.html 页面
//   3. 页面内通过 window.__runDragFps(duration) 模拟指针拖拽轨迹（圆周路径），
//      用 requestAnimationFrame 采样帧间隔
//   4. 通过 window.__perfDragFpsResult 读取结果
//   5. 判断平均 FPS 是否 ≥ 30
//
// ⚠️ 范围说明（与 fps-test.html 同口径）：本页测得的是 **webview 渲染层**帧率，
// 不含真实 Tauri 窗口拖动时 Rust 侧 outerPosition/setPosition 的开销。真机拖拽
// 帧率会更低，因此该指标用于**横向对比与回归检测**，不代表端到端真机帧率。
//
// 依赖：playwright（需 npx playwright install chromium）
//
// 环境变量：
//   SPIRITPAL_FPS_DURATION — 测量时长（ms，默认 5000）
//   SPIRITPAL_FPS_HEADLESS — 是否无头模式（1=无头，0=有头，默认 1）
//
// 运行方式：
//   node perf/drag-fps.mjs
//   pnpm perf

import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THRESHOLDS, saveResultJson, formatResult, printResult } from './_helpers.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')

async function runDragFpsTest() {
  console.log('━'.repeat(60))
  console.log('  🖱️  拖拽帧率测试 (Drag FPS Test)')
  console.log('━'.repeat(60))

  const duration = parseInt(process.env.SPIRITPAL_FPS_DURATION || '5000', 10)
  const headless = process.env.SPIRITPAL_FPS_HEADLESS !== '0'

  console.log(`  ℹ️  测量时长: ${duration / 1000} 秒`)
  console.log(`  ℹ️  浏览器:  Chromium (${headless ? '无头' : '有头'}模式)`)

  const htmlPath = resolve(__dirname, 'drag-fps.html')
  const url = new URL('file:///' + htmlPath.replace(/\\/g, '/'))
  url.searchParams.set('duration', String(duration))
  const pageUrl = url.toString()
  console.log(`  ℹ️  页面:    ${pageUrl}`)

  const browser = await chromium.launch({
    headless,
    args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  })

  const context = await browser.newContext({ viewport: { width: 400, height: 500 } })
  const page = await context.newPage()

  page.on('console', (msg) => {
    const text = msg.text()
    if (msg.type() === 'error') console.log(`  [页面错误] ${text}`)
    else if (msg.type() === 'warning') console.log(`  [页面警告] ${text}`)
  })

  try {
    console.log('  ℹ️  加载测试页面...')
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // 等待 __runDragFps 注入完成（页面脚本同步执行，DOMContentLoaded 后即可用）
    await page.waitForFunction(() => typeof window.__runDragFps === 'function', {
      timeout: 10000,
    })

    console.log(`  ℹ️  模拟拖拽并测量帧率（约 ${duration / 1000} 秒）...`)
    const result = await page.evaluate((d) => window.__runDragFps(d), duration)

    if (result.error) {
      const testResult = formatResult({
        name: '拖拽帧率',
        value: 0,
        unit: 'fps',
        threshold: THRESHOLDS.fps,
        compare: 'gte',
        detail: `页面错误: ${result.error}`,
      })
      printResult(testResult)
      return testResult
    }

    console.log(`  ℹ️  总帧数:   ${result.frames}`)
    console.log(`  ℹ️  平均帧间隔: ${result.avgFrameMs}ms`)
    console.log(`  ℹ️  P95 帧间隔: ${result.p95FrameMs}ms`)
    console.log(`  ℹ️  最大帧间隔: ${result.maxFrameMs}ms`)

    const testResult = formatResult({
      name: '拖拽帧率',
      value: result.fps,
      unit: 'fps',
      threshold: THRESHOLDS.fps,
      compare: 'gte',
      detail: `平均 ${result.fps}fps | P95 帧间隔 ${result.p95FrameMs}ms | 最大帧间隔 ${result.maxFrameMs}ms | ${result.frames} 帧（webview 渲染层，不含 Tauri 窗口拖动开销）`,
    })
    printResult(testResult)
    saveResultJson('drag-fps', testResult)
    return testResult
  } finally {
    await browser.close()
  }
}

try {
  const result = await runDragFpsTest()
  process.exit(result.passed ? 0 : 1)
} catch (err) {
  console.error('\n  💥 测试发生异常:', err.message)
  console.error(err.stack)
  process.exit(2)
}
