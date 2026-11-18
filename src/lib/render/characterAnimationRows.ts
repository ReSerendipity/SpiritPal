/**
 * 自定义动画行编辑的纯逻辑层（TD-011）。
 *
 * 债项原状：`CharacterCreator` 的「自定义」动画预设只有一个按钮，行编辑 UI 被整段删掉
 * （`docs/_devarchive/removed-components/CustomPetForm.tsx`），因为当时的编辑结果**没有写回**
 * `atlasLayout`／角色档案——用户改了也不生效，比不提供更误导。
 *
 * 现在这条链补齐为：行草稿（draft）→ 校验 → `CharacterProfile.animationRows` → `SpriteRenderer`
 * 直接取用（渲染侧早就支持 `character.animationRows[animKey]`，缺的只是「编辑并写回」这一跳）。
 *
 * 校验不另起一套口径：行号范围 / 帧数上限 / 行号重复都直接复用
 * `lib/render/spriteLayout.ts` 的 `validateSpriteLayout`（那是仓内既有、已被 `spriteLayout` 使用的判据）。
 * 唯一在此升级的一条：**动画名重复在那边只是 warning**，但落到 `animationRows` 这个以动画名为 key 的
 * 映射里会静默覆盖前一行（后一行赢），属于"编辑结果丢一半还不报错"，所以这里把它升为 error。
 */

import { ATLAS, ANIMATION_ROWS, type AnimationRow } from '@/lib/data/types'
import { DEFAULT_SPRITE_LAYOUT, validateSpriteLayout, type SpriteRowLayout } from './spriteLayout'

/** 未使用的行（草稿里 name 为空串） */
export const UNUSED_ROW_NAME = ''

/** 一行草稿：行号固定，动画名可空（空 = 该行不参与动画） */
export interface AnimationRowDraft {
  row: number
  name: string
  frames: number
}

/** 可选的动画名（与全局 ANIMATION_ROWS 键一致，渲染侧就是按这些 key 查找） */
export function availableAnimationNames(): string[] {
  return Object.keys(ANIMATION_ROWS)
}

/** 该行默认应放哪个动画（按全局 ANIMATION_ROWS 的行号反查） */
function defaultNameForRow(row: number): string {
  const entry = Object.entries(ANIMATION_ROWS).find(([, v]) => v.row === row)
  return entry ? entry[0] : UNUSED_ROW_NAME
}

/**
 * 生成行草稿。
 *
 * @param rows 行数（默认取全局 ATLAS.rows，即 9）
 * @param current 角色已有的 `animationRows`（有则以它为准，缺的行回落到全局默认）
 */
export function buildRowDraft(rows: number = ATLAS.rows, current?: Record<string, AnimationRow>): AnimationRowDraft[] {
  const byRow = new Map<number, { name: string; frames: number }>()
  for (const [name, v] of Object.entries(current ?? {})) {
    if (!Number.isInteger(v.row) || v.row < 0 || v.row >= rows) continue
    byRow.set(v.row, { name, frames: v.frames })
  }
  const draft: AnimationRowDraft[] = []
  for (let row = 0; row < rows; row++) {
    const hit = byRow.get(row)
    if (hit) {
      draft.push({ row, name: hit.name, frames: hit.frames })
    } else {
      const name = defaultNameForRow(row)
      draft.push({ row, name, frames: name ? ANIMATION_ROWS[name].frames : 0 })
    }
  }
  return draft
}

/** 把草稿转成 `validateSpriteLayout` 认的布局（未使用的行不进校验，避免"空行"被当成非法） */
function draftToLayout(draft: AnimationRowDraft[]) {
  const rows: SpriteRowLayout[] = draft
    .filter((d) => d.name.trim() !== UNUSED_ROW_NAME)
    .map((d) => ({ row: d.row, name: d.name.trim(), frames: d.frames }))
  return {
    ...DEFAULT_SPRITE_LAYOUT,
    sheetSize: { ...DEFAULT_SPRITE_LAYOUT.sheetSize },
    rows,
  }
}

export interface AnimationRowsResult {
  /** 合法的行映射；有 error 时为 undefined（不写回，免得把非法值持久化） */
  animationRows?: Record<string, AnimationRow>
  errors: string[]
  warnings: string[]
}

/**
 * 校验并生成 `CharacterProfile.animationRows`。
 *
 * 出错时**不返回映射**：宁可让编辑停在草稿态，也不把非法行写进角色档案——
 * 越界行号在渲染侧会把图集取到图外，表现为黑块/闪烁，比不生效更难查。
 */
export function draftToAnimationRows(draft: AnimationRowDraft[]): AnimationRowsResult {
  const layout = draftToLayout(draft)
  const validated = validateSpriteLayout(layout)

  const errors = [...validated.errors]
  const warnings = [...validated.warnings]

  // 动画名重复：validateSpriteLayout 只报 warning，这里升级为 error（映射会静默覆盖）
  const seen = new Map<string, number>()
  for (const row of layout.rows) {
    if (seen.has(row.name)) {
      errors.push(`动画名 "${row.name}" 同时用在行 ${seen.get(row.name)} 和行 ${row.row}，写回时后者会覆盖前者`)
    } else {
      seen.set(row.name, row.row)
    }
  }

  if (errors.length > 0) return { errors, warnings }
  return { animationRows: buildAnimationRowsFromDraft(draft), errors, warnings }
}

function buildAnimationRowsFromDraft(draft: AnimationRowDraft[]): Record<string, AnimationRow> {
  const out: Record<string, AnimationRow> = {}
  for (const d of draft) {
    const name = d.name.trim()
    if (name === UNUSED_ROW_NAME) continue
    out[name] = { row: d.row, frames: d.frames }
  }
  return out
}

/** 三档预设 → 写回值（`default` 返回 undefined，让渲染侧回落到全局 ANIMATION_ROWS） */
export type AnimationPreset = 'default' | 'simple' | 'custom'

export function animationRowsForPreset(
  preset: AnimationPreset,
  draft: AnimationRowDraft[],
): AnimationRowsResult {
  if (preset === 'default') {
    return { animationRows: undefined, errors: [], warnings: [] }
  }
  if (preset === 'simple') {
    // 只保留 idle / walk 两行，行号与帧数沿用全局口径
    const rows: Record<string, AnimationRow> = {
      idle: { ...ANIMATION_ROWS.idle },
      walk: { ...ANIMATION_ROWS.walk },
    }
    return { animationRows: rows, errors: [], warnings: [] }
  }
  return draftToAnimationRows(draft)
}
