/**
 * 社区形象系统 — REST API 设计与前端封装
 * PRD §社区形象系统 — 浏览/下载/上传/评分/评论
 *
 * @fileoverview
 * 主要模块：
 * - CommunityCharacter 接口：社区角色信息
 * - CharacterComment 接口：评论信息
 * - CommunityApiClient 类：API 客户端，支持列表获取、详情、下载、上传、评分、评论
 * - GitHubReleasesBackend 类：GitHub Releases 后端（零服务器成本模组分发）
 * - MockCommunityBackend 类：Mock 后端（后端不可达时回退）
 *
 * 后端 API 设计（REST）：
 *   GET    /api/characters?page=1&sort=hot|latest|rating&q=keyword  获取社区形象列表
 *   GET    /api/characters/:id                                       获取形象详情
 *   GET    /api/characters/:id/download                              下载 .petmod 文件
 *   POST   /api/characters/upload                                    上传形象
 *   POST   /api/characters/:id/rate                                  评分（1-5）
 *   GET    /api/characters/:id/comments                              获取评论列表
 *   POST   /api/characters/:id/comments                              添加评论
 *
 * v0.3.2: 新增 GitHub Releases 后端 — 零服务器成本的模组分发方案
 *
 * @module communityApi
 * @requires ./modManager - CharacterMod 类型定义
 * @requires ./types - AnimationRow, OPENPETS_REACTION_MAP, ANIMATION_ROWS 类型常量
 */

import type { CharacterMod } from './modManager'
import { OPENPETS_REACTION_MAP, ANIMATION_ROWS, type AnimationRow } from './types'
// SECURITY R-09: SSRF 防护 — 社区 API 请求使用 safeFetch
import { safeFetch } from './ssrfProtection'

// ============ 配置 ============

/**
 * 社区后端 API 基址。
 * - 开发环境使用占位 URL，请求会失败并回退到 mock 数据
 * - 实际部署时通过设置 `window.__COMMUNITY_API_BASE_URL__` 或修改默认值替换
 */
const DEFAULT_API_BASE_URL = 'https://community.spiritpal.example.com'

// OPTIMIZE: [A3/C3] 集中网络层常量，便于统一调参与避免魔法数字
// 超时分级：JSON 请求快速失败，二进制下载允许较长等待，上传容忍最长等待
/** JSON API 请求默认超时（毫秒）— 普通列表/详情/评论/评分接口 */
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
/** 二进制下载默认超时（毫秒）— .petmod 文件下载，允许较长等待 */
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000
/** 上传默认超时（毫秒）— multipart 上传，容忍大文件慢网络 */
const DEFAULT_UPLOAD_TIMEOUT_MS = 120_000
/** 上传文件最大尺寸（50 MB）— 防止超大文件耗尽后端存储与带宽 */
// SECURITY: [D4] 入口校验文件大小，避免后端被超大 multipart 请求拖垮
const MAX_UPLOAD_FILE_SIZE = 50 * 1024 * 1024

// OPTIMIZE: [A3] 业务约束常量化，避免分散硬编码
const DEFAULT_PAGE_SIZE = 12
const MIN_RATING = 1
const MAX_RATING = 5

function getApiBaseUrl(): string {
  try {
    const w = window as Window & { __COMMUNITY_API_BASE_URL__?: string }
    if (w.__COMMUNITY_API_BASE_URL__) return w.__COMMUNITY_API_BASE_URL__.replace(/\/$/, '')
  } catch {
    // ignore
  }
  return DEFAULT_API_BASE_URL
}

/**
 * 创建带超时的 AbortSignal
 * ROBUSTNESS: [E3] 所有网络请求必须有超时控制，避免悬挂连接耗尽资源
 *
 * @param timeoutMs 超时毫秒数
 * @param externalSignal 可选的外部 signal（已 abort 时立即传播）
 * @returns 合并后的 AbortSignal
 */
function createTimeoutSignal(timeoutMs: number, externalSignal?: AbortSignal | null): AbortSignal {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`请求超时 (${timeoutMs}ms)`)), timeoutMs)
  // 外部 signal 已 abort 时立即传播并清理定时器
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer)
      controller.abort(externalSignal.reason)
    } else {
      externalSignal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          controller.abort(externalSignal.reason)
        },
        { once: true },
      )
    }
  }
  // 注意：timer 在 abort 后不会被自动清理，但 controller.signal 已 settled，
  // 后续无副作用；如需精细化清理可在 fetch.finally 中 clearTimeout（此处保持简洁）
  return controller.signal
}

