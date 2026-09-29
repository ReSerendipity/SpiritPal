//! 系统 Keychain 加密存储模块（API Key 等敏感数据）
//!
//! [REFACTOR] 从 lib.rs 拆分，职责单一化
//!
//! # 功能
//! 使用 `keyring` crate 将敏感数据存储到系统 Keychain：
//! - Windows: Credential Manager
//! - macOS:   Keychain
//! - Linux:   Secret Service (GNOME Keyring / KWallet)
//! - 移动端:  应用沙箱内 AES-256-GCM 加密文件（keyring 不支持移动平台，详见下方 mobile_file_store 模块）
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

// ============ 移动端实现：应用沙箱内加密文件存储 ============
// Android/iOS 无可供 Rust 直接使用的系统 Keychain（keyring crate 不支持移动平台）。
// 此实现提供「沙箱等价保护」：秘密以 AES-256-GCM 加密存放于应用私有目录
// （SELinux per-app 隔离，第三方无法读取），加密密钥为首启随机生成、
// 同目录存放的 32 字节设备密钥。真正的 Android Keystore 硬件绑定集成留作增强。
//
// [SECURITY] 威胁模型说明：该方案防的是「其他应用/普通文件读取」，
// 不防 root 后的全盘读取（Android Keystore 可补足，见上）。

#[cfg(not(desktop))]
mod mobile_file_store {
    use super::SecretStore;
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Key, Nonce};
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine as _;
    use std::path::PathBuf;
    use std::sync::Mutex;

    const KEY_FILE: &str = "secrets-device.key";
    const DATA_FILE: &str = "secrets.json.enc";

    pub struct MobileFileSecretStore {
        dir: PathBuf,
        /// 进程内串行化（读-改-写整个秘密表）
        lock: Mutex<()>,
    }

    impl MobileFileSecretStore {
        pub fn new(dir: PathBuf) -> Self {
            Self {
                dir,
                lock: Mutex::new(()),
            }
        }

        fn key_path(&self) -> PathBuf {
            self.dir.join(KEY_FILE)
        }

        fn data_path(&self) -> PathBuf {
            self.dir.join(DATA_FILE)
        }

        /// 首启生成 32 字节随机设备密钥（OS CSPRNG），已存在则复用
        fn ensure_device_key(&self) -> Result<[u8; 32], String> {
            let path = self.key_path();
            if let Ok(bytes) = std::fs::read(&path) {
                if bytes.len() == 32 {
                    let mut key = [0u8; 32];
                    key.copy_from_slice(&bytes);
                    return Ok(key);
                }
            }
            let mut key = [0u8; 32];
            getrandom::getrandom(&mut key).map_err(|e| format!("生成设备密钥失败: {}", e))?;
            std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
            std::fs::write(&path, &key).map_err(|e| e.to_string())?;
            Ok(key)
        }

        fn cipher(&self) -> Result<Aes256Gcm, String> {
            let key = self.ensure_device_key()?;
            Ok(Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key)))
        }

        /// 读取并解密整个秘密表（文件不存在视为空表）
        fn load_map(&self) -> Result<std::collections::HashMap<String, String>, String> {
            let path = self.data_path();
            let raw = match std::fs::read(&path) {
                Ok(bytes) => bytes,
                Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(std::collections::HashMap::new())
                }
                Err(e) => return Err(format!("读取秘密文件失败: {}", e)),
            };
            let combined = B64
                .decode(&raw)
                .map_err(|e| format!("秘密文件解码失败: {}", e))?;
            if combined.len() < 12 {
                return Err("秘密文件损坏（长度异常）".to_string());
            }
            let (nonce_bytes, ciphertext) = combined.split_at(12);
            let cipher = self.cipher()?;
            let plain = cipher
                .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
                .map_err(|_| "秘密文件解密失败（密钥不匹配或数据被篡改）".to_string())?;
            serde_json::from_slice(&plain).map_err(|e| format!("秘密表解析失败: {}", e))
        }

        /// 序列化并加密写回整个秘密表
        fn save_map(
            &self,
            map: &std::collections::HashMap<String, String>,
        ) -> Result<(), String> {
            let plain = serde_json::to_vec(map).map_err(|e| e.to_string())?;
            let cipher = self.cipher()?;
            let mut nonce_bytes = [0u8; 12];
            getrandom::getrandom(&mut nonce_bytes).map_err(|e| e.to_string())?;
            let ciphertext = cipher
                .encrypt(Nonce::from_slice(&nonce_bytes), plain.as_slice())
                .map_err(|e| format!("加密失败: {}", e))?;
            let mut combined = Vec::with_capacity(12 + ciphertext.len());
            combined.extend_from_slice(&nonce_bytes);
            combined.extend_from_slice(&ciphertext);
            std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
            std::fs::write(self.data_path(), B64.encode(&combined))
                .map_err(|e| format!("写入秘密文件失败: {}", e))
        }
    }

    impl SecretStore for MobileFileSecretStore {
        fn set_password(&self, key: &str, value: &str) -> Result<(), String> {
            let _guard = self.lock.lock().unwrap();
            let mut map = self.load_map()?;
            map.insert(key.to_string(), value.to_string());
            self.save_map(&map)
        }

        fn get_password(&self, key: &str) -> Result<Option<String>, String> {
            let _guard = self.lock.lock().unwrap();
            Ok(self.load_map()?.get(key).cloned())
        }

        fn delete_credential(&self, key: &str) -> Result<(), String> {
            let _guard = self.lock.lock().unwrap();
            let mut map = self.load_map()?;
            map.remove(key);
            self.save_map(&map)
        }
    }
}

