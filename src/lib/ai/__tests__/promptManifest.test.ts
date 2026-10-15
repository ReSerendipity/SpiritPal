/**
 * @file promptManifest.test.ts
 * @description 外源 Prompt 登记机制的漂移门禁（LLM 维度 P1「提示散落无版本」）
 *
 * 与 perf/安全类既有「负向自证」惯例同思路：把散落在业务模块里的提示做成**台账 + 机器校验**，
 * 让任何提示变更都必须在 Git 里留下带版本号的一笔记账。
 *
 * 三条不变式：
 * 1. 正向漂移：每条登记的 anchors 必须在其文件中出现且**仅一次** —— 改提示首句即红；
 * 2. 反向漂移：受管文件的「疑似提示行」有效条数须与 PROMPT_FILE_BASELINE 一致 ——
 *    新增/删除提示即红（英文提示等不在正则口径内的情况由第 1 条的锚点兜底）；
 * 3. 元数据自洽：每条登记都有锚点、version >= 1，且 file 落在已登记基线的受管文件内。
 *
 * 修复路径（写给后来者）：测试变红时不要删用例或放松口径，而是回到
 * `src/lib/ai/promptManifest.ts` 更新对应条目的 version / changeLog / anchors / 基线，
 * 并在提交信息里说明这次改动对 LLM 行为的影响。
 *
 * ⚠️ 口径说明：这是**回归保护线**，不是提示质量评测集。它保证「提示变更可追溯」，
 * 不保证提示本身好或坏（提示/人格质量回归见 prompt.eval.test.ts）。
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  EXTERNAL_PROMPT_MANIFEST,
  PROMPT_FILE_BASELINE,
  PROMPT_TEXT_HINT_RE,
  getExternalPromptRef,
  getExternalPromptVersions,
  getManagedPromptFiles,
} from '../promptManifest'

/** 仓库根目录：<本测试文件> = src/lib/ai/__tests__/promptManifest.test.ts */
const REPO_ROOT = resolve(__dirname, '../../../..')

const readRepoFile = (relPath: string): string => readFileSync(resolve(REPO_ROOT, relPath), 'utf8')

/** 锚点在文本中的命中次数（纯函数，便于负向自证复用） */
function anchorHits(content: string, anchor: string): number {
  return content.split(anchor).length - 1
}

/** 有效疑似提示行数 = 命中正则的行数 - 登记的伪命中行数 */
function effectiveHintLines(content: string, nonPromptAnchors: string[] = []): number {
  const lines = content.split(/\r?\n/)
  const hit = lines.filter((line) => PROMPT_TEXT_HINT_RE.test(line)).length
  if (nonPromptAnchors.length === 0) return hit
  const nonPrompt = lines.filter((line) => nonPromptAnchors.some((anchor) => line.includes(anchor))).length
  return hit - nonPrompt
}

describe('外源 Prompt 登记清单', () => {
  it('key 全局唯一（否则版本台账里会出现两条同名条目）', () => {
    const versions = getExternalPromptVersions()
    expect(Object.keys(versions)).toHaveLength(EXTERNAL_PROMPT_MANIFEST.length)
  })

  it('每条登记至少有一个锚点、版本号 >= 1、file 指向存在的受管文件', () => {
    for (const ref of EXTERNAL_PROMPT_MANIFEST) {
      expect(ref.anchors.length, `${ref.key} 缺少锚点`).toBeGreaterThan(0)
      expect(ref.version, `${ref.key} 版本号非法`).toBeGreaterThanOrEqual(1)
      expect(PROMPT_FILE_BASELINE[ref.file], `${ref.key} 的 file 未登记基线`).toBeDefined()
      expect(() => readRepoFile(ref.file), `${ref.key} 的 file 不可读`).not.toThrow()
    }
  })

  it('getExternalPromptRef / getManagedPromptFiles 行为正确', () => {
    const first = EXTERNAL_PROMPT_MANIFEST[0]
    expect(getExternalPromptRef(first.key)?.file).toBe(first.file)
    expect(getExternalPromptRef('__不存在的 key__')).toBeUndefined()
    // 受管文件数 <= 清单条数（同一文件可承载多条登记）
    expect(getManagedPromptFiles().length).toBeLessThanOrEqual(EXTERNAL_PROMPT_MANIFEST.length)
    for (const f of getManagedPromptFiles()) expect(PROMPT_FILE_BASELINE[f]).toBeDefined()
  })
})

describe('提示漂移检测（改提示必须同步更新 version）', () => {
  it('正向：每条锚点在源文件中出现且仅出现一次', () => {
    for (const ref of EXTERNAL_PROMPT_MANIFEST) {
      const content = readRepoFile(ref.file)
      for (const anchor of ref.anchors) {
        const hits = anchorHits(content, anchor)
        expect(
          hits,
          `${ref.key} 的锚点在 ${ref.file} 中命中 ${hits} 次（应为 1）：提示已漂移，请同步更新 version/changeLog`,
        ).toBe(1)
      }
    }
  })

  it('反向：受管文件的疑似提示行有效条数与基线一致（新增或删除提示必须重新登记）', () => {
    for (const file of Object.keys(PROMPT_FILE_BASELINE)) {
      const baseline = PROMPT_FILE_BASELINE[file]
      const effective = effectiveHintLines(readRepoFile(file), baseline.nonPromptAnchors ?? [])
      expect(effective, `${file} 的疑似提示行数偏离登记基线`).toBe(baseline.hintLines)
    }
  })
})

describe('负向自证：门禁真的拦得住漂移', () => {
  const sample = [
    '// 模拟源文件',
    'export const X = {',
    "  systemPrompt: '你是一个专业的图像分析助手。请仔细分析图片内容。',",
    '}',
    "const KEYWORDS = ['你是我最重要的人', '你是我的全部']",
  ].join('\n')

  it('改掉的提示会因为锚点失配被抓出来（而不是静默通过）', () => {
    const anchor = '你是一个专业的图像分析助手'
    expect(anchorHits(sample, anchor)).toBe(1)

    const drifted = sample.replace('专业的图像分析助手', '普通的图片处理脚本')
    expect(anchorHits(drifted, anchor)).toBe(0)
  })

  it('新增一处未登记提示会让反向基线变红（而不是静默通过）', () => {
    const baseline = effectiveHintLines(sample, ['你是我最重要的人', '你是我的全部'])
    expect(baseline).toBe(1)

    const withNewPrompt = `${sample}\nconst EXTRA = '请根据上下文重新组织答案。'`
    expect(effectiveHintLines(withNewPrompt, ['你是我最重要的人', '你是我的全部'])).toBe(2)
  })
})
