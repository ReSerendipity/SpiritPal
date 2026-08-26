/**
 * @file windowTitleExtractor.ts
 * @description 窗口标题提取与关键文本高亮模块
 * 
 * 实现功能：
 * - 从活跃窗口提取标题和进程信息
 * - 智能解析窗口标题中的关键内容（文件路径、URL、搜索词等）
 * - 关键词高亮标记（代码变量名、URL、文件名等）
 * - 为上下文感知提供结构化信息
 * 
 * 参考：Live2DPet active_window.py / OpenPets packages/window/
 */

import { invoke } from '@tauri-apps/api/core'

// ============ 类型定义 ============

export interface WindowInfo {
  /** 窗口标题 */
  title: string
  /** 进程名 */
  processName: string
  /** 应用名 */
  appName?: string
  /** 提取的关键信息 */
  extractedInfo?: ExtractedWindowInfo
}

export interface ExtractedWindowInfo {
  /** 主要关键词列表 */
  keywords: string[]
  /** URL（如有） */
  url?: string
  /** 文件路径（如有） */
  filePath?: string
  /** 项目名称或仓库名（如 VS Code 打开的项目） */
  projectName?: string
  /** 代码相关的实体（类名、函数名、变量名） */
  codeEntities?: string[]
  /** 文档标题（浏览器或阅读器） */
  documentTitle?: string
  /** 搜索查询（搜索引擎或 IDE） */
  searchQuery?: string
  /** 消息预览（聊天软件） */
  messagePreview?: string
}

export interface HighlightPattern {
  /** 匹配模式 */
  pattern: RegExp
  /** 类型标识 */
  type: 'url' | 'filepath' | 'code' | 'hash' | 'version' | 'email'
  /** 高亮样式类名 */
  cssClass: string
}

// ============ 高亮模式定义 ============

export const HIGHLIGHT_PATTERNS: HighlightPattern[] = [
  // URL
  {
    pattern: /\b(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)\b/gi,
    type: 'url',
    cssClass: 'highlight-url',
  },
  // 文件路径（Windows/Linux/macOS）
  {
    pattern: /\b([A-Za-z]:\\[^:*?"<>|\r\n]+|\/[\w\s./-]+)\b/g,
    type: 'filepath',
    cssClass: 'highlight-filepath',
  },
  // Git commit hash / 短哈希
  {
    pattern: /\b[a-f0-9]{7,40}\b/g,
    type: 'hash',
    cssClass: 'highlight-hash',
  },
  // 版本号（语义化版本）
  {
    pattern: /\bv?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.+-]+)?(?:\+[a-zA-Z0-9.+-]+)?\b/gi,
    type: 'version',
    cssClass: 'highlight-version',
  },
  // Email 地址
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
    type: 'url',
    cssClass: 'highlight-email',
  },
  // 代码标识符（驼峰/下划线命名）
  {
    pattern: /\b([A-Z][a-zA-Z0-9]*|[a-z][a-zA-Z0-9]*_[a-zA-Z0-9_]+)\b/g,
    type: 'code',
    cssClass: 'highlight-code',
  },
]

// ============ 窗口信息提取器 ============

export class WindowTitleExtractor {
  private lastCache: WindowInfo | null = null
  private cacheTime: number = 0
  private readonly CACHE_TTL_MS = 1000 // 缓存 1 秒

  /**
   * 获取当前活跃窗口信息
   */
  async getActiveWindow(): Promise<WindowInfo> {
    // 检查缓存
    const now = Date.now()
    if (this.lastCache && now - this.cacheTime < this.CACHE_TTL_MS) {
      return this.lastCache
    }

    try {
      const rawInfo = await invoke<{ title: string; process_name: string }>('get_active_window')
      
      const title = rawInfo?.title ?? ''
      const processName = rawInfo?.process_name ?? ''

      const windowInfo: WindowInfo = {
        title,
        processName,
        appName: this.inferAppName(processName),
        extractedInfo: this.extractKeyInfo(title, processName),
      }

      this.lastCache = windowInfo
      this.cacheTime = now

      return windowInfo
    } catch (error) {
      console.error('[WindowTitleExtractor] Failed to get active window:', error)
      return {
        title: '',
        processName: '',
        extractedInfo: { keywords: [] },
      }
    }
  }

  /**
   * 从进程名推断应用名
   */
  inferAppName(processName: string): string | undefined {
    const mapping: Record<string, string> = {
      'Code': 'Visual Studio Code',
      'idea': 'IntelliJ IDEA',
      'webstorm': 'WebStorm',
      'pycharm': 'PyCharm',
      'chrome': 'Google Chrome',
      'firefox': 'Mozilla Firefox',
      'msedge': 'Microsoft Edge',
      'safari': 'Safari',
      'zoom': 'Zoom',
      'Teams': 'Microsoft Teams',
      'WeChat': '微信',
      'Lark': '飞书',
      'DingTalk': '钉钉',
    }

    const lowerProcess = processName.toLowerCase()
    for (const [key, appName] of Object.entries(mapping)) {
      if (lowerProcess.includes(key.toLowerCase())) {
        return appName
      }
    }

    return undefined
  }

