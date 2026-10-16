// spec-refs 仓内审计器（scripts/spec_audit_local.py）的门禁自证测试
//
// 背景：CI 原先以 `--allow-unavailable` 调用家族审计器，干净检出永远跑不到审计器，
// 门禁只剩一条 ::warning::（绿 ≠ 已判定）。改为回落仓内审计器之后，还必须能证明
// 「它会拦幽灵路径」——否则审计器被改哑，就又剩下一个装饰性门禁。
//
// 运行：随 pnpm test 一起跑（vitest.config.ts 的 include 覆盖 scripts/__tests__/*.test.mjs）
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const AUDITOR = join(REPO, 'scripts', 'spec_audit_local.py')

function findPython() {
  for (const candidate of ['python', 'python3', 'py']) {
    if (!spawnSync(candidate, ['--version']).error) return candidate
  }
  return null
}

const PYTHON = findPython()

/** 审计器需要 python 才能跑；缺失时明确失败，不静默放行（否则自证变成假通过） */
function requirePython() {
  if (!PYTHON) {
    throw new Error('未找到 python 解释器（python / python3 / py），spec-refs 门禁无法自证')
  }
}

/** 在指定 root 上跑审计器，返回 { code, out }（stdout+stderr 合并） */
function runAuditor(root) {
  requirePython()
  const r = spawnSync(PYTHON, [AUDITOR, '--root', root, '--list'], { encoding: 'utf-8' })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const tmpDirs = []
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'spec-audit-'))
  tmpDirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf-8')
  }
  return root
}

/** 需要真实 git check-ignore 语义的夹具（.gitignore 命中判定离不开 git 仓库） */
function gitFixture(files) {
  const root = fixture(files)
  const r = spawnSync('git', ['-C', root, 'init', '-q'], { encoding: 'utf-8' })
  if (r.status !== 0) {
    throw new Error(`夹具 git init 失败，无法自证 .gitignore 判定：${r.stderr}`)
  }
  return root
}

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 清理失败不影响结论
    }
  }
})

describe('spec_audit_local 门禁自证', () => {
  it('门禁调用的脚本不存在时必须 exit 1 并点名（负向核心用例）', () => {
    const root = fixture({
      'scripts/present.py': 'print("ok")\n',
      '.github/workflows/gate.yml': [
        'name: gate',
        'on: push',
        'jobs:',
        '  lint:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: python scripts/present.py',
        '      - run: node scripts/absent.mjs',
        '',
      ].join('\n'),
    })
    const { code, out } = runAuditor(root)
    expect(code, out).toBe(1)
    expect(out).toContain('PHANTOM scripts/absent.mjs')
    expect(out).toContain('gate.yml')
    // 存在的那条不该被误报
    expect(out).not.toContain('PHANTOM scripts/present.py')
  })

  it('pre-commit local hook 指向缺失脚本时必须 exit 1', () => {
    const root = fixture({
      'scripts/gate.mjs': 'console.log(1)\n',
      '.pre-commit-config.yaml': [
        'repos:',
        '  - repo: local',
        '    hooks:',
        '      - id: ok',
        '        entry: node scripts/gate.mjs',
        '      - id: broken',
        '        entry: python scripts/gone.py',
        '',
      ].join('\n'),
    })
    const { code, out } = runAuditor(root)
    expect(code, out).toBe(1)
    expect(out).toContain('scripts/gone.py')
    expect(out).not.toContain('PHANTOM scripts/gate.mjs')
  })

  it('治理文档把仓库路径写成幽灵路径时必须拦下', () => {
    const root = fixture({
      'README.md': ['# demo', '', '门禁脚本见 `scripts/not-there.py`。', ''].join('\n'),
    })
    const { code, out } = runAuditor(root)
    expect(code, out).toBe(1)
    expect(out).toContain('PHANTOM scripts/not-there.py')
    expect(out).toContain('README.md')
  })

  it('已跟踪治理文档引用被 .gitignore 命中的路径时，记入台账但不判失败', () => {
    const root = gitFixture({
      '.gitignore': ['AGENTS.md', 'docs/agents/', ''].join('\n'),
      'README.md': ['# demo', '', '本地层规则见 `docs/agents/SOPS.md`。', ''].join('\n'),
      'AGENTS.md': ['# agents', '', '同类内容见 `docs/agents/GOTCHAS.md`。', ''].join('\n'),
    })
    const { code, out } = runAuditor(root)
    // 不阻断：本地层不入库是有意设计，硬判会让必需检查天天红、信号被噪声吃掉
    expect(code, out).toBe(0)
    expect(out).toContain('status=PASS')
    // 但必须可见：已跟踪文档里那条引用过去被 check-ignore 整条静默减掉
    expect(out).toContain('UNTRACKED docs/agents/SOPS.md')
    expect(out).toMatch(/untracked_refs=1/)
    expect(out).toContain('README.md')
    // 本地层自身引用兄弟本地层文件属设计内行为，不进台账
    expect(out).not.toContain('GOTCHAS.md')
  })

  it('路径全部存在时放行（正向用例，防审计器被改哑后反向失效）', () => {
    const root = fixture({
      'scripts/present.py': 'print("ok")\n',
      'README.md': ['# demo', '', '跑 `python scripts/present.py` 即可。', ''].join('\n'),
      '.github/workflows/gate.yml': [
        'name: gate',
        'jobs:',
        '  lint:',
        '    steps:',
        '      - run: python scripts/present.py',
        '',
      ].join('\n'),
    })
    const { code, out } = runAuditor(root)
    expect(code, out).toBe(0)
    expect(out).toContain('status=PASS')
  })

  it('真实仓库当前无幽灵引用，且确实判过足够多的路径', () => {
    const { code, out } = runAuditor(REPO)
    expect(code, out).toBe(0)
    expect(out).toContain('status=PASS')
    // 必须真的判过东西，而不是"什么都没扫到"式的假通过
    expect(Number(/claims=(\d+)/.exec(out)?.[1] ?? 0)).toBeGreaterThan(20)
  })

  it('包装脚本无家族审计器时也报告"已执行"，不再退化为 UNAVAILABLE', () => {
    requirePython()
    const r = spawnSync(PYTHON, [join(REPO, 'scripts', 'check_spec_refs.py')], {
      encoding: 'utf-8',
    })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    expect(r.status, out).toBe(0)
    expect(out).toMatch(/status=PASS auditor=(family|repo-local)/)
    expect(out).not.toContain('UNAVAILABLE')
  })
})
