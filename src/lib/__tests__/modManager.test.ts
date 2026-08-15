// modManager 模块测试 — 模组安装/卸载/启用/导入（mock Tauri API + db）
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db', () => ({
  saveMod: vi.fn(() => Promise.resolve()),
  getMods: vi.fn(() => Promise.resolve([])),
  deleteMod: vi.fn(() => Promise.resolve()),
  updateModEnabled: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(() => Promise.resolve(null)),
  ask: vi.fn(() => Promise.resolve(false)),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(() => Promise.resolve('{}')),
  exists: vi.fn(() => Promise.resolve(false)),
  writeTextFile: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(() => Promise.resolve('/mock/appdata')),
  join: vi.fn((...args: string[]) => Promise.resolve(args.join('/'))),
}))

import { ModManager, createModTemplate } from '../modManager'
import type { CharacterMod } from '../modManager'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, ask as askDialog } from '@tauri-apps/plugin-dialog'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'

function createTestMod(id: string = 'test-mod'): CharacterMod {
  return {
    petConf: {
      id,
      name: id,
      displayName: `测试${id}`,
      source: '测试',
      birthBackground: '测试背景',
      emotionalCore: '温柔',
      personality: { warmth: 0.5, liveliness: 0.5, dependence: 0.5, directness: 0, rationality: 0 },
      signaturePhrase: '测试签名',
      classicQuotes: ['引用1'],
      themeColor: { primary: '#FFB6C1', secondary: '#A777E3' },
      favoriteItems: ['食物'],
      dislikeItems: ['药'],
      spriteAsset: 'test.png',
      spriteType: 'atlas',
      activeHours: { start: 8, end: 22 },
    },
    dialogueConf: {
      systemPrompt: '你是测试宠物',
      fewShotExamples: [],
      bubbleMessages: {
        idle: ['你好'],
        hungry: ['饿了'],
        sad: ['伤心'],
        pet: ['舒服'],
        feed: ['谢谢'],
        pomodoroDone: ['完成了'],
      },
    },
  }
}

