#!/usr/bin/env node
/**
 * test-impact.mjs — 测试影响分析（审计 P2-8）
 *
 * 基于 git 变更文件映射到对应测试文件，输出应运行的测试列表。
 * ⚠️ 启发式工具（约定映射 + 反向 grep），非完整依赖图 — 仅用于本地快查，不替代 CI 全量。
 *
 * 用法:
 *   打印模式（默认）:  node scripts/test-impact.mjs [base-ref]
 *     - base-ref 省略 → 对比工作区变更（git diff HEAD：已暂存+未暂存，另含未跟踪新文件）
 *     - base-ref 指定 → 对比已提交范围（git diff base...HEAD，不含工作区未提交改动）
 *     - stdout 输出单行空格分隔的测试文件列表，bash 下可直接展开喂给 vitest:
 *         pnpm exec vitest run $(node scripts/test-impact.mjs)
 *     - 无匹配 / 测试基建变更时 stdout 为空 → bash 下退化为 vitest 全量（符合预期）
 *   执行模式:          node scripts/test-impact.mjs --exec [base-ref] [--] [vitest 参数...]
 *     - 脚本内部直接 spawn `vitest run <files...>`，跨平台无 shell 展开依赖（Windows 适用）
 *     - `-` 开头的参数透传给 vitest（如 -t 按用例名过滤），第一个非 `-` 参数视为 base-ref
 *     - 无匹配 / 测试基建（vitest、vite 配置、src/test/ 全局 setup、pnpm-lock.yaml）变更时不运行，
 *       stderr 给出建议后 exit 0
 *
 * 映射策略（与当前测试布局实测对齐，2026-09-18）:
 *   1) 变更文件本身是测试（*.test/spec.ts|tsx|mjs）→ 直接纳入
 *   2) 约定映射（生成候选后按文件存在性过滤，覆盖仓库全部已知布局）:
 *      - 同目录测试:      src/hooks/pet/foo.ts → src/hooks/pet/foo.test.tsx（hooks 约定共置）
 *      - 祖先目录 __tests__: src/lib/ai/foo.ts → src/lib/ai/__tests__/foo.test.ts
 *                            或 src/lib/__tests__/foo.test.ts（顶层测试布局同样命中）
 *      - scripts/foo.mjs → scripts/__tests__/foo.test.mjs
 *   3) 反向 grep: 测试文件内容中含完整模块路径（`@/lib/ai/foo` 别名导入可命中；
 *      纯相对导入 `../foo` / `./foo` 依赖策略 2 的共置约定兜底）
 *
 * 已知局限:
 *   - 仅靠相对路径交叉引用、且非共置的模块可能漏选（如 A 模块改动影响 import 它的
 *     B 模块测试，但 B 测试用相对路径导入）→ 漏选风险由 CI 全量兜底
 *   - 反向 grep 可能多选（子串误命中）→ 多选只是多跑几个测试，方向安全
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(process.cwd())
const require = createRequire(import.meta.url)

// ---------- CLI 参数解析（延迟到 main，import 时不读 argv） ----------
function parseArgs(argv) {
  let execMode = false
  let baseRef = ''
  const vitestExtra = []
  for (const a of argv) {
    if (a === '--exec') execMode = true
    else if (a === '--') continue // 分隔符（pnpm run x -- --flag 场景）
    else if (a.startsWith('-')) vitestExtra.push(a)
    else if (!baseRef) baseRef = a
  }
  return { execMode, baseRef, vitestExtra }
}

// 测试基建变更 → 子集选择不可靠，退化为「建议全量」
// 口径：只拦「真正改变 vitest 执行语义」的文件——vitest/vite 配置、全局 setup、依赖锁。
// package.json 故意不拦：依赖变更必然连带 pnpm-lock.yaml（lockfile 才是依赖真相，
// CI --frozen-lockfile 也保证两者不一致时安装期即失败），而 scripts/版本字段等纯元数据
// 修改与用例选择无关，拦下来只会让日常快查被自家工具卡死。
const INFRA_RE = /^(vitest\.config\.|vite\.config\.|src\/test\/|pnpm-lock\.yaml$)/

function runGit(args) {
  try {
    // stdio 显式 pipe：避免 execFileSync 默认把 git 的 CRLF 等警告透传到 stderr 噪声化输出
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  } catch {
    return ''
  }
}

function gitDiffNames(baseRef) {
  // 无 base-ref：工作区变更（含未跟踪新文件）；有 base-ref：已提交范围
  let out = baseRef
    ? runGit(['diff', '--name-only', `${baseRef}...HEAD`])
    : runGit(['diff', '--name-only', 'HEAD'])
  const files = out.split('\n').map((l) => l.trim()).filter(Boolean)
  if (!baseRef) {
    const untracked = runGit(['ls-files', '--others', '--exclude-standard'])
    files.push(...untracked.split('\n').map((l) => l.trim()).filter(Boolean))
  }
  return [...new Set(files)]
}

function escapeEre(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mapToTestFile(changed) {
  const rel = changed.replace(/\\/g, '/')
  const candidates = []

  // 1) 变更文件本身是测试 → 直接纳入
  if (/\.(test|spec)\.(ts|tsx|mjs)$/.test(rel)) {
    return [rel]
  }

  const parts = rel.split('/')
  const fileName = parts.pop()
  const stem = parts.join('/') // 如 src/lib/ai 或 src/hooks/pet

  // 2) 约定映射：同目录测试 + 各级祖先目录 __tests__（存在性由调用方过滤）
  const srcMatch = fileName.match(/^(.+)\.(ts|tsx)$/)
  if (parts[0] === 'src' && srcMatch) {
    const name = srcMatch[1]
    for (const kind of ['test', 'spec']) {
      for (const ext of ['ts', 'tsx']) {
        // 同目录（hooks 约定）
        candidates.push(`${stem}/${name}.${kind}.${ext}`)
        // 各级祖先目录 __tests__（src/lib/ai → src/lib → src，覆盖嵌套与顶层两种布局）
        for (let j = parts.length; j >= 1; j--) {
          const dir = parts.slice(0, j).join('/')
          candidates.push(`${dir}/__tests__/${name}.${kind}.${ext}`)
        }
      }
    }
  }
  const mjsMatch = fileName.match(/^(.+)\.mjs$/)
  if (parts[0] === 'scripts' && mjsMatch) {
    candidates.push(`scripts/__tests__/${mjsMatch[1]}.test.mjs`)
    candidates.push(`${stem}/${mjsMatch[1]}.test.mjs`)
  }

  // 3) 反向引用：grep 哪些测试文件内容含完整模块路径（@/ 别名导入可命中）
  //    仅限可测源文件（src/**、scripts/** 的 .ts/.tsx/.mjs）：
  //    避免 README.md / *.toml 等文档变更被子串误命中（实测：modDocGenerator 测试内容里的
  //    "README.md" 字样会让 README.md 的变更误圈 1 个测试）
  const moduleName = rel.replace(/^src\//, '').replace(/\.(ts|tsx|mjs)$/, '')
  const greppable =
    /\.(ts|tsx|mjs)$/.test(rel) && (parts[0] === 'src' || parts[0] === 'scripts')
  if (moduleName && greppable) {
    const grep = runGit([
      'grep', '-l', '-E', escapeEre(moduleName),
      '--', 'src/**/__tests__/**', 'src/**/*.test.*', 'scripts/__tests__/*.test.mjs',
    ])
    grep.split('\n').map((l) => l.trim()).filter(Boolean).forEach((f) => candidates.push(f))
  }

  return candidates
}

function resolveVitestEntry() {
  try {
    const pkg = require.resolve('vitest/package.json')
    return path.join(path.dirname(pkg), 'vitest.mjs')
  } catch {
    console.error('[test-impact] 找不到 vitest（node_modules 未安装？）— 请先 pnpm install')
    process.exit(1)
  }
}

// ---------- 主流程（导出供测试复用；仅在直接执行时运行） ----------
export { gitDiffNames, mapToTestFile, INFRA_RE }

function main() {
  const { execMode, baseRef, vitestExtra } = parseArgs(process.argv.slice(2))

  const changed = gitDiffNames(baseRef)
  const infraHit = changed.find((f) => INFRA_RE.test(f))

  let list = []
  if (infraHit) {
    console.error(`[test-impact] 检测到测试基建变更（${infraHit}）— 子集选择不可靠，请运行全量 pnpm test`)
  } else {
    const testFiles = new Set()
    for (const f of changed) {
      for (const cand of mapToTestFile(f)) {
        if (fs.existsSync(path.join(repoRoot, cand))) testFiles.add(cand)
      }
    }
    list = [...testFiles].sort()
    if (list.length === 0) {
      const why = changed.length === 0 ? '工作区无变更' : '变更未命中任何测试'
      console.error(`[test-impact] ${why} — 管道模式退化为 vitest 全量；--exec 模式不运行`)
    }
  }

  if (execMode) {
    if (infraHit || list.length === 0) process.exit(0)
    const entry = resolveVitestEntry()
    console.error(`[test-impact] 变更文件 ${changed.length} 个，运行命中测试 ${list.length} 个:`)
    for (const f of list) console.error(`  ${f}`)
    const r = spawnSync(process.execPath, [entry, 'run', ...list, ...vitestExtra], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    process.exit(r.status ?? 1)
  }

  // 打印模式：仅单行列表上 stdout（空列表则不输出，保持管道契约干净）
  if (list.length > 0) console.log(list.join(' '))
  console.error(`[test-impact] 变更文件 ${changed.length} 个，命中测试 ${list.length} 个`)
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) main()
