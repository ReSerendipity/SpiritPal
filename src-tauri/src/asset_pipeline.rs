//! 素材管线对接模块 — 检测本机工具 + 安全执行 Python 脚本
//!
//! P2: 为前端素材加工（PSD → PNG 帧、黑幕 → 透明 WebM）提供后端支持。
//!
//! # 提供的 Tauri 命令（在 lib.rs 中注册）
//! - [`detect_asset_tools`] — 检测本机 python / ffmpeg 是否在 PATH
//! - [`run_asset_pipeline`] — 安全白名单执行 asset-pipeline 脚本
//!
//! # 安全措施
//! - 脚本白名单：仅允许 `scripts/asset-pipeline/` 下的三个脚本
//! - 参数强校验：拒绝 shell 元字符（`;` `&` `|` `>` `<` `` ` `` `$` `!` `\n` `\r`）
//! - 路径校验：拒绝 `..` 路径组件

use std::path::{Component, Path};
use std::process::Command;

/// 允许执行的脚本白名单
const ALLOWED_SCRIPTS: &[&str] = &["chroma_key.py", "normalize.py", "psd_to_pet.py"];

/// 危险字符黑名单 — 防止命令注入
const DANGEROUS_CHARS: &[char] = &[
    ';', '&', '|', '>', '<', '`', '$', '!', '\n', '\r', '"', '\'', '\\',
];

// ============ Tauri 命令实现函数 ============

/// 检测结果
#[derive(serde::Serialize, Debug)]
pub struct ToolDetectionResult {
    /// Python 是否可用
    pub python: bool,
    /// ffmpeg 是否可用
    pub ffmpeg: bool,
    /// Python 版本号（如 "3.11.5"）
    pub python_version: String,
    /// ffmpeg 版本号（如 "6.0"）
    pub ffmpeg_version: String,
}

/// 检测本机 python / ffmpeg 是否在 PATH
pub fn detect_asset_tools() -> ToolDetectionResult {
    let (python, python_version) = detect_tool("python", "--version");
    let (ffmpeg, ffmpeg_version) = detect_tool("ffmpeg", "-version");

    ToolDetectionResult {
        python,
        ffmpeg,
        python_version,
        ffmpeg_version,
    }
}

/// 执行检测结果
#[derive(serde::Serialize, Debug)]
pub struct PipelineRunResult {
    /// 是否成功
    pub success: bool,
    /// stdout 输出
    pub stdout: String,
    /// stderr 输出
    pub stderr: String,
    /// 退出码
    pub exit_code: Option<i32>,
}

/// 安全执行 asset-pipeline 脚本
///
/// # Arguments
/// - `script_name` — 脚本文件名（必须在白名单中）
/// - `args` — 参数列表（每个参数都会做安全校验）
///
/// # Returns
/// - `Ok(PipelineRunResult)` — 执行完成（无论脚本退出码）
/// - `Err(String)` — 脚本名不在白名单、参数包含危险字符、路径不合法
pub fn run_asset_pipeline(script_name: &str, args: &[String]) -> Result<PipelineRunResult, String> {
    // 1. 校验脚本名在白名单中
    if !ALLOWED_SCRIPTS.contains(&script_name) {
        return Err(format!(
            "脚本 {} 不在白名单中（允许: {}）",
            script_name,
            ALLOWED_SCRIPTS.join(", ")
        ));
    }

    // 2. 校验脚本名不含危险字符
    if contains_dangerous_chars(script_name) {
        return Err("脚本名包含非法字符".to_string());
    }

    // 3. 校验每个参数不含危险字符
    for (i, arg) in args.iter().enumerate() {
        if contains_dangerous_chars(arg) {
            return Err(format!("参数 {} 包含非法字符: {}", i, sanitize_for_display(arg)));
        }
        // 校验路径类参数不含 ..
        if Path::new(arg)
            .components()
            .any(|c| matches!(c, Component::ParentDir))
        {
            return Err(format!("参数 {} 包含非法路径组件", i));
        }
    }

    // 4. 构建脚本路径（相对于项目根目录的 scripts/asset-pipeline/）
    let script_path = format!("scripts/asset-pipeline/{}", script_name);

    // 5. 执行
    let output = Command::new("python")
        .arg(&script_path)
        .args(args)
        .output()
        .map_err(|e| format!("执行 Python 失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    Ok(PipelineRunResult {
        success: output.status.success(),
        stdout,
        stderr,
        exit_code: output.status.code(),
    })
}

// ============ 辅助函数 ============

/// 检测单个工具是否可用
fn detect_tool(name: &str, version_arg: &str) -> (bool, String) {
    match Command::new(name).arg(version_arg).output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let combined = format!("{}{}", stdout, stderr);

            // 从输出中提取版本号
            let version = extract_version(&combined, name);

            (true, version)
        }
        Err(_) => (false, String::new()),
    }
}