// ============ 类型定义 ============

export type CharacterSort = 'hot' | 'latest' | 'rating'

export interface CommunityCharacterSummary {
  id: string
  name: string
  displayName: string
  author: string
  description: string
  previewImage: string
  rating: number
  ratingCount: number
  downloadCount: number
  uploadAt: number
  tags: string[]
  version: string
}

export interface CommunityCharacterDetail extends CommunityCharacterSummary {
  themeColor: { primary: string; secondary: string }
  fileSize: number
  modData: CharacterMod
}

export interface CommunityComment {
  id: string
  characterId: string
  userName: string
  content: string
  createdAt: number
}

export interface PaginatedList<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

export interface UploadModData {
  file: File
  displayName: string
  description: string
  author: string
  tags: string[]
}

export interface RateResult {
  characterId: string
  rating: number
  ratingCount: number
}

// ============ Mock 数据 ============

const MOCK_CHARACTERS: CommunityCharacterDetail[] = [
  {
    id: 'mock-1',
    name: 'miku',
    displayName: '初音未来 · 社区版',
    author: '社区作者·NekoDev',
    description: '基于经典初音形象重制的社区形象，包含 12 帧精灵图、6 种动作、独立对话气泡与专属物品。',
    previewImage: '',
    rating: 4.8,
    ratingCount: 128,
    downloadCount: 1024,
    uploadAt: Date.now() - 86400000 * 3,
    tags: ['二次元', ' Vocaloid', '初音'],
    themeColor: { primary: '#39c5bb', secondary: '#66e1d8' },
    version: '1.2.0',
    fileSize: 2_400_000,
    modData: {
      petConf: {
        id: 'miku-community',
        name: 'miku',
        displayName: '初音未来 · 社区版',
        source: 'community',
        birthBackground: '数字世界的歌声精灵',
        emotionalCore: '活力',
        personality: { warmth: 0.8, liveliness: 0.9, dependence: 0.5, directness: 0.6, rationality: 0.4 },
        signaturePhrase: '一起来唱歌吧！',
        classicQuotes: ['音乐连接每个心灵'],
        themeColor: { primary: '#39c5bb', secondary: '#66e1d8' },
        favoriteItems: ['柠檬'],
        dislikeItems: ['加班'],
        spriteAsset: 'miku.png',
        spriteType: 'atlas',
        activeHours: { start: 8, end: 23 },
      },
      dialogueConf: {
        systemPrompt: '你是初音未来，温柔活力，热爱唱歌。',
        fewShotExamples: [],
        bubbleMessages: {
          idle: ['想听我唱歌吗？'],
          hungry: ['肚子饿了，给我一个柠檬吧～'],
          sad: ['今天没有歌声…'],
          pet: ['嘿嘿，痒痒的～'],
          feed: ['谢谢你～'],
          pomodoroDone: ['专注时间结束啦！'],
        },
      },
    },
  },
  {
    id: 'mock-2',
    name: 'shiba',
    displayName: '柴犬小宝',
    author: 'PetLover',
    description: '一只可爱的柴犬桌宠，含 8 帧精灵图，会摇尾巴、要食物、配合番茄钟陪伴工作。',
    previewImage: '',
    rating: 4.6,
    ratingCount: 89,
    downloadCount: 642,
    uploadAt: Date.now() - 86400000 * 7,
    tags: ['萌宠', '柴犬'],
    themeColor: { primary: '#d97706', secondary: '#fbbf24' },
    version: '1.0.3',
    fileSize: 1_800_000,
    modData: {
      petConf: {
        id: 'shiba-community',
        name: 'shiba',
        displayName: '柴犬小宝',
        source: 'community',
        birthBackground: '阳光下的活泼柴犬',
        emotionalCore: '忠诚',
        personality: { warmth: 0.9, liveliness: 0.85, dependence: 0.7, directness: 0.5, rationality: 0.3 },
        signaturePhrase: '汪汪！',
        classicQuotes: ['陪伴是最长情的告白'],
        themeColor: { primary: '#d97706', secondary: '#fbbf24' },
        favoriteItems: ['骨头'],
        dislikeItems: ['洗澡'],
        spriteAsset: 'shiba.png',
        spriteType: 'atlas',
        activeHours: { start: 6, end: 22 },
      },
      dialogueConf: {
        systemPrompt: '你是柴犬小宝，活泼忠诚。',
        fewShotExamples: [],
        bubbleMessages: {
          idle: ['汪汪～', '陪我玩嘛'],
          hungry: ['汪！好饿…'],
          sad: ['呜呜…'],
          pet: ['嘿嘿～舒服'],
          feed: ['谢谢主人！'],
          pomodoroDone: ['休息一下吧！'],
        },
      },
    },
  },
  {
    id: 'mock-3',
    name: 'robot-cat',
    displayName: '机械猫 MK-II',
    author: 'CyberLab',
    description: '赛博朋克风机械猫桌宠，发光眼罩 + 全息尾巴，适合极客工作流场景。',
    previewImage: '',
    rating: 4.9,
    ratingCount: 256,
    downloadCount: 2048,
    uploadAt: Date.now() - 3600000 * 12,
    tags: ['赛博', '机械', '极客'],
    themeColor: { primary: '#06b6d4', secondary: '#3b82f6' },
    version: '2.0.1',
    fileSize: 3_200_000,
    modData: {
      petConf: {
        id: 'robot-cat-community',
        name: 'robot-cat',
        displayName: '机械猫 MK-II',
        source: 'community',
        birthBackground: '赛博实验室诞生',
        emotionalCore: '理性',
        personality: { warmth: 0.3, liveliness: 0.4, dependence: 0.2, directness: 0.9, rationality: 0.95 },
        signaturePhrase: '系统就绪',
        classicQuotes: ['数据即一切'],
        themeColor: { primary: '#06b6d4', secondary: '#3b82f6' },
        favoriteItems: ['电池'],
        dislikeItems: ['断电'],
        spriteAsset: 'robot-cat.png',
        spriteType: 'atlas',
        activeHours: { start: 0, end: 24 },
      },
      dialogueConf: {
        systemPrompt: '你是机械猫，理性高效。',
        fewShotExamples: [],
        bubbleMessages: {
          idle: ['系统就绪', '扫描中…'],
          hungry: ['电量不足'],
          sad: ['系统错误'],
          pet: ['交互已记录'],
          feed: ['能量已补充'],
          pomodoroDone: ['任务完成'],
        },
      },
    },
  },
]

