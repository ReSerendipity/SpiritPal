#!/usr/bin/env node
/**
 * fetch-mnn-model.mjs — 从 ModelScope 下载 MNN 格式模型并**强制校验完整性**
 *
 * 为什么需要它：
 * ModelScope 的大文件下载会**静默截断**（HTTP 200、curl 无报错，但少几十 MB）。
 * 不校验会拿到一个装不上/跑不起来的模型。本脚本对每个文件比对
 * **体积 + SHA-256**（取自 ModelScope 仓库 API），不匹配则断点续传重试。
 *
 * 用法：
 *   node scripts/fetch-mnn-model.mjs --repo MNN/Qwen3.5-2B-MNN --out artifacts/mnn-models/Qwen3.5-2B-MNN
 *   node scripts/fetch-mnn-model.mjs --repo MNN/Qwen3.5-0.8B-MNN --out <dir> --verify-only
 *   node scripts/fetch-mnn-model.mjs --list MNN/Qwen3.5-2B-MNN        # 只列文件与哈希
 *
 * 依赖：Node 18+（内置 fetch）。无第三方依赖。
 *
 * 已知可用的 MNN 官方仓库（ModelScope / HF 镜像 taobao-mnn/*）：
 *   MNN/Qwen3.5-0.8B-MNN (0.55GB)  MNN/Qwen3.5-2B-MNN (1.39GB)
 *   MNN/Qwen3.5-4B-MNN   (2.85GB)  MNN/Qwen3.5-9B-MNN (7.27GB)
 * 权威清单见 MNN 仓 apps/Android/MnnLlmChat/app/src/main/assets/model_market.json
 *
 * @see docs/execution/ondevice-custom-model-pipeline.md
 */
import { createWriteStream } from 'node:fs'
import { mkdir, stat, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import path from 'node:path'

const API = 'https://www.modelscope.cn/api/v1/models'
const RESOLVE = 'https://www.modelscope.cn/models'
const UA = 'SpiritPal-fetch-mnn-model/1.0'
/** 单文件最大重试次数（每次续传） */
const MAX_ATTEMPTS = 8

// ============ CLI 参数 ============

function parseArgs(argv) {
  const out = { repo: '', out: '', verifyOnly: false, list: false, revision: 'master' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--repo') out.repo = argv[++i]
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--revision') out.revision = argv[++i]
    else if (a === '--verify-only') out.verifyOnly = true
    else if (a === '--list') out.list = true
    else if (a === '-h' || a === '--help') {
      console.log(
        '用法: node scripts/fetch-mnn-model.mjs --repo <ns/name> [--out <dir>] [--verify-only] [--list]',
      )
      process.exit(0)
    }
  }
  if (!out.repo) {
    console.error('缺少 --repo（如 --repo MNN/Qwen3.5-2B-MNN）')
    process.exit(2)
  }
  return out
}

// ============ 工具 ============

function fmtBytes(n) {
  if (!n) return '0 B'
  const gb = n / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

/** 拉取仓库文件清单（含 Size 与 Sha256 权威值） */
async function listFiles(repo, revision) {
  const url = `${API}/${repo}/repo/files?Revision=${revision}&Recursive=true`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`列文件失败 HTTP ${res.status}: ${url}`)
  const json = await res.json()
  if (json.Code !== 200) throw new Error(`列文件失败 Code=${json.Code}: ${JSON.stringify(json).slice(0, 200)}`)
  // 只要模型文件，跳过 git 元数据与说明
  return json.Data.Files.filter((f) => f.Type === 'blob' && !['.gitattributes', 'README.md'].includes(f.Path))
}

async function fileSize(p) {
  try {
    return (await stat(p)).size
  } catch {
    return 0
  }
}

async function sha256(p) {
  const buf = await readFile(p)
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * 下载单个文件（支持断点续传）。
 * ⚠️ 必须用 `/models/<ns>/<name>/resolve/<rev>/<file>` 形式；
 * `/api/v1/models/.../repo?FilePath=` 有时返回 200 但**响应体为空**。
 */
async function downloadOne(repo, revision, relPath, dest, expectSize) {
  const url = `${RESOLVE}/${repo}/resolve/${revision}/${relPath}`
  const have = await fileSize(dest)
  const headers = { 'User-Agent': UA }
  if (have > 0 && have < expectSize) headers.Range = `bytes=${have}-`

  const res = await fetch(url, { headers })
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`)
  if (!res.body) throw new Error('响应体为空（检查是否误用了 /repo?FilePath= 形式）')

  await pipeline(
    Readable.fromWeb(res.body),
    createWriteStream(dest, { flags: have > 0 && res.status === 206 ? 'a' : 'w' }),
  )
  return { resumedFrom: res.status === 206 ? have : 0 }
}

// ============ 主流程 ============

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const files = await listFiles(args.repo, args.revision)
  const total = files.reduce((s, f) => s + (f.Size || 0), 0)

  console.log(`仓库 ${args.repo}@${args.revision}：${files.length} 个文件，共 ${fmtBytes(total)}\n`)

  if (args.list) {
    for (const f of files) {
      console.log(`  ${String(f.Size).padStart(12)}  ${f.Sha256 ?? '(无哈希)'}  ${f.Path}`)
    }
    return
  }

  if (!args.out) {
    console.error('缺少 --out（下载目录）')
    process.exit(2)
  }
  await mkdir(args.out, { recursive: true })

  let ok = 0
  let failed = 0

  for (const f of files) {
    const dest = path.join(args.out, f.Path.replace(/\//g, path.sep))
    const label = `${f.Path} (${fmtBytes(f.Size)})`

    // 已存在且体积+哈希都对 → 跳过
    const cur = await fileSize(dest)
    if (cur === f.Size) {
      const h = await sha256(dest)
      if (!f.Sha256 || h === f.Sha256) {
        console.log(`  ✓ 已完整  ${label}`)
        ok++
        continue
      }
      console.log(`  ! 哈希不符，重下  ${label}`)
      await rm(dest, { force: true })
    } else if (cur > 0) {
      console.log(`  ↓ 续传（已有 ${fmtBytes(cur)} / ${fmtBytes(f.Size)}）  ${label}`)
    } else {
      console.log(`  ↓ 下载  ${label}`)
    }

    if (args.verifyOnly) {
      console.log(`    ✗ 缺失或损坏（--verify-only 不下载）`)
      failed++
      continue
    }

    let done = false
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !done; attempt++) {
      try {
        const { resumedFrom } = await downloadOne(args.repo, args.revision, f.Path, dest, f.Size)
        const size = await fileSize(dest)
        if (size !== f.Size) {
          console.log(`    尝试 ${attempt}：体积 ${size} / ${f.Size}（差 ${f.Size - size} 字节）→ 续传`)
          continue
        }
        if (f.Sha256) {
          const h = await sha256(dest)
          if (h !== f.Sha256) {
            console.log(`    尝试 ${attempt}：哈希不符 → 重下`)
            await rm(dest, { force: true })
            continue
          }
        }
        console.log(`    ✓ 校验通过${resumedFrom ? `（续传自 ${fmtBytes(resumedFrom)}）` : ''}`)
        done = true
        ok++
      } catch (e) {
        console.log(`    尝试 ${attempt} 失败：${e.message}`)
      }
    }
    if (!done) {
      console.error(`    ✗ ${f.Path} 在 ${MAX_ATTEMPTS} 次尝试后仍不完整`)
      failed++
    }
  }

  console.log(`\n=== 完成：通过 ${ok} / 失败 ${failed} / 共 ${files.length} ===`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('致命错误:', e.message)
  process.exit(1)
})
