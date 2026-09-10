#!/usr/bin/env node
/**
 * @file lint-capabilities.mjs
 * @description Tauri capability 最小授权 lint（报告2 §二 + SECURITY_AUDIT 门禁适用性说明）
 *
 * 规则：
 * 1. 硬拒绝黑名单：`sql:allow-execute`、`shell:allow-execute`、`shell:default`
 *    及 scope 中的宽泛通配（`*://*`、`**`、裸 `*`）
 * 2. 非 `core:*` 权限前缀必须对应真实注册的插件（Cargo.toml 依赖 + lib.rs 注册 + package.json 依赖）
 * 3. `invoke('xxx')` 调用的自定义命令必须在 Rust 源中有定义（排除 `plugin:` 前缀与 `sp_*` 语义命令）
 *    —— 反向即「声明了权限/命令但无消费/无实现」的失效授权
 *
 * 用法：
 *   node scripts/lint-capabilities.mjs [--capabilities-dir <dir>]
 *
 * 退出码：0 = 通过；1 = 发现违规（硬失败，供 CI/pre-commit 阻断）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============ 路径 ============

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..')

const argIdx = process.argv.indexOf('--capabilities-dir')
const CAP_DIR =
  argIdx !== -1 ? resolve(process.cwd(), process.argv[argIdx + 1]) : join(REPO_ROOT, 'src-tauri', 'capabilities')
const srcArgIdx = process.argv.indexOf('--frontend-src')
const FRONTEND_SRC = srcArgIdx !== -1 ? resolve(process.cwd(), process.argv[srcArgIdx + 1]) : join(REPO_ROOT, 'src')
const RUST_SRC = join(REPO_ROOT, 'src-tauri', 'src')
const CARGO_TOML = join(REPO_ROOT, 'src-tauri', 'Cargo.toml')
const PKG_JSON = join(REPO_ROOT, 'package.json')

// ============ 硬拒绝黑名单 ============

const FORBIDDEN_PERMISSIONS = new Set(['sql:allow-execute', 'sql:default', 'shell:allow-execute', 'shell:default'])

const FORBIDDEN_SCOPE_PATTERNS = [/^\*:\/\/\*$/, /^\*\*$/, /^\*$/]

// ============ 插件注册表（从真实配置文件构建） ============

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf-8') : ''
}

const cargoToml = readText(CARGO_TOML)
const pkgJsonRaw = readText(PKG_JSON)
let pkgJson = {}
try {
  pkgJson = JSON.parse(pkgJsonRaw)
} catch {
  // package.json 解析失败则视为无依赖信息（由 lint 报错兜底）
}

/** 权限前缀 → 插件标识（tauri-plugin-<id> / @tauri-apps/plugin-<id>） */
const PLUGIN_ID_BY_PREFIX = {
  store: 'store',
  notification: 'notification',
  updater: 'updater',
  process: 'process',
  fs: 'fs',
  dialog: 'dialog',
  autostart: 'autostart',
  'deep-link': 'deep-link',
  'global-shortcut': 'global-shortcut',
  sql: 'sql',
  shell: 'shell',
  log: 'log',
}

function pluginRegistered(id) {
  const cargoHas = cargoToml.includes(`tauri-plugin-${id}`)
  const libHas =
    readText(join(RUST_SRC, 'lib.rs')).includes(`plugin_${id.replace(/-/g, '_')}`) ||
    readText(join(RUST_SRC, 'lib.rs')).includes(`tauri_plugin_${id.replace(/-/g, '_')}`)
  const npmHas = Object.keys(pkgJson.dependencies ?? {}).some((d) => d === `@tauri-apps/plugin-${id}`)
  return { cargoHas, libHas, npmHas }
}

// ============ 自定义命令注册表 ============

function collectRegisteredCommands() {
  const registered = new Set()
  const seen = new Set()
  function scan(dir) {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) {
        // 跳过 target / gen（生成代码中的命令不属自定义注册面）
        if (entry.name === 'target' || entry.name === 'gen' || entry.name === 'generated') continue
        scan(p)
      } else if (entry.name.endsWith('.rs')) {
        if (seen.has(p)) continue
        seen.add(p)
        const src = readText(p)
        // 捕获 #[tauri::command] 修饰的函数名
        const re = /#\[tauri::command\][\s\S]{0,200}?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)/g
        let m
        while ((m = re.exec(src)) !== null) registered.add(m[1])
      }
    }
  }
  scan(RUST_SRC)
  // sp_* 语义命令在 sqlite.rs 中批量注册（前缀 sp_）
  const sqliteSrc = readText(join(RUST_SRC, 'sqlite.rs'))
  const spRe = /fn\s+(sp_[a-zA-Z0-9_]+)\s*\(/g
  let sm
  while (spRe.exec(sqliteSrc) !== null) {
    // eslint-disable-next-line no-cond-assign
    if ((sm = spRe.exec(sqliteSrc)) !== null) registered.add(sm[1])
  }
  return registered
}

