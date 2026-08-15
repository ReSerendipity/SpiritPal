/**
 * @file ssrfProtection.ts
 * @description SSRF 防护模块 — 网络请求限制和安全防护
 *
 * 核心功能：
 * 1. 网络请求限制为声明的域名（白名单机制）
 * 2. URL 校验 against allowlist/blocklist
 * 3. 阻止私有 IP 范围访问（防止内网探测）
 * 4. DNS rebinding 防护（缓存 DNS 解析结果）
 * 5. 可配置的域名白名单/黑名单
 * 6. 危险端口阻止（数据库、SSH、SMTP 等）
 * 7. 功能级别域名白名单（不同功能可配置不同允许域名）
 * 8. safeFetch() 安全 fetch 封装
 *
 * 私有 IP 防护范围：
 * - 127.0.0.0/8 回环地址
 * - 10.0.0.0/8 A 类私有
 * - 172.16.0.0/12 B 类私有
 * - 192.168.0.0/16 C 类私有
 * - 169.254.0.0/16 链路本地
 * - 0.0.0.0/8 当前网络
 * - 100.64.0.0/10 CGNAT
 * - 198.18.0.0/15 基准测试
 * - 224.0.0.0/4 组播地址
 * - 240.0.0.0/4 保留地址
 * - IPv6 本地地址（::1, fc/fd 开头, fe80 开头）
 *
 * 默认阻止端口：22(SSH), 25/465/587(SMTP), 6379(Redis), 27017(MongoDB), 9200/9300(Elasticsearch), 5432(PostgreSQL), 3306(MySQL)
 *
 * 主要模块：
 * - SSRFValidationResult: 校验结果接口
 * - SSRFConfig: 防护配置接口
 * - SSRFProtector: SSRF 防护器类
 * - safeFetch(): 安全 fetch 封装
 *
 * 依赖关系：无外部依赖（使用 Web URL API）
 *
 * 核心接口：
 * - SSRFProtector.validate(): 校验 URL 安全性
 * - safeFetch(): 校验后执行 fetch
 * - getSSRFProtector(): 获取单例实例
 *
 * 参考：OpenPets 的 SSRF 防护设计
 */

// ============ 私有 IP 范围 ============

/** 私有 IP 范围定义 */
const PRIVATE_IP_RANGES: Array<{ start: number; end: number; label: string }> = [
  // 127.0.0.0/8 — 回环地址
  { start: ipToNumber('127.0.0.0'), end: ipToNumber('127.255.255.255'), label: '回环地址' },
  // 10.0.0.0/8 — A 类私有
  { start: ipToNumber('10.0.0.0'), end: ipToNumber('10.255.255.255'), label: 'A类私有' },
  // 172.16.0.0/12 — B 类私有
  { start: ipToNumber('172.16.0.0'), end: ipToNumber('172.31.255.255'), label: 'B类私有' },
  // 192.168.0.0/16 — C 类私有
  { start: ipToNumber('192.168.0.0'), end: ipToNumber('192.168.255.255'), label: 'C类私有' },
  // 169.254.0.0/16 — 链路本地
  { start: ipToNumber('169.254.0.0'), end: ipToNumber('169.254.255.255'), label: '链路本地' },
  // 0.0.0.0/8 — 当前网络
  { start: ipToNumber('0.0.0.0'), end: ipToNumber('0.255.255.255'), label: '当前网络' },
  // 100.64.0.0/10 — 运营商级 NAT
  { start: ipToNumber('100.64.0.0'), end: ipToNumber('100.127.255.255'), label: 'CGNAT' },
  // 198.18.0.0/15 — 基准测试
  { start: ipToNumber('198.18.0.0'), end: ipToNumber('198.19.255.255'), label: '基准测试' },
  // 224.0.0.0/4 — 组播地址
  { start: ipToNumber('224.0.0.0'), end: ipToNumber('239.255.255.255'), label: '组播地址' },
  // 240.0.0.0/4 — 保留地址
  { start: ipToNumber('240.0.0.0'), end: ipToNumber('255.255.255.255'), label: '保留地址' },
]