const MOCK_COMMENTS: Record<string, CommunityComment[]> = {
  'mock-1': [
    { id: 'c1', characterId: 'mock-1', userName: 'User_Alice', content: '形象超可爱，动作流畅！', createdAt: Date.now() - 3600000 * 5 },
    { id: 'c2', characterId: 'mock-1', userName: 'User_Bob', content: '下载安装顺利，谢谢分享', createdAt: Date.now() - 3600000 * 24 },
  ],
  'mock-2': [
    { id: 'c3', characterId: 'mock-2', userName: 'User_CatLover', content: '柴犬超萌，喜欢摇尾巴动作', createdAt: Date.now() - 3600000 * 48 },
  ],
  'mock-3': [
    { id: 'c4', characterId: 'mock-3', userName: 'User_Hacker', content: '赛博风超酷，给 5 星', createdAt: Date.now() - 3600000 * 2 },
    { id: 'c5', characterId: 'mock-3', userName: 'User_Nerd', content: '配合代码工作场景氛围拉满', createdAt: Date.now() - 3600000 * 8 },
  ],
}

// ============ Mock 工具函数 ============

function mockList(page: number, pageSize: number, sort: CharacterSort, query?: string): PaginatedList<CommunityCharacterSummary> {
  let items = MOCK_CHARACTERS.map((c) => ({ ...c, modData: undefined }) as unknown as CommunityCharacterSummary)
  if (query) {
    const q = query.toLowerCase()
    items = items.filter(
      (c) => c.displayName.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }
  switch (sort) {
    case 'latest':
      items.sort((a, b) => b.uploadAt - a.uploadAt)
      break
    case 'rating':
      items.sort((a, b) => b.rating - a.rating)
      break
    case 'hot':
    default:
      items.sort((a, b) => b.downloadCount - a.downloadCount)
      break
  }
  const total = items.length
  const start = (page - 1) * pageSize
  const sliced = items.slice(start, start + pageSize)
  return {
    items: sliced,
    page,
    pageSize,
    total,
    hasMore: start + pageSize < total,
  }
}

function mockDetail(id: string): CommunityCharacterDetail | null {
  return MOCK_CHARACTERS.find((c) => c.id === id) ?? null
}

function mockComments(id: string): CommunityComment[] {
  return MOCK_COMMENTS[id] ?? []
}

function mockAddComment(id: string, content: string): CommunityComment {
  const c: CommunityComment = {
    id: `local-${Date.now()}`,
    characterId: id,
    userName: '我',
    content,
    createdAt: Date.now(),
  }
  if (!MOCK_COMMENTS[id]) MOCK_COMMENTS[id] = []
  MOCK_COMMENTS[id].unshift(c)
  return c
}

function mockRate(id: string, rating: number): RateResult {
  const c = MOCK_CHARACTERS.find((x) => x.id === id)
  if (!c) return { characterId: id, rating, ratingCount: 0 }
  // 模拟平均评分更新
  const totalScore = c.rating * c.ratingCount + rating
  c.ratingCount += 1
  c.rating = Math.round((totalScore / c.ratingCount) * 10) / 10
  return { characterId: id, rating: c.rating, ratingCount: c.ratingCount }
}

// ============ 网络请求工具 ============

class ApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`
  // ROBUSTNESS: [E3] 加 AbortController 超时控制，避免占位域名 DNS 解析悬挂
  const timeoutMs = init?.signal ? 0 : DEFAULT_REQUEST_TIMEOUT_MS // 外部已管理 signal 时不覆盖
  const signal = timeoutMs > 0 ? createTimeoutSignal(timeoutMs, init?.signal) : init?.signal
  // SECURITY R-09: 使用 safeFetch 进行 SSRF 防护
  const res = await safeFetch(url, {
    ...init,
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  }, undefined, 'community')
  if (!res.ok) {
    throw new ApiError(`API ${path} 失败: ${res.status} ${res.statusText}`, res.status)
  }
  return (await res.json()) as T
}

/** 判断是否应回退到 mock 数据（网络失败 / 占位 URL） */
function shouldFallbackToMock(err: unknown): boolean {
  if (err instanceof ApiError) return false
  // TypeError 通常是网络不可达 / CORS / 占位域名无法解析
  return err instanceof TypeError || (err instanceof Error && /fetch|network/i.test(err.message))
}

// ============ 前端 API 封装 ============

/**
 * 获取社区形象列表（分页 + 排序 + 搜索）
 * @param page 页码（从 1 开始）
 * @param sort 排序：hot（热门，默认）/ latest（最新）/ rating（评分）
 */
export async function fetchCommunityCharacters(
  page = 1,
  sort: CharacterSort = 'hot',
  query?: string,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<PaginatedList<CommunityCharacterSummary>> {
  // 1. 优先尝试 GitHub Releases 后端（零服务器成本）
  if (isGitHubBackend()) {
    try {
      return await fetchGitHubCharacters(page, sort, query, pageSize)
    } catch { /* GitHub 不可用时降级 */ }
  }
  // 2. 尝试 REST API
  try {
    const params = new URLSearchParams({
      page: String(page),
      sort,
      pageSize: String(pageSize),
    })
    if (query) params.set('q', query)
    return await request<PaginatedList<CommunityCharacterSummary>>(`/api/characters?${params.toString()}`)
  } catch (e) {
    // 3. 降级到 Mock 数据
    if (shouldFallbackToMock(e)) return mockList(page, pageSize, sort, query)
    throw e
  }
}

/**
 * 获取形象详情
 */
export async function fetchCharacterDetail(id: string): Promise<CommunityCharacterDetail> {
  // 1. GitHub
  if (isGitHubBackend() && id.startsWith('gh-')) {
    try { return await fetchGitHubDetail(id) } catch { /* fallback */ }
  }
  // 2. REST API
  try {
    return await request<CommunityCharacterDetail>(`/api/characters/${id}`)
  } catch (e) {
    if (shouldFallbackToMock(e)) {
      const detail = mockDetail(id)
      if (!detail) throw new ApiError(`形象 ${id} 不存在`, 404)
      return detail
    }
    throw e
  }
}

/**
 * 下载形象 .petmod 文件
 * @returns Blob（可直接保存或交给 importPetmodFile 安装）
 */
export async function downloadCharacter(id: string): Promise<Blob> {
  // 1. GitHub
  if (isGitHubBackend() && id.startsWith('gh-')) {
    try { return await downloadGitHubCharacter(id) } catch { /* fallback */ }
  }
  // 2. REST API
  try {
    const url = `${getApiBaseUrl()}/api/characters/${id}/download`
    const signal = createTimeoutSignal(DEFAULT_DOWNLOAD_TIMEOUT_MS)
    // SECURITY R-09: 使用 safeFetch 进行 SSRF 防护
    const res = await safeFetch(url, { signal }, undefined, 'community')
    if (!res.ok) throw new ApiError(`下载失败: ${res.status}`, res.status)
    return await res.blob()
  } catch (e) {
    if (shouldFallbackToMock(e)) {
      const detail = mockDetail(id)
      const content = JSON.stringify({ kind: 'petmod', id, modData: detail?.modData ?? null }, null, 2)
      return new Blob([content], { type: 'application/octet-stream' })
    }
    throw e
  }
}

/**
 * 上传形象到社区
 * @param modData 包含本地 .petmod 文件、描述、作者、标签
 * @returns 新创建的形象 ID
 */
export async function uploadCharacter(modData: UploadModData): Promise<{ id: string }> {
  // SECURITY: [D4] 入口校验文件大小，避免超大文件耗尽后端存储与带宽
  // Fail Fast：在发起网络请求前暴露配置/输入错误
  if (modData.file.size > MAX_UPLOAD_FILE_SIZE) {
    const sizeMB = (modData.file.size / (1024 * 1024)).toFixed(1)
    const limitMB = (MAX_UPLOAD_FILE_SIZE / (1024 * 1024)).toFixed(0)
    throw new ApiError(`文件过大: ${sizeMB}MB 超过上限 ${limitMB}MB`, 413)
  }
  try {
    const form = new FormData()
    form.append('file', modData.file)
    form.append('displayName', modData.displayName)
    form.append('description', modData.description)
    form.append('author', modData.author)
    form.append('tags', JSON.stringify(modData.tags))
    const url = `${getApiBaseUrl()}/api/characters/upload`
    // ROBUSTNESS: [E3] 上传加超时控制，容忍大文件慢网络但有上限
    const signal = createTimeoutSignal(DEFAULT_UPLOAD_TIMEOUT_MS)
    // SECURITY R-09: 使用 safeFetch 进行 SSRF 防护
    const res = await safeFetch(url, { method: 'POST', body: form, signal }, undefined, 'community')
    if (!res.ok) throw new ApiError(`上传失败: ${res.status}`, res.status)
    return (await res.json()) as { id: string }
  } catch (e) {
    if (shouldFallbackToMock(e)) {
      // Mock：返回一个本地生成的 ID，模拟上传成功
      return { id: `local-${Date.now()}` }
    }
    throw e
  }
}

/**
 * 对形象评分（1-5 星）
 */
export async function rateCharacter(id: string, rating: number): Promise<RateResult> {
  const clamped = Math.max(MIN_RATING, Math.min(MAX_RATING, Math.round(rating)))
  // 1. GitHub
  if (isGitHubBackend() && id.startsWith('gh-')) {
    try { return await rateGitHubCharacter(id, clamped) } catch { /* fallback */ }
  }
  // 2. REST API
  try {
    return await request<RateResult>(`/api/characters/${id}/rate`, {
      method: 'POST',
      body: JSON.stringify({ rating: clamped }),
    })
  } catch (e) {
    if (shouldFallbackToMock(e)) return mockRate(id, clamped)
    throw e
  }
}

/**
 * 获取形象评论列表
 */
export async function fetchComments(id: string): Promise<CommunityComment[]> {
  // 1. GitHub
  if (isGitHubBackend() && id.startsWith('gh-')) {
    try { return await fetchGitHubComments(id) } catch { /* fallback */ }
  }
  // 2. REST API
  try {
    return await request<CommunityComment[]>(`/api/characters/${id}/comments`)
  } catch (e) {
    if (shouldFallbackToMock(e)) return mockComments(id)
    throw e
  }
}

/**
 * 添加评论
 */
export async function addComment(id: string, content: string): Promise<CommunityComment> {
  // 1. GitHub
  if (isGitHubBackend() && id.startsWith('gh-')) {
    try { return await addGitHubComment(id, content) } catch { /* fallback */ }
  }
  // 2. REST API
  try {
    return await request<CommunityComment>(`/api/characters/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
  } catch (e) {
    if (shouldFallbackToMock(e)) return mockAddComment(id, content)
    throw e
  }
}

