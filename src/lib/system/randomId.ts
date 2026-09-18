/**
 * 密码学安全随机 ID（CSPRNG）—— 会话 ID / 消息 ID 的唯一来源。
 *
 * 为什么不用 `Math.random()`：它由引擎的 xorshift128+ 类算法实现，种子可预测、
 * 输出可枚举，用在「ID / 令牌 / 会话标识」这类安全上下文属弱随机，CodeQL 会报
 * `js/insecure-randomness`（Insecure randomness）；而在开启了
 * `required_conversation_resolution` 的分支保护下，这类告警会以"未解决评审意见"
 * 的形式直接阻塞合并。
 *
 * `crypto.getRandomValues` 在 Tauri WebView（WebView2 / WKWebView / Android System
 * WebView）与 Node ≥ 19（vitest / jsdom 环境）下均为全局可用，无需 polyfill。
 */

/** 6 字节 = 48 bit 熵 → 12 位 hex。 */
const ID_BYTES = 6

/**
 * 生成 `<毫秒时间戳>-<12 位 hex>` 形式的唯一 ID。
 *
 * 48 bit 熵意味着"同一毫秒内碰撞"需约 1.7×10⁷ 个 ID（生日界）；而前缀本就是
 * 毫秒时间戳，跨毫秒天然不碰撞，故 6 字节足够且 ID 仍然短。
 *
 * 会话与消息 ID 统一走这里：历史上 `chatStore.genId` 与 `ChatWindow.mkMsg`
 * 各写了一份随机实现，后者还用着 `Math.random()` —— 单一实现可防再次漂移。
 */
export function genId(): string {
  const bytes = new Uint8Array(ID_BYTES)
  crypto.getRandomValues(bytes)
  const rand = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${Date.now()}-${rand}`
}
