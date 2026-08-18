/**
 * modManager 纯函数补充测试
 *
 * 现有 modManager.test.ts 已覆盖 ModManager 类的安装/卸载/启用/签名校验等流程，
 * 本文件聚焦尚未覆盖的纯函数：SemVer 工具（parseSemVer / compareSemVer / satisfiesVersionConstraint）
 * 和 validatePetmodManifest（清单校验）。
 *
 * 这些函数无外部依赖，纯逻辑，可全量单测。
 */

import { describe, it, expect } from 'vitest'
import {
  parseSemVer,
  isValidSemVer,
  compareSemVer,
  satisfiesVersionConstraint,
  validatePetmodManifest,
  createModTemplate,
} from '@/lib/modManager'

// ============ 导出存在 ============

describe('modManager 纯函数导出', () => {
  it('导出 SemVer 工具函数', () => {
    expect(typeof parseSemVer).toBe('function')
    expect(typeof isValidSemVer).toBe('function')
    expect(typeof compareSemVer).toBe('function')
    expect(typeof satisfiesVersionConstraint).toBe('function')
    expect(typeof validatePetmodManifest).toBe('function')
    expect(typeof createModTemplate).toBe('function')
  })
})

// ============ parseSemVer ============

describe('parseSemVer', () => {
  it('解析标准版本号', () => {
    expect(parseSemVer('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: undefined })
  })

  it('解析带 prerelease 的版本号', () => {
    expect(parseSemVer('2.0.0-beta.1')).toEqual({ major: 2, minor: 0, patch: 0, prerelease: 'beta.1' })
  })

  it('解析 prerelease 为 alpha', () => {
    expect(parseSemVer('0.9.0-alpha')).toEqual({ major: 0, minor: 9, patch: 0, prerelease: 'alpha' })
  })

  it('非 SemVer 格式返回 null', () => {
    expect(parseSemVer('1.2')).toBeNull()
    expect(parseSemVer('v1.2.3')).toBeNull()
    expect(parseSemVer('abc')).toBeNull()
    expect(parseSemVer('')).toBeNull()
  })

  it('处理大版本号', () => {
    expect(parseSemVer('100.200.300')).toEqual({ major: 100, minor: 200, patch: 300, prerelease: undefined })
  })
})

// ============ isValidSemVer ============

describe('isValidSemVer', () => {
  it('合法版本号返回 true', () => {
    expect(isValidSemVer('1.0.0')).toBe(true)
    expect(isValidSemVer('0.0.1')).toBe(true)
  })

  it('非法版本号返回 false', () => {
    expect(isValidSemVer('1.0')).toBe(false)
    expect(isValidSemVer('v1.0.0')).toBe(false)
    expect(isValidSemVer('')).toBe(false)
  })
})

// ============ compareSemVer ============

describe('compareSemVer', () => {
  it('相同版本返回 0', () => {
    expect(compareSemVer('1.2.3', '1.2.3')).toBe(0)
  })

  it('major 不同时比较 major', () => {
    expect(compareSemVer('2.0.0', '1.9.9')).toBe(1)
    expect(compareSemVer('1.0.0', '2.0.0')).toBe(-1)
  })

  it('minor 不同时比较 minor', () => {
    expect(compareSemVer('1.3.0', '1.2.9')).toBe(1)
    expect(compareSemVer('1.2.0', '1.3.0')).toBe(-1)
  })

  it('patch 不同时比较 patch', () => {
    expect(compareSemVer('1.2.4', '1.2.3')).toBe(1)
    expect(compareSemVer('1.2.2', '1.2.3')).toBe(-1)
  })

  it('prerelease 低于正式版', () => {
    expect(compareSemVer('1.0.0-beta', '1.0.0')).toBe(-1)
    expect(compareSemVer('1.0.0', '1.0.0-beta')).toBe(1)
  })

  it('prerelease 按字典序比较', () => {
    expect(compareSemVer('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
    expect(compareSemVer('1.0.0-rc', '1.0.0-alpha')).toBe(1)
  })

  it('无效版本返回 0', () => {
    expect(compareSemVer('invalid', '1.0.0')).toBe(0)
    expect(compareSemVer('1.0.0', 'invalid')).toBe(0)
  })
})

// ============ satisfiesVersionConstraint ============

describe('satisfiesVersionConstraint', () => {
  // --- caret ^ ---
  it('^x.y.z：major 不匹配时拒绝', () => {
    expect(satisfiesVersionConstraint('1.2.3', '^2.0.0')).toBe(false)
    expect(satisfiesVersionConstraint('1.2.3', '^0.1.0')).toBe(false)
  })

  it('^x.y.z：minor 更高时满足', () => {
    expect(satisfiesVersionConstraint('1.3.0', '^1.2.0')).toBe(true)
  })

  it('^x.y.z：minor 相同、patch 更高或相等时满足', () => {
    expect(satisfiesVersionConstraint('1.2.3', '^1.2.3')).toBe(true)
    expect(satisfiesVersionConstraint('1.2.5', '^1.2.3')).toBe(true)
  })

  it('^x.y.z：minor 更低时拒绝', () => {
    expect(satisfiesVersionConstraint('1.1.9', '^1.2.0')).toBe(false)
  })

  it('^x.y.z：minor 相同、patch 更低时拒绝', () => {
    expect(satisfiesVersionConstraint('1.2.2', '^1.2.3')).toBe(false)
  })

  // --- >= ---
  it('>=x.y.z：等于时满足', () => {
    expect(satisfiesVersionConstraint('2.0.0', '>=2.0.0')).toBe(true)
  })

  it('>=x.y.z：更高时满足', () => {
    expect(satisfiesVersionConstraint('3.0.0', '>=2.0.0')).toBe(true)
  })

  it('>=x.y.z：更低时拒绝', () => {
    expect(satisfiesVersionConstraint('1.9.9', '>=2.0.0')).toBe(false)
  })

  // --- 精确匹配 ---
  it('精确版本号：匹配时返回 true', () => {
    expect(satisfiesVersionConstraint('1.2.3', '1.2.3')).toBe(true)
  })

  it('精确版本号：不匹配时返回 false', () => {
    expect(satisfiesVersionConstraint('1.2.4', '1.2.3')).toBe(false)
  })

  // --- 通配符 ---
  it('x.*（major 通配）：major 相同即满足', () => {
    expect(satisfiesVersionConstraint('1.9.9', '1.*')).toBe(true)
    expect(satisfiesVersionConstraint('2.0.0', '1.*')).toBe(false)
  })

  it('x.y.*（major+minor 通配）：major 和 minor 相同即满足', () => {
    expect(satisfiesVersionConstraint('1.2.9', '1.2.*')).toBe(true)
    expect(satisfiesVersionConstraint('1.3.0', '1.2.*')).toBe(false)
  })

  it('bare major（如 "1"）：major 相同即满足', () => {
    expect(satisfiesVersionConstraint('1.9.9', '1')).toBe(true)
    expect(satisfiesVersionConstraint('2.0.0', '1')).toBe(false)
  })

  // --- 边界 ---
  it('无效版本号返回 false', () => {
    expect(satisfiesVersionConstraint('invalid', '^1.0.0')).toBe(false)
  })

  it('不支持的约束格式返回 false', () => {
    expect(satisfiesVersionConstraint('1.0.0', 'not-a-constraint')).toBe(false)
    expect(satisfiesVersionConstraint('1.0.0', '')).toBe(false)
  })
})

// ============ validatePetmodManifest ============

describe('validatePetmodManifest', () => {
  it('非对象返回无效', () => {
    const r = validatePetmodManifest(null)
    expect(r.valid).toBe(false)
    expect(r.errors).toContain('清单不是有效对象')
  })

  it('有效清单通过校验', () => {
    const r = validatePetmodManifest({
      id: 'my-mod',
      name: 'My Mod',
      version: '1.0.0',
      author: 'tester',
      description: 'A test mod',
    })
    expect(r.valid).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('缺少 id 记录错误', () => {
    const r = validatePetmodManifest({ name: 'test', version: '1.0.0', author: 'tester' })
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.includes('id'))).toBe(true)
  })

  it('id 非 kebab-case 记录错误', () => {
    const r = validatePetmodManifest({ id: 'MyMod', name: 'test', version: '1.0.0', author: 'tester' })
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.includes('id'))).toBe(true)
  })

  it('valid kebab-case id 通过', () => {
    const r = validatePetmodManifest({
      id: 'my-mod-with-dashes',
      name: 'test',
      version: '1.0.0',
      author: 'tester',
    })
    expect(r.valid).toBe(true)
  })

  it('缺少 name/version/author 时记录错误', () => {
    const r = validatePetmodManifest({ id: 'test' })
    expect(r.errors.some((e) => e.includes('name'))).toBe(true)
    expect(r.errors.some((e) => e.includes('version'))).toBe(true)
    expect(r.errors.some((e) => e.includes('author'))).toBe(true)
  })

  it('缺少 description 时记录警告（非错误）', () => {
    const r = validatePetmodManifest({ id: 'test', name: 'test', version: '1.0.0', author: 'tester' })
    expect(r.valid).toBe(true)
    expect(r.warnings.some((w) => w.includes('description'))).toBe(true)
  })

  it('非 SemVer version 记录错误', () => {
    const r = validatePetmodManifest({ id: 'test', name: 'test', version: 'not-semver', author: 'tester' })
    expect(r.errors.some((e) => e.includes('version'))).toBe(true)
  })

  it('依赖缺少 id/version 记录错误', () => {
    const r = validatePetmodManifest({
      id: 'test',
      name: 'test',
      version: '1.0.0',
      author: 'tester',
      dependencies: [{ id: '', version: '1.0.0' }, { id: 'dep1' }],
    })
    expect(r.errors.some((e) => e.includes('dependencies'))).toBe(true)
  })

  it('权限缺少 name 记录错误', () => {
    const r = validatePetmodManifest({
      id: 'test',
      name: 'test',
      version: '1.0.0',
      author: 'tester',
      permissions: [{ name: '' }, {}],
    })
    expect(r.errors.some((e) => e.includes('permissions'))).toBe(true)
  })

  it('minSpiritPalVersion 非 SemVer 记录警告', () => {
    const r = validatePetmodManifest({
      id: 'test',
      name: 'test',
      version: '1.0.0',
      author: 'tester',
      minSpiritPalVersion: 'not-semver',
    })
    expect(r.valid).toBe(true)
    expect(r.warnings.some((w) => w.includes('minSpiritPalVersion'))).toBe(true)
  })
})

// ============ createModTemplate ============

describe('createModTemplate', () => {
  it('返回完整模板（petConf + actConf + itemsConf + dialogueConf）', () => {
    const template = createModTemplate()
    expect(template.petConf.id).toBe('custom-pet')
    expect(template.actConf).toBeDefined()
    expect(template.itemsConf).toBeDefined()
    expect(template.dialogueConf.systemPrompt).toBeTruthy()
  })
})