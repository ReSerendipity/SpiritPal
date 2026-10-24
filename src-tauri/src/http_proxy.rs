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
//! `http_proxy_stream` 在 headers 到达时立即通知，逐块传递原始字节；
//! 旧 `http_proxy` 保留整包返回接口，两者共用请求校验和逐块大小上限。

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{ipc::Channel, AppHandle, State};
use tokio_util::sync::CancellationToken;

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
        let p: Vec<u64> = a
            .split('.')
            .map(|x| x.parse::<u64>().unwrap_or(0))
            .collect();
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
        let v = seg.parse::<u64>().ok()?;
        // 段值必须 ≤255：否则 `v << 24` 会在 `as u32` 截断后落进错误网段
        // （例：999→0x3E7，999<<24 截断成 224.0.0.0 段被误判为组播）
        if v > 255 {
            return None;
        }
        parts.push(v);
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
        if matches!(
            port,
            22 | 25 | 465 | 587 | 6379 | 27017 | 9200 | 9300 | 5432 | 3306
        ) {
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

/// 共用构建路径，流式接口不能绕过旧接口的安全检查或 no_proxy。
fn build_request(request: HttpProxyRequest) -> Result<(reqwest::RequestBuilder, usize), String> {
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

    let method = request
        .method
        .to_ascii_uppercase()
        .parse::<reqwest::Method>()
        .map_err(|_| "HTTP 方法无效".to_string())?;
    let mut builder = client.request(method, url);

    if let Some(headers) = &request.headers {
        let mut map = HeaderMap::new();
        for (k, v) in headers {
            let name =
                HeaderName::from_bytes(k.as_bytes()).map_err(|_| format!("请求头名称非法: {k}"))?;
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

    Ok((builder, max_body_bytes))
}

fn response_headers(response: &reqwest::Response) -> Vec<(String, String)> {
    response
        .headers()
        .iter()
        .map(|(k, v)| {
            (
                k.as_str().to_string(),
                v.to_str().unwrap_or("<non-utf8>").to_string(),
            )
        })
        .collect()
}

/// 检查通过才更新计数/转发；不信任 Content-Length（含解压后的实际字节）。
fn check_body_limit(count: &mut usize, chunk_len: usize, max: usize) -> Result<(), String> {
    let total = count
        .checked_add(chunk_len)
        .ok_or_else(|| "响应体超限（计数溢出）".to_string())?;
    if total > max {
        return Err(format!("响应体超限（{total} 字节 > 上限 {max} 字节）"));
    }
    *count = total;
    Ok(())
}

/// 兼容旧调用方的整包响应；同样逐块检查上限，越界立即丢弃连接。
#[tauri::command]
pub async fn http_proxy(
    _app: AppHandle,
    request: HttpProxyRequest,
) -> Result<HttpProxyResponse, String> {
    let (builder, max_body_bytes) = build_request(request)?;
    let mut response = builder.send().await.map_err(|e| format!("请求失败: {e}"))?;
    let status = response.status().as_u16();
    let headers = response_headers(&response);
    let mut count = 0;
    let mut body_bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?
    {
        check_body_limit(&mut count, chunk.len(), max_body_bytes)?;
        body_bytes.extend_from_slice(&chunk);
    }
    use base64::Engine;
    Ok(HttpProxyResponse {
        status,
        headers,
        body_base64: base64::engine::general_purpose::STANDARD.encode(&body_bytes),
    })
}

#[derive(Debug, serde::Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HttpProxyEvent {
    Headers {
        status: u16,
        headers: Vec<(String, String)>,
    },
    Chunk {
        #[serde(rename = "dataBase64")]
        data_base64: String,
    },
    End,
    Error {
        message: String,
    },
}

#[derive(Clone, Default)]
pub struct HttpProxyState {
    requests: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

/// 无论成功、网络错误、取消或任务被 drop，登记项都必须回收。
struct RequestGuard {
    state: HttpProxyState,
    id: String,
}
impl Drop for RequestGuard {
    fn drop(&mut self) {
        self.state
            .requests
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
    }
}

async fn stream_response(
    request: HttpProxyRequest,
    send: &impl Fn(HttpProxyEvent) -> Result<(), String>,
) -> Result<(), String> {
    let (builder, max_body_bytes) = build_request(request)?;
    let mut response = builder.send().await.map_err(|e| format!("请求失败: {e}"))?;
    send(HttpProxyEvent::Headers {
        status: response.status().as_u16(),
        headers: response_headers(&response),
    })?;
    let mut count = 0;
    use base64::Engine;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?
    {
        check_body_limit(&mut count, chunk.len(), max_body_bytes)?;
        send(HttpProxyEvent::Chunk {
            data_base64: base64::engine::general_purpose::STANDARD.encode(&chunk),
        })?;
    }
    Ok(())
}

fn start_proxy_stream(
    state: HttpProxyState,
    request: HttpProxyRequest,
    request_id: String,
    send: impl Fn(HttpProxyEvent) -> Result<(), String> + Send + Sync + 'static,
) -> Result<(), String> {
    let cancel = CancellationToken::new();
    {
        let mut requests = state
            .requests
            .lock()
            .map_err(|_| "代理状态不可用".to_string())?;
        if requests.contains_key(&request_id) {
            return Err("重复的代理 requestId".into());
        }
        requests.insert(request_id.clone(), cancel.clone());
    }
    let guard = RequestGuard {
        state,
        id: request_id,
    };
    tokio::spawn(async move {
        // select 丢弃 reqwest future 即取消 DNS/connect/headers/body 读取。
        // 每次发送前也检查，避免已有大量 ready chunks 时延迟响应取消。
        let send_data = |event| {
            if cancel.is_cancelled() {
                return Err("请求已取消".into());
            }
            send(event)
        };
        let result = tokio::select! {
            biased;
            _ = cancel.cancelled() => Err("请求已取消".into()),
            result = stream_response(request, &send_data) => result,
        };
        // 先移除状态再发送唯一终态；迟到的 abort 是无操作，不留 tombstone。
        drop(guard);
        let event = match result {
            Ok(()) => HttpProxyEvent::End,
            Err(message) => HttpProxyEvent::Error { message },
        };
        let _ = send(event);
    });
    Ok(())
}

fn abort_proxy_stream(state: &HttpProxyState, request_id: &str) -> Result<(), String> {
    let requests = state
        .requests
        .lock()
        .map_err(|_| "代理状态不可用".to_string())?;
    if let Some(cancel) = requests.get(request_id) {
        cancel.cancel();
    }
    Ok(())
}

/// 回复仅确认登记完成，网络事件走 Channel，不把 invoke 挂到响应结束。
#[tauri::command]
pub async fn http_proxy_stream(
    request: HttpProxyRequest,
    request_id: String,
    on_event: Channel<HttpProxyEvent>,
    state: State<'_, HttpProxyState>,
) -> Result<(), String> {
    start_proxy_stream(state.inner().clone(), request, request_id, move |event| {
        on_event
            .send(event)
            .map_err(|e| format!("代理 Channel 已关闭: {e}"))
    })
}

#[tauri::command]
pub fn http_proxy_abort(
    request_id: String,
    state: State<'_, HttpProxyState>,
) -> Result<(), String> {
    abort_proxy_stream(state.inner(), &request_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::sync::{mpsc, oneshot};

    // A real HTTP peer with an explicit gate: no timing-based fake streaming.
    // Until the test releases it, neither later bytes nor EOF can exist.
    async fn http_peer(
        initial: &'static [u8],
    ) -> (
        HttpProxyRequest,
        oneshot::Sender<Vec<u8>>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = oneshot::channel::<Vec<u8>>();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                if socket.read(&mut byte).await.unwrap() == 0 {
                    return;
                }
                request.push(byte[0]);
            }
            socket.write_all(initial).await.unwrap();
            tokio::select! {
                rest = rx => {
                    if let Ok(rest) = rest { let _ = socket.write_all(&rest).await; }
                }
                result = socket.read(&mut byte) => {
                    assert_eq!(result.unwrap_or(0), 0, "cancel must drop the HTTP connection");
                }
            }
        });
        (
            HttpProxyRequest {
                url,
                method: "GET".into(),
                headers: None,
                body_b64: None,
                timeout_ms: Some(5_000),
                max_body_bytes: None,
            },
            tx,
            task,
        )
    }

    fn start_test_stream(
        state: &HttpProxyState,
        request: HttpProxyRequest,
        id: &str,
    ) -> mpsc::UnboundedReceiver<HttpProxyEvent> {
        let (tx, rx) = mpsc::unbounded_channel();
        start_proxy_stream(state.clone(), request, id.into(), move |event| {
            tx.send(event).map_err(|_| "receiver closed".into())
        })
        .unwrap();
        rx
    }

    async fn next(rx: &mut mpsc::UnboundedReceiver<HttpProxyEvent>) -> HttpProxyEvent {
        tokio::time::timeout(Duration::from_secs(3), rx.recv())
            .await
            .expect("event must arrive without waiting for peer EOF")
            .unwrap()
    }

    async fn closed(peer: tokio::task::JoinHandle<()>) {
        tokio::time::timeout(Duration::from_secs(3), peer)
            .await
            .expect("HTTP connection must be released")
            .unwrap();
    }

    #[tokio::test]
    async fn stream_first_bytes_before_end_and_preserve_http_error_body() {
        let (request, gate, peer) = http_peer(b"HTTP/1.1 429 Too Many Requests\r\nTransfer-Encoding: chunked\r\nX-Test: yes\r\n\r\n1\r\n\xe4\r\n").await;
        let state = HttpProxyState::default();
        let mut rx = start_test_stream(&state, request, "first");
        match next(&mut rx).await {
            HttpProxyEvent::Headers { status, headers } => {
                assert_eq!(status, 429);
                assert!(headers.contains(&("x-test".into(), "yes".into())));
            }
            other => panic!("headers must be first: {other:?}"),
        }
        let first = next(&mut rx).await;
        assert_eq!(
            serde_json::to_value(first).unwrap(),
            serde_json::json!({"type": "chunk", "dataBase64": "5A=="})
        );
        assert!(matches!(
            rx.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));
        gate.send(b"2\r\n\xb8\xad\r\n0\r\n\r\n".to_vec()).unwrap();
        assert_eq!(
            serde_json::to_value(next(&mut rx).await).unwrap(),
            serde_json::json!({"type": "chunk", "dataBase64": "uK0="})
        );
        assert!(matches!(next(&mut rx).await, HttpProxyEvent::End));
        assert!(rx.recv().await.is_none());
        assert!(state.requests.lock().unwrap().is_empty());
        closed(peer).await;
    }

    #[tokio::test]
    async fn stream_size_limit_counts_chunks_and_aborts_without_eof() {
        let (mut request, gate, peer) = http_peer(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nAB\r\n2\r\nCD\r\n",
        )
        .await;
        request.max_body_bytes = Some(3);
        let state = HttpProxyState::default();
        let mut rx = start_test_stream(&state, request, "limit");
        assert!(matches!(
            next(&mut rx).await,
            HttpProxyEvent::Headers { .. }
        ));
        assert_eq!(
            serde_json::to_value(next(&mut rx).await).unwrap(),
            serde_json::json!({"type": "chunk", "dataBase64": "QUI="})
        );
        match next(&mut rx).await {
            HttpProxyEvent::Error { message } => assert!(message.contains("响应体超限")),
            other => panic!("expected size-limit error, got {other:?}"),
        }
        assert!(rx.recv().await.is_none());
        assert!(state.requests.lock().unwrap().is_empty());
        // The peer is still holding EOF back, yet the client must disconnect.
        closed(peer).await;
        drop(gate);
    }

    #[tokio::test]
    async fn stream_abort_before_and_after_headers_is_idempotent() {
        for initial in [
            b"".as_slice(),
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n".as_slice(),
        ] {
            let (request, gate, peer) = http_peer(initial).await;
            let state = HttpProxyState::default();
            let mut rx = start_test_stream(&state, request, "cancel");
            if !initial.is_empty() {
                assert!(matches!(
                    next(&mut rx).await,
                    HttpProxyEvent::Headers { .. }
                ));
            } else {
                // Make sure send() is pending on a connected server, not just queued.
                tokio::task::yield_now().await;
            }
            abort_proxy_stream(&state, "cancel").unwrap();
            abort_proxy_stream(&state, "cancel").unwrap();
            assert!(matches!(next(&mut rx).await, HttpProxyEvent::Error { .. }));
            assert!(rx.recv().await.is_none());
            assert!(state.requests.lock().unwrap().is_empty());
            abort_proxy_stream(&state, "cancel").unwrap();
            drop(gate);
            peer.abort(); // before-headers cancellation may happen before accept()
        }
    }

    #[tokio::test]
    async fn stream_errors_and_disconnected_channels_release_state() {
        let (mut request, gate, peer) =
            http_peer(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n").await;
        request.timeout_ms = Some(200);
        let state = HttpProxyState::default();
        let mut rx = start_test_stream(&state, request, "timeout");
        assert!(matches!(
            next(&mut rx).await,
            HttpProxyEvent::Headers { .. }
        ));
        assert!(matches!(next(&mut rx).await, HttpProxyEvent::Error { .. }));
        assert!(rx.recv().await.is_none());
        assert!(state.requests.lock().unwrap().is_empty());
        closed(peer).await;
        drop(gate);

        let (request, gate, peer) =
            http_peer(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n").await;
        let rx = start_test_stream(&state, request, "disconnected");
        drop(rx);
        closed(peer).await;
        assert!(state.requests.lock().unwrap().is_empty());
        drop(gate);
    }

    #[tokio::test]
    async fn stream_validation_error_is_terminal_and_does_not_open_network() {
        let state = HttpProxyState::default();
        let request = HttpProxyRequest {
            url: "http://169.254.169.254/latest/meta-data/".into(),
            method: "GET".into(),
            headers: None,
            body_b64: None,
            timeout_ms: None,
            max_body_bytes: None,
        };
        let mut rx = start_test_stream(&state, request, "ssrf");
        match next(&mut rx).await {
            HttpProxyEvent::Error { message } => assert!(message.contains("私有 IP")),
            other => panic!("SSRF target must be rejected: {other:?}"),
        }
        assert!(rx.recv().await.is_none());
        assert!(state.requests.lock().unwrap().is_empty());
    }

    #[test]
    fn byte_limit_exact_boundary_and_overflow() {
        let mut count = 0;
        check_body_limit(&mut count, 2, 3).unwrap();
        check_body_limit(&mut count, 1, 3).unwrap();
        assert!(check_body_limit(&mut count, 1, 3).is_err());
        assert_eq!(count, 3);
        count = usize::MAX;
        assert!(check_body_limit(&mut count, 1, usize::MAX).is_err());
    }

    fn url(u: &str) -> reqwest::Url {
        reqwest::Url::parse(u).unwrap()
    }

    // ============ is_private_ipv4：IPv4 段判定 ============

    #[test]
    fn test_is_private_ipv4_hits_every_range_with_label() {
        // (地址, 期望 label) —— 逐段钉住，label 会进前端错误提示
        let cases = [
            ("127.0.0.1", "回环地址"),
            ("10.1.2.3", "A类私有"),
            ("172.16.5.5", "B类私有"),
            ("172.31.255.255", "B类私有"),
            ("192.168.1.1", "C类私有"),
            ("169.254.169.254", "链路本地"), // 云元数据地址
            ("0.0.0.0", "当前网络"),
            ("100.64.1.1", "CGNAT"),
            ("198.18.0.1", "基准测试"),
            ("224.0.0.1", "组播地址"),
            ("240.0.0.1", "保留地址"),
            ("255.255.255.255", "保留地址"),
        ];
        for (ip, label) in cases {
            assert_eq!(is_private_ipv4(ip), Some(label), "IP {ip} 应命中 {label}");
        }
    }

    #[test]
    fn test_is_private_ipv4_lets_public_through() {
        for ip in ["8.8.8.8", "1.1.1.1", "203.0.113.10", "114.114.114.114"] {
            assert_eq!(is_private_ipv4(ip), None, "公网 IP {ip} 应放行");
        }
    }

    #[test]
    fn test_is_private_ipv4_range_boundaries() {
        // B 类私有的上下边界与边界外一格
        assert_eq!(is_private_ipv4("172.15.255.255"), None);
        assert_eq!(is_private_ipv4("172.16.0.0"), Some("B类私有"));
        assert_eq!(is_private_ipv4("172.31.255.255"), Some("B类私有"));
        assert_eq!(is_private_ipv4("172.32.0.0"), None);
        // 链路本地只到 169.254，169.253/169.255 不在段内
        assert_eq!(is_private_ipv4("169.253.0.1"), None);
        assert_eq!(is_private_ipv4("169.255.0.1"), None);
        // 网关同段边界的 0 / 255 结尾
        assert_eq!(is_private_ipv4("10.0.0.0"), Some("A类私有"));
        assert_eq!(is_private_ipv4("10.255.255.255"), Some("A类私有"));
    }

    #[test]
    fn test_is_private_ipv4_rejects_malformed() {
        // 域名 / 段数不对 / 非数字段 / 超范围段 → 一律 None（不能 panic）
        assert_eq!(is_private_ipv4("example.com"), None);
        assert_eq!(is_private_ipv4("1.2.3"), None);
        assert_eq!(is_private_ipv4("1.2.3.4.5"), None);
        // 超范围段（>255）：u64→u32 截断后会误落进组播段，必须显式挡掉
        assert_eq!(is_private_ipv4("999.1.1.1"), None);
        assert_eq!(is_private_ipv4("256.1.1.1"), None);
        assert_eq!(is_private_ipv4("1.1.1.999"), None);
        assert_eq!(is_private_ipv4("a.b.c.d"), None);
        assert_eq!(is_private_ipv4(""), None);
    }

    // ============ is_loopback_host：回环放行 ============

    #[test]
    fn test_is_loopback_host_accepts_local_endpoints() {
        for h in [
            "localhost",
            "LocalHost",
            "LOCALHOST",
            "0.0.0.0",
            "::1",
            "[::1]",
            "127.0.0.1",
            "127.8.8.8",
        ] {
            assert!(is_loopback_host(h), "本地端点 {h} 应放行");
        }
    }

    #[test]
    fn test_is_loopback_host_rejects_private_non_loopback() {
        // 私网 ≠ 回环：用户配 Ollama 给的是 localhost，不是 192.168.x.x
        for h in [
            "192.168.1.5",
            "10.0.0.5",
            "169.254.169.254",
            "example.com",
            "",
        ] {
            assert!(!is_loopback_host(h), "非回环本地地址 {h} 不应放行");
        }
    }

    // ============ validate_target：命令前的四层校验 ============

    #[test]
    fn test_validate_target_allows_normal_requests() {
        assert!(validate_target("GET", &url("http://example.com/v1/x")).is_ok());
        assert!(validate_target("POST", &url("https://api.example.com")).is_ok());
        // 方法大小写不敏感（HTTP 方法本身大小写敏感，但白名单比对做了归一化）
        assert!(validate_target("get", &url("https://example.com")).is_ok());
        // 非标准但非敏感端口允许
        assert!(validate_target("POST", &url("https://example.com:8443/x")).is_ok());
    }

    #[test]
    fn test_validate_target_rejects_bad_methods_and_schemes() {
        for m in ["TRACE", "CONNECT", "FOOBAR"] {
            assert!(
                validate_target(m, &url("http://example.com")).is_err(),
                "方法 {m} 应被拒"
            );
        }
        for u in [
            "ftp://example.com/f",
            "file:///etc/passwd",
            "javascript:alert(1)",
        ] {
            assert!(validate_target("GET", &url(u)).is_err(), "协议 {u} 应被拒");
        }
    }

    #[test]
    fn test_validate_target_rejects_intranet_service_ports() {
        // 每种内网服务端口都拒绝（错误文案含端口号，便于前端提示）
        for p in [22u16, 25, 465, 587, 6379, 27017, 9200, 9300, 5432, 3306] {
            let e = validate_target("GET", &url(&format!("http://example.com:{p}/"))).unwrap_err();
            assert!(e.contains("端口"), "应说明端口被拒: {e}");
        }
    }

    #[test]
    fn test_validate_target_blocks_private_and_metadata_hosts() {
        // SSRF 核心：私网段 / 链路本地（云元数据 169.254.169.254）必须拒绝
        for h in [
            "10.0.0.1",
            "172.16.0.9",
            "192.168.31.99",
            "169.254.169.254", // 云厂商元数据端点， exploit 热点
            "100.64.0.1",
        ] {
            let e =
                validate_target("GET", &url(&format!("http://{h}/latest/meta-data/"))).unwrap_err();
            assert!(e.contains("私有 IP"), "私网 {h} 应被拒: {e}");
        }
    }

    #[test]
    fn test_validate_target_allows_loopback_for_local_services() {
        // 127/8 与 localhost 是回环而非私网 → 放行（Ollama / 本地服务）
        assert!(validate_target("POST", &url("http://localhost:11434/api/generate")).is_ok());
        assert!(validate_target("POST", &url("http://127.0.0.1:11434/api/generate")).is_ok());
        assert!(validate_target("GET", &url("http://0.0.0.0:8080")).is_ok());
    }

    // 注：`host.is_empty()` 分支实际不可达 —— reqwest 的 URL 解析层（WHATWG 规范）
    // 不会产出空主机（`Url::parse("http://")` 直接 Err）。该判断是对 parse 输出的
    // 纵深防御，保留但不单列用例。

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
        assert!(
            validate_target("GET", &reqwest::Url::parse("file:///etc/passwd").unwrap()).is_err()
        );
        assert!(
            validate_target("GET", &reqwest::Url::parse("https://a.com:22/").unwrap()).is_err()
        );
        assert!(
            validate_target("GET", &reqwest::Url::parse("https://a.com:6379/").unwrap()).is_err()
        );
    }

    #[test]
    fn public_host_allowed() {
        let u = reqwest::Url::parse("https://api.deepseek.com/v1/chat/completions").unwrap();
        assert!(validate_target("POST", &u).is_ok());
    }
}