// ============ Phase 1.5: OpenPets 宠物包格式识别与转换 ============
//
// OpenPets 宠物包使用 pet.json 元数据格式，与 SpiritPal 的 pet_conf.json 格式不同。
// 两者 spritesheet 格式像素级兼容（8×9, 192×208, 1536×1872）。
// 此模块识别 OpenPets 格式并转换为 SpiritPal CharacterProfile。

/** OpenPets pet.json 的 reactions 字段类型 */
interface OpenPetsReaction {
  row: number
  frames: number
  fps?: number
  loop?: boolean
}

/**
 * 检测宠物包是否为 OpenPets 格式
 * OpenPets 包含 pet.json 文件，且有 format 或 reactions 字段
 */
export function isOpenPetsFormat(metadata: Record<string, unknown>): boolean {
  // 检查是否有 OpenPets 的标志性字段
  if (metadata.format === 'openpets' || metadata.format === 'openpets-v1') return true
  if (metadata.reactions && typeof metadata.reactions === 'object') return true
  return false
}

/**
 * 将 OpenPets 的 reactions 映射转换为 SpiritPal 的 ANIMATION_ROWS
 * OpenPets 使用 reaction 名（如 thinking/editing/testing），
 * SpiritPal 使用动画行名（如 idle/walk/waving）
 */