// ============ 前端 invoke 收集 ============

function collectInvokeCalls() {
  const commands = new Set()
  const seen = new Set()
  function scan(dir) {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'test') continue
        scan(p)
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        if (seen.has(p)) continue
        seen.add(p)
        const src = readText(p)
        // invoke('xxx') / invoke("xxx")
        const re = /invoke\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*|plugin:[a-zA-Z0-9_|]+)['"]\s*,?/g
        let m
        while ((m = re.exec(src)) !== null) commands.add(m[1])
      }
    }
  }
  scan(FRONTEND_SRC)
  return commands
}

// ============ 主校验 ============

function main() {
  const errors = []
  const warnings = []

  if (!existsSync(CAP_DIR)) {
    console.error(`capabilities 目录不存在：${CAP_DIR}`)
    process.exit(1)
  }

  const capFiles = readdirSync(CAP_DIR).filter((f) => f.endsWith('.json'))
  if (capFiles.length === 0) {
    console.error(`capabilities 目录为空：${CAP_DIR}`)
    process.exit(1)
  }

  // ---- 规则 1 & 2：权限黑名单 + 插件注册 ----
  for (const file of capFiles) {
    let cap
    try {
      cap = JSON.parse(readText(join(CAP_DIR, file)))
    } catch (e) {
      errors.push(`[${file}] JSON 解析失败：${e.message}`)
      continue
    }
    const perms = cap.permissions ?? []
    if (!Array.isArray(perms)) {
      errors.push(`[${file}] permissions 非数组`)
      continue
    }
    for (const perm of perms) {
      if (FORBIDDEN_PERMISSIONS.has(perm)) {
        errors.push(`[${file}] 硬拒绝权限：${perm}（报告2 §二：最小授权）`)
        continue
      }
      // 非 core:* 前缀 → 插件注册校验
      if (!perm.startsWith('core:')) {
        const prefix = perm.split(':')[0]
        const pluginId = PLUGIN_ID_BY_PREFIX[prefix]
        if (!pluginId) {
          // 未知前缀：保守放行但告警（可能是自定义插件，避免误杀）
          warnings.push(`[${file}] 未知权限前缀 ${prefix}（${perm}）——如为自定义插件请确认已注册`)
        } else {
          const { cargoHas, libHas, npmHas } = pluginRegistered(pluginId)
          if (!cargoHas || !libHas || !npmHas) {
            errors.push(
              `[${file}] 权限 ${perm} 对应插件 ${pluginId} 未完整注册（Cargo=${cargoHas} lib=${libHas} npm=${npmHas}）——「声明了权限但无实现」`,
            )
          }
        }
      }
    }
    // scope 宽泛通配
    const scope = cap.scope ?? []
    const walk = (arr, pathStr) => {
      if (typeof arr === 'string') {
        if (FORBIDDEN_SCOPE_PATTERNS.some((re) => re.test(arr))) {
          errors.push(`[${file}] scope 宽泛通配：${pathStr} = "${arr}"（应收缩到具体域名/路径）`)
        }
        return
      }
      if (!Array.isArray(arr) && typeof arr !== 'object') return
      for (const [k, v] of Object.entries(arr)) {
        walk(v, `${pathStr}.${k}`)
      }
    }
    walk(scope, 'scope')
  }

  // ---- 规则 3：invoke 命令必须已注册 ----
  const registered = collectRegisteredCommands()
  const invokeCalls = collectInvokeCalls()
  for (const cmd of invokeCalls) {
    if (cmd.startsWith('plugin:') || cmd.startsWith('plugin_')) continue // 插件命令由插件自身注册（plugin:store|set / plugin_storage_set）
    if (cmd.startsWith('sp_')) continue // Rust 语义 SQL 命令（sqlite.rs 批量注册）
    if (!registered.has(cmd)) {
      errors.push(`invoke('${cmd}') 在 Rust 端未找到 #[tauri::command] 定义——前端调用了不存在的命令`)
    }
  }

  // ---- 输出 ----
  if (errors.length > 0) {
    console.error(`❌ capability lint 失败（${errors.length} 项违规）：`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  if (warnings.length > 0) {
    console.warn(`⚠ capability lint 通过（${warnings.length} 项告警）：`)
    for (const w of warnings) console.warn(`  - ${w}`)
  }
  console.log(`✅ capability lint 通过：${capFiles.join(', ')}（权限最小授权 + 插件实现 + invoke 命令存在性）`)
}

main()
