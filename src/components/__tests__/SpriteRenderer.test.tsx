// SpriteRenderer 回归测试 — 图集分支的背景图必须是合法 CSS url()
// 根因（2026-09-13 内部浏览器全量切换检测）：51 只 shimeji 中 17 只素材文件名含空格，
// 旧实现 `url(${spriteAsset})` 无引号 → 声明被 CSSOM 丢弃 → 宠物完全不可见且零报错。
// 注：video→atlas 回退分支（同一 helper 的另一调用点）不在本文件覆盖，jsdom 无媒体实现，
// 无法可靠触发 playing/error 交换；该分支由 src/lib/__tests__/cssUrl.test.ts 的纯函数用例守护。
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { SpriteRenderer } from '../SpriteRenderer'

vi.mock('@/lib/data/characters', () => {
  const characters = {
    'hu-tao': {
      id: 'hu-tao',
      displayName: 'Hu Tao',
      spriteType: 'atlas',
      spriteAsset: '/pets/shimeji/Hu Tao.png',
      atlasLayout: { cellW: 128, cellH: 128, cols: 8, rows: 9 },
      animationRows: { idle: { row: 0, frames: 1 } },
    },
    'kazuha': {
      id: 'kazuha',
      displayName: 'Kazuha',
      spriteType: 'atlas',
      spriteAsset: '/pets/shimeji/Kazuha.png',
      atlasLayout: { cellW: 128, cellH: 128, cols: 8, rows: 9 },
      animationRows: { idle: { row: 0, frames: 1 } },
    },
  }
  return {
    getCharacter: (id: string) => characters[id as keyof typeof characters],
  }
})

function renderSprite(characterId: string): HTMLElement | null {
  const { container } = render(<SpriteRenderer characterId={characterId} state="idle" />)
  return container.querySelector('[data-testid="live2d-container"]') as HTMLElement | null
}

describe('SpriteRenderer 图集渲染', () => {
  afterEach(() => {
    cleanup()
  })

  it('素材路径含空格时 background-image 声明不被丢弃', () => {
    const el = renderSprite('hu-tao')
    expect(el).not.toBeNull()
    expect(el?.style.backgroundImage).toContain('url(')
    expect(el?.style.backgroundImage).toContain('/pets/shimeji/Hu%20Tao.png')
  })

  it('素材路径无空格时保持原始路径', () => {
    const el = renderSprite('kazuha')
    expect(el?.style.backgroundImage).toContain('/pets/shimeji/Kazuha.png')
  })

  it('角色不存在时渲染占位容器而非抛错', () => {
    const el = renderSprite('not-exist')
    expect(el).not.toBeNull()
    expect(el?.style.backgroundImage).toBe('none')
  })
})