export function convertOpenPetsReactions(
  reactions: Record<string, OpenPetsReaction>,
): Record<string, AnimationRow> {
  const result: Record<string, AnimationRow> = {}

  for (const [reactionName, reaction] of Object.entries(reactions)) {
    // 先尝试通过映射表转换
    const spiritpalName = OPENPETS_REACTION_MAP[reactionName]
    if (spiritpalName && ANIMATION_ROWS[spiritpalName]) {
      result[spiritpalName] = {
        row: reaction.row,
        frames: reaction.frames,
      }
    } else if (ANIMATION_ROWS[reactionName]) {
      // 如果反应名直接匹配 SpiritPal 的动画行名
      result[reactionName] = {
        row: reaction.row,
        frames: reaction.frames,
      }
    } else {
      // 未知反应名，尝试按行号匹配
      const existingEntry = Object.entries(ANIMATION_ROWS).find(
        ([, v]) => v.row === reaction.row,
      )
      if (existingEntry) {
        result[existingEntry[0]] = {
          row: reaction.row,
          frames: reaction.frames,
        }
      }
    }
  }

  // 确保至少有 idle 行
  if (!result.idle) {
    result.idle = ANIMATION_ROWS.idle
  }

  return result
}

// ============ GitHub Releases 后端（零服务器成本） ============
//
// 使用 GitHub Releases 存储 .petmod 文件，GitHub Issues 作为评分/评论系统。
// 配置：设置 window.__GITHUB_MOD_REPO__ = 'owner/repo' 启用 GitHub 后端。
// 默认仓库：spiritpal-community/mods

