/**
 * PII 掩码工具 — 数据导出时对敏感个人信息脱敏
 * （GDPR「导出权」/T-11 配套：明文导出默认打码，避免泄露邮箱/手机号/身份证等）
 *
 * 覆盖类型：
 * - 邮箱
 * - 中国大陆手机号（11 位，1[3-9] 开头）
 * - 18 位身份证号（末位可为数字/X）
 */
// 邮箱：xxx@example.com → a***@example.com
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// 手机号：138****1234
const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g
// 身份证：只保留前 1 后 1，其余打 *
const IDCARD_RE = /(?<!\d)\d{17}[\dXx](?!\d)/g

function maskEmail(match: string): string {
  const at = match.indexOf('@')
  const local = match.slice(0, at)
  const domain = match.slice(at) // 含 @domain
  return local.slice(0, Math.min(1, local.length)) + '****' + domain
}

function maskIdCard(match: string): string {
  return match.slice(0, 1) + '****************' + match.slice(-1)
}

/** 对单段文本做 PII 掩码 */
export function maskPII(input: string): string {
  if (!input) return input
  return input
    .replace(IDCARD_RE, maskIdCard)
    .replace(PHONE_RE, (m) => m.slice(0, 3) + '****' + m.slice(7))
    .replace(EMAIL_RE, maskEmail)
}

/** 递归对任意 JSON 数据对象中的所有字符串做 PII 掩码 */
export function maskPIIInObject<T>(value: T): T {
  if (typeof value === 'string') return maskPII(value) as unknown as T
  if (Array.isArray(value)) {
    return value.map((item) => maskPIIInObject(item)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = maskPIIInObject((value as Record<string, unknown>)[key])
    }
    return out as T
  }
  return value
}