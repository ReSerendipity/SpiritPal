/**
 * R-12 + R-11: 前端代码混淆 + 资源完整性清单 (SRI) 生成/校验脚本
 *
 * 三种模式：
 *   node scripts/obfuscate-and-sri.mjs                 默认：混淆 dist/assets/*.js → 生成清单 → 回读自校验
 *   node scripts/obfuscate-and-sri.mjs --no-obfuscate  只生成清单（dist 已是最终产物，避免二次混淆）
 *   node scripts/obfuscate-and-sri.mjs --verify        只校验：重算 dist 产物 SHA-256 与 sri_hashes.rs 逐条比对，
 *                                                      任何缺失/不一致即退出码 1（构建期门禁，接入 CI 构建 job）
 *
 * 默认模式流程：
 * 1. 对 dist/assets/*.js 进行 javascript-obfuscator 混淆
 * 2. 计算混淆后的 SHA-256 哈希
 * 3. 生成 src-tauri/src/generated/sri_hashes.rs 供 Rust 编译时嵌入
 * 4. 回读生成结果并与 dist 逐条比对（生成器输出保真自校验）
 *
 * 运行时消费：src-tauri/src/integrity.rs（release 启动时重算内嵌资源哈希比对清单）
 * 退出码：0 = 成功/校验通过；1 = 校验失败或生成失败
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const distAssets = resolve(root, 'dist', 'assets')
const generatedDir = resolve(root, 'src-tauri', 'src', 'generated')
const sriPath = join(generatedDir, 'sri_hashes.rs')

const args = process.argv.slice(2)
const VERIFY_ONLY = args.includes('--verify')
const SKIP_OBFUSCATE = args.includes('--no-obfuscate')

/**
 * 重算 dist/assets/*.js 的 SHA-256 并与 sri_hashes.rs 清单逐条比对。
 * 双向核对：dist 产物必须登记在清单中且哈希一致；清单条目必须对应真实产物。
 * 不混淆、不写文件、不受 TAURI_ENV_DEBUG 跳过逻辑影响——它只回答「清单与产物是否一致」。
 */
function verifyManifest() {
  if (!existsSync(distAssets)) {
    console.error(`[obfuscate-and-sri] 校验失败：${distAssets} 不存在，无法核对 SRI 清单`)
    return false
  }
  if (!existsSync(sriPath)) {
    console.error(`[obfuscate-and-sri] 校验失败：${sriPath} 不存在，请先执行构建期生成`)
    return false
  }

  const entries = new Map()
  const entryRe = /m\.insert\("([^"]+)",\s*"([0-9a-fA-F]{64})"\);/g
  let match
  while ((match = entryRe.exec(readFileSync(sriPath, 'utf8'))) !== null) {
    entries.set(match[1], match[2].toLowerCase())
  }

  const problems = []
  const files = readdirSync(distAssets).filter((f) => f.endsWith('.js'))

  for (const file of files) {
    const actual = createHash('sha256').update(readFileSync(join(distAssets, file))).digest('hex')
    const expected = entries.get(file)
    if (!expected) {
      problems.push(`清单缺失条目: ${file}`)
    } else if (expected !== actual) {
      problems.push(`哈希不一致: ${file}（清单 ${expected.slice(0, 12)}… ≠ 实际 ${actual.slice(0, 12)}…）`)
    }
  }
  const fileSet = new Set(files)
  for (const name of entries.keys()) {
    if (!fileSet.has(name)) problems.push(`清单多余条目: ${name}（dist/ 中不存在该产物）`)
  }

  if (problems.length > 0) {
    console.error(`[obfuscate-and-sri] SRI 校验失败：${problems.length} 项不一致`)
    for (const p of problems) console.error(`  - ${p}`)
    return false
  }
  console.log(`[obfuscate-and-sri] SRI 校验通过：${files.length} 个 dist 产物与 sri_hashes.rs 逐条一致`)
  return true
}

// ============ --verify：只校验（构建期门禁） ============
// 独立于下方 dev/缺目录的 Skipping 分支：门禁不允许静默通过。
if (VERIFY_ONLY) {
  process.exit(verifyManifest() ? 0 : 1)
}

// Skip obfuscation in dev mode
if (process.env.TAURI_ENV_DEBUG) {
  console.log('[obfuscate-and-sri] Debug mode — skipping obfuscation and SRI generation')
  process.exit(0)
}

// Skip if dist/assets doesn't exist
if (!existsSync(distAssets)) {
  console.warn('[obfuscate-and-sri] dist/assets not found — skipping')
  process.exit(0)
}

// ============ R-12: 代码混淆 ============

let JavaScriptObfuscator
try {
  JavaScriptObfuscator = (await import('javascript-obfuscator')).default
} catch {
  console.warn('[obfuscate-and-sri] javascript-obfuscator not installed — skipping obfuscation')
}

// 混淆选项说明（2026-08-14 调整）：
// controlFlowFlattening / selfDefending / splitStrings / transformObjectKeys 等高危选项
// 在 ESM + 动态 import 场景下会产生运行时损坏代码（字符串数组解码失败 ->
// 调用不存在的函数 -> TypeError: xxx is not a function -> 窗口加载崩溃闪现消失）。
// 降级为 stringArray 基础混淆（仍能隐藏字符串常量与标识符），保留 SRI 完整性校验。
const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: false,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.6,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
}

if (SKIP_OBFUSCATE) {
  console.log('[obfuscate-and-sri] --no-obfuscate：跳过混淆（直接基于现有 dist 生成清单）')
} else if (JavaScriptObfuscator) {
  const jsFiles = readdirSync(distAssets).filter((f) => f.endsWith('.js'))
  let obfuscatedCount = 0

  for (const file of jsFiles) {
    const filePath = join(distAssets, file)
    const code = readFileSync(filePath, 'utf8')

    // Skip already minified vendor chunks to save time
    // 注意：rolldown-runtime 是各 chunk（含 vendor-*）共享的 ESM 互操作基础设施，
    // vendor chunk 通过具名导出按名绑定引用它。混淆该 chunk 会破坏 CJS 互操作
    // 语义，导致启动期 TypeError（Cannot read properties of undefined (reading 'S')）。
    // 因此必须一并跳过，保持其字节与 vendor chunk 的导入契约一致。
    const isVendor = file.startsWith('vendor-') || file.startsWith('rolldown-runtime-')
    if (isVendor) {
      console.log(`[obfuscate-and-sri] Skipping vendor chunk: ${file}`)
      continue
    }

    try {
      const obfuscated = JavaScriptObfuscator.obfuscate(code, {
        ...OBFUSCATOR_OPTIONS,
        // Smaller chunks get lighter obfuscation
        ...(code.length < 5000 ? { controlFlowFlattening: false, stringArray: false } : {}),
      }).getObfuscatedCode()

      writeFileSync(filePath, obfuscated, 'utf8')
      obfuscatedCount++
    } catch (err) {
      console.warn(`[obfuscate-and-sri] Failed to obfuscate ${file}:`, err.message)
    }
  }

  console.log(`[obfuscate-and-sri] Obfuscated ${obfuscatedCount}/${jsFiles.length} JS files`)
}

// ============ R-11: SRI 哈希生成 ============

const allFiles = readdirSync(distAssets).filter((f) => f.endsWith('.js'))
const hashes = []

for (const file of allFiles) {
  const filePath = join(distAssets, file)
  const content = readFileSync(filePath)
  const hash = createHash('sha256').update(content).digest('hex')
  hashes.push({ file, hash })
}

// Generate Rust source file
if (!existsSync(generatedDir)) {
  mkdirSync(generatedDir, { recursive: true })
}

const rustCode = `// AUTO-GENERATED by scripts/obfuscate-and-sri.mjs — DO NOT EDIT
// R-11: Frontend resource integrity (SRI) hashes
// Generated at: ${new Date().toISOString()}

use std::collections::HashMap;
use std::sync::LazyLock;

/// 前端资源 SHA-256 哈希表（文件名 → 哈希值）
/// 运行时由 crate::integrity::verify_integrity 消费：release 构建下逐个读取
/// 内嵌资源重算哈希并与本表比对（debug 构建跳过，见 integrity.rs 模块注释）。
// rustfmt::skip：自动生成的长行不参与格式检查（保持生成器输出原样）
#[rustfmt::skip]
pub static SRI_HASHES: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {
    let mut m = HashMap::new();
${hashes.map((h) => `    m.insert("${h.file}", "${h.hash}");`).join('\n')}
    m
});

/// 获取指定资源的 SRI 哈希
pub fn get_hash(filename: &str) -> Option<&'static str> {
    SRI_HASHES.get(filename).copied()
}
`

writeFileSync(sriPath, rustCode, 'utf8')
console.log(`[obfuscate-and-sri] Generated SRI hashes for ${hashes.length} files → ${sriPath}`)

// ============ 生成结果自校验（生成器输出保真） ============
// 回读刚写入的清单并与 dist 逐条比对：若生成逻辑被改坏（写错文件/编码错误/清单与产物不同源），
// 构建立即失败，而不是静默产出与内嵌资源不匹配的清单。
if (!verifyManifest()) {
  console.error('[obfuscate-and-sri] 自校验失败：生成器输出与 dist 产物不一致')
  process.exit(1)
}
