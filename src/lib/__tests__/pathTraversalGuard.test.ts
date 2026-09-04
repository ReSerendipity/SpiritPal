// pathTraversalGuard 单元测试 — 路径穿越检测与防护
import { describe, it, expect } from 'vitest'
import {
  normpath,
  detectPathTraversal,
  isPathWithinAllowedDirs,
  safeJoinPath,
  validatePath,
} from '@/lib/system/pathTraversalGuard'

describe('normpath（路径规范化）', () => {
  it('解析 . 与 .. 组件', () => {
    expect(normpath('/a/b/../c')).toBe('/a/c')
    expect(normpath('/a/./b')).toBe('/a/b')
    expect(normpath('a/b//c')).toBe('a/b/c')
  })

  it('统一 Windows 反斜杠分隔符', () => {
    expect(normpath('C:\\docs\\file.txt')).toBe('C:/docs/file.txt')
  })

  it('保留相对路径开头的 ..', () => {
    expect(normpath('../a/b')).toBe('../a/b')
  })

  it('空输入返回点', () => {
    expect(normpath('')).toBe('.')
  })
})

describe('detectPathTraversal（穿越检测）', () => {
  it('检测 ../ 父目录引用', () => {
    const result = detectPathTraversal('../../etc/passwd')
    expect(result.detected).toBe(true)
    expect(result.riskLevel).not.toBe('none')
  })

  it('检测 URL 编码穿越为 critical', () => {
    const result = detectPathTraversal('%2e%2e%2fsecret')
    expect(result.detected).toBe(true)
    expect(result.riskLevel).toBe('critical')
  })

  it('检测空字节注入为 critical', () => {
    const result = detectPathTraversal('file.png\0.exe')
    expect(result.detected).toBe(true)
    expect(result.riskLevel).toBe('critical')
  })

  it('正常路径无风险', () => {
    const result = detectPathTraversal('pets/doro/sprite.png')
    expect(result.detected).toBe(false)
    expect(result.riskLevel).toBe('none')
  })
})

describe('isPathWithinAllowedDirs（范围校验）', () => {
  const ALLOWED = ['C:/Data/pets']

  it('目录内路径应通过', () => {
    expect(isPathWithinAllowedDirs('C:/Data/pets/doro/sprite.png', ALLOWED)).toBe(true)
    expect(isPathWithinAllowedDirs('C:/Data/pets', ALLOWED)).toBe(true)
  })

  it('目录外路径应拒绝', () => {
    expect(isPathWithinAllowedDirs('C:/Data/other/x.png', ALLOWED)).toBe(false)
    expect(isPathWithinAllowedDirs('C:/Data/pets-secret/x.png', ALLOWED)).toBe(false)
  })
})

describe('safeJoinPath（安全拼接）', () => {
  it('安全拼接返回规范化路径', () => {
    expect(safeJoinPath('/data/pets', 'doro', 'sprite.png')).toBe('/data/pets/doro/sprite.png')
  })

  it('含 .. 的片段返回 null（拒绝穿越）', () => {
    expect(safeJoinPath('/data/pets', '../etc/passwd')).toBeNull()
  })
})

describe('validatePath（综合校验）', () => {
  it('严重风险（编码穿越）被拒绝', () => {
    const result = validatePath('%2e%2e/secret', ['/data/pets'])
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/安全风险/)
  })

  it('正常路径通过校验', () => {
    const result = validatePath('/data/pets/doro.png', ['/data/pets'])
    expect(result.valid).toBe(true)
  })
})