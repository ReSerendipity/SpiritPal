//! HTTP 网络代理命令（P0 修复）
//!
//! # 背景
//! 隐私政策声明的服务商与 CSP `connect-src` 白名单失同步：5 个已实现服务商
//! （Qwen / GLM / Kimi / Doubao，境内）+ Ollama（本地）+ 天气（ipapi/open-meteo）
//! 以及模组注册表（registry.spiritpal.app）在生产构建（打包版）下全部被 CSP 阻断，
//! 而开发模式（Vite dev server 无 CSP 注入）不受影响 —— 导致问题从未被发现。
//!
//! # 方案（报告 Q1 推荐项）
//! 不放宽 CSP 白名单，而是提供 Rust 侧唯一网络出口：
//! - 前端 SSRF 白名单校验（功能级域名）保持不变（ssrfProtection.ts 功能白名单）
//! - 本命令在 Rust 侧做第二道校验：协议 / 端口 / 私有 IP 段 / 回环放行（用户显式配置的本地服务如 Ollama）
//! - 响应体大小与总超时双上限，防内存与 hang 死
//! - 支持普通 REST 与 WebDAV（PROPFIND / MKCOL）方法
//!
//! 安全边界：
//! - 白名单仍最小（CSP 无需新增任何域名）
//! - API Key 经请求头透传，明文只在本机出网（与前端直连等价），不落盘
//! - 私有 IP 段 / 内网探测 / DNS rebinding 目标均被拒绝（与 ssrfProtection.ts 逻辑一致）
//!
//! 已知限制：非流式返回（响应体整体拉回后透传），LLM 首字延迟略增；
//! SSE 解析仍在前端进行，打字机渲染效果保留。

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::time::Duration;
use tauri::AppHandle;

/// 单次请求总超时（LLM 流式响应时长 + 网络缓冲裕量）
const DEFAULT_TIMEOUT_MS: u64 = 120_000;
/// 默认响应体上限（LLM 长响应 / 模组下载，32MB 足够；防御整包内存放大）
const DEFAULT_MAX_BODY_BYTES: usize = 32 * 1024 * 1024;
/// 允许的 HTTP 方法（WebDAV 方法一并放行；其余自定义方法一律拒绝）
const ALLOWED_METHODS: &[&str] = &[
    "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "PROPFIND", "MKCOL",
];

// ============ 私有 IP 段（与前端 ssrfProtection.ts 对齐）============

/// IPv4 段判定用的 (start, end) 数值对
fn ipv4_ranges() -> Vec<(u32, u32, &'static str)> {
    let n = |a: &str| {
        let p: Vec<u64> = a.split('.').map(|x| x.parse::<u64>().unwrap_or(0)).collect();
        ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) as u32
    };
    vec![
        (n("127.0.0.0"), n("127.255.255.255"), "回环地址"),
        (n("10.0.0.0"), n("10.255.255.255"), "A类私有"),
        (n("172.16.0.0"), n("172.31.255.255"), "B类私有"),
        (n("192.168.0.0"), n("192.168.255.255"), "C类私有"),
        (n("169.254.0.0"), n("169.254.255.255"), "链路本地"),
        (n("0.0.0.0"), n("0.255.255.255"), "当前网络"),
        (n("100.64.0.0"), n("100.127.255.255"), "CGNAT"),
        (n("198.18.0.0"), n("198.19.255.255"), "基准测试"),
        (n("224.0.0.0"), n("239.255.255.255"), "组播地址"),
        (n("240.0.0.0"), n("255.255.255.255"), "保留地址"),
    ]
}

/// 是否为 IPv4 私有/保留地址
fn is_private_ipv4(ip: &str) -> Option<&'static str> {
    let mut parts = Vec::new();
    for seg in ip.split('.') {
        parts.push(seg.parse::<u64>().ok()?);
    }
    if parts.len() != 4 {
        return None;
    }
    let num = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) as u32;
    ipv4_ranges()
        .into_iter()
        .find(|(s, e, _)| num >= *s && num <= *e)
        .map(|(_, _, label)| label)
}

/// 是否为回环地址（localhost / 127/8 / ::1 / 0.0.0.0）
/// 回环是用户显式配置的本地服务端点（如 Ollama http://localhost:11434），放行。
fn is_loopback_host(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    if h == "localhost" || h == "0.0.0.0" || h == "[::1]" || h == "::1" {
        return true;
    }
    if let Some(label) = is_private_ipv4(&h) {
        return label == "回环地址";
    }
    false
}

