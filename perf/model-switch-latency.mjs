// perf/model-switch-latency.mjs — 模型热切换延迟测试（真实触发，2026-09-11 替换 sleep(300) 模拟）
//
// 测试目标：模型热切换延迟 < 500ms（PRD v0.2；从触发切换到新模型可交互）
//
// 为什么用 Playwright 页内测量（而非 Tauri 命令）：
//   模型/角色切换在本项目中是纯前端状态（无 Tauri 命令），生产代码路径为
//   src/components/Live2DRenderer.tsx 的 modelPath effect：
//   model.destroy() + app.destroy(true,{children:true}) → new PIXI.Application()
//   → Live2DModel.from(newPath) → stage.addChild(model) → onReady。
//   因此本脚本与 perf/fps-test.mjs 同构：用 Playwright 加载 perf/model-switch.html，
//   页面以与生产同版本的 pixi.js@7.4.3 + pixi-live2d-display@0.4.0(cubism4) 真实
//   执行上述切换路径，并用页面内 performance.now() 计时（零驱动开销）。
//
// 口径：
//   - warm（热切换，主指标）：目标模型资源已缓存时，从触发切换到新模型 addChild
//     后 2 个 rAF（首帧已渲染，≈ onReady 可交互）的耗时中位数
//   - cold：目标模型首次 from() 的耗时（含资源下载/解码，仅参考，不参与阈值判定）
//   - 不含 React/store 切换开销；应用内端到端（含 GUI 驱动开销）实测值见
//     RELEASE_VERIFICATION.md 四章（2026-09-11 GUI 实测行）
//
// 依赖：playwright（需 npx playwright install chromium）
//
// 环境变量：
//   SPIRITPAL_MODELSWITCH_A    — 自定义模型 A（.model3.json URL，相对 perf/ 或绝对 URL）
//   SPIRITPAL_MODELSWITCH_B    — 自定义模型 B
//   SPIRITPAL_MODELSWITCH_WARM — 热切换轮数（默认 3，每轮 2 个 warm 样本）
//   SPIRITPAL_FPS_HEADLESS     — 是否无头模式（1=无头默认，0=有头，与 fps 测试共用）
//
// 运行方式：
//   node perf/model-switch-latency.mjs
//   pnpm perf:model-switch

import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { saveResultJson, formatResult, printResult } from './_helpers.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')

const MODEL_SWITCH_THRESHOLD_MS = 500
const WARM_ROUNDS = parseInt(process.env.SPIRITPAL_MODELSWITCH_WARM || '3', 10)
const HEADLESS = process.env.SPIRITPAL_FPS_HEADLESS !== '0'
// SPIRITPAL_PERF_GPU=1：去掉 swiftshader 软件渲染兜底，使用本机真实 GPU（N 卡机器验收口径）
const USE_NATIVE_GPU = process.env.SPIRITPAL_PERF_GPU === '1'

