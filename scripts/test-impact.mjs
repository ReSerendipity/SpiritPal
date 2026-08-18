#!/usr/bin/env node
/**
 * test-impact.mjs — 测试影响分析（审计 P2-8）
 *
 * 基于 git diff 找出变更的源文件，映射到对应的测试文件，输出应运行的测试列表。
 * 用法:
 *   node scripts/test-impact.mjs [base-ref]
 *     base-ref 省略时对比工作区变更（HEAD + unstaged）
 *     例: node scripts/test-impact.mjs origin/main
 * 输出:
 *   空格分隔的测试文件列表，可直接喂给 vitest:
 *     pnpm exec vitest run $(node scripts/test-impact.mjs)
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(process.cwd())

function gitDiffNames(baseRef) {
  const args = baseRef
    ? ['diff', '--name-only', `${baseRef}...HEAD`]
    : ['diff', '--name-only', 'HEAD']
  try {
    const out = execSync(`git ${args.join(' ')}`, { cwd: repoRoot, encoding: 'utf8' })
    return out.split('\n').map((l) => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function mapToTestFile(changed) {
  // 目录约定映射表
  const candidates = []
  const rel = changed.replace(/\\/g, '/')

  // 1) 变更文件本身就是测试 → 直接纳入
  if (/\.(test|spec)\.(ts|tsx)$/.test(rel)) {
    return [rel]
  }

  // 2) 按约定映射源 → 测试
  // src/lib/foo.ts → src/lib/__tests__/foo.test.ts
  let m = rel.match(/^src\/lib\/([^/]+)\.ts$/)
  if (m) candidates.push(`src/lib/__tests__/${m[1]}.test.ts`)

  // src/components/Foo.tsx → src/components/__tests__/Foo.test.tsx
  m = rel.match(/^src\/components\/([^/]+)\.tsx$/)
  if (m) candidates.push(`src/components/__tests__/${m[1]}.test.tsx`)

  // src/stores/foo.ts → src/stores/__tests__/foo.test.ts
  m = rel.match(/^src\/stores\/([^/]+)\.ts$/)
  if (m) candidates.push(`src/stores/__tests__/${m[1]}.test.ts`)

  // src/hooks/foo.ts → 同目录 src/hooks/foo.test.tsx（本项目 hooks 约定）
  m = rel.match(/^src\/hooks\/(.+)?\/?([^/]+)\.ts$/)
  if (m) {
    const dir = m[1] ? `${m[1]}/` : ''
    candidates.push(`src/hooks/${dir}${m[2]}.test.tsx`)
  }

  // 3) 反向引用：grep 哪些测试文件 import 了该模块（别名 @/ 或相对路径）
  const moduleName = rel.replace(/^src\//, '').replace(/\.(ts|tsx)$/, '')
  try {
    const grep = execSync(
      `git grep -l -E "${moduleName.replace(/[.\\/]/g, '\\$&')}" -- "src/**/__tests__/**" "src/**/*.test.*"`,
      { cwd: repoRoot, encoding: 'utf8' },
    )
    grep.split('\n').map((l) => l.trim()).filter(Boolean).forEach((f) => candidates.push(f))
  } catch {
    // 无匹配
  }

  return candidates
}

function main() {
  const baseRef = process.argv[2]
  const changed = gitDiffNames(baseRef)
  const testFiles = new Set()

  for (const f of changed) {
    for (const cand of mapToTestFile(f)) {
      if (fs.existsSync(path.join(repoRoot, cand))) testFiles.add(cand)
    }
  }

  const list = [...testFiles].sort()
  if (list.length === 0) {
    console.log('(无匹配的测试文件 — 建议运行全量)')
    console.log('src')
  } else {
    console.log(list.join(' '))
  }
  // 附加信息输出到 stderr，避免污染管道
  console.error(`[test-impact] 变更文件 ${changed.length} 个，命中测试 ${list.length} 个`)
}

main()
