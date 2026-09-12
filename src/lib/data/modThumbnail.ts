/**
 * Mod 缩略图解析模块
 *
 * @fileoverview 为 Mod 管理列表卡片解析缩略图（preview.png / manifest.thumbnail）
 *
 * 主要模块：
 * - getModThumbnailCandidates(): 纯函数，列出候选缩略图绝对路径
 * - resolveModThumbnail(): 异步解析第一个真实存在的候选，返回 asset URL
 *
 * 解析顺序：
 * 1. 模组目录下的 preview.png → thumbnail.png → icon.png
 * 2. manifest.json 的 thumbnail / icon 字段（相对模组根目录）
 * 3. 都不存在 → null（UI 层展示占位图）
 *
 * 依赖关系：
 * - modManager.ts: ModInfo 类型
 * - @tauri-apps/api/core: convertFileSrc 转换为 asset:// URL
 * - @tauri-apps/api/path: join 路径拼接
 * - @tauri-apps/plugin-fs: exists 文件探测
 */

import { convertFileSrc } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import type { ModInfo } from './modManager'

/** 模组目录下按优先级探测的缩略图文件名 */
export const MOD_THUMBNAIL_FILES = ['preview.png', 'thumbnail.png', 'icon.png'] as const

/**
 * 列出模组可能的缩略图绝对路径（纯函数，不触达文件系统）
 *
 * @param mod 已安装模组信息
 * @returns 候选绝对路径数组（modPath 缺失时返回空数组）
 */
export function getModThumbnailCandidates(mod: ModInfo): string[] {
  if (!mod.modPath) return []
  const candidates: string[] = []
  for (const name of MOD_THUMBNAIL_FILES) {
    candidates.push(`${mod.modPath}/${name}`)
  }
  return candidates
}

/**
 * 读取 manifest.json 中的 thumbnail / icon 字段，返回相对模组根目录的路径
 */
async function readManifestThumbnail(modPath: string): Promise<string | null> {
  try {
    const manifestPath = `${modPath}/manifest.json`
    if (!(await exists(manifestPath))) return null
    const raw = await readTextFile(manifestPath)
    const manifest = JSON.parse(raw) as { thumbnail?: unknown; icon?: unknown }
    const field = typeof manifest.thumbnail === 'string'
      ? manifest.thumbnail
      : typeof manifest.icon === 'string'
        ? manifest.icon
        : null
    if (!field) return null
    // 仅接受模组内部相对路径，拒绝绝对路径/协议头以防越权引用
    if (/^([a-zA-Z]+:|\/|\\\\)/.test(field)) return null
    return await join(modPath, field)
  } catch {
    return null
  }
}

/**
 * 解析模组缩略图的可显示 URL
 *
 * 依次探测候选文件，第一个存在的即返回其 convertFileSrc 后的 URL；
 * 全部不存在时回退 manifest 字段；仍无则返回 null（UI 展示占位图）。
 *
 * @param mod 已安装模组信息
 * @returns 可直接用于 <img src> 的 URL；无缩略图时为 null
 */
export async function resolveModThumbnail(mod: ModInfo): Promise<string | null> {
  const candidates = getModThumbnailCandidates(mod)
  for (const candidate of candidates) {
    try {
      if (await exists(candidate)) {
        return convertFileSrc(candidate)
      }
    } catch {
      // 单个候选探测失败，继续尝试下一个
    }
  }

  // 回退：manifest.thumbnail / manifest.icon
  if (mod.modPath) {
    const manifestThumb = await readManifestThumbnail(mod.modPath)
    if (manifestThumb) {
      try {
        if (await exists(manifestThumb)) {
          return convertFileSrc(manifestThumb)
        }
      } catch {
        // 忽略探测错误
      }
    }
  }

  return null
}
