//! 系统 Keychain 加密存储模块（API Key 等敏感数据）
//!
//! [REFACTOR] 从 lib.rs 拆分，职责单一化
//!
//! # 功能
//! 使用 `keyring` crate 将敏感数据存储到系统 Keychain：
//! - Windows: Credential Manager
//! - macOS:   Keychain
//! - Linux:   Secret Service (GNOME Keyring / KWallet)
//!
//! # 存储约定
//! - service name 统一为 `"SpiritPal"`
//! - account 为传入的 key 参数
//! - 前端通过 `secureStorage.ts` 封装调用，key 格式：`api-key-${providerId}`
//!
//! # 提供的 Tauri 命令
//! - [`set_secret`] — 存储敏感值到系统 Keychain
//! - [`get_secret`] — 从系统 Keychain 读取敏感值
//! - [`delete_secret`] — 从系统 Keychain 删除敏感值
//!
//! # 可测性设计（2026-09-04 整改，P1-4）
//! 密钥访问抽象为 [`SecretStore`] trait：生产使用 [`SystemKeychainStore`]（真实 keyring），
//! 单元测试使用内存实现，避免触碰真实系统凭据。业务逻辑抽为 `*_inner` 纯函数，
//! 命令只负责 spawn_blocking 包装，便于脱离 tauri 运行时单测。

use std::sync::Arc;

// ============ 密钥存储抽象 ============

/// 密钥存储接口：默认实现使用系统 Keychain（keyring crate），
/// 测试时可替换为内存实现，避免触碰真实系统凭据。
///
/// `Send + Sync`：实现需可跨线程共享（命令在 spawn_blocking 中调用，
/// 全局 store 存于 static OnceLock，要求 Sync）。
pub(crate) trait SecretStore: Send + Sync + 'static {
    /// 存储敏感值；失败返回错误信息
    fn set_password(&self, key: &str, value: &str) -> Result<(), String>;
    /// 读取敏感值；不存在返回 None
    fn get_password(&self, key: &str) -> Result<Option<String>, String>;
    /// 删除敏感值；不存在视为成功（幂等）
    fn delete_credential(&self, key: &str) -> Result<(), String>;
}

/// 默认实现：系统 Keychain（keyring crate）
struct SystemKeychainStore;

impl SecretStore for SystemKeychainStore {
    fn set_password(&self, key: &str, value: &str) -> Result<(), String> {
        // R-12 v2.0: obfstr 混淆 service 名
        let entry =
            keyring::Entry::new(obfstr::obfstr!("SpiritPal"), key).map_err(|e| e.to_string())?;
        entry.set_password(value).map_err(|e| e.to_string())
    }

    fn get_password(&self, key: &str) -> Result<Option<String>, String> {
        let entry =
            keyring::Entry::new(obfstr::obfstr!("SpiritPal"), key).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn delete_credential(&self, key: &str) -> Result<(), String> {
        let entry =
            keyring::Entry::new(obfstr::obfstr!("SpiritPal"), key).map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// 全局 store（默认系统 Keychain；测试注入内存实现）
static STORE: std::sync::OnceLock<Arc<dyn SecretStore>> = std::sync::OnceLock::new();

fn store() -> Arc<dyn SecretStore> {
    STORE
        .get_or_init(|| Arc::new(SystemKeychainStore))
        .clone()
}

// ============ 业务逻辑（可脱离 tauri 运行时单测） ============

/// 将敏感值存储到系统 Keychain
fn set_secret_inner(store: &dyn SecretStore, key: &str, value: &str) -> Result<(), String> {
    store.set_password(key, value)
}

/// 从系统 Keychain 读取敏感值，不存在时返回 None
fn get_secret_inner(store: &dyn SecretStore, key: &str) -> Result<Option<String>, String> {
    store.get_password(key)
}

/// 从系统 Keychain 删除敏感值，键不存在时视为成功（幂等）
fn delete_secret_inner(store: &dyn SecretStore, key: &str) -> Result<(), String> {
    store.delete_credential(key)
}

// ============ Tauri 命令 ============

/// 将敏感值存储到系统 Keychain
///
/// 使用 `spawn_blocking` 避免 keyring 操作阻塞 IPC 线程。
///
/// 前端调用方式：`invoke('set_secret', { key: string, value: string })`
///
/// # Arguments
/// - `key` — 键名，如 `"api-key-openai"`
/// - `value` — 待存储的敏感值（如 API Key）
///
/// # Returns
/// - `Ok(())` — 存储成功
/// - `Err(String)` — Keychain 访问失败或任务执行失败
#[cfg(desktop)]
#[tauri::command]
pub async fn set_secret(key: String, value: String) -> Result<(), String> {
    let store = store();
    tauri::async_runtime::spawn_blocking(move || set_secret_inner(&*store, &key, &value))
        .await
        .map_err(|e| format!("存储任务执行失败: {}", e))?
}

/// 从系统 Keychain 读取敏感值，不存在时返回 None
///
/// 使用 `spawn_blocking` 避免 keyring 操作阻塞 IPC 线程。
///
/// 前端调用方式：`invoke('get_secret', { key: string })`
///
/// # Returns
/// - `Ok(Some(String))` — 读取到的敏感值
/// - `Ok(None)` — 键不存在
/// - `Err(String)` — Keychain 访问失败（非 NoEntry 错误）或任务执行失败
#[cfg(desktop)]
#[tauri::command]
pub async fn get_secret(key: String) -> Result<Option<String>, String> {
    let store = store();
    tauri::async_runtime::spawn_blocking(move || get_secret_inner(&*store, &key))
        .await
        .map_err(|e| format!("读取任务执行失败: {}", e))?
}

/// 从系统 Keychain 删除敏感值
///
/// 使用 `spawn_blocking` 避免 keyring 操作阻塞 IPC 线程。
/// 键不存在时视为成功（幂等操作）。
///
/// 前端调用方式：`invoke('delete_secret', { key: string })`
///
/// # Returns
/// - `Ok(())` — 删除成功（或键不存在）
/// - `Err(String)` — Keychain 访问失败（非 NoEntry 错误）或任务执行失败
#[cfg(desktop)]
#[tauri::command]
pub async fn delete_secret(key: String) -> Result<(), String> {
    let store = store();
    tauri::async_runtime::spawn_blocking(move || delete_secret_inner(&*store, &key))
        .await
        .map_err(|e| format!("删除任务执行失败: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// 内存实现（测试专用），不触碰真实系统 Keychain
    struct MemoryStore(Mutex<HashMap<String, String>>);

    impl SecretStore for MemoryStore {
        fn set_password(&self, key: &str, value: &str) -> Result<(), String> {
            self.0
                .lock()
                .unwrap()
                .insert(key.to_string(), value.to_string());
            Ok(())
        }

        fn get_password(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().get(key).cloned())
        }

        fn delete_credential(&self, key: &str) -> Result<(), String> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }

    fn memory_store() -> Arc<dyn SecretStore> {
        Arc::new(MemoryStore(Mutex::new(HashMap::new())))
    }

    #[test]
    fn set_get_roundtrip() {
        let store = memory_store();
        assert!(set_secret_inner(&*store, "api-key-openai", "sk-test-123").is_ok());
        assert_eq!(
            get_secret_inner(&*store, "api-key-openai").unwrap(),
            Some("sk-test-123".to_string())
        );
    }

    #[test]
    fn get_missing_returns_none() {
        let store = memory_store();
        assert_eq!(get_secret_inner(&*store, "not-exist").unwrap(), None);
    }

    #[test]
    fn delete_is_idempotent() {
        let store = memory_store();
        assert!(set_secret_inner(&*store, "k", "v").is_ok());
        assert!(delete_secret_inner(&*store, "k").is_ok());
        assert_eq!(get_secret_inner(&*store, "k").unwrap(), None);
        // 键不存在时删除仍为成功（幂等）
        assert!(delete_secret_inner(&*store, "k").is_ok());
    }

    #[test]
    fn overwrite_updates_value() {
        let store = memory_store();
        assert!(set_secret_inner(&*store, "k", "v1").is_ok());
        assert!(set_secret_inner(&*store, "k", "v2").is_ok());
        assert_eq!(get_secret_inner(&*store, "k").unwrap(), Some("v2".to_string()));
    }

    #[test]
    fn keys_are_isolated_per_account() {
        let store = memory_store();
        assert!(set_secret_inner(&*store, "a", "1").is_ok());
        assert!(set_secret_inner(&*store, "b", "2").is_ok());
        assert_eq!(get_secret_inner(&*store, "a").unwrap(), Some("1".to_string()));
        assert_eq!(get_secret_inner(&*store, "b").unwrap(), Some("2".to_string()));
    }
}