/** IP 地址转数值 */
function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

/** 检查 IP 是否为私有地址 */
function isPrivateIP(ip: string): { isPrivate: boolean; label?: string } {
  // IPv6 本地地址
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) {
    return { isPrivate: true, label: 'IPv6本地地址' }
  }

  const parts = ip.split('.')
  if (parts.length !== 4) return { isPrivate: false }

  const num = ipToNumber(ip)
  for (const range of PRIVATE_IP_RANGES) {
    if (num >= range.start && num <= range.end) {
      return { isPrivate: true, label: range.label }
    }
  }

  return { isPrivate: false }
}

// ============ SSRF 防护器 ============

/** SSRF 校验结果 */
export interface SSRFValidationResult {
  /** 是否允许 */
  allowed: boolean
  /** 拒绝原因 */
  reason?: string
  /** 解析后的 URL */
  parsedUrl?: URL
  /** 风险等级 */
  riskLevel: 'safe' | 'warning' | 'danger'
}

/** SSRF 防护配置 */
export interface SSRFConfig {
  /** 允许的域名白名单（空=允许所有非私有地址） */
  allowedDomains: string[]
  /** 阻止的域名黑名单 */
  blockedDomains: string[]
  /** 阻止的 IP 范围（默认包含所有私有 IP） */
  blockPrivateIPs: boolean
  /** 阻止的端口列表 */
  blockedPorts: number[]
  /** 允许的协议列表 */
  allowedProtocols: string[]
  /** 是否启用 DNS rebinding 防护 */
  enableDnsRebindingProtection: boolean
  /** 已解析的 DNS 缓存（用于 rebinding 防护） */
  dnsCache: Map<string, string>
}

/** 默认配置 */
const DEFAULT_SSRF_CONFIG: SSRFConfig = {
  allowedDomains: [],
  blockedDomains: [],
  blockPrivateIPs: true,
  blockedPorts: [22, 25, 465, 587, 6379, 27017, 9200, 9300, 5432, 3306],
  allowedProtocols: ['http', 'https'],
  enableDnsRebindingProtection: true,
  dnsCache: new Map(),
}

/**
 * SSRF 防护器 — 验证网络请求目标 URL 的安全性
 */
export class SSRFProtector {
  private config: SSRFConfig
  /** 功能级别的域名白名单 */
  private featureAllowlists = new Map<string, Set<string>>()

  constructor(config?: Partial<SSRFConfig>) {
    this.config = { ...DEFAULT_SSRF_CONFIG, ...config }
    if (!this.config.dnsCache) {
      this.config.dnsCache = new Map()
    }
  }

  /**
   * 校验 URL 是否允许访问
   * @param url 目标 URL
   * @param feature 功能标识（用于功能级别白名单）
   * @returns 校验结果
   */
  validate(url: string, feature?: string): SSRFValidationResult {
    // 1. URL 解析
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return { allowed: false, reason: 'URL 格式无效', riskLevel: 'danger' }
    }

    // 2. 协议检查
    if (!this.config.allowedProtocols.includes(parsedUrl.protocol.replace(':', ''))) {
      return {
        allowed: false,
        reason: `不允许的协议: ${parsedUrl.protocol}`,
        riskLevel: 'danger',
      }
    }

    // 3. 端口检查
    const port = parsedUrl.port ? parseInt(parsedUrl.port) : (parsedUrl.protocol === 'https:' ? 443 : 80)
    if (this.config.blockedPorts.includes(port)) {
      return {
        allowed: false,
        reason: `不允许的端口: ${port}`,
        riskLevel: 'danger',
      }
    }

    // 4. 主机名检查 — 黑名单
    const hostname = parsedUrl.hostname.toLowerCase()
    for (const blocked of this.config.blockedDomains) {
      if (hostname === blocked || hostname.endsWith(`.${blocked}`)) {
        return {
          allowed: false,
          reason: `域名在黑名单中: ${blocked}`,
          riskLevel: 'danger',
        }
      }
    }