  /**
   * 提取窗口标题中的关键信息
   */
  extractKeyInfo(title: string, processName: string): ExtractedWindowInfo {
    const info: ExtractedWindowInfo = {
      keywords: [],
    }

    // 提取 URL
    const urlMatch = title.match(HIGHLIGHT_PATTERNS.find(p => p.type === 'url')!.pattern)
    if (urlMatch) {
      info.url = urlMatch[0]
    }

    // 提取文件路径
    const pathMatch = title.match(HIGHLIGHT_PATTERNS.find(p => p.type === 'filepath')!.pattern)
    if (pathMatch) {
      info.filePath = pathMatch[0]
    }

    // VS Code / IntelliJ 类 IDE - 提取项目信息
    if (/code|-code|idea|webstorm|pycharm/i.test(processName)) {
      // 格式："filename.js - ProjectName" 或 "ProjectName - Visual Studio Code"
      const projectMatch = title.match(/- ([^-]+) -?$/i)
      if (projectMatch) {
        info.projectName = projectMatch[1]?.trim()
      }
      
      // 提取代码相关的实体（简单启发式）
      info.codeEntities = this.extractCodeEntities(title)
    }

    // 浏览器 - 提取文档标题和 URL
    if (/chrome|firefox|edge|safari|brave/i.test(processName)) {
      const parts = title.split(' - ')
      if (parts.length >= 2) {
        info.documentTitle = parts[0]?.trim()
        info.url = parts.slice(1).join(' - ').trim()
      }
    }

    // 搜索引擎 - 提取搜索查询
    if (/google|bing|baidu|duckduckgo/i.test(title)) {
      const queryMatch = title.match(/q=([^&]+)/)
      if (queryMatch) {
        info.searchQuery = decodeURIComponent(queryMatch[1])
      }
    }

    // 聊天软件 - 提取联系人/群名和消息预览
    if (/wechats?|wechat|lark|feishu|dingtalk|teams/i.test(processName)) {
      const parts = title.split(':')
      if (parts.length >= 2) {
        info.messagePreview = `${parts[0].trim()}: ${parts[1].trim().substring(0, 30)}`
      } else {
        info.keywords.push(title.trim())
      }
    }

    // 通用关键词提取（去除分隔符后的片段）
    const separators = [' - ', ' — ', ' | ', ': ', ' @ ']
    let cleanTitle = title
    separators.forEach(sep => {
      cleanTitle = cleanTitle.replace(new RegExp(`\\${sep}`, 'g'), ' ')
    })
    
    // 提取有意义的单词（排除常用停用词）
    const stopWords = new Set(['and', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with'])
    const words = cleanTitle
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()))
    
    info.keywords = words.slice(0, 5)

    return info
  }

  /**
   * 提取代码相关实体（简单正则匹配）
   */
  private extractCodeEntities(title: string): string[] {
    const entities: string[] = []
    
    // 类名（帕斯卡命名）
    const classes = title.match(/\b[A-Z][a-zA-Z0-9]+\b/g) || []
    entities.push(...classes.slice(0, 3))
    
    // 函数/方法调用（包含括号）
    const functions = title.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\s*\(/g) || []
    entities.push(...functions.map(f => f.trim().slice(0, -1)).slice(0, 3))
    
    // 导入语句
    const imports = title.match(/from\s+['"][^'"]+['"]/gi) || []
    entities.push(...imports.map(i => i.replace("from '", '').replace("from ", '').replace("'", '')).slice(0, 2))

    return [...new Set(entities)] // 去重
  }

  /**
   * 对文本进行高亮标记
   * @param text 原始文本
   * @returns HTML 字符串（已添加高亮标签）
   */
  highlightText(text: string): string {
    let highlighted = text
    
    // 按优先级排序（URL 优先，避免被其他规则误匹配）
    const sortedPatterns = [...HIGHLIGHT_PATTERNS].sort((a, b) => {
      const priority = { url: 1, filepath: 2, code: 3, hash: 4, version: 5, email: 6 }
      return (priority[a.type] || 9) - (priority[b.type] || 9)
    })

    sortedPatterns.forEach(({ pattern, cssClass }) => {
      highlighted = highlighted.replace(pattern, (match) => {
        return `<span class="${cssClass}" title="${match}">${match}</span>`
      })
    })

    return highlighted
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.lastCache = null
    this.cacheTime = 0
  }
}

// ============ 单例 ============

let instance: WindowTitleExtractor | null = null

export function getWindowTitleExtractor(): WindowTitleExtractor {
  if (!instance) {
    instance = new WindowTitleExtractor()
  }
  return instance
}

export function resetWindowTitleExtractor(): void {
  if (instance) {
    instance.clearCache()
    instance = null
  }
}
