/**
 * petWindowSizing 纯函数测试 — 窗口尺寸计算规则（基准适配 / 气泡驱动 / 钳位）
 */
import { describe, it, expect } from 'vitest'
import {
  computeWindowSizeFor,
  computeBubbleWindowSize,
  computePanelWindowSize,
  computePanelPetPos,
  computePetPosInWindow,
  computeWalkBounds,
  WIN_MIN_W,
  WIN_MIN_H,
  WIN_MAX_W,
  WIN_MAX_H,
  ACTIONS_PANEL_H,
  STATUS_PANEL_H,
} from '../petWindowSizing'

describe('computeWindowSizeFor（基准适配：精灵 + 32 边距 + 64 气泡空间，钳位 160×200~720×900）', () => {
  it('0.5× 宠物（96×104）→ 钳位到最小 160×200', () => {
    expect(computeWindowSizeFor(0.5)).toEqual({ w: 160, h: 200 })
  })

  it('1.0× 宠物（192×208）→ 224×304', () => {
    expect(computeWindowSizeFor(1.0)).toEqual({ w: 224, h: 304 })
  })

  it('2.0× 宠物（384×416）→ 416×512', () => {
    expect(computeWindowSizeFor(2.0)).toEqual({ w: 416, h: 512 })
  })

  it('3.0× 宠物（576×624）→ 608×720（上限 720×900 内）', () => {
    expect(computeWindowSizeFor(3.0)).toEqual({ w: 608, h: 720 })
  })

  it('超大宠物尺寸 → 钳位到最大 720×900', () => {
    expect(computeWindowSizeFor(10)).toEqual({ w: WIN_MAX_W, h: WIN_MAX_H })
  })

  it('极限小宠物 → 钳位到最小 160×200', () => {
    expect(computeWindowSizeFor(0.1)).toEqual({ w: WIN_MIN_W, h: WIN_MIN_H })
  })
})

describe('computeBubbleWindowSize（气泡驱动：窗口随说话内容扩展）', () => {
  it('小气泡不超过基准 → 保持基准尺寸', () => {
    expect(computeBubbleWindowSize(1.0, 120, 30)).toEqual({ w: 224, h: 304 })
  })

  it('宽气泡（244px 含边距）→ 宽度扩展，高度不变', () => {
    expect(computeBubbleWindowSize(1.0, 244, 40)).toEqual({ w: 268, h: 304 })
  })

  it('高气泡（5 行文字）→ 高度扩展', () => {
    expect(computeBubbleWindowSize(1.0, 220, 130)).toEqual({ w: 244, h: 354 })
  })

  it('宽 + 高气泡同时扩展', () => {
    expect(computeBubbleWindowSize(1.0, 244, 160)).toEqual({ w: 268, h: 384 })
  })

  it('0.5× 宠物 + 高气泡 → 高度按 精灵高+气泡高+16', () => {
    // 0.5×: 精灵 104 高；气泡 150 高 → 104+150+16 = 270；宽 244+24 = 268
    expect(computeBubbleWindowSize(0.5, 244, 150)).toEqual({ w: 268, h: 270 })
  })

  it('极端大气泡 → 钳位到最大 720×900', () => {
    expect(computeBubbleWindowSize(1.0, 800, 800)).toEqual({ w: WIN_MAX_W, h: WIN_MAX_H })
  })
})

describe('computePanelWindowSize（并排行：状态/宠物/动作列表同排，宠物不被压到列表下方）', () => {
  it("0.5× 宠物 statusMode='left' 无气泡 → 宽=6+176+6+96+6+148+6=444，高=16+max(150,104,280)+6=302", () => {
    expect(computePanelWindowSize(0.5, 0, 0)).toEqual({ w: 444, h: 302 })
  })

  it("1.0× 宠物 'left' → 宽=6+176+6+192+6+148+6=540，高受 fit.h 下限约束=304", () => {
    expect(computePanelWindowSize(1.0, 0, 0)).toEqual({ w: 540, h: 304 })
  })

  it("statusMode='off'（宠物左+动作右）→ 宽=6+96+6+148+6=262，高=16+max(104,280)+6=302", () => {
    expect(computePanelWindowSize(0.5, 0, 0, ACTIONS_PANEL_H, STATUS_PANEL_H, 'off')).toEqual({ w: 262, h: 302 })
  })

  it("statusMode='right'（宠物左+右侧状态卡与动作堆叠）→ 宽=6+(96+6+176)+6=290，高=16+max(104,150+280)+6=452", () => {
    expect(computePanelWindowSize(0.5, 0, 0, ACTIONS_PANEL_H, STATUS_PANEL_H, 'right')).toEqual({ w: 290, h: 452 })
  })

  it('气泡出现时对话区叠加（高度随内容增长）', () => {
    // 0.5× 'left' + 高 100px 气泡 → 对话区 116 → 116+280+6 = 402
    expect(computePanelWindowSize(0.5, 220, 100)).toEqual({ w: 444, h: 402 })
  })

  it('3.0× 大宠物 → 宽度钳位到 720，高度取 fit.h=720（needH=646 低于下限）', () => {
    const s = computePanelWindowSize(3.0, 0, 0)
    expect(s).toEqual({ w: WIN_MAX_W, h: 720 })
  })

  it('极端输入 → 钳位到 [最小, 最大]', () => {
    expect(computePanelWindowSize(0.1, 0, 0).w).toBeGreaterThanOrEqual(WIN_MIN_W)
    expect(computePanelWindowSize(10, 9999, 9999)).toEqual({ w: WIN_MAX_W, h: WIN_MAX_H })
  })
})

