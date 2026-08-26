/**
 * characterImportService.ts 单元测试
 *
 * 测试统一角色导入服务的 JSON 字符串 / JSON 文件 / PNG 文件 / 目录导入路径。
 *
 * @module characterImportService.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { importCharacter, type ImportSource } from '../characterImportService'
import type { CharacterProfile } from '../types'

// Mock saveCustomCharacter to avoid localStorage side effects
vi.mock('../characters', () => ({
  saveCustomCharacter: vi.fn(),
}))

// Mock characterCardImporter
vi.mock('../characterCardImporter', () => ({
  extractCharCardFromPNG: vi.fn(),
  parseCharCardFromJSON: vi.fn(),
  importCharacterCard: vi.fn(),
}))

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { saveCustomCharacter } from '../characters'
import { parseCharCardFromJSON, importCharacterCard, extractCharCardFromPNG } from '../characterCardImporter'
import { invoke } from '@tauri-apps/api/core'

// ============ 测试数据 ============

function makeValidPackConfig(): Record<string, unknown> {
  return {
    id: 'test-cat',
    name: 'Test Cat',
    version: '1.0.0',
    author: 'TestAuthor',
    license: 'MIT',
    description: 'A test cat',
    spritePath: '/pets/test-cat/spritesheet.webp',
    spriteType: 'atlas',
  }
}

function makeValidResourcePackage(): Record<string, unknown> {
  return {
    meta: {
      id: 'test-dog',
      name: 'test-dog',
      displayName: 'Test Dog',
      version: '1.0.0',
      author: 'TestAuthor',
      license: 'MIT',
    },
    sprites: [
      {
        path: '/pets/test-dog/spritesheet.png',
        type: 'atlas',
        layout: { cellW: 192, cellH: 208, cols: 8, rows: 9, animations: {} },
      },
    ],
  }
}

function makeSillyTavernCard() {
  return {
    name: 'Test Character',
    description: 'A cheerful and friendly character',
    first_mes: 'Hello there!',
    personality: 'cheerful, warm, kind',
    system_prompt: 'You are a cheerful character.',
    tags: ['test'],
    creator: 'TestCreator',
    character_version: '1.0',
  }
}

// ============ 前后置 ============

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============ JSON 字符串导入 ============

describe('importCharacter: JSON 字符串导入', () => {
  it('should import valid pack-config JSON', async () => {
    const source: ImportSource = {
      kind: 'json-string',
      jsonStr: JSON.stringify(makeValidPackConfig()),
    }

    const result = await importCharacter(source)

    expect(result.ok).toBe(true)
    expect(result.profile).not.toBeUndefined()
    expect(result.profile!.id).toBe('test-cat')
    expect(result.profile!.name).toBe('Test Cat')
    expect(result.characterId).toBe('test-cat')
    expect(saveCustomCharacter).toHaveBeenCalledWith(result.profile)
  })

  it('should import valid resource-package JSON', async () => {
    const source: ImportSource = {
      kind: 'json-string',
      jsonStr: JSON.stringify(makeValidResourcePackage()),
    }

    const result = await importCharacter(source)

    expect(result.ok).toBe(true)
    expect(result.profile!.id).toBe('test-dog')
    expect(result.profile!.displayName).toBe('Test Dog')
    expect(saveCustomCharacter).toHaveBeenCalled()
  })

  it('should fall back to SillyTavern card when pack-config fails', async () => {
    const card = makeSillyTavernCard()
    vi.mocked(parseCharCardFromJSON).mockReturnValue(card)
    vi.mocked(importCharacterCard).mockResolvedValue({
      success: true,
      profile: {
        id: 'st-test-character-abc',
        name: 'Test Character',
        displayName: 'Test Character',
        personality: { warmth: 0.3, liveliness: 0.4, dependence: 0.1, directness: 0, rationality: 0 },
        systemPrompt: 'You are a cheerful character.',
      },
      warnings: ['性格参数由关键词匹配推断，精度有限'],
      errors: [],
    })

    const source: ImportSource = {
      kind: 'json-string',
      jsonStr: JSON.stringify(card),
    }

    const result = await importCharacter(source)

    expect(result.ok).toBe(true)
    expect(result.profile!.id).toBe('st-test-character-abc')
    expect(result.profile!.name).toBe('Test Character')
    expect(result.profile!.systemPrompt).toBe('You are a cheerful character.')
    expect(result.warnings).toContain('性格参数由关键词匹配推断，精度有限')
    expect(saveCustomCharacter).toHaveBeenCalled()
  })

  it('should fail for invalid JSON', async () => {
    vi.mocked(parseCharCardFromJSON).mockReturnValue(null)

    const source: ImportSource = {
      kind: 'json-string',
      jsonStr: '{invalid json}',
    }

    const result = await importCharacter(source)

    expect(result.ok).toBe(false)
    expect(result.profile).toBeUndefined()
    expect(result.errors.length).toBeGreaterThan(0)
    expect(saveCustomCharacter).not.toHaveBeenCalled()
  })

  it('should fail for unrecognized JSON format', async () => {
    vi.mocked(parseCharCardFromJSON).mockReturnValue(null)

    const source: ImportSource = {
      kind: 'json-string',
      jsonStr: JSON.stringify({ foo: 'bar', baz: 123 }),
    }

    const result = await importCharacter(source)

    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('无法识别'))).toBe(true)
  })
})

// ============ JSON File 导入 ============

describe('importCharacter: JSON 文件导入', () => {
  it('should import from a valid JSON File', async () => {
    const file = new File([JSON.stringify(makeValidPackConfig())], 'test-cat.json', { type: 'application/json' })

    const source: ImportSource = {
      kind: 'json-file',
      file,
    }

    const result = await importCharacter(source)

    expect(result.ok).toBe(true)
    expect(result.profile!.id).toBe('test-cat')
    expect(saveCustomCharacter).toHaveBeenCalled()
  })

  it('should fail for empty file', async () => {
    const file = new File([''], 'empty.json', { type: 'application/json' })

    const source: ImportSource = {
      kind: 'json-file',
      file,
    }

    const result = await importCharacter(source)

    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

// ============ PNG 文件导入 ============

describe('importCharacter: PNG 文件导入', () => {
  it('should import from PNG with embedded SillyTavern card', async () => {
    const card = makeSillyTavernCard()
    vi.mocked(extractCharCardFromPNG).mockReturnValue(card)
    vi.mocked(importCharacterCard).mockResolvedValue({
      success: true,
      profile: {
        id: 'st-test-character-xyz',
        name: 'Test Character',
        displayName: 'Test Character',
        personality: { warmth: 0.3, liveliness: 0.4, dependence: 0.1, directness: 0, rationality: 0 },
        systemPrompt: 'You are a cheerful character.',
      },
      warnings: [],
      errors: [],
    })

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'character.png', { type: 'image/png' })

    const source: ImportSource = {
      kind: 'png-file',
      file,
    }

    const result = await importCharacter(source)

    expect(result.ok).toBe(true)
    expect(result.profile!.id).toBe('st-test-character-xyz')
    expect(extractCharCardFromPNG).toHaveBeenCalled()
    expect(saveCustomCharacter).toHaveBeenCalled()
  })

  it('should fail when PNG has no embedded card', async () => {
    vi.mocked(extractCharCardFromPNG).mockReturnValue(null)

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'no-card.png', { type: 'image/png' })

    const source: ImportSource = {
      kind: 'png-file',
      file,
    }

    const result = await importCharacter(source)

    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('未找到'))).toBe(true)
  })
})

// ============ 目录导入 ============

describe('importCharacter: 目录导入', () => {
  it('should import from directory with pet.json', async () => {
    const petJson = JSON.stringify(makeValidPackConfig())
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_character_directory') {
        return ['/path/to/test-cat'] as unknown as void
      }
      if (cmd === 'read_text_file') {
        return petJson as unknown as void
      }
      return [] as unknown as void
    })

    const source: ImportSource = {
      kind: 'directory',
      dirPath: '/path/to/characters',
    }

    const result = await importCharacter(source)

    expect(result.ok).toBe(true)
    expect(result.profile!.id).toBe('test-cat')
    expect(saveCustomCharacter).toHaveBeenCalled()
  })

  it('should warn when multiple character packs found', async () => {
    const petJson = JSON.stringify(makeValidPackConfig())
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_character_directory') {
        return ['/path/to/cat1', '/path/to/cat2'] as unknown as void
      }
      if (cmd === 'read_text_file') {
        return petJson as unknown as void
      }
      return [] as unknown as void
    })

    const source: ImportSource = {
      kind: 'directory',
      dirPath: '/path/to/characters',
    }

    const result = await importCharacter(source)

    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.includes('2 个角色包'))).toBe(true)
  })

  it('should fail when no pet.json found in directory', async () => {
    vi.mocked(invoke).mockResolvedValue([])

    const source: ImportSource = {
      kind: 'directory',
      dirPath: '/empty/dir',
    }

    const result = await importCharacter(source)

    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('未找到'))).toBe(true)
  })

  it('should fail when Rust command throws', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('Permission denied'))

    const source: ImportSource = {
      kind: 'directory',
      dirPath: '/forbidden/dir',
    }

    const result = await importCharacter(source)

    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('目录导入失败'))).toBe(true)
  })
})

// ============ 边界 ============

describe('importCharacter: 边界', () => {
  it('should return error for unknown source kind', async () => {
    const source: ImportSource = {
      kind: 'unknown' as never,
    }

    const result = await importCharacter(source)

    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('未知'))).toBe(true)
  })
})