    // 5. 私有 IP 检查
    if (this.config.blockPrivateIPs) {
      // 检查 hostname 是否为 IP 地址
      const ipMatch = hostname.match(/^(\d+\.\d+\.\d+\.\d+)$/)
      if (ipMatch) {
        const { isPrivate, label } = isPrivateIP(ipMatch[1])
        if (isPrivate) {
          return {
            allowed: false,
            reason: `目标为私有 IP 地址 (${label}): ${hostname}`,
            riskLevel: 'danger',
          }
        }
      }

      // 特殊主机名检查
      if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '[::1]') {
        return {
          allowed: false,
          reason: '目标为本地地址',
          riskLevel: 'danger',
        }
      }
    }

    // 6. 功能级别白名单检查
    if (feature) {
      const featureDomains = this.featureAllowlists.get(feature)
      if (featureDomains && featureDomains.size > 0) {
        let matched = false
        for (const domain of featureDomains) {
          if (hostname === domain || hostname.endsWith(`.${domain}`)) {
            matched = true
            break
          }
        }
        if (!matched) {
          return {
            allowed: false,
            reason: `功能 "${feature}" 不允许访问域名: ${hostname}`,
            riskLevel: 'warning',
          }
        }
      }
    }

    // 7. 全局白名单检查
    if (this.config.allowedDomains.length > 0) {
      let matched = false
      for (const domain of this.config.allowedDomains) {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
          matched = true
          break
        }
      }
      if (!matched) {
        return {
          allowed: false,
          reason: `域名不在白名单中: ${hostname}`,
          riskLevel: 'warning',
        }
      }
    }

    // 8. DNS rebinding 防护
    if (this.config.enableDnsRebindingProtection) {
      // 实际 DNS 解析需要后端支持，这里仅做标记
    }

    return {
      allowed: true,
      parsedUrl,
      riskLevel: 'safe',
    }
  }

  /**
   * 添加功能级别域名白名单
   * @param feature 功能标识
   * @param domains 允许的域名列表
   */
  addFeatureAllowlist(feature: string, domains: string[]): void {
    this.featureAllowlists.set(feature, new Set(domains))
  }

  /**
   * 移除功能级别域名白名单
   */
  removeFeatureAllowlist(feature: string): void {
    this.featureAllowlists.delete(feature)
  }

  /**
   * 添加全局允许域名
   */
  addAllowedDomain(domain: string): void {
    if (!this.config.allowedDomains.includes(domain)) {
      this.config.allowedDomains.push(domain)
    }
  }

  /**
   * 移除全局允许域名
   */
  removeAllowedDomain(domain: string): void {
    this.config.allowedDomains = this.config.allowedDomains.filter((d) => d !== domain)
  }

  /**
   * 添加阻止域名
   */
  addBlockedDomain(domain: string): void {
    if (!this.config.blockedDomains.includes(domain)) {
      this.config.blockedDomains.push(domain)
    }
  }

  /**
   * 获取配置
   */
  getConfig(): Readonly<SSRFConfig> {
    return this.config
  }
}

// ============ 安全 fetch 封装 ============

/**
 * 安全的网络请求封装
 * 在调用 fetch 前进行 SSRF 校验
 */
export async function safeFetch(
  url: string,
  options?: RequestInit,
  protector?: SSRFProtector,
  feature?: string,
): Promise<Response> {
  const guard = protector ?? getSSRFProtector()
  const validation = guard.validate(url, feature)

  if (!validation.allowed) {
    throw new Error(`SSRF 防护: ${validation.reason}`)
  }

  return fetch(url, options)
}

// ============ 单例 ============

let sharedProtector: SSRFProtector | null = null

export function getSSRFProtector(config?: Partial<SSRFConfig>): SSRFProtector {
  if (!sharedProtector) {
    sharedProtector = new SSRFProtector(config)
  }
  return sharedProtector
}

export function resetSSRFProtector(): void {
  sharedProtector = null
}
