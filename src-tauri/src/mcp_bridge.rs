//! MCP 命令桥 · Tauri 应用粘合层
//!
//! 在应用进程内宿主 `spiritpal-mcp` 的 bridge 服务器（默认 127.0.0.1:3124），
//! 把外部 Agent 的工具调用桥到 webview：Rust 收到 `/mcp/call` → 向 webview 发
//! `mcp://request` 事件 → webview 执行 `executeMcpTool` → 调用 `mcp_respond`
//! 命令把结果回填给挂起的 HTTP 请求，最终返回给外部 Agent。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use spiritpal_mcp::run_bridge_server_auth;

type Pending = HashMap<String, mpsc::Sender<String>>;

// 挂起请求表：id → 该 HTTP 连接的响应发送端
static PENDING: std::sync::OnceLock<Arc<Mutex<Pending>>> = std::sync::OnceLock::new();
fn pending() -> &'static Arc<Mutex<Pending>> {
    PENDING.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 生成一次性本地 Token（SHA-256 摘要）
///
/// pub：memory_sidecar 复用同一派生逻辑（token 生成单点维护，M0 加固）。
pub fn gen_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let src = format!(
        "{}-{}-{}",
        std::process::id(),
        nanos,
        NEXT_ID.fetch_add(1, Ordering::SeqCst)
    );
    to_hex(&Sha256::digest(src.as_bytes()))
}

/// 启动 MCP 命令桥（阻塞线程；在 app setup 中调用）
pub fn spawn(app: &AppHandle) {
    // M3 加固：端口冲突降级。默认 127.0.0.1:3124 被占用（多实例/其他程序）时
    // 回退到随机可用端口，避免 bridge 线程静默死亡（此前 bind 失败被 `let _ =` 吞掉）。
    let wanted_addr =
        std::env::var("SPIRITPAL_MCP_BRIDGE_ADDR").unwrap_or_else(|_| "127.0.0.1:3124".to_string());
    let (addr, port_fallback) = match std::net::TcpListener::bind(&wanted_addr) {
        Ok(_) => (wanted_addr, false), // 端口空闲，直接使用
        Err(_) => match std::net::TcpListener::bind("127.0.0.1:0") {
            Ok(l) => (
                l.local_addr().map(|a| a.to_string()).unwrap_or(wanted_addr),
                true,
            ),
            Err(_) => (wanted_addr, true), // 随机端口也失败：仍尝试原地址，由监视线程记录
        },
    };

    // 生成并透出本地 Token：`spiritpal-mcp` 转发端需通过环境变量使用
    let token = gen_token();
    std::env::set_var("SPIRITPAL_MCP_BRIDGE_TOKEN", &token);
    // 若配置了 token 文件路径，则落盘供外部 agent 读取。
    // M0 加固：Unix 下以 0o600 写入，防止同机其他用户读取 token。
    if let Ok(token_file) = std::env::var("SPIRITPAL_MCP_TOKEN_FILE") {
        #[cfg(unix)]
        {
            use std::io::Write;
            use std::os::unix::fs::OpenOptionsExt;
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(&token_file)
            {
                let _ = f.write_all(token.as_bytes());
            }
        }
        #[cfg(not(unix))]
        {
            let _ = std::fs::write(&token_file, &token);
        }
    }
    // 实际监听地址透出给转发端（环境变量被覆盖后，spiritpal-mcp 的 bridge_addr()
    // 读到的就是真实端口；token 文件场景由 agent 侧按需读取）。
    std::env::set_var("SPIRITPAL_MCP_BRIDGE_ADDR", &addr);
    // M0 加固：不在 stdout 明文打印 token（同机进程可读 stdout/日志）。
    if port_fallback {
        println!("[MCP] command bridge: 3124 被占用，已降级监听 {addr}");
    } else {
        println!("[MCP] command bridge listening on {addr}");
    }

    let app = app.clone();
    std::thread::spawn(move || {
        let _ = run_bridge_server_auth(&addr, token, move |tool, args| {
            let id = format!(
                "mcp-{}-{:016x}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::SeqCst)
            );
            let (tx, rx) = mpsc::channel::<String>();
            pending().lock().unwrap().insert(id.clone(), tx);
            let posted = app.emit(
                "mcp://request",
                json!({ "id": id, "tool": tool, "arguments": args }),
            );
            if posted.is_err() {
                pending().lock().unwrap().remove(&id);
                return r#"{"error":"emit to webview failed"}"#.to_string();
            }
            // 等待 webview 通过 mcp_respond 回调；超时返回诚实错误
            match rx.recv_timeout(Duration::from_secs(10)) {
                Ok(reply) => reply,
                Err(_) => {
                    // 超时后必须从 PENDING 中移除挂起条目，防止内存泄漏。
                    // 不移除会导致 id→sender 永久残留在 HashMap 中（sender 已 drop 但条目不清理）。
                    pending().lock().unwrap().remove(&id);
                    r#"{"error":"webview response timeout"}"#.to_string()
                }
            }
        });
    });
}

/// webview 回调：完成挂起的 MCP 工具调用（由 `executeMcpTool` 结果触发）
///
/// D-9：校验调用方窗口必须是应用窗口（拒绝冷启动/外部 WebView 伪造回包）。
/// 门禁失败返回 `false`（保持 bool 契约不变，前端按「未完成」处理）。
#[tauri::command]
pub fn mcp_respond(window: tauri::Window, id: String, result: String) -> bool {
    if let Err(e) = crate::window_gate::require_window(&window, crate::window_gate::APP_WINDOWS) {
        let _ = crate::audit_log::record_audit(
            window.app_handle(),
            "security_event",
            "unknown",
            &format!("mcp_respond 拒绝: {e}"),
        );
        return false;
    }
    mcp_respond_core(id, result)
}

/// 核心：回填挂起的 MCP 工具调用（无门禁；门禁由命令层负责，便于单测）
fn mcp_respond_core(id: String, result: String) -> bool {
    let sender = pending().lock().unwrap().remove(&id);
    match sender {
        Some(tx) => tx.send(result).is_ok(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gen_token_is_unique_hex() {
        let a = gen_token();
        let b = gen_token();
        // SHA-256 hex = 64 字符
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        // 每次调用生成不同 Token
        assert_ne!(a, b);
    }

    #[test]
    fn mcp_respond_delivers_result_to_pending() {
        let (tx, rx) = mpsc::channel::<String>();
        let id = "mcp-test-deliver".to_string();
        pending().lock().unwrap().insert(id.clone(), tx);
        assert!(mcp_respond_core(id.clone(), "reply-ok".to_string()));
        assert_eq!(rx.recv_timeout(Duration::from_secs(1)).unwrap(), "reply-ok");
        // 响应后挂起条目已被移除
        assert!(pending().lock().unwrap().get(&id).is_none());
    }

    #[test]
    fn mcp_respond_unknown_id_returns_false() {
        assert!(!mcp_respond_core(
            "mcp-no-such-id".to_string(),
            "x".to_string()
        ));
    }

    #[test]
    fn mcp_respond_dropped_channel_returns_false() {
        // sender 已 drop（接收端丢弃）时，send 失败应返回 false
        let (tx, _rx) = mpsc::channel::<String>();
        drop(_rx);
        let id = "mcp-test-dropped".to_string();
        pending().lock().unwrap().insert(id.clone(), tx);
        assert!(!mcp_respond_core(id, "x".to_string()));
    }
}