interface GitHubRelease {
  id: number
  tag_name: string
  name: string
  body: string
  published_at: string
  assets: Array<{
    id: number
    name: string
    size: number
    browser_download_url: string
    content_type: string
  }>
  author: { login: string }
  draft: boolean
  prerelease: boolean
}

interface GitHubIssue {
  id: number
  number: number
  title: string
  body: string
  user: { login: string }
  created_at: string
  labels: Array<{ name: string }>
}

function getGithubRepo(): string {
  try {
    const w = window as Window & { __GITHUB_MOD_REPO__?: string }
    if (w.__GITHUB_MOD_REPO__) return w.__GITHUB_MOD_REPO__
  } catch { /* ignore */ }
  return 'spiritpal-community/mods'
}

function isGitHubBackend(): boolean {
  // 配置了自定义 REST API（window.__COMMUNITY_API_BASE_URL__）时，优先使用 REST 后端
  try {
    const w = window as Window & { __COMMUNITY_API_BASE_URL__?: string }
    if (w.__COMMUNITY_API_BASE_URL__) return false
  } catch { /* ignore */ }
  // 未配置自定义 REST API 时默认启用 GitHub Releases 后端（零服务器成本）
  return true
}

/** 从 Release body JSON 解析模组元数据 */
function parseReleaseMetadata(release: GitHubRelease): CommunityCharacterSummary | null {
  try {
    const meta = JSON.parse(release.body)
    const petmodAsset = release.assets.find((a) => a.name.endsWith('.petmod'))
    if (!petmodAsset) return null
    return {
      id: `gh-${release.tag_name}`,
      name: meta.name ?? release.tag_name,
      displayName: meta.displayName ?? release.name ?? release.tag_name,
      author: meta.author ?? release.author.login,
      description: meta.description ?? release.body,
      previewImage: meta.previewImage ?? '',
      rating: meta.rating ?? 0,
      ratingCount: meta.ratingCount ?? 0,
      downloadCount: petmodAsset.size > 0 ? release.assets.reduce((sum, a) => sum + (a.name.endsWith('.petmod') ? a.size : 0), 0) : 0,
      uploadAt: new Date(release.published_at).getTime(),
      tags: meta.tags ?? [],
      version: meta.version ?? release.tag_name,
    }
  } catch {
    return null
  }
}