#[cfg(not(desktop))]
use mobile_file_store::MobileFileSecretStore;

/// 移动端：在 setup 阶段以应用私有目录初始化秘密存储。
/// 必须在任何 set/get/delete_secret 命令可被前端调用前执行（lib.rs setup）。
#[cfg(not(desktop))]
pub(crate) fn init_mobile_store(dir: std::path::PathBuf) {
    let _ = STORE.set(Arc::new(MobileFileSecretStore::new(dir)));
}

#[cfg(desktop)]
fn store() -> Result<Arc<dyn SecretStore>, String> {
    Ok(STORE
        .get_or_init(|| Arc::new(SystemKeychainStore) as Arc<dyn SecretStore>)
        .clone())
}

/// 移动端：store 必须已在 setup 时初始化（见 init_mobile_store）
#[cfg(not(desktop))]
fn store() -> Result<Arc<dyn SecretStore>, String> {
    match STORE.get() {
        Some(s) => Ok(s.clone()),
        None => Err("密钥存储尚未初始化（setup 阶段未调用 init_mobile_store）".to_string()),
    }
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
#[tauri::command]
pub async fn set_secret(window: tauri::Window, key: String, value: String) -> Result<(), String> {
    // D-2: Keychain 写入仅允许应用窗口
    crate::window_gate::require_window(&window, crate::window_gate::APP_WINDOWS)?;
    let store = store()?;
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
#[tauri::command]
pub async fn get_secret(window: tauri::Window, key: String) -> Result<Option<String>, String> {
    // D-2: Keychain 读取仅允许应用窗口
    crate::window_gate::require_window(&window, crate::window_gate::APP_WINDOWS)?;
    // D-6: 安全模式（检测到调试器）下拒绝读取密钥（防凭据外带）
    if crate::antidebug::is_debugger_detected() {
        return Err("安全模式（检测到调试器），拒绝读取密钥".to_string());
    }
    let store = store()?;
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
#[tauri::command]
pub async fn delete_secret(window: tauri::Window, key: String) -> Result<(), String> {
    // D-2: Keychain 删除仅允许应用窗口
    crate::window_gate::require_window(&window, crate::window_gate::APP_WINDOWS)?;
    let store = store()?;
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
        assert_eq!(
            get_secret_inner(&*store, "k").unwrap(),
            Some("v2".to_string())
        );
    }

    #[test]
    fn keys_are_isolated_per_account() {
        let store = memory_store();
        assert!(set_secret_inner(&*store, "a", "1").is_ok());
        assert!(set_secret_inner(&*store, "b", "2").is_ok());
        assert_eq!(
            get_secret_inner(&*store, "a").unwrap(),
            Some("1".to_string())
        );
        assert_eq!(
            get_secret_inner(&*store, "b").unwrap(),
            Some("2".to_string())
        );
    }
}
