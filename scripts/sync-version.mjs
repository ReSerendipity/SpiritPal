#!/usr/bin/env node
/**
 * SpiritPal 版本一致性工具（P1-2 / 报告 5.3）
 * - 以 package.json 的 version 为单一事实来源
 * - 同步目标：src-tauri/Cargo.toml、src-tauri/tauri.conf.json
 * - 用法：
 *   node scripts/sync-version.mjs          # 以 package.json 为准，回写到另外两处
 *   node scripts/sync-version.mjs --check  # 只校验三处是否一致，不一致 exit 1（供 CI / push 预检）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const here = (...p) => join(ROOT, '..', ...p);
const CHECK = process.argv.includes('--check');

const pkgPath = here('package.json');
const cargoPath = here('src-tauri', 'Cargo.toml');
const confPath = here('src-tauri', 'tauri.conf.json');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const pkg = readJson(pkgPath);
const conf = readJson(confPath);
const pkgVersion = pkg.version;

// Cargo.toml：仅匹配 [package] 段首次出现的顶层 version = "x.y.z"
const cargo = readFileSync(cargoPath, 'utf8');
const cargoMatch = cargo.match(/^version\s*=\s*"([^"]+)"/m);
if (!cargoMatch) {
  console.error('sync-version: 无法在 src-tauri/Cargo.toml [package] 段找到 version');
  process.exit(1);
}
const cargoVersion = cargoMatch[1];

const results = [
  { file: 'package.json', value: pkgVersion },
  { file: 'src-tauri/Cargo.toml', value: cargoVersion },
  { file: 'src-tauri/tauri.conf.json', value: conf.version },
];

const mismatched = results.filter((r) => r.value !== pkgVersion);

if (CHECK) {
  console.log(`verify: package.json=${pkgVersion} Cargo.toml=${cargoVersion} tauri.conf.json=${conf.version}`);
  if (mismatched.length > 0) {
    console.error(
      `sync-version: 版本不一致！以 package.json ${pkgVersion} 为准，以下文件漂移:\n` +
        mismatched.map((m) => `  - ${m.file}: ${m.value}`).join('\n'),
    );
    process.exit(1);
  }
  console.log('sync-version: 三处版本一致 ✓');
  process.exit(0);
}

if (mismatched.length === 0) {
  console.log(`sync-version: 三处一致（${pkgVersion}），无需改动`);
  process.exit(0);
}

// 回写 Cargo.toml：保持原文件其余内容逐字节不变
const nextCargo = cargo.replace(/^version\s*=\s*"([^"]+)"/m, `version = "${pkgVersion}"`);
writeFileSync(cargoPath, nextCargo);

// 回写 tauri.conf.json：保持字段顺序，仅改 version
conf.version = pkgVersion;
writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`);

console.log(`sync-version: package.json ${pkgVersion} 已同步到 Cargo.toml / tauri.conf.json`);