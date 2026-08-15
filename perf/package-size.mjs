#!/usr/bin/env node
// 安装包大小验证脚本 — P1-8
// PRD §10 指标：桌面端安装包 <30MB
//
// 使用方法：
//   node perf/package-size.mjs              # 检查已构建的安装包
//   node perf/package-size.mjs --build      # 先构建再检查
//
// 检查逻辑：
// 1. 在 src-tauri/target/release/bundle/ 中查找安装包文件
// 2. 测量每个安装包大小
// 3. 与 PRD 指标（<30MB）对比并报告

import { readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'

// ============ 配置 ============

const SIZE_LIMIT_MB = 30
const ROOT_DIR = join(import.meta.dirname, '..')
const BUNDLE_DIR = join(ROOT_DIR, 'src-tauri', 'target', 'release', 'bundle')
const NSIS_DIR = join(ROOT_DIR, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const MSI_DIR = join(ROOT_DIR, 'src-tauri', 'target', 'release', 'bundle', 'msi')
const DMG_DIR = join(ROOT_DIR, 'src-tauri', 'target', 'release', 'bundle', 'dmg')
const DEB_DIR = join(ROOT_DIR, 'src-tauri', 'target', 'release', 'bundle', 'deb')
const APPIMAGE_DIR = join(ROOT_DIR, 'src-tauri', 'target', 'release', 'bundle', 'appimage')

// 安装包扩展名 → 平台映射
const PACKAGE_PATTERNS = [
  { exts: ['.exe'], platform: 'Windows (NSIS)', dirs: [NSIS_DIR] },
  { exts: ['.msi'], platform: 'Windows (MSI)', dirs: [MSI_DIR] },
  { exts: ['.dmg'], platform: 'macOS (DMG)', dirs: [DMG_DIR] },
  { exts: ['.deb'], platform: 'Linux (DEB)', dirs: [DEB_DIR] },
  { exts: ['.AppImage'], platform: 'Linux (AppImage)', dirs: [APPIMAGE_DIR] },
]

// ============ 工具函数 ============

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

async function findPackages(dir, extensions) {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && extensions.some((ext) => e.name.endsWith(ext)))
    .map((e) => join(dir, e.name))
}

async function getFileInfo(filePath) {
  const stats = await stat(filePath)
  return {
    name: basename(filePath),
    path: filePath,
    size: stats.size,
    sizeMB: stats.size / (1024 * 1024),
  }
}

// ============ 主逻辑 ============

async function checkPackageSizes() {
  console.log('📦 SpiritPal 安装包大小验证')
  console.log(`   PRD 指标: < ${SIZE_LIMIT_MB} MB\n`)

  // 如果指定了 --build，先构建
  if (process.argv.includes('--build')) {
    console.log('🔨 正在构建安装包...')
    try {
      execSync('pnpm tauri build', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        timeout: 600000, // 10 分钟超时
      })
    } catch (err) {
      console.error('❌ 构建失败:', err.message)
      process.exit(1)
    }
    console.log()
  }

  // 检查是否构建过
  if (!existsSync(BUNDLE_DIR)) {
    console.log('⚠️  未找到构建输出目录')
    console.log(`   期望路径: ${BUNDLE_DIR}`)
    console.log('   请先运行: pnpm tauri build')
    console.log('   或使用:   node perf/package-size.mjs --build')
    process.exit(1)
  }

  const results = []

  for (const pattern of PACKAGE_PATTERNS) {
    for (const dir of pattern.dirs) {
      const files = await findPackages(dir, pattern.exts)
      for (const file of files) {
        const info = await getFileInfo(file)
        results.push({
          ...info,
          platform: pattern.platform,
          passed: info.sizeMB < SIZE_LIMIT_MB,
        })
      }
    }
  }

  // 也检查 Rust 二进制文件大小
  const releaseBin = join(ROOT_DIR, 'src-tauri', 'target', 'release', 'spiritpal-app.exe')
  if (existsSync(releaseBin)) {
    const binInfo = await getFileInfo(releaseBin)
    results.push({
      ...binInfo,
      platform: 'Windows (Binary)',
      passed: true, // 二进制不参与大小限制
    })
  }

  // ============ 输出报告 ============

  if (results.length === 0) {
    console.log('⚠️  未找到任何安装包文件')
    console.log('   请先运行: pnpm tauri build')
    process.exit(1)
  }

  console.log('┌─────────────────────────┬──────────────┬──────────┬────────┐')
  console.log('│ 平台                    │ 安装包       │ 大小     │ 状态   │')
  console.log('├─────────────────────────┼──────────────┼──────────┼────────┤')

  let allPassed = true

  for (const r of results) {
    const status = r.platform.includes('Binary')
      ? 'ℹ️ 参考'
      : r.passed
        ? '✅ 通过'
        : '❌ 超标'
    if (!r.passed && !r.platform.includes('Binary')) allPassed = false
    const name = r.name.length > 12 ? r.name.slice(0, 11) + '…' : r.name
    console.log(`│ ${r.platform.padEnd(23)} │ ${name.padEnd(12)} │ ${formatSize(r.size).padEnd(8)} │ ${status.padEnd(6)} │`)
  }

  console.log('└─────────────────────────┴──────────────┴──────────┴────────┘')

  console.log()
  if (allPassed) {
    console.log('✅ 所有安装包均满足 PRD 指标 (<30MB)')
  } else {
    console.log('❌ 部分安装包超出 PRD 指标限制')
  }

  // 输出 JSON 结果（供 CI 使用）
  const jsonPath = join(ROOT_DIR, 'perf', 'results', 'package-size.json')
  const resultData = {
    timestamp: new Date().toISOString(),
    limitMB: SIZE_LIMIT_MB,
    allPassed,
    packages: results.map((r) => ({
      platform: r.platform,
      name: r.name,
      sizeBytes: r.size,
      sizeMB: Math.round(r.sizeMB * 100) / 100,
      passed: r.passed,
    })),
  }

  // 确保 results 目录存在
  const resultsDir = join(ROOT_DIR, 'perf', 'results')
  if (!existsSync(resultsDir)) {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(resultsDir, { recursive: true })
  }

  const { writeFile } = await import('node:fs/promises')
  await writeFile(jsonPath, JSON.stringify(resultData, null, 2))
  console.log(`\n📄 结果已保存到: ${jsonPath}`)

  process.exit(allPassed ? 0 : 1)
}

checkPackageSizes().catch((err) => {
  console.error('❌ 检查失败:', err)
  process.exit(1)
})