describe('computePanelPetPos（并排行内宠物位置：水平在状态栏右侧/窗口左侧，垂直行内居中）', () => {
  it("'left' 0.5× → 宠物在状态卡右侧 x=6+176+6=188，行内居中 y=16+round((280-104)/2)=104", () => {
    expect(computePanelPetPos(0.5, 0, 0)).toEqual({ x: 188, y: 104 })
  })

  it("'off' 0.5× → 宠物在窗口左侧 x=6，行内居中", () => {
    expect(computePanelPetPos(0.5, 0, 0, ACTIONS_PANEL_H, STATUS_PANEL_H, 'off')).toEqual({ x: 6, y: 104 })
  })

  it("'right' 0.5× → 宠物左侧 x=6，右侧堆叠行内居中 y=16+round((150+280-104)/2)=179", () => {
    expect(computePanelPetPos(0.5, 0, 0, ACTIONS_PANEL_H, STATUS_PANEL_H, 'right')).toEqual({ x: 6, y: 179 })
  })

  it('气泡出现时宠物随对话区下移', () => {
    expect(computePanelPetPos(0.5, 220, 100)).toEqual({ x: 188, y: 116 + 88 })
  })
})

describe('computeWalkBounds（行走目标区间：收起态按实际窗口宽 / 展开态列间缝隙）', () => {
  it('收起态 0.5× 在 160 宽窗口 → [8, 160-96-8=56]', () => {
    expect(computeWalkBounds(0.5, 160, false)).toEqual({ minX: 8, maxX: 56 })
  })

  it('收起态 1.0× 在 224 宽窗口 → [8, 224-192-8=24]（修复硬编码 300px 后不再只走左半区）', () => {
    expect(computeWalkBounds(1.0, 224, false)).toEqual({ minX: 8, maxX: 24 })
  })

  it('收起态 3.0× 在 608 宽窗口 → [8, 608-576-8=24]', () => {
    expect(computeWalkBounds(3.0, 608, false)).toEqual({ minX: 8, maxX: 24 })
  })

  it("展开态 'left' 0.5× 在 444 宽窗口 → 状态卡右侧缝隙 [188, 444-6-148-6-96=188]（0 宽 → 跳过行走）", () => {
    expect(computeWalkBounds(0.5, 444, true, 'left')).toEqual({ minX: 188, maxX: 188 })
  })

  it("展开态 'off' 0.5× 在 262 宽窗口 → [6, 262-6-148-6-96=6]（0 宽 → 跳过行走）", () => {
    expect(computeWalkBounds(0.5, 262, true, 'off')).toEqual({ minX: 6, maxX: 6 })
  })

  it("展开态 'right' 0.5× 在 290 宽窗口 → 右侧栏为 max(176,148) → [6, 290-6-176-6-96=6]", () => {
    expect(computeWalkBounds(0.5, 290, true, 'right')).toEqual({ minX: 6, maxX: 6 })
  })
})

describe('computePetPosInWindow（宠物位置：水平居中 + 底部 8px 边距）', () => {
  it('1.0× 宠物在基准窗口内 → 水平居中，底部留 8px', () => {
    expect(computePetPosInWindow({ w: 224, h: 304 }, 1.0)).toEqual({ x: 16, y: 88 })
  })

  it('0.5× 宠物在最小窗口内 → (32, 88)', () => {
    expect(computePetPosInWindow({ w: 160, h: 200 }, 0.5)).toEqual({ x: 32, y: 88 })
  })

  it('窗口小于精灵时坐标钳位到 0（不会出现负坐标）', () => {
    const pos = computePetPosInWindow({ w: 150, h: 150 }, 2.0)
    expect(pos.x).toBeGreaterThanOrEqual(0)
    expect(pos.y).toBeGreaterThanOrEqual(0)
  })
})


