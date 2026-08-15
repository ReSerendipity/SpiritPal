//! 输入校验辅助函数模块（命令注入 / 路径遍历防护）
//!
//! [REFACTOR] 从 lib.rs 拆分，职责单一化：集中管理所有跨命令复用的输入校验逻辑
//!
//! # 安全防线
//! 本模块提供两层安全防线：
//! 1. [`validate_app_name`] — 拒绝 shell 元字符，防止命令注入（用于 `open_application`）
//! 2. [`validate_target_dir`] — 三层路径遍历防护（用于 `import_petmod`）

use tauri::Manager;

/// Shell 元字符黑名单 — 拒绝这些字符即可阻断 cmd.exe / sh 的命令分隔
// [SECURITY] D1 - 防止 open_application 命令注入
// R-10: 补充 '$' (变量替换), ' ' (空格注入 IFS), '\t' (制表符), '"' (引号注入)
const SHELL_METACHARS: &[char] = &[
    '&', '|', '>', '<', '^', '(', ')', '%', '!', '\n', '\r', ';', '`', '$', ' ', '\t', '"',
];

/// 允许的 URL scheme 白名单
// R-10: 若输入包含 :// 则仅允许 http/https 协议
const ALLOWED_URL_SCHEMES: &[&str] = &["http://", "https://"];

/// 校验应用程序名称/URL，拒绝 shell 元字符防止命令注入
///
/// 用于 [`crate::open_application`] 命令，在调用 `open::that` 前校验输入，
/// 防止用户传入包含 shell 元字符的字符串导致命令注入。
///
/// # 合法输入示例
/// - `"calc"` / `"notepad"`（应用名）
/// - `"https://www.bing.com"`（URL）
/// - `"ms-settings:"`（协议 URI）
///
/// # 非法输入示例
/// - `"calc & del /f"`（命令分隔）
/// - `"calc;rm -rf"`（分号分隔）
/// - `"calc\nwhoami"`（换行注入）
///
/// # Arguments
/// - `app_name` — 待校验的应用名称或 URL
///
/// # Returns
/// - `Ok(())` — 输入合法
/// - `Err(String)` — 输入为空或包含非法字符
pub fn validate_app_name(app_name: &str) -> Result<(), String> {
    if app_name.is_empty() {
        // R-12 v2.0: obfstr 混淆错误消息
        return Err(obfstr::obfstr!("应用程序名称不能为空").to_string());
    }
    // R-10: 若输入包含 :// 则验证 URL scheme 白名单
    if app_name.contains("://") {
        let lower = app_name.to_lowercase();
        let scheme_valid = ALLOWED_URL_SCHEMES
            .iter()
            .any(|scheme| lower.starts_with(scheme));
        if !scheme_valid {
            return Err(obfstr::obfstr!("仅允许 http:// 或 https:// URL 协议").to_string());
        }
    }
    for ch in app_name.chars() {
        if SHELL_METACHARS.contains(&ch) {
            return Err(format!("应用程序名称包含非法字符: '{}'", ch));
        }
    }
    Ok(())
}

/// 校验目标路径是否在应用数据目录范围内（路径遍历防护）
///
/// 用于 [`crate::petmod::import_petmod`] 命令，防止前端传入任意路径写入文件。
///
/// # SECURITY: 三层防御
/// 1. **拒绝 `..` 组件** — 阻断 `app_data_dir/../sensitive` 这类前缀绕过
/// 2. **canonicalize 后做严格 starts_with** — 解析符号链接并归一化路径
/// 3. **目标尚未创建时，回退到字符串规范化匹配** — 强制要求以 `base/` 为前缀，
///    避免 `app_data_dir-evil` 这类同级前缀碰撞
///
/// # Arguments
/// - `app` — Tauri 应用句柄，用于获取 app_data_dir
/// - `target_dir` — 待校验的目标目录路径
///
/// # Returns
/// - `Ok(())` — 路径合法，在应用数据目录范围内
/// - `Err(String)` — 路径包含非法组件、无法规范化或越权
pub fn validate_target_dir(app: &tauri::AppHandle, target_dir: &str) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    let target_path = std::path::Path::new(target_dir);

    // SECURITY-1: 拒绝任何 ParentDir 组件，从源头阻断 `..` 穿越
    if target_path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(obfstr::obfstr!("目标目录包含非法路径组件").to_string());
    }

    // SECURITY-2: 优先用 canonicalize 做严格前缀匹配（解析符号链接、归一化大小写）
    let canonical_base = app_data_dir
        .canonicalize()
        .map_err(|e| format!("无法规范化应用数据目录: {}", e))?;
    match target_path.canonicalize() {
        Ok(canonical_target) => {
            if !canonical_target.starts_with(&canonical_base) {
                return Err(obfstr::obfstr!("目标目录不在应用数据目录范围内").to_string());
            }
        }
        // 目标目录尚未创建（常见场景：解压前先校验目标父目录）
        // 此时回退到字符串规范化匹配，但要求严格以 base + 分隔符 为前缀
        Err(_) => {
            let base_str = canonical_base
                .to_string_lossy()
                .to_lowercase()
                .replace('\\', "/")
                // Windows canonicalize 返回 verbatim 路径（\\?\\ 前缀），
                // 与前端传入的普通路径比较前需剥离该前缀
                .trim_start_matches("//?/")
                .to_string();
            let target_str = target_dir.to_lowercase().replace('\\', "/");
            let is_match =
                target_str == base_str || target_str.starts_with(&format!("{}/", base_str));
            if !is_match {
                return Err(obfstr::obfstr!("目标目录不在应用数据目录范围内").to_string());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============ validate_app_name 补充测试 ============

    #[test]
    fn test_validate_app_name_dollar_sign() {
        assert!(validate_app_name("calc$HOME").is_err());
    }

    #[test]
    fn test_validate_app_name_space() {
        assert!(validate_app_name("calc notepad").is_err());
    }

    #[test]
    fn test_validate_app_name_tab() {
        assert!(validate_app_name("calc\tnotepad").is_err());
    }

    #[test]
    fn test_validate_app_name_double_quote() {
        assert!(validate_app_name("calc\"test").is_err());
    }

    #[test]
    fn test_validate_app_name_http_url() {
        assert!(validate_app_name("http://example.com").is_ok());
    }

    #[test]
    fn test_validate_app_name_https_url() {
        assert!(validate_app_name("https://example.com").is_ok());
    }

    #[test]
    fn test_validate_app_name_ftp_url_rejected() {
        // ftp:// 协议不在白名单中
        assert!(validate_app_name("ftp://example.com").is_err());
    }

    #[test]
    fn test_validate_app_name_javascript_url_rejected() {
        assert!(validate_app_name("javascript://alert(1)").is_err());
    }

    #[test]
    fn test_validate_app_name_ms_settings() {
        // ms-settings: 不包含 :// 所以不做 URL scheme 校验
        assert!(validate_app_name("ms-settings:").is_ok());
    }

    #[test]
    fn test_validate_app_name_caret() {
        assert!(validate_app_name("calc^test").is_err());
    }

    #[test]
    fn test_validate_app_name_percent() {
        assert!(validate_app_name("calc%test%").is_err());
    }

    #[test]
    fn test_validate_app_name_exclamation() {
        assert!(validate_app_name("calc!test").is_err());
    }

    #[test]
    fn test_validate_app_name_parentheses() {
        assert!(validate_app_name("calc(test)").is_err());
    }

    #[test]
    fn test_validate_app_name_carriage_return() {
        assert!(validate_app_name("calc\rwhoami").is_err());
    }

    #[test]
    fn test_validate_app_name_long_valid() {
        let long_name = "a".repeat(255);
        assert!(validate_app_name(&long_name).is_ok());
    }

    #[test]
    fn test_validate_app_name_unicode() {
        // 中文应用名不含 shell 元字符
        assert!(validate_app_name("记事本").is_ok());
    }
}