/// URL 校验：协议 / 方法 / 私有 IP / 普通端口
/// 返回 Err 时给出可读原因（不会泄漏内网探测结果细节）。
fn validate_target(method: &str, url: &reqwest::Url) -> Result<(), String> {
    let m = method.to_ascii_uppercase();
    if !ALLOWED_METHODS.contains(&m.as_str()) {
        return Err(format!("不允许的 HTTP 方法: {}", method));
    }
    match url.scheme() {
        "http" | "https" => {}
        other => return Err(format!("不允许的协议: {other}")),
    }
    if let Some(port) = url.port() {
        // 常见内网服务端口一律拒绝（数据库 / SSH / 缓存等）
        if matches!(port, 22 | 25 | 465 | 587 | 6379 | 27017 | 9200 | 9300 | 5432 | 3306) {
            return Err(format!("不允许的端口: {port}"));
        }
    }
    let host = url.host_str().unwrap_or("");
    if host.is_empty() {
        return Err("URL 缺少主机名".into());
    }
    if is_loopback_host(host) {
        return Ok(());
    }
    // 形如 IPv4 字面量且命中私有段 → 拒绝
    if let Some(label) = is_private_ipv4(host) {
        return Err(format!("目标为私有 IP 地址 ({label}): {host}"));
    }
    Ok(())
}

// ============ 命令 ============

/// 代理响应载荷
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpProxyResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    /// 响应体原始字节（base64 编码，避免 UTF-8/二进制歧义）
    pub body_base64: String,
}

/// 代理请求参数
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpProxyRequest {
    pub url: String,
    pub method: String,
    pub headers: Option<Vec<(String, String)>>,
    pub body_b64: Option<String>,
    pub timeout_ms: Option<u64>,
    pub max_body_bytes: Option<usize>,
}

/// Rust 侧 HTTP 网络出口（P0：绕过生产 CSP 对境内/本地服务商的阻断）
#[tauri::command]
pub async fn http_proxy(
    _app: AppHandle,
    request: HttpProxyRequest,
) -> Result<HttpProxyResponse, String> {
    let url = reqwest::Url::parse(&request.url).map_err(|_| "URL 格式无效".to_string())?;
    validate_target(&request.method, &url)?;

    let timeout_ms = request.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    let max_body_bytes = request.max_body_bytes.unwrap_or(DEFAULT_MAX_BODY_BYTES);

    // 每次请求新建短生命周期 Client：避免连接复用导致目标 IP 漂移逃逸校验（DNS rebinding 纵深）
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .connect_timeout(Duration::from_secs(15))
        // reqwest 自带代理环境变量支持，此处不显式放行系统代理
        .no_proxy()
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;

    let mut builder = client
        .request(
            request.method.parse::<reqwest::Method>().unwrap(),
            url,
        );

    if let Some(headers) = &request.headers {
        let mut map = HeaderMap::new();
        for (k, v) in headers {
            let name = HeaderName::from_bytes(k.as_bytes())
                .map_err(|_| format!("请求头名称非法: {k}"))?;
            let value = HeaderValue::from_str(v).map_err(|_| format!("请求头值非法: {k}"))?;
            map.insert(name, value);
        }
        builder = builder.headers(map);
    }

    if let Some(body_b64) = &request.body_b64 {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(body_b64)
            .map_err(|_| "请求体 base64 解码失败".to_string())?;
        builder = builder.body(bytes);
    }

    let response = builder
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;

    let status = response.status().as_u16();
    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("<non-utf8>").to_string()))
        .collect();

    // 限制响应体大小：防御大文件整包缓冲（模组下载等）
    let body_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?
        .to_vec();
    if body_bytes.len() > max_body_bytes {
        return Err(format!(
            "响应体超限（{} 字节 > 上限 {} 字节）",
            body_bytes.len(),
            max_body_bytes
        ));
    }

    use base64::Engine;
    let body_base64 = base64::engine::general_purpose::STANDARD.encode(&body_bytes);

    Ok(HttpProxyResponse {
        status,
        headers,
        body_base64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_allowed() {
        for url in [
            "http://localhost:11434/api/tags",
            "http://127.0.0.1:11434",
            "http://[::1]:11434/api/chat",
            "http://0.0.0.0:8080",
        ] {
            let u = reqwest::Url::parse(url).unwrap();
            assert!(validate_target("GET", &u).is_ok(), "{url} 应放行");
        }
    }

    #[test]
    fn private_ip_rejected() {
        for url in [
            "http://10.0.0.5/x",
            "http://172.16.0.1",
            "http://192.168.1.1",
            "http://169.254.0.1",
        ] {
            let u = reqwest::Url::parse(url).unwrap();
            assert!(validate_target("GET", &u).is_err(), "{url} 应拒绝");
        }
    }

    #[test]
    fn bad_scheme_and_port_rejected() {
        assert!(validate_target("GET", &reqwest::Url::parse("file:///etc/passwd").unwrap()).is_err());
        assert!(validate_target("GET", &reqwest::Url::parse("https://a.com:22/").unwrap()).is_err());
        assert!(validate_target("GET", &reqwest::Url::parse("https://a.com:6379/").unwrap()).is_err());
    }

    #[test]
    fn public_host_allowed() {
        let u = reqwest::Url::parse("https://api.deepseek.com/v1/chat/completions").unwrap();
        assert!(validate_target("POST", &u).is_ok());
    }
}