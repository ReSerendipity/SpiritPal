/**
 * 宠物窗口尺寸计算（纯函数，无 React 依赖）
 *
 * 窗口尺寸的三条规则（与 Rust 侧 max/min_inner_size 对齐）：
 * 1. 基准适配：窗口 = 精灵尺寸 + 四周 16px 边距，顶部额外预留气泡空间
 * 2. 气泡驱动：宠物说话内容变大时，窗口在基准适配基础上按气泡实际尺寸扩展
 * 3. 钳位：下限 WIN_MIN（对齐 Rust min_inner_size 160×200），上限 WIN_MAX（720×900）
 *
 * 供 PetWindow（挂载校正 / 滚轮缩放 / 气泡自适应）与单元测试复用。
 */

export const SPRITE_W = 192
export const SPRITE_H = 208
/** 窗口最小尺寸（对齐 Rust min_inner_size 160×200）：宠物缩小时窗口跟随缩小 */
export const WIN_MIN_W = 160
export const WIN_MIN_H = 200
/** 窗口最大尺寸（对齐 Rust max_inner_size 720×900） */
export const WIN_MAX_W = 720
export const WIN_MAX_H = 900
/** 宠物头顶上方的气泡预留空间（PetBubble 定位在宠物容器正上方） */
export const BUBBLE_TOP_SPACE = 64
/** 窗口内边距（精灵四周各 16px） */
const EDGE_MARGIN = 32

/** 展开态：左侧状态卡宽度 */
export const STATUS_PANEL_W = 176
/** 展开态：右侧动作列表宽度 */
export const ACTIONS_PANEL_W = 148
/** 展开态：状态卡估算高度（名称/等级 + 3 行状态 + 金币 + 按钮） */
export const STATUS_PANEL_H = 150
/** 展开态：动作列表估算高度（约 11 项 × 24px + 分组间距 + 内边距） */
export const ACTIONS_PANEL_H = 280
/** 展开态：区块间距 */
export const PANEL_GAP = 6
/** 展开态：顶部对话区上下边距（top-2 + 与下方栏的间隙） */
export const DIALOGUE_ZONE_PAD = 16

/** 目标窗口尺寸（逻辑像素） */
export interface WindowSize {
  w: number
  h: number
}

/**
 * 按宠物尺寸计算基准窗口尺寸（不含气泡扩展）：
 * 宽 = 精灵宽 + 32 边距，高 = 精灵高 + 32 边距 + 64 气泡空间，
 * 结果钳位到 [WIN_MIN, WIN_MAX]。
 */
export function computeWindowSizeFor(petSize: number): WindowSize {
  const sw = SPRITE_W * petSize
  const sh = SPRITE_H * petSize
  return {
    w: Math.min(WIN_MAX_W, Math.max(WIN_MIN_W, Math.ceil(sw + EDGE_MARGIN))),
    h: Math.min(WIN_MAX_H, Math.max(WIN_MIN_H, Math.ceil(sh + EDGE_MARGIN + BUBBLE_TOP_SPACE))),
  }
}

/**
 * 按宠物尺寸 + 气泡实际尺寸计算窗口尺寸：
 * 宽 = max(基准宽, 气泡宽 + 24 边距)，高 = max(基准高, 精灵高 + 气泡高 + 16 边距)，
 * 结果钳位到 [WIN_MIN, WIN_MAX]。
 */
export function computeBubbleWindowSize(petSize: number, bubbleW: number, bubbleH: number): WindowSize {
  const fit = computeWindowSizeFor(petSize)
  const sh = SPRITE_H * petSize
  return {
    w: Math.min(WIN_MAX_W, Math.max(fit.w, Math.ceil(bubbleW + 24))),
    h: Math.min(WIN_MAX_H, Math.max(fit.h, Math.ceil(sh + bubbleH + 16))),
  }
}

/** 状态卡显示模式：off=不显示 / left=展开面板左侧 / right=宠物右侧 */
export type StatusCardMode = 'off' | 'left' | 'right'

/**
 * 展开态面板窗口尺寸（右键展开时使用）：
 * 布局 = 顶部对话区（随气泡内容自适应）→ 内容行（状态卡 + 宠物 + 动作列表并排，宠物不被压到列表下方）。
 * - 'off'：宠物左 + 动作列表右（宽 = GAP + 宠物宽 + GAP + 动作宽 + GAP）
 * - 'left'：状态卡左 + 宠物中 + 动作列表右（宽 = GAP + 状态宽 + GAP + 宠物宽 + GAP + 动作宽 + GAP）
 * - 'right'：宠物左 + 右侧堆叠（状态卡在上 + 动作列表在下）
 * 可选 actionsH/statusH：运行时传入两栏 DOM 实测高度，缺省用估算常量。
 * 结果钳位到 [WIN_MIN, WIN_MAX]。
 */