describe('modManager', () => {
  let mgr: ModManager

  beforeEach(async () => {
    vi.clearAllMocks()
    mgr = new ModManager()
    await mgr.ensureLoaded()
  })

  describe('installMod', () => {
    it('安装新模组', () => {
      const mod = createTestMod()
      const info = mgr.installMod(mod)
      expect(info.id).toBe('test-mod')
      expect(info.displayName).toBe('测试test-mod')
      expect(info.enabled).toBe(true)
      expect(info.isBuiltIn).toBe(false)
    })

    it('安装已存在的模组时更新', () => {
      const mod = createTestMod()
      mgr.installMod(mod)
      const mod2 = createTestMod('test-mod')
      mod2.petConf.displayName = '更新后的名称'
      const info = mgr.installMod(mod2, 'new-sha256')
      // installMod 更新时只更新 modData/sha256/modPath，不更新 displayName
      expect(info.displayName).toBe('测试test-mod')
      expect(info.sha256).toBe('new-sha256')
      // 验证 modData 已更新
      expect(info.modData.petConf.displayName).toBe('更新后的名称')
    })

    it('安装后出现在 getMods', () => {
      const mod = createTestMod()
      mgr.installMod(mod)
      const mods = mgr.getMods()
      expect(mods.some((m) => m.id === 'test-mod')).toBe(true)
    })
  })

  describe('installFromJSON', () => {
    it('从 JSON 字符串安装', () => {
      const mod = createTestMod()
      const info = mgr.installFromJSON(JSON.stringify(mod))
      expect(info).not.toBeNull()
      expect(info!.id).toBe('test-mod')
    })

    it('无效 JSON 返回 null', () => {
      const info = mgr.installFromJSON('invalid json')
      expect(info).toBeNull()
    })

    it('缺少 petConf 返回 null', () => {
      const info = mgr.installFromJSON(JSON.stringify({ dialogueConf: {} }))
      expect(info).toBeNull()
    })
  })

  describe('uninstallMod', () => {
    it('卸载模组', () => {
      const mod = createTestMod()
      mgr.installMod(mod)
      mgr.uninstallMod('test-mod')
      expect(mgr.getMods().some((m) => m.id === 'test-mod')).toBe(false)
    })

    it('卸载内置模组时保留', () => {
      const mod = createTestMod()
      const info = mgr.installMod(mod)
      info.isBuiltIn = true
      mgr.uninstallMod('test-mod')
      // 内置模组不可卸载
      expect(mgr.getMods().some((m) => m.id === 'test-mod')).toBe(true)
    })
  })

  describe('enableMod / disableMod', () => {
    it('disableMod 禁用模组', () => {
      const mod = createTestMod()
      mgr.installMod(mod)
      mgr.disableMod('test-mod')
      expect(mgr.getMod('test-mod')!.enabled).toBe(false)
    })

    it('enableMod 启用模组', () => {
      const mod = createTestMod()
      mgr.installMod(mod)
      mgr.disableMod('test-mod')
      mgr.enableMod('test-mod')
      expect(mgr.getMod('test-mod')!.enabled).toBe(true)
    })

    it('disableMod 不禁用内置模组', () => {
      const mod = createTestMod()
      const info = mgr.installMod(mod)
      info.isBuiltIn = true
      mgr.disableMod('test-mod')
      expect(mgr.getMod('test-mod')!.enabled).toBe(true)
    })

    it('getEnabledMods 只返回启用的模组', () => {
      mgr.installMod(createTestMod('mod1'))
      mgr.installMod(createTestMod('mod2'))
      mgr.disableMod('mod1')
      const enabled = mgr.getEnabledMods()
      expect(enabled.every((m) => m.enabled)).toBe(true)
      expect(enabled.some((m) => m.id === 'mod1')).toBe(false)
    })
  })

  describe('查询', () => {
    it('getMod 返回指定模组', () => {
      mgr.installMod(createTestMod('test-mod'))
      const mod = mgr.getMod('test-mod')
      expect(mod).toBeDefined()
      expect(mod!.id).toBe('test-mod')
    })

    it('getMod 不存在返回 undefined', () => {
      expect(mgr.getMod('nonexistent')).toBeUndefined()
    })

    it('getMods 返回副本（不修改原数组）', () => {
      mgr.installMod(createTestMod())
      const mods1 = mgr.getMods()
      mods1.push({} as never)
      const mods2 = mgr.getMods()
      expect(mods2.length).toBeLessThan(mods1.length)
    })
  })

  describe('toCharacterProfile', () => {
    it('将 ModInfo 转换为 CharacterProfile', () => {
      const mod = createTestMod()
      const info = mgr.installMod(mod)
      const profile = mgr.toCharacterProfile(info)
      expect(profile.id).toBe('test-mod')
      expect(profile.displayName).toBe('测试test-mod')
      expect(profile.systemPrompt).toBe('你是测试宠物')
      expect(profile.personality).toBeDefined()
      expect(profile.themeColor).toBeDefined()
    })
  })

  describe('exportMod', () => {
    it('导出模组为 JSON 字符串', () => {
      const mod = createTestMod()
      mgr.installMod(mod)
      const json = mgr.exportMod('test-mod')
      expect(json).not.toBeNull()
      const parsed = JSON.parse(json!)
      expect(parsed.petConf.id).toBe('test-mod')
    })

    it('导出不存在的模组返回 null', () => {
      expect(mgr.exportMod('nonexistent')).toBeNull()
    })
  })

  describe('scanLocalMods', () => {
    it('调用 invoke scan_mods_directory', async () => {
      vi.mocked(invoke).mockResolvedValue({ mods: [{ id: 'scanned1', name: 'scanned', path: '/path' }] })
      const result = await mgr.scanLocalMods('/test/dir')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('scanned1')
    })

    it('未传 dirPath 时使用默认目录', async () => {
      vi.mocked(invoke).mockResolvedValue({ mods: [] })
      await mgr.scanLocalMods()
      expect(invoke).toHaveBeenCalled()
    })

    it('出错时返回空数组', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('scan failed'))
      const result = await mgr.scanLocalMods()
      expect(result).toEqual([])
    })
  })

  describe('importPetmodFile', () => {
    it('未选择文件时返回失败', async () => {
      vi.mocked(openDialog).mockResolvedValue(null)
      const result = await mgr.importPetmodFile()
      expect(result.success).toBe(false)
      expect(result.error).toContain('未选择')
    })

    it('成功导入模组', async () => {
      vi.mocked(openDialog).mockResolvedValue('/path/to/test.petmod')
      vi.mocked(invoke).mockResolvedValue({ success: true, modId: 'imported-mod', sha256: 'abc123' })
      vi.mocked(exists).mockResolvedValue(false)
      // loadModFromDirectory 返回 null（因为 exists 返回 false）
      const result = await mgr.importPetmodFile()
      expect(result.success).toBe(true)
      expect(result.modId).toBe('imported-mod')
    })

    it('后端调用失败时返回错误', async () => {
      vi.mocked(openDialog).mockResolvedValue('/path/to/test.petmod')
      vi.mocked(invoke).mockRejectedValue(new Error('backend error'))
      const result = await mgr.importPetmodFile()
      expect(result.success).toBe(false)
      expect(result.error).toContain('后端调用失败')
    })

    it('文件选择失败时返回错误', async () => {
      vi.mocked(openDialog).mockRejectedValue(new Error('dialog error'))
      const result = await mgr.importPetmodFile()
      expect(result.success).toBe(false)
      expect(result.error).toContain('文件选择失败')
    })

    it('R7-A: 签名不匹配且用户拒绝时不安装', async () => {
      // 模拟：解压成功 + manifest 存在 + 签名不匹配 + 用户选"否"
      vi.mocked(openDialog).mockResolvedValue('/path/to/test.petmod')
      vi.mocked(invoke).mockResolvedValue({ success: true, modId: 'tampered-mod', sha256: 'actual-sha' })
      // exists 返回 true 让 manifest 校验路径生效；loadModFromDirectory 不会被调用
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ expectedSha256: 'different-sha' }))
      // 用户拒绝继续安装
      vi.mocked(askDialog).mockResolvedValue(false)

      const result = await mgr.importPetmodFile()

      // SECURITY 验证：用户拒绝时不安装，返回错误
      expect(result.success).toBe(false)
      expect(result.error).toContain('用户取消')
      expect(askDialog).toHaveBeenCalled()
    })

    it('R7-A: 签名不匹配且用户确认时继续安装并标注 warning', async () => {
      const mod = createTestMod('confirmed-mod')
      vi.mocked(openDialog).mockResolvedValue('/path/to/test.petmod')
      vi.mocked(invoke).mockResolvedValue({ success: true, modId: 'confirmed-mod', sha256: 'actual-sha' })
      // exists: manifest 校验 + loadModFromDirectory 内部都返回 true
      vi.mocked(exists).mockResolvedValue(true)
      // readTextFile: manifest + pet_conf.json + dialogue.json
      vi.mocked(readTextFile).mockImplementation((path: string | URL) => {
        const p = String(path)
        if (p.includes('manifest.json')) return Promise.resolve(JSON.stringify({ expectedSha256: 'different-sha' }))
        if (p.includes('pet_conf.json')) return Promise.resolve(JSON.stringify(mod.petConf))
        if (p.includes('dialogue.json')) return Promise.resolve(JSON.stringify(mod.dialogueConf))
        return Promise.resolve('{}')
      })
      // 用户确认继续安装
      vi.mocked(askDialog).mockResolvedValue(true)

      const result = await mgr.importPetmodFile()

      expect(result.success).toBe(true)
      expect(result.warning).toContain('用户已确认')
      expect(askDialog).toHaveBeenCalled()
    })

    it('R7-A: 签名匹配时不弹窗，直接安装', async () => {
      const mod = createTestMod('signed-mod')
      vi.mocked(openDialog).mockResolvedValue('/path/to/test.petmod')
      vi.mocked(invoke).mockResolvedValue({ success: true, modId: 'signed-mod', sha256: 'matching-sha' })
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockImplementation((path: string | URL) => {
        const p = String(path)
        if (p.includes('manifest.json')) return Promise.resolve(JSON.stringify({ expectedSha256: 'matching-sha' }))
        if (p.includes('pet_conf.json')) return Promise.resolve(JSON.stringify(mod.petConf))
        if (p.includes('dialogue.json')) return Promise.resolve(JSON.stringify(mod.dialogueConf))
        return Promise.resolve('{}')
      })

      const result = await mgr.importPetmodFile()

      expect(result.success).toBe(true)
      // 签名匹配时不应弹窗询问
      expect(askDialog).not.toHaveBeenCalled()
    })
  })

  describe('loadModFromDirectory', () => {
    it('pet_conf.json 不存在时返回 null', async () => {
      vi.mocked(exists).mockResolvedValue(false)
      const result = await mgr.loadModFromDirectory('/test/mod')
      expect(result).toBeNull()
    })

    it('成功加载模组配置', async () => {
      const mod = createTestMod()
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockImplementation((path: string | URL) => {
        const p = String(path)
        if (p.includes('pet_conf.json')) return Promise.resolve(JSON.stringify(mod.petConf))
        if (p.includes('dialogue.json')) return Promise.resolve(JSON.stringify(mod.dialogueConf))
        return Promise.resolve('{}')
      })
      const result = await mgr.loadModFromDirectory('/test/mod')
      expect(result).not.toBeNull()
      expect(result!.petConf.id).toBe('test-mod')
    })

    it('缺少 dialogue.json 时使用默认值', async () => {
      const mod = createTestMod()
      vi.mocked(exists).mockImplementation((path: string | URL) => {
        const p = String(path)
        if (p.includes('pet_conf.json')) return Promise.resolve(true)
        if (p.includes('dialogue.json')) return Promise.resolve(false)
        return Promise.resolve(false)
      })
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(mod.petConf))
      const result = await mgr.loadModFromDirectory('/test/mod')
      expect(result).not.toBeNull()
      expect(result!.dialogueConf.systemPrompt).toContain('测试')
    })

    it('读取失败时返回 null', async () => {
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockRejectedValue(new Error('read error'))
      const result = await mgr.loadModFromDirectory('/test/mod')
      expect(result).toBeNull()
    })

    it('R7-B: pet_conf.json 解析失败时返回 null（核心配置不可降级）', async () => {
      const mod = createTestMod()
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockImplementation((path: string | URL) => {
        const p = String(path)
        // pet_conf.json 返回非法 JSON
        if (p.includes('pet_conf.json')) return Promise.resolve('{ invalid json')
        if (p.includes('dialogue.json')) return Promise.resolve(JSON.stringify(mod.dialogueConf))
        return Promise.resolve('{}')
      })
      const result = await mgr.loadModFromDirectory('/test/mod')
      expect(result).toBeNull()
    })

    it('R7-B: act_conf.json 解析失败时不阻断加载（降级为 undefined）', async () => {
      const mod = createTestMod()
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockImplementation((path: string | URL) => {
        const p = String(path)
        if (p.includes('pet_conf.json')) return Promise.resolve(JSON.stringify(mod.petConf))
        if (p.includes('act_conf.json')) return Promise.resolve('{ invalid json') // 损坏
        if (p.includes('dialogue.json')) return Promise.resolve(JSON.stringify(mod.dialogueConf))
        return Promise.resolve('{}')
      })
      const result = await mgr.loadModFromDirectory('/test/mod')
      // ROBUSTNESS 验证：act_conf.json 损坏不阻断整个模组加载
      expect(result).not.toBeNull()
      expect(result!.petConf.id).toBe('test-mod')
      expect(result!.actConf).toBeUndefined()
      // dialogue.json 仍正常加载
      expect(result!.dialogueConf).toBeDefined()
    })

    it('R7-B: items_config.json 解析失败时不阻断加载', async () => {
      const mod = createTestMod()
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockImplementation((path: string | URL) => {
        const p = String(path)
        if (p.includes('pet_conf.json')) return Promise.resolve(JSON.stringify(mod.petConf))
        if (p.includes('items_config.json')) return Promise.resolve('{ invalid json') // 损坏
        if (p.includes('dialogue.json')) return Promise.resolve(JSON.stringify(mod.dialogueConf))
        return Promise.resolve('{}')
      })
      const result = await mgr.loadModFromDirectory('/test/mod')
      expect(result).not.toBeNull()
      expect(result!.itemsConf).toBeUndefined()
      expect(result!.petConf.id).toBe('test-mod')
    })

    it('R7-B: dialogue.json 解析失败时降级到默认对话配置', async () => {
      const mod = createTestMod()
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockImplementation((path: string | URL) => {
        const p = String(path)
        if (p.includes('pet_conf.json')) return Promise.resolve(JSON.stringify(mod.petConf))
        if (p.includes('dialogue.json')) return Promise.resolve('{ invalid json') // 损坏
        return Promise.resolve('{}')
      })
      const result = await mgr.loadModFromDirectory('/test/mod')
      // ROBUSTNESS 验证：dialogue.json 损坏时降级到默认配置，模组仍可用
      expect(result).not.toBeNull()
      expect(result!.dialogueConf).toBeDefined()
      expect(result!.dialogueConf.systemPrompt).toContain('测试test-mod')
      expect(result!.dialogueConf.bubbleMessages.idle).toEqual([])
    })

    it('R7-B: 仅 pet_conf.json 完整时其他全部降级', async () => {
      const mod = createTestMod()
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockImplementation((path: string | URL) => {
        const p = String(path)
        if (p.includes('pet_conf.json')) return Promise.resolve(JSON.stringify(mod.petConf))
        // 其他文件全部损坏
        return Promise.resolve('{ invalid json')
      })
      const result = await mgr.loadModFromDirectory('/test/mod')
      expect(result).not.toBeNull()
      expect(result!.petConf.id).toBe('test-mod')
      expect(result!.actConf).toBeUndefined()
      expect(result!.itemsConf).toBeUndefined()
      expect(result!.dialogueConf).toBeDefined() // 降级默认
    })
  })

  describe('computeSha256', () => {
    it('调用 invoke compute_sha256', async () => {
      vi.mocked(invoke).mockResolvedValue('hashed-value')
      const result = await mgr.computeSha256('/path/to/file')
      expect(result).toBe('hashed-value')
    })

    it('出错时返回 null', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('hash failed'))
      const result = await mgr.computeSha256('/path/to/file')
      expect(result).toBeNull()
    })
  })

  describe('verifyModSignature', () => {
    it('模组无路径信息时跳过校验', async () => {
      const mod = createTestMod()
      const info = mgr.installMod(mod)
      // 不传 modPath
      const result = await mgr.verifyModSignature(info.id)
      expect(result.valid).toBe(true)
    })

    it('模组不存在时返回有效（跳过）', async () => {
      const result = await mgr.verifyModSignature('nonexistent')
      expect(result.valid).toBe(true)
    })

    it('无 manifest 时跳过签名校验', async () => {
      const mod = createTestMod()
      const info = mgr.installMod(mod, 'sha256-value', '/mod/path')
      vi.mocked(exists).mockResolvedValue(false)
      const result = await mgr.verifyModSignature(info.id)
      expect(result.valid).toBe(true)
    })

    it('签名匹配时校验通过', async () => {
      const mod = createTestMod()
      const info = mgr.installMod(mod, 'correct-sha256', '/mod/path')
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ expectedSha256: 'correct-sha256' }))
      const result = await mgr.verifyModSignature(info.id)
      expect(result.valid).toBe(true)
    })

    it('签名不匹配时校验失败', async () => {
      const mod = createTestMod()
      const info = mgr.installMod(mod, 'actual-sha256', '/mod/path')
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ expectedSha256: 'different-sha256' }))
      const result = await mgr.verifyModSignature(info.id)
      expect(result.valid).toBe(false)
    })

    it('模组无 SHA-256 时校验失败', async () => {
      const mod = createTestMod()
      const info = mgr.installMod(mod, undefined, '/mod/path')
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ expectedSha256: 'some-sha256' }))
      const result = await mgr.verifyModSignature(info.id)
      expect(result.valid).toBe(false)
    })
  })

  describe('onChange', () => {
    it('安装模组时通知监听器', () => {
      const listener = vi.fn()
      mgr.onChange(listener)
      mgr.installMod(createTestMod())
      expect(listener).toHaveBeenCalled()
    })

    it('取消订阅后不再通知', () => {
      const listener = vi.fn()
      const unsub = mgr.onChange(listener)
      unsub()
      mgr.installMod(createTestMod())
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('createModTemplate', () => {
    it('返回完整的模组模板', () => {
      const template = createModTemplate()
      expect(template.petConf).toBeDefined()
      expect(template.dialogueConf).toBeDefined()
      expect(template.actConf).toBeDefined()
      expect(template.petConf.id).toBe('custom-pet')
    })
  })
})
