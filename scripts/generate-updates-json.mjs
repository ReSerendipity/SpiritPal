#!/usr/bin/env node
/**
 * @file generate-updates-json.mjs
 * @description 生成/更新仓库根 updates.json（Tauri v2 updater 元数据）
 *
 * 背景（任务书 P0-1.4）：漏更新 updates.json = 用户永远检查不到新版本。
 * 本脚本在每次发版后由 release.yml 的 publish job 调用（或本地手动），
 * 从 GitHub Release 资产中提取各平台签名与下载 URL，组装并写回 updates.json。
 *
 * 用法：
 *   node scripts/generate-updates-json.mjs --repo <owner/repo> --tag <vX.Y.Z> [--out <path>]
 *
 * 依赖：gh CLI（需 GH_TOKEN 或已登录）；无第三方 npm 依赖。
 *
 * 输出（Tauri v2 格式）：
 * {
 *   "version": "0.1.1",
 *   "notes": "...",
 *   "pub_date": "2026-09-10T...Z",
 *   "platforms": {
 *     "windows-x86_64": { "signature": "...", "url": "..." },
 *     "darwin-aarch64": { ... },
 *     "darwin-x86_64": { ... },
 *     "linux-x86_64": { ... }
 *   }
 * }
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

// ============ 参数解析 ============

const args = process.argv.slice(2)
function getArg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  if (i !== -1 && args[i + 1]) return args[i + 1]
  return fallback
}

const repo = getArg('repo', 'ReSerendipity/SpiritPal')
const tag = getArg('tag', '')
const outPath = getArg('out', 'updates.json')

if (!tag) {
  console.error('缺少 --tag <vX.Y.Z> 参数')
  process.exit(2)
}

// ============ gh 辅助 ============

function ghJson(...cmd) {
  const stdout = execFileSync('gh', ['api', ...cmd], {
    encoding: 'utf-8',
    env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '' },
  })
  return JSON.parse(stdout)
}

// ============ 主流程 ============

/** 将 Tauri 产物文件名映射为 updates.json platform key */
function platformKeyFor(fileName) {
  const name = fileName.toLowerCase()
  if (name.includes('setup.exe') || name.endsWith('.exe')) return 'windows-x86_64'
  if (name.includes('aarch64') && name.endsWith('.dmg')) return 'darwin-aarch64'
  if (name.includes('x64') && name.endsWith('.dmg')) return 'darwin-x86_64'
  if (name.includes('x86_64') && name.endsWith('.appimage')) return 'linux-x86_64'
  return null
}

/** 判断是否为更新器可消费的产物（排除 .sig / portable / msi / deb 等） */
function isUpdaterArtifact(fileName) {
  const name = fileName.toLowerCase()
  if (name.endsWith('.sig')) return false
  if (name.includes('portable')) return false
  if (name.endsWith('.msi')) return false
  return platformKeyFor(name) !== null
}

function main() {
  const release = ghJson('repos', repo, 'releases/tags', tag)
  if (!release || !release.assets) {
    console.error(`release ${tag} 不存在或无法读取`)
    process.exit(1)
  }

  const assets = release.assets
  const updaterAssets = assets.filter((a) => isUpdaterArtifact(a.name))

  if (updaterAssets.length === 0) {
    console.error(`release ${tag} 中未找到可更新产物（期望 setup.exe / dmg / appimage）`)
    process.exit(1)
  }

  const platforms = {}
  for (const asset of updaterAssets) {
    const key = platformKeyFor(asset.name)
    if (!key) continue
    // 签名文件：同名 + .sig
    const sigAsset = assets.find((a) => a.name === `${asset.name}.sig`)
    let signature = ''
    if (sigAsset) {
      const sig = execFileSync('curl', ['-sL', sigAsset.browser_download_url], {
        encoding: 'utf-8',
      })
      signature = sig.trim()
    }
    platforms[key] = {
      signature,
      url: asset.browser_download_url,
    }
  }

  const updatesJson = {
    version: tag.replace(/^v/, ''),
    notes: release.body || '',
    pub_date: release.published_at || new Date().toISOString(),
    platforms,
  }

  writeFileSync(outPath, JSON.stringify(updatesJson, null, 2) + '\n', 'utf-8')
  console.log(`[updates.json] 已生成：${outPath}`)
  console.log(`  version : ${updatesJson.version}`)
  console.log(`  platforms: ${Object.keys(platforms).join(', ')}`)
  for (const [k, v] of Object.entries(platforms)) {
    if (!v.signature) console.warn(`  ⚠ ${k} 缺少签名（.sig 未找到或为空）——漏签名将导致客户端校验失败`)
  }
}

main()