export function computePanelWindowSize(
  petSize: number,
  bubbleW: number,
  bubbleH: number,
  actionsH: number = ACTIONS_PANEL_H,
  statusH: number = STATUS_PANEL_H,
  statusMode: StatusCardMode = 'left',
): WindowSize {
  const fit = computeWindowSizeFor(petSize)
  const sw = SPRITE_W * petSize
  const sh = SPRITE_H * petSize
  const dialogueH = DIALOGUE_ZONE_PAD + bubbleH
  let rowW: number
  let rowH: number
  if (statusMode === 'off') {
    rowW = sw + PANEL_GAP + ACTIONS_PANEL_W
    rowH = Math.max(sh, actionsH)
  } else if (statusMode === 'left') {
    rowW = STATUS_PANEL_W + PANEL_GAP + sw + PANEL_GAP + ACTIONS_PANEL_W
    rowH = Math.max(statusH, sh, actionsH)
  } else {
    // 'right'：右侧堆叠 = 状态卡 + 动作列表
    rowW = sw + PANEL_GAP + Math.max(STATUS_PANEL_W, ACTIONS_PANEL_W)
    rowH = Math.max(sh, statusH + actionsH)
  }
  const needW = PANEL_GAP + rowW + PANEL_GAP
  const needH = dialogueH + rowH + PANEL_GAP
  return {
    w: Math.min(WIN_MAX_W, Math.max(fit.w, Math.ceil(needW), Math.ceil(sw + 16))),
    h: Math.min(WIN_MAX_H, Math.max(fit.h, Math.ceil(needH))),
  }
}

/**
 * 展开态面板内宠物的位置（并排行布局）：
 * 水平：'off'/'right' 在窗口左侧（GAP 处），'left' 在状态卡右侧；
 * 垂直：内容行内居中（宠物与动作列表并排，不在列表下方）。
 */
export function computePanelPetPos(
  petSize: number,
  bubbleW: number,
  bubbleH: number,
  actionsH: number = ACTIONS_PANEL_H,
  statusH: number = STATUS_PANEL_H,
  statusMode: StatusCardMode = 'left',
): { x: number; y: number } {
  const sh = SPRITE_H * petSize
  const dialogueH = DIALOGUE_ZONE_PAD + bubbleH
  let petX: number
  let rowH: number
  if (statusMode === 'off') {
    petX = PANEL_GAP
    rowH = Math.max(sh, actionsH)
  } else if (statusMode === 'left') {
    petX = PANEL_GAP + STATUS_PANEL_W + PANEL_GAP
    rowH = Math.max(statusH, sh, actionsH)
  } else {
    petX = PANEL_GAP
    rowH = Math.max(sh, statusH + actionsH)
  }
  return {
    x: petX,
    y: dialogueH + Math.max(0, Math.round((rowH - sh) / 2)),
  }
}

/**
 * 宠物行走目标 x 区间（纯函数）：
 * - 收起态：minX=8，maxX=实际窗口宽 - 精灵宽 - 8（修复硬编码 300px 旧窗口宽导致的游走越界）
 * - 展开态（panelOpen）：minX=宠物区左缘（'left' 模式在状态卡右侧，否则窗口左侧），
 *   maxX=窗口宽 - 右栏宽 - 间距 - 精灵宽（列间缝隙，通常 <24px → 调用方跳过行走）
 */
export function computeWalkBounds(
  petSize: number,
  winW: number,
  panelOpen: boolean,
  statusMode: StatusCardMode = 'left',
): { minX: number; maxX: number } {
  const sw = SPRITE_W * petSize
  if (!panelOpen) {
    return { minX: 8, maxX: Math.max(8, winW - sw - 8) }
  }
  const minX = statusMode === 'left' ? PANEL_GAP + STATUS_PANEL_W + PANEL_GAP : PANEL_GAP
  const rightColW = statusMode === 'left' ? ACTIONS_PANEL_W : statusMode === 'right' ? Math.max(STATUS_PANEL_W, ACTIONS_PANEL_W) : ACTIONS_PANEL_W
  return { minX, maxX: winW - PANEL_GAP - rightColW - PANEL_GAP - sw }
}

/**
 * 宠物在窗口内的推荐位置：水平居中，底部留 8px 边距。
 * 气泡出现时需保证 pos.y ≥ 气泡高 + 8（气泡完整可见），
 * 因此气泡驱动的窗口（高度按 精灵高+气泡高+16 计算）天然满足该约束。
 */
export function computePetPosInWindow(win: WindowSize, petSize: number): { x: number; y: number } {
  const sw = SPRITE_W * petSize
  const sh = SPRITE_H * petSize
  return {
    x: Math.max(0, Math.round((win.w - sw) / 2)),
    y: Math.max(0, Math.round(win.h - sh - 8)),
  }
}
