/**
 * CSS url() 值安全拼接
 *
 * 背景（2026-09-13 内部浏览器全量切换检测发现）：
 * `backgroundImage: \`url(${path})\`` 这种**无引号**写法在 CSS 规范里是 url-token，
 * 不允许包含空白字符。一旦资源路径带空格（shimeji 素材普遍如此，如
 * `/pets/shimeji/Hu Tao.png`），整条 `background-image` 声明会被 CSSOM 判为非法并
 * **静默丢弃**（计算值 `none`、零报错），表现为「切换宠物后角色完全不可见」。
 * 同理，Windows 绝对路径里的 `\` 在无引号 url() 中会被当作 CSS 转义符吃掉。
 *
 * 因此所有拼进 CSS 的资源路径必须经本函数处理：
 * 1. 空路径 → `none`（保持声明合法，避免再次出现「属性整个消失」的静默失败）
 * 2. 未编码路径 → `encodeURI`（空格 → `%20`，中文 → `%E4%B8%AD`）
 * 3. 已含 `%XX` 的路径 → 不再编码（避免 `%20` 被二次编码成 `%2520` 而 404）
 * 4. 统一用双引号形式 `url("...")`，并转义内部的 `\` 与 `"`
 */

/** 判断路径是否已经是百分号编码形式（如 `%20` / `%E4%B8%AD`） */
const PERCENT_ENCODED = /%[0-9a-fA-F]{2}/

/**
 * 把资源路径转换为合法的 CSS `url(...)` 值
 * @param path 资源路径（相对路径如 `/pets/shimeji/Hu Tao.png`，或绝对/asset 路径）
 * @returns 可直接赋给 `backgroundImage` 等属性的合法 CSS 值
 */
export function cssUrl(path: string | undefined | null): string {
  if (!path || !path.trim()) return 'none'
  const encoded = PERCENT_ENCODED.test(path) ? path : encodeURI(path)
  return `url("${encoded.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`
}
