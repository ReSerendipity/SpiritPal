/**
 * 社区宠物接入的纯映射/规范化函数（无副作用，供 import 脚本与单测共用）
 *
 * - normalizeId: 外部仓库角色 id → SpiritPal kebab-case id（撞内置追加来源后缀）
 * - VIDEO_STATE_FILES: SpiritPal 视频宠物状态 → webm 文件名（与 SpriteRenderer.tsx stateToVideoFile 对齐）
 */

/** 内置角色 id（社区宠物撞名时追加来源后缀） */
export const BUILTIN_IDS = new Set(['doro', 'feibi', 'gugugaga'])

/** OC-Claw 源 id → 规范 id 映射（点号转连字符，撞内置加后缀） */
export const OC_CLAW_ID_MAP = {
  'doro.codex-pet': 'doro-codex',
  'phoebe.codex-pet': 'phoebe-codex',
}

/** 规范化 id：kebab-case，撞内置追加来源后缀 */
export function normalizeId(id, source) {
  let out = (OC_CLAW_ID_MAP[id] ?? id)
    .toLowerCase()
    .replace(/\./g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  if (BUILTIN_IDS.has(out)) out = `${out}-${source}`
  return out
}

/**
 * 视频宠物状态 → webm 文件名（与 SpriteRenderer.tsx stateToVideoFile 约定一致）
 * idle/walk/rest/eat/spin/dance/angry/headpat 是 SpiritPal 状态机需要的全部视频状态
 */
export const VIDEO_STATE_FILES = {
  idle: 'idle.webm',
  walk: 'walk.webm',
  rest: 'rest.webm',
  eat: 'eat.webm',
  spin: 'spin.webm',
  dance: 'dance.webm',
  angry: 'angry.webm',
  headpat: 'headpat.webm',
}

/** OC-Claw 香企鹅：源 .mov 名 → 输出状态 */
export const XQ_STATE_MAP = {
  idle: 'idle',
  walk: 'walk',
  rest: 'rest',
  eat: 'eat',
  spin: 'spin',
  dance: 'dance',
  angry: 'angry',
  headpat: 'headpat',
}

/** dsh-pet 大肥鱼：源 webm 中文动作名 → 输出状态（91 动作库中取 8 个状态子集） */
export const DSHPET_STATE_MAP = {
  idle: '待机呼吸休闲',
  walk: '螃蟹走路',
  rest: '原地小憩沉眠',
  eat: '吃午餐',
  spin: '被鼠标拖拽悬空反馈',
  dance: '轻快摇摆舞',
  angry: '点击回应-傲娇生气',
  headpat: '点击回应-挠痒咯咯笑',
}