// ============================================================
// 主测试函数
// ============================================================
async function runModelSwitchTest() {
  console.log('━'.repeat(60))
  console.log('  ⏱️  模型切换延迟测试 (Model Switch Latency) — 真实 Live2D 切换')
  console.log('━'.repeat(60))
  console.log(`  ℹ️  热切换轮数: ${WARM_ROUNDS}（每轮 2 个 warm 样本）`)
  console.log(`  ℹ️  浏览器:    Chromium (${USE_NATIVE_GPU ? '有头 + 本机 GPU' : HEADLESS ? '无头' : '有头'}模式)`)

  // 构建页面 URL（默认模型路径在页面内以相对路径给出）
  const htmlPath = resolve(__dirname, 'model-switch.html')
  const url = new URL('file:///' + htmlPath.replace(/\\/g, '/'))
  url.searchParams.set('warm', String(WARM_ROUNDS))
  if (process.env.SPIRITPAL_MODELSWITCH_A) {
    url.searchParams.set('a', process.env.SPIRITPAL_MODELSWITCH_A)
  }
  if (process.env.SPIRITPAL_MODELSWITCH_B) {
    url.searchParams.set('b', process.env.SPIRITPAL_MODELSWITCH_B)
  }
  const pageUrl = url.toString()

  console.log(`  ℹ️  页面:      ${pageUrl}`)
  console.log('  ℹ️  启动浏览器...')

  // --- 1. 启动浏览器（默认参数与 fps-test 一致；SPIRITPAL_PERF_GPU=1 时走本机真实 GPU） ---
  const browser = await chromium.launch({
    headless: USE_NATIVE_GPU ? false : HEADLESS,
    args: [
      // 默认 swiftshader 软件渲染兜底（与 fps-test 一致，跨机器可重复）；
      // N 卡机器验收设 SPIRITPAL_PERF_GPU=1 走真实 GPU（与生产 WebView2 口径一致）
      ...(USE_NATIVE_GPU ? [] : ['--use-gl=swiftshader']),
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--allow-file-access-from-files', // file:// 页面读取同盘模型 JSON/纹理
    ],
  })

  const context = await browser.newContext({ viewport: { width: 400, height: 520 } })
  const page = await context.newPage()

  page.on('console', (msg) => {
    const text = msg.text()
    if (msg.type() === 'error') console.log(`  [页面错误] ${text}`)
    else if (msg.type() === 'warning') console.log(`  [页面警告] ${text}`)
  })

  try {
    // --- 2. 加载页面 ---
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

    await page.waitForFunction(
      () => typeof window.PIXI !== 'undefined' && typeof window.PIXI.live2d !== 'undefined',
      { timeout: 15000 },
    )

    // --- 3. 等待测量完成（cold + warm 全部跑完） ---
    console.log('  ℹ️  等待真实切换测量完成...')
    const result = await page.waitForFunction(
      () => window.__perfModelSwitchResult !== null,
      { timeout: 90000 },
    ).then(() => page.evaluate(() => window.__perfModelSwitchResult))

    if (result.error) {
      console.log(`  ❌ 页面测量失败: ${result.error}`)
      const failResult = formatResult({
        name: '模型切换延迟（热切换，真实）',
        value: Number.POSITIVE_INFINITY,
        unit: 'ms',
        threshold: MODEL_SWITCH_THRESHOLD_MS,
        compare: 'lt',
        detail: `页面错误: ${result.error}`,
      })
      printResult(failResult)
      saveResultJson('model-switch', failResult)
      return failResult
    }

    // --- 4. 输出结果 ---
    console.log(`  ℹ️  模型: A=${result.models.a} / B=${result.models.b}`)
    console.log(`  ℹ️  初始加载(A): ${result.initialLoadMs} ms（不计入切换阈值）`)
    console.log(`  ℹ️  冷切换 B(首次): ${result.coldMs.join(', ')} ms（含资源加载，仅参考）`)
    console.log('  ℹ️  热切换样本 (ms):', result.warmSamples.join(', '))
    for (const [to, st] of Object.entries(result.directionStats || {})) {
      console.log(`     → ${to}: median=${st.median} mean=${st.mean} [${st.min}~${st.max}] ms (n=${st.n})`)
    }

    const detail =
      `真实 Live2D 热切换中位数（pixi ${result.libs.pixi} + pixi-live2d-display ${result.libs['pixi-live2d-display']}）` +
      `｜口径: destroy模型/Application→新建→Live2DModel.from→addChild→2rAF，页面内 performance.now() 零驱动开销` +
      `｜warm mean/min/max/p95=${result.warm.mean}/${result.warm.min}/${result.warm.max}/${result.warm.p95} ms` +
      `｜cold=${result.coldMs.join('/')} ms｜初始加载=${result.initialLoadMs} ms` +
      `｜GUI 端到端（含驱动开销）见 RELEASE_VERIFICATION.md 四章`

    const testResult = formatResult({
      name: '模型切换延迟（热切换，真实）',
      value: result.warm.median,
      unit: 'ms',
      threshold: MODEL_SWITCH_THRESHOLD_MS,
      compare: 'lt',
      detail,
    })
    printResult(testResult)
    console.log(`         阈值:   < ${MODEL_SWITCH_THRESHOLD_MS} ms`)

    // 附带完整样本供 results JSON 消费（formatResult 之外的测量明细）
    saveResultJson('model-switch', {
      ...testResult,
      metric: 'warm-median',
      warm: result.warm,
      warmSamples: result.warmSamples,
      directionStats: result.directionStats,
      renderer: USE_NATIVE_GPU ? 'native-gpu' : 'swiftshader',
      coldMs: result.coldMs,
      initialLoadMs: result.initialLoadMs,
      models: result.models,
      libs: result.libs,
      endpoint: result.endpoint,
    })
    return testResult
  } finally {
    await browser.close()
  }
}

// ============================================================
// 入口
// ============================================================
try {
  const result = await runModelSwitchTest()
  process.exit(result.passed ? 0 : 1)
} catch (err) {
  console.error('\n  💥 测试发生异常:', err.message)
  console.error(err.stack)
  process.exit(2)
}