/// 从工具输出中提取版本号
fn extract_version(output: &str, tool: &str) -> String {
    // Python: "Python 3.11.5"
    // ffmpeg: "ffmpeg version 6.0 Copyright"
    for line in output.lines() {
        let lower = line.to_lowercase();
        if lower.contains(tool) {
            // 尝试提取版本号模式 (x.y.z 或 x.y)
            let words: Vec<&str> = line.split_whitespace().collect();
            for word in words {
                if is_version_like(word) {
                    return word.to_string();
                }
            }
        }
    }
    String::new()
}

/// 判断字符串是否像版本号
fn is_version_like(s: &str) -> bool {
    if s.is_empty() { return false; }
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() < 2 {
        return false;
    }
    parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// 检查字符串是否包含危险字符
fn contains_dangerous_chars(s: &str) -> bool {
    s.chars().any(|c| DANGEROUS_CHARS.contains(&c))
}

/// 清理字符串用于错误消息显示（隐藏原始内容）
fn sanitize_for_display(s: &str) -> String {
    if s.len() > 50 {
        format!("({} chars)", s.len())
    } else {
        s.chars().take(50).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============ run_asset_pipeline 安全测试 ============

    #[test]
    fn test_reject_script_not_in_whitelist() {
        let result = run_asset_pipeline("evil_script.py", &[]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("不在白名单中"));
    }

    #[test]
    fn test_reject_script_with_semicolon() {
        // Script with semolon fails at whitelist check first (not in whitelist)
        let result = run_asset_pipeline("chroma_key.py; rm -rf /", &[]);
        assert!(result.is_err());
        // Whitelist check fires first, so error mentions whitelist
        assert!(result.unwrap_err().contains("不在白名单中"));
    }

    #[test]
    fn test_reject_script_with_pipe() {
        let result = run_asset_pipeline("chroma_key.py | cat /etc/passwd", &[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_reject_script_with_ampersand() {
        let result = run_asset_pipeline("chroma_key.py & whoami", &[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_reject_arg_with_semicolon() {
        let result = run_asset_pipeline("chroma_key.py", &["input.mp4; rm -rf /".to_string()]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("非法字符"));
    }

    #[test]
    fn test_reject_arg_with_parent_dir() {
        let result = run_asset_pipeline("chroma_key.py", &["../../etc/passwd".to_string()]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("非法路径组件"));
    }

    #[test]
    fn test_reject_arg_with_backtick() {
        let result = run_asset_pipeline("chroma_key.py", &["`whoami`".to_string()]);
        assert!(result.is_err());
    }

    #[test]
    fn test_reject_arg_with_dollar() {
        let result = run_asset_pipeline("chroma_key.py", &["$HOME/secret".to_string()]);
        assert!(result.is_err());
    }

    #[test]
    fn test_reject_arg_with_newline() {
        let result = run_asset_pipeline("chroma_key.py", &["input.mp4\nwhoami".to_string()]);
        assert!(result.is_err());
    }

    #[test]
    fn test_accept_valid_script_name() {
        // 不实际执行 Python，只验证白名单通过
        // 如果 Python 不存在会返回 Ok 但 success=false
        let result = run_asset_pipeline("chroma_key.py", &[]);
        // 在没有 Python 的测试环境中可能 Err，也可能 Ok(success=false)
        // 关键是不应因白名单问题而 Err
        if let Err(ref e) = result {
            assert!(!e.contains("不在白名单中"), "should not reject whitelisted script");
            assert!(!e.contains("非法字符"), "should not reject clean script name");
        }
    }

    #[test]
    fn test_accept_valid_args() {
        let result = run_asset_pipeline("normalize.py", &["input.webm".to_string(), "--width".to_string(), "512".to_string()]);
        if let Err(ref e) = result {
            assert!(!e.contains("非法字符"), "should not reject clean args");
            assert!(!e.contains("非法路径组件"), "should not reject clean paths");
        }
    }

    // ============ 辅助函数测试 ============

    #[test]
    fn test_contains_dangerous_chars() {
        assert!(contains_dangerous_chars("hello;world"));
        assert!(contains_dangerous_chars("hello|world"));
        assert!(contains_dangerous_chars("hello&world"));
        assert!(contains_dangerous_chars("hello`world"));
        assert!(contains_dangerous_chars("$HOME"));
        assert!(!contains_dangerous_chars("hello world"));
        assert!(!contains_dangerous_chars("input.mp4"));
        assert!(!contains_dangerous_chars("--width 512"));
    }

    #[test]
    fn test_is_version_like() {
        assert!(is_version_like("3.11.5"));
        assert!(is_version_like("6.0"));
        assert!(is_version_like("1.2.3.4"));
        assert!(!is_version_like("hello"));
        assert!(!is_version_like("3."));
        assert!(!is_version_like(".5"));
        assert!(!is_version_like(""));
    }

    #[test]
    fn test_extract_version_python() {
        let output = "Python 3.11.5\n[GCC 11.4.0]";
        assert_eq!(extract_version(output, "python"), "3.11.5");
    }

    #[test]
    fn test_extract_version_ffmpeg() {
        let output = "ffmpeg version 6.0 Copyright (c) 2000-2023";
        assert_eq!(extract_version(output, "ffmpeg"), "6.0");
    }

    #[test]
    fn test_extract_version_empty() {
        assert_eq!(extract_version("", "python"), "");
    }
}
