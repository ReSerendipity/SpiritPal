// pixi 渲染栈版本守卫 — 关闭「pixi.js 7→8 升级」这条登记滞后项
//
// 为什么要这条测试，而不是只把债项从表里划掉：
//   ADR-0004 记录的真实事故是「pixi 7 + pixi-live2d-display 0.4」**能编译、能启动，但 Cubism 模型不上屏**
//   ——版本错配的失败是**运行期静默**的，`tsc` 与单测都拦不住。本轮口径不做真机运行态验证，
//   所以把「文档结论 / 依赖声明 / 实装版本 / 源码 API 面」四者的一致性做成静态断言：
//   ① package.json 声明必须 pixi.js 8.x 且 live2d 插件 1.x（两者成对；降回 7 / 0.4 立刻红）；
//   ② node_modules 实装版本同样是 8.x / 1.x（声明对了但锁文件解析成旧版本的场景也红）；
//   ③ ADR-0004 状态必须是 Superseded——文档若被回改成「锁定 7.4」，与依赖现状矛盾，当场红；
//   ④ src 内不得出现 v7-only API（beginFill / endFill / lineStyle / app.view / app.start / BaseTexture / new Loader）；
//   ⑤ Live2DRenderer 必须走 v8 的异步生命周期（`await app.init(...)` + `app.canvas`），而不是 v7 的构造即启动。
//
// 负控（已手工跑过一次）：把 package.json 的 `pixi.js` 改回 `^7.4.3`，本文件必须红在断言 ①。
// 运行时离线判据：本条只保证「不会因为依赖版本回退而在真机上无声白屏」，不替代真机渲染验证。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

function readJson(rel: string): { version?: string; dependencies?: Record<string, string> } {
  return JSON.parse(readText(rel)) as { version?: string; dependencies?: Record<string, string> }
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      out.push(...listSourceFiles(abs))
      continue
    }
    if (!/\.(ts|tsx)$/.test(name)) continue
    if (/\.(test|spec)\.(ts|tsx)$/.test(name)) continue
    if (name.endsWith('.d.ts')) continue
    out.push(abs)
  }
  return out
}

const V7_ONLY: Array<[string, RegExp]> = [
  ['Graphics.beginFill', /\bbeginFill\s*\(/],
  ['Graphics.endFill', /\bendFill\s*\(/],
  ['Graphics.lineStyle', /\blineStyle\s*\(/],
  ['Application.view', /\bapp\w*\.view\b/],
  ['Application.start', /\bapp\w*\.start\s*\(\s*\)/],
  ['BaseTexture', /\bBaseTexture\b/],
  ['new Loader', /\bnew Loader\s*\(/],
]

describe('pixi 渲染栈版本守卫（ADR-0004 Superseded 后的一致性）', () => {
  it('① package.json 声明为 pixi.js 8.x + @jannchie/pixi-live2d-display 1.x（成对升级）', () => {
    const pkg = readJson('package.json')
    const deps = pkg.dependencies ?? {}
    expect(Object.keys(deps), 'package.json 缺少 dependencies').toContain('pixi.js')

    const pixiSpec = deps['pixi.js']
    const live2dSpec = deps['@jannchie/pixi-live2d-display']
    expect(pixiSpec, 'pixi.js 必须声明为 8.x（ADR-0004 已于 2026-09-17 解除 7.x 锁定）').toMatch(/^\^?8\./)
    expect(live2dSpec, '必须使用支持 PixiJS 8 的 @jannchie/pixi-live2d-display 1.x').toMatch(/^\^?1\./)
    // 反向：不允许悄悄降回锁定组合
    expect(deps['pixi-live2d-display'], '不得回退到只兼容 pixi 6/7 的 pixi-live2d-display@0.4').toBeUndefined()
  })

  it('② 实装版本同样是 8.x / 1.x（锁文件解析结果与声明一致）', () => {
    const pixi = readJson('node_modules/pixi.js/package.json')
    const live2d = readJson('node_modules/@jannchie/pixi-live2d-display/package.json')
    expect(pixi.version, 'node_modules 里的 pixi.js 实装版本不是 8.x').toMatch(/^8\./)
    expect(live2d.version, 'node_modules 里的 live2d 插件实装版本不是 1.x').toMatch(/^1\./)
  })

  it('③ ADR-0004 状态是 Superseded（文档不得被回改成锁定 7.4）', () => {
    const adr = readText('docs/adr/0004-pixi-live2d-version-lock.md')
    expect(adr, 'ADR-0004 状态行应为 Superseded；若依赖已是 pixi 8 而 ADR 仍写「锁定 7.4」，说明口径自相矛盾').toMatch(
      /状态\*\*[:：]\s*Superseded/,
    )
    expect(adr, 'ADR-0004 应留有解除锁定的日期（2026-09-17）').toMatch(/2026-09-17/)
  })

  it('④ src 内无 v7-only API 残留', () => {
    const files = listSourceFiles(path.join(ROOT, 'src'))
    expect(files.length, 'src 下没扫到源码文件，扫描集为空会让本断言变成空转').toBeGreaterThan(50)

    const violations: string[] = []
    for (const abs of files) {
      const lines = readFileSync(abs, 'utf8').split(/\r?\n/)
      lines.forEach((line, idx) => {
        // 跳过纯注释行（历史注释里会提到 v7 API 名，不算残留）
        const code = line.trim()
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return
        for (const [name, re] of V7_ONLY) {
          if (re.test(line)) violations.push(`${path.relative(ROOT, abs)}:${idx + 1} ${name}`)
        }
      })
    }
    expect(violations, '发现 PixiJS 7 专属 API（v8 下这些调用要么不存在、要么行为不同）').toEqual([])
  })

  it('⑤ Live2DRenderer 走 v8 异步生命周期（await app.init + app.canvas）', () => {
    const src = readText('src/components/Live2DRenderer.tsx')
    expect(src, 'v8 的 Application 必须先 await app.init(...) 才会创建渲染器').toMatch(/await\s+app\.init\(/)
    expect(src, 'v8 用 app.canvas 取画布（v7 是 app.view）').toMatch(/app\.canvas\b/)
    expect(src, 'v8 与 Live2D 模型应共用 Ticker.shared，否则动画与渲染不同步').toMatch(/sharedTicker/)
  })
})
