//! validation 模块集成测试
//!
//! 测试 validation.rs 的公开 API：
//! - validate_app_name：命令注入防护、URL scheme 白名单

use spiritpal_lib::validation::validate_app_name;

// ============ 合法输入测试 ============

#[test]
fn test_valid_app_names() {
    assert!(validate_app_name("calc").is_ok());
    assert!(validate_app_name("notepad").is_ok());
    assert!(validate_app_name("mspaint").is_ok());
    assert!(validate_app_name("explorer").is_ok());
    assert!(validate_app_name("code").is_ok());
}

#[test]
fn test_valid_urls() {
    assert!(validate_app_name("http://example.com").is_ok());
    assert!(validate_app_name("https://example.com").is_ok());
    assert!(validate_app_name("https://www.bing.com").is_ok());
}

#[test]
fn test_valid_protocol_uris() {
    // GAP-R01（2026-10-25）：scheme 白名单校验条件收紧为含 `:` 即触发——
    // 旧条件 contains("://") 放行了 file:/vbscript:/mailto: 等一切不含 :// 的协议。
    // ms-settings: 是 APP_NAME_MAP「设置」项的显式白名单协议；mailto: 随收口被拒
    // （fail-closed：TS zod 层本就拒绝 `:` 与 `@`，open_application 语义为按名打开应用）。
    assert!(validate_app_name("ms-settings:").is_ok());
    assert!(validate_app_name("mailto:test@example.com").is_err());
}

#[test]
fn test_valid_unicode() {
    assert!(validate_app_name("记事本").is_ok());
    assert!(validate_app_name("计算器").is_ok());
    assert!(validate_app_name("テキストエディタ").is_ok());
}

// ============ 非法输入测试 ============

#[test]
fn test_empty_rejected() {
    assert!(validate_app_name("").is_err());
}

#[test]
fn test_shell_metachars_rejected() {
    let metachars: &[&str] = &[
        "calc&test",
        "calc|test",
        "calc>test",
        "calc<test",
        "calc^test",
        "calc(test)",
        "calc%test",
        "calc!test",
        "calc\ntest",
        "calc\rtest",
        "calc;test",
        "calc`test`",
        "calc$test",
        "calc test",
        "calc\ttest",
        "calc\"test",
    ];
    for &input in metachars {
        assert!(
            validate_app_name(input).is_err(),
            "应拒绝包含 shell 元字符的输入: {:?}",
            input
        );
    }
}

#[test]
fn test_disallowed_url_schemes_rejected() {
    assert!(validate_app_name("ftp://example.com").is_err());
    assert!(validate_app_name("javascript://alert(1)").is_err());
    assert!(validate_app_name("file:///etc/passwd").is_err());
    assert!(validate_app_name("data://text/html").is_err());
}

#[test]
fn test_command_injection_attempts() {
    let injections: &[&str] = &[
        "calc & del /f C:\\",
        "calc | format C:",
        "calc; rm -rf /",
        "calc\nwhoami",
        "calc`whoami`",
        "calc$(whoami)",
    ];
    for &input in injections {
        assert!(
            validate_app_name(input).is_err(),
            "应拒绝命令注入尝试: {:?}",
            input
        );
    }
}

// ============ 边界测试 ============

#[test]
fn test_long_valid_name() {
    let long_name = "a".repeat(255);
    assert!(validate_app_name(&long_name).is_ok());
}

#[test]
fn test_single_char() {
    assert!(validate_app_name("a").is_ok());
}

#[test]
fn test_url_with_query_ampersand_rejected() {
    // URL 中的 & 会被拒绝（cmd.exe 解析为命令分隔符）
    assert!(validate_app_name("https://example.com?a=1&b=2").is_err());
}
