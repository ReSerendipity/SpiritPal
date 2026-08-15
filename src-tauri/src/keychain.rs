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
///
/// [Quality Review] 改为 async + spawn_blocking，避免 keyring 操作阻塞 IPC 线程
#[cfg(desktop)]
#[tauri::command]
pub async fn set_secret(key: String, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // R-12 v2.0: obfstr 混淆 service 名
        let entry =
            keyring::Entry::new(obfstr::obfstr!("SpiritPal"), &key).map_err(|e| e.to_string())?;
        entry.set_password(&value).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| format!("存储任务执行失败: {}", e))?
}

/// 从系统 Keychain 读取敏感值，不存在时返回 None
///
/// 使用 `spawn_blocking` 避免 keyring 操作阻塞 IPC 线程。
///
/// 前端调用方式：`invoke('get_secret', { key: string })`
///
/// # Arguments
/// - `key` — 键名，如 `"api-key-openai"`
///
/// # Returns
/// - `Ok(Some(String))` — 读取到的敏感值
/// - `Ok(None)` — 键不存在
/// - `Err(String)` — Keychain 访问失败（非 NoEntry 错误）或任务执行失败
///
/// [Quality Review] 改为 async + spawn_blocking
#[cfg(desktop)]
#[tauri::command]
pub async fn get_secret(key: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry =
            keyring::Entry::new(obfstr::obfstr!("SpiritPal"), &key).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    })
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
/// # Arguments
/// - `key` — 键名，如 `"api-key-openai"`
///
/// # Returns
/// - `Ok(())` — 删除成功（或键不存在）
/// - `Err(String)` — Keychain 访问失败（非 NoEntry 错误）或任务执行失败
///
/// [Quality Review] 改为 async + spawn_blocking
#[cfg(desktop)]
#[tauri::command]
pub async fn delete_secret(key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry =
            keyring::Entry::new(obfstr::obfstr!("SpiritPal"), &key).map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| format!("删除任务执行失败: {}", e))?
}