/** GitHub Releases API：获取模组列表 */
export async function fetchGitHubCharacters(
  page = 1,
  sort: CharacterSort = 'hot',
  query?: string,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<PaginatedList<CommunityCharacterSummary>> {
  const repo = getGithubRepo()
  const perPage = Math.min(pageSize * 3, 100) // 多取一些用于客户端过滤
  const signal = createTimeoutSignal(DEFAULT_REQUEST_TIMEOUT_MS)
  // SECURITY R-09: 使用 safeFetch 进行 SSRF 防护
  const res = await safeFetch(
    `https://api.github.com/repos/${repo}/releases?per_page=${perPage}&page=${page}`,
    { signal, headers: { Accept: 'application/vnd.github.v3+json' } },
    undefined, 'community',
  )
  if (!res.ok) throw new ApiError(`GitHub API 失败: ${res.status}`)
  const releases = (await res.json()) as GitHubRelease[]

  let items = releases.map(parseReleaseMetadata).filter((x): x is CommunityCharacterSummary => x !== null)

  // 搜索过滤
  if (query) {
    const q = query.toLowerCase()
    items = items.filter(
      (c) => c.displayName.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }

  // 排序
  switch (sort) {
    case 'latest': items.sort((a, b) => b.uploadAt - a.uploadAt); break
    case 'rating': items.sort((a, b) => b.rating - a.rating); break
    case 'hot': items.sort((a, b) => b.downloadCount - a.downloadCount); break
  }

  const total = items.length
  const start = 0
  items = items.slice(start, start + pageSize)
  return { items, page, pageSize, total, hasMore: total > start + pageSize }
}

/** GitHub Releases API：获取模组详情 */
export async function fetchGitHubDetail(id: string): Promise<CommunityCharacterDetail> {
  const repo = getGithubRepo()
  const tagName = id.replace(/^gh-/, '')
  const signal = createTimeoutSignal(DEFAULT_REQUEST_TIMEOUT_MS)
  // SECURITY R-09: 使用 safeFetch 进行 SSRF 防护
  const res = await safeFetch(
    `https://api.github.com/repos/${repo}/releases/tags/${tagName}`,
    { signal, headers: { Accept: 'application/vnd.github.v3+json' } },
    undefined, 'community',
  )
  if (!res.ok) throw new ApiError(`GitHub Release ${tagName} 不存在`, 404)
  const release = (await res.json()) as GitHubRelease
  const summary = parseReleaseMetadata(release)
  if (!summary) throw new ApiError('Release 元数据解析失败')

  const petmodAsset = release.assets.find((a) => a.name.endsWith('.petmod'))
  let modData: CharacterMod
  try {
    const meta = JSON.parse(release.body)
    modData = meta.modData ?? { petConf: { id: summary.id, name: summary.name, displayName: summary.displayName, source: 'community', birthBackground: '', emotionalCore: '', personality: { warmth: 0.5, liveliness: 0.5, dependence: 0.5, directness: 0, rationality: 0 }, signaturePhrase: '', classicQuotes: [], themeColor: { primary: '#4a5568', secondary: '#2d3748' }, favoriteItems: [], dislikeItems: [], spriteAsset: '', spriteType: 'atlas', activeHours: { start: 8, end: 23 } }, dialogueConf: { systemPrompt: `你是${summary.displayName}。`, fewShotExamples: [], bubbleMessages: { idle: [], hungry: [], sad: [], pet: [], feed: [], pomodoroDone: [] } } }
  } catch {
    modData = { petConf: { id: summary.id, name: summary.name, displayName: summary.displayName, source: 'community', birthBackground: '', emotionalCore: '', personality: { warmth: 0.5, liveliness: 0.5, dependence: 0.5, directness: 0, rationality: 0 }, signaturePhrase: '', classicQuotes: [], themeColor: { primary: '#4a5568', secondary: '#2d3748' }, favoriteItems: [], dislikeItems: [], spriteAsset: '', spriteType: 'atlas', activeHours: { start: 8, end: 23 } }, dialogueConf: { systemPrompt: `你是${summary.displayName}。`, fewShotExamples: [], bubbleMessages: { idle: [], hungry: [], sad: [], pet: [], feed: [], pomodoroDone: [] } } }
  }

  return {
    ...summary,
    themeColor: modData.petConf.themeColor,
    fileSize: petmodAsset?.size ?? 0,
    modData,
  }
}

/** GitHub Releases API：下载 .petmod */
export async function downloadGitHubCharacter(id: string): Promise<Blob> {
  await fetchGitHubDetail(id)
  const repo = getGithubRepo()
  const tagName = id.replace(/^gh-/, '')
  const signal = createTimeoutSignal(DEFAULT_DOWNLOAD_TIMEOUT_MS)
  // SECURITY R-09: 使用 safeFetch 进行 SSRF 防护
  const releaseRes = await safeFetch(
    `https://api.github.com/repos/${repo}/releases/tags/${tagName}`,
    { signal, headers: { Accept: 'application/vnd.github.v3+json' } },
    undefined, 'community',
  )
  if (!releaseRes.ok) throw new ApiError('Release 不存在')
  const release = (await releaseRes.json()) as GitHubRelease
  const asset = release.assets.find((a) => a.name.endsWith('.petmod'))
  if (!asset) throw new ApiError('找不到 .petmod 文件')

  // SECURITY R-09: 使用 safeFetch 进行 SSRF 防护
  const dlRes = await safeFetch(asset.browser_download_url, { signal }, undefined, 'community')
  if (!dlRes.ok) throw new ApiError('下载失败')
  return dlRes.blob()
}

/** GitHub Issues API：获取评论（label: comment） */
export async function fetchGitHubComments(id: string): Promise<CommunityComment[]> {
  const repo = getGithubRepo()
  const tagName = id.replace(/^gh-/, '')
  const signal = createTimeoutSignal(DEFAULT_REQUEST_TIMEOUT_MS)
  // SECURITY R-09: 使用 safeFetch 进行 SSRF 防护
  const res = await safeFetch(
    `https://api.github.com/repos/${repo}/issues?labels=comment,${tagName}&per_page=50&sort=created&direction=desc`,
    { signal, headers: { Accept: 'application/vnd.github.v3+json' } },
    undefined, 'community',
  )
  if (!res.ok) return []
  const issues = (await res.json()) as GitHubIssue[]
  return issues.map((issue) => ({
    id: String(issue.id),
    characterId: id,
    userName: issue.user.login,
    content: issue.body,
    createdAt: new Date(issue.created_at).getTime(),
  }))
}

/** GitHub Issues API：添加评论（创建 Issue with label: comment） */
export async function addGitHubComment(id: string, content: string): Promise<CommunityComment> {
  const repo = getGithubRepo()
  const tagName = id.replace(/^gh-/, '')
  const signal = createTimeoutSignal(DEFAULT_REQUEST_TIMEOUT_MS)
  // SECURITY R-09: 使用 safeFetch 进行 SSRF 防护
  const res = await safeFetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    signal,
    headers: { Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `[comment] ${tagName}`, body: content, labels: ['comment', tagName] }),
  }, undefined, 'community')
  if (!res.ok) throw new ApiError('评论失败')
  const issue = (await res.json()) as GitHubIssue
  return { id: String(issue.id), characterId: id, userName: issue.user.login, content, createdAt: Date.now() }
}

/** GitHub Issues API：评分（创建 Issue with label: rating） */
export async function rateGitHubCharacter(id: string, rating: number): Promise<RateResult> {
  const repo = getGithubRepo()
  const tagName = id.replace(/^gh-/, '')
  const clamped = Math.max(MIN_RATING, Math.min(MAX_RATING, Math.round(rating)))
  const signal = createTimeoutSignal(DEFAULT_REQUEST_TIMEOUT_MS)
  // SECURITY R-09: 使用 safeFetch 进行 SSRF 防护
  await safeFetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    signal,
    headers: { Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `[rating] ${tagName}: ${clamped}/5`, body: `${clamped}`, labels: ['rating', tagName] }),
  }, undefined, 'community')
  // 重新获取最新评分
  // SECURITY R-09: 使用 safeFetch 进行 SSRF 防护
  const commentsRes = await safeFetch(
    `https://api.github.com/repos/${repo}/issues?labels=rating,${tagName}&per_page=100`,
    { signal, headers: { Accept: 'application/vnd.github.v3+json' } },
    undefined, 'community',
  )
  if (!commentsRes.ok) return { characterId: id, rating: clamped, ratingCount: 1 }
  const ratingIssues = (await commentsRes.json()) as GitHubIssue[]
  let total = 0
  let count = 0
  for (const issue of ratingIssues) {
    const match = issue.body?.match(/^(\d)$/)
    if (match) { total += parseInt(match[1]); count++ }
  }
  return { characterId: id, rating: count > 0 ? Math.round((total / count) * 10) / 10 : clamped, ratingCount: count }
}
