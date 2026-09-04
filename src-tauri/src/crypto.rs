//! AES-256-GCM 加密 / SHA-256 哈希 / 机器 ID 派生模块
//!
//! [REFACTOR] 从 lib.rs 拆分，集中管理所有加密相关逻辑
//!
//! # 加密流程
//! 1. 密钥派生：PBKDF2-HMAC-SHA256（100,000 次迭代 + 32 字节 salt，salt = SHA-256(password) 确定性派生）→ 32 字节 AES-256 密钥
//!    （password 为机器 ID；见 R-06。历史 ENC1: 前缀的旧数据仍走单次 SHA-256 兼容解密）
//! 2. 随机生成 12 字节 nonce（使用 OS CSPRNG via getrandom）
//! 3. AES-256-GCM 加密（认证加密，密文包含 16 字节认证标签）
//! 4. 输出格式：base64(nonce || ciphertext || tag || salt)，带 `ENC2:` 前缀（历史 ENC1: 格式无 salt）
//!
//! # 密码来源
//! 优先使用机器 ID，获取失败时 Fail Fast 返回 Err（不再降级到硬编码密钥）
//! - Windows:  HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid
//! - Linux:    /etc/machine-id
//! - macOS:    sysctl kern.uuid 或 ioreg IOPlatformUUID
//!
//! # 提供的 Tauri 命令
//! - [`compute_sha256`] — 计算文件 SHA-256 校验和
//! - [`encrypt_data`] — AES-256-GCM 加密数据
//! - [`decrypt_data`] — AES-256-GCM 解密数据
//!
//! 前端调用时 password 传空字符串，Rust 端自动使用机器 ID。

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::{engine::general_purpose, Engine};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;
// R-06: PBKDF2 密钥派生
use pbkdf2::pbkdf2_hmac;

// ============ 常量 ============

/// 加密数据存储前缀，用于区分密文与遗留明文
/// R-12 v2.0: 运行时已改用 obfstr! 混淆，此常量仅保留供测试引用
#[allow(dead_code)]
pub const ENC_PREFIX: &str = "ENC1:";

/// R-06: PBKDF2 加密数据存储前缀，用于区分 PBKDF2 派生的密文
/// R-12 v2.0: 运行时已改用 obfstr! 混淆，此常量仅保留供测试和外部引用
#[allow(dead_code)]
pub const ENC_PREFIX_V2: &str = "ENC2:";

/// SHA-256 流式读取缓冲区大小
// [OPTIMIZE] A3 - 抽取魔法数字为具名常量
const SHA256_BUF_SIZE: usize = 8192;

/// AES-GCM nonce 长度（标准 12 字节）
const NONCE_LEN: usize = 12;

/// R-06: PBKDF2 迭代次数（100,000 次，符合 NIST SP 800-132 推荐）
const PBKDF2_ITERATIONS: u32 = 100_000;

/// R-06: PBKDF2 salt 长度（32 字节 = SHA-256 输出长度）
const PBKDF2_SALT_LEN: usize = 32;

// ============ 机器 ID 获取 ============

/// 获取机器 ID 作为加密密码来源
///
/// [SECURITY] D3 - 移除 APP_FALLBACK_KEY 硬编码降级，改为 Fail Fast：
/// 所有平台方法均失败时返回 Err，强制暴露环境问题，避免静默降级为等同明文存储。
///
/// # Returns
/// - `Ok(String)` — 机器 ID 字符串
/// - `Err(String)` — 所有平台方法均失败，无法获取机器 ID
///
/// # Platform-specific behavior
/// - **Linux**: 读取 `/etc/machine-id`
/// - **Windows**: 通过 `reg query` 读取注册表 `MachineGuid`
/// - **macOS**: 优先 `sysctl -n kern.uuid`，失败则尝试 `ioreg` 获取 `IOPlatformUUID`
pub fn get_machine_id() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        if let Ok(id) = std::fs::read_to_string("/etc/machine-id") {
            let id = id.trim().to_string();
            if !id.is_empty() {
                return Ok(id);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // 使用 reg 命令读取 MachineGuid，避免引入 windows registry feature
        // CREATE_NO_WINDOW：隐藏 reg.exe 的控制台窗口，
        // 否则每次启动都会闪现一个命令行窗口（用户报告的"瞬现弹窗"）
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = std::process::Command::new("reg");
        cmd.args([
            "query",
            "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .creation_flags(CREATE_NO_WINDOW);
        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                // 解析输出，查找 MachineGuid 值
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if trimmed.to_lowercase().contains("machineguid") {
                        // 格式：    MachineGuid    REG_SZ    xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
                        if let Some(guid) = trimmed.split_whitespace().last() {
                            return Ok(guid.to_string());
                        }
                    }
                }
            }
        }
    }

    // [Tauri Review] macOS 使用 sysctl 获取 IOPlatformUUID，不再回退到硬编码密钥
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("sysctl")
            .args(["-n", "kern.uuid"])
            .output()
        {
            if output.status.success() {
                let uuid = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !uuid.is_empty() {
                    return Ok(uuid);
                }
            }
        }
        // 尝试 ioreg 获取 IOPlatformUUID
        if let Ok(output) = std::process::Command::new("ioreg")
            .args(["-d2", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if line.contains("IOPlatformUUID") {
                        if let Some(uuid) = line.split('"').nth(1) {
                            return Ok(uuid.to_string());
                        }
                    }
                }
            }
        }
    }

    // [SECURITY] D3 - Fail Fast：所有方法失败时返回 Err，不再降级到固定密钥
    // R-12 v2.0: 字符串混淆，防止明文出现在 .rodata
    Err(obfstr::obfstr!("无法获取机器 ID，加密功能不可用").to_string())
}

// ============ 密钥派生 ============

/// 从 password 派生 AES-256 密钥（SHA-256）
///
/// [SECURITY] D3 - 保留用于解密旧数据（ENC1: 前缀）
/// 新数据使用 PBKDF2 派生密钥（ENC2: 前缀）
///
/// # Arguments
/// - `password` — 用于派生密钥的密码字符串
///
/// # Returns
/// 32 字节 AES-256 密钥数组
pub fn derive_aes_key(password: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    let result = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

/// M-8 改进：从 password 派生 PBKDF2 salt（使用 password 的 SHA-256 作为确定性 fallback）
///
/// 注意：此函数仅在向后兼容旧数据解密时使用。
/// 新加密使用 `generate_random_salt()` 生成真随机 salt。
///
/// 使用 password 本身的 SHA-256 作为 salt，使得不同机器的 password 产生不同的 salt。
/// 虽然同机器的 salt 和 password 均源自机器 ID，但 PBKDF2 的 100,000 次迭代
/// 仍能显著提升暴力破解成本（较单次 SHA-256 提升 10^5 倍）。
#[allow(dead_code)] // 保留供向后兼容参考（旧版 ENC1 数据不使用此函数）
fn derive_salt(password: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    let result = hasher.finalize();
    let mut salt = [0u8; 32];
    salt.copy_from_slice(&result);
    salt
}

/// M-8: 生成随机 salt（OS CSPRNG）
///
/// 每次加密生成新的随机 salt，确保相同明文+密码的密文也不同。
/// salt 随密文一起存储（base64 编码后追加在 nonce+ciphertext 之后）。
///
/// # Returns
/// 32 字节随机 salt
fn generate_random_salt() -> Result<[u8; 32], String> {
    let mut salt = [0u8; 32];
    getrandom::getrandom(&mut salt).map_err(|e| format!("生成随机 salt 失败: {}", e))?;
    Ok(salt)
}

/// R-06: 使用 PBKDF2-HMAC-SHA256 派生 AES-256 密钥
///
/// 符合 NIST SP 800-132 推荐标准，迭代 100,000 次 + salt。
/// 暴力破解成本较单次 SHA-256 提升 10^5 倍。
///
/// # Arguments
/// - `password` — 用于派生密钥的密码字符串
/// - `salt` — 盐值（建议使用 password 的 SHA-256）
///
/// # Returns
/// 32 字节 AES-256 密钥数组
pub fn derive_aes_key_pbkdf2(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}

/// 获取加密密码：优先使用机器 ID，参数为空时自动填充
///
/// [SECURITY] D3 - 机器 ID 获取失败时返回 Err（Fail Fast），不再降级
///
/// # Arguments
/// - `password` — 用户提供的密码，空字符串时自动使用机器 ID
///
/// # Returns
/// - `Ok(String)` — 解析后的密码
/// - `Err(String)` — 密码为空且无法获取机器 ID
pub fn resolve_password(password: &str) -> Result<String, String> {
    if password.is_empty() {
        get_machine_id()
    } else {
        Ok(password.to_string())
    }
}

// ============ SHA-256 工具 ============

/// 将 SHA-256 字节切片转为十六进制字符串
///
/// 使用查找表优化，避免 `format!` 的格式化开销。
///
/// # Arguments
/// - `bytes` — SHA-256 哈希字节切片
///
/// # Returns
/// 小写十六进制字符串（长度 64）
// [OPTIMIZE] A3 - 使用查找表优化，避免 format! 的格式化开销
pub fn sha256_to_hex(bytes: &[u8]) -> String {
    const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";
    let mut hex = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        hex.push(HEX_CHARS[(b >> 4) as usize] as char);
        hex.push(HEX_CHARS[(b & 0x0f) as usize] as char);
    }
    hex
}

/// 计算文件的 SHA-256 校验和
///
/// 流式读取大文件，避免一次性加载到内存。使用 `spawn_blocking` 避免阻塞 IPC 线程。
///
/// 前端调用方式：`invoke('compute_sha256', { filePath: string })`
///
/// # Arguments
/// - `file_path` — 文件绝对路径
///
/// # Returns
/// - `Ok(String)` — SHA-256 十六进制字符串（小写）
/// - `Err(String)` — 文件不存在、读取失败或任务执行失败
// [Tauri Review] 改为 async + spawn_blocking，避免阻塞 IPC 线程
#[tauri::command]
pub async fn compute_sha256(file_path: String) -> Result<String, String> {
    // [Tauri Review] 将阻塞 I/O 移至 spawn_blocking
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let mut file = fs::File::open(&file_path).map_err(|e| format!("无法打开文件: {}", e))?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; SHA256_BUF_SIZE];
        loop {
            let n = file
                .read(&mut buffer)
                .map_err(|e| format!("读取文件失败: {}", e))?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
        let result = hasher.finalize();
        Ok(sha256_to_hex(&result))
    })
    .await
    .map_err(|e| format!("计算任务执行失败: {}", e))?;

    result
}

// ============ AES-256-GCM 加密 / 解密 ============

/// AES-256-GCM 加密：返回 `base64(nonce || ciphertext || tag || salt)`，带 `ENC2:` 前缀
///
/// R-06: 密钥派生升级为 PBKDF2-HMAC-SHA256（100,000 次迭代 + salt）
///
/// 加密流程：
/// 1. 解析密码（空密码自动使用机器 ID）
/// 2. PBKDF2-HMAC-SHA256 派生 32 字节密钥（salt = SHA-256(password)）
/// 3. OS CSPRNG 生成 12 字节随机 nonce
/// 4. AES-256-GCM 认证加密（自动附加 16 字节认证标签）
/// 5. 拼接 nonce + ciphertext + tag + salt → base64 编码 → 添加 `ENC2:` 前缀
///
/// 前端调用方式：`invoke('encrypt_data', { data: string, password: string })`
/// password 传空字符串时自动使用机器 ID。
///
/// # Arguments
/// - `data` — 待加密的明文字符串
/// - `password` — 加密密码，空字符串时使用机器 ID
///
/// # Returns
/// - `Ok(String)` — 加密后的密文，格式为 `ENC2:base64(...)`
/// - `Err(String)` — 密码解析失败、随机数生成失败或加密失败
///
/// [SECURITY] D3 - 密钥派生失败时返回 Err，不再静默降级
// [Tauri Review] 改为 async，避免 get_machine_id() 中的阻塞 I/O
#[tauri::command]
pub async fn encrypt_data(data: String, password: String) -> Result<String, String> {
    // [Tauri Review] 将阻塞操作（机器 ID 获取 + PBKDF2 + AES）移至 spawn_blocking
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        // [SECURITY] D3 - Fail Fast：机器 ID 获取失败时拒绝加密，而非降级到硬编码密钥
        let pwd = resolve_password(&password)?;
        // M-8: 使用随机 salt（替代确定性 SHA-256(password)），增强抗彩虹表攻击能力
        let salt = generate_random_salt()?;
        let key = derive_aes_key_pbkdf2(&pwd, &salt);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

        // 生成 12 字节随机 nonce（OS CSPRNG）
        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce_bytes).map_err(|e| e.to_string())?;
        let nonce = Nonce::from_slice(&nonce_bytes);

        // 加密（AES-GCM 自动附加 16 字节认证标签）
        let ciphertext = cipher
            .encrypt(nonce, data.as_bytes())
            .map_err(|e| e.to_string())?;

        // R-06: 合并 nonce + ciphertext + salt 并 base64 编码
        let mut combined = Vec::with_capacity(nonce_bytes.len() + ciphertext.len() + salt.len());
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);
        combined.extend_from_slice(&salt);

        // R-12 v2.0: 使用 obfstr 混淆前缀，防止明文出现在 .rodata
        let b64 = general_purpose::STANDARD.encode(&combined);
        Ok(format!("{}{}", obfstr::obfstr!("ENC2:"), b64))
    })
    .await
    .map_err(|e| format!("加密任务执行失败: {}", e))?;

    result
}

/// AES-256-GCM 解密：支持 `ENC1:` (SHA-256) 和 `ENC2:` (PBKDF2) 两种前缀
///
/// R-06: 向后兼容解密路径
/// - `ENC2:` 前缀 → 使用 PBKDF2 派生密钥解密（新数据）
/// - `ENC1:` 前缀 → 使用 SHA-256 派生密钥解密（旧数据，向后兼容）
///
/// 前端调用方式：`invoke('decrypt_data', { encrypted: string, password: string })`
/// password 传空字符串时自动使用机器 ID。
///
/// # Arguments
/// - `encrypted` — 待解密的密文字符串（`ENC1:` 或 `ENC2:` 前缀开头）
/// - `password` — 解密密码，空字符串时使用机器 ID
///
/// # Returns
/// - `Ok(String)` — 解密后的明文字符串
/// - `Err(String)` — 前缀缺失、base64 解码失败、数据过短、密码错误或解密失败
///
/// [SECURITY] D3 - 密钥派生失败时返回 Err，不再静默降级
// [Tauri Review] 改为 async，避免 get_machine_id() 中的阻塞 I/O
#[tauri::command]
pub async fn decrypt_data(encrypted: String, password: String) -> Result<String, String> {
    // D-6: 安全模式（检测到调试器）下拒绝解密（防加密数据外带）
    if crate::antidebug::is_debugger_detected() {
        return Err("安全模式（检测到调试器），拒绝解密数据".to_string());
    }
    // [Tauri Review] 将阻塞操作（机器 ID 获取 + base64 解码 + AES）移至 spawn_blocking
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        // [SECURITY] D3 - Fail Fast：机器 ID 获取失败时拒绝解密
        let pwd = resolve_password(&password)?;

        // R-06: 优先尝试 PBKDF2 解密（ENC2: 前缀）
        // R-12 v2.0: 使用 obfstr 混淆前缀
        if let Some(stripped) = encrypted.strip_prefix(obfstr::obfstr!("ENC2:")) {
            let combined = general_purpose::STANDARD
                .decode(stripped)
                .map_err(|e| e.to_string())?;

            if combined.len() < NONCE_LEN + PBKDF2_SALT_LEN {
                return Err("加密数据长度不足".to_string());
            }

            // 分离 nonce + ciphertext + salt
            let salt_offset = combined.len() - PBKDF2_SALT_LEN;
            let nonce_bytes = &combined[..NONCE_LEN];
            let ciphertext = &combined[NONCE_LEN..salt_offset];
            let salt = &combined[salt_offset..];

            let key = derive_aes_key_pbkdf2(&pwd, salt);
            let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
            let nonce = Nonce::from_slice(nonce_bytes);

            let plaintext = cipher
                .decrypt(nonce, ciphertext)
                .map_err(|e| e.to_string())?;
            return String::from_utf8(plaintext).map_err(|e| e.to_string());
        }

        // 向后兼容：尝试 SHA-256 解密（ENC1: 前缀，旧数据）
        // R-12 v2.0: 使用 obfstr 混淆前缀
        if let Some(stripped) = encrypted.strip_prefix(obfstr::obfstr!("ENC1:")) {
            let combined = general_purpose::STANDARD
                .decode(stripped)
                .map_err(|e| e.to_string())?;

            if combined.len() < NONCE_LEN {
                return Err("加密数据长度不足".to_string());
            }
            let (nonce_bytes, ciphertext) = combined.split_at(NONCE_LEN);
            let nonce = Nonce::from_slice(nonce_bytes);

            let key = derive_aes_key(&pwd);
            let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

            let plaintext = cipher
                .decrypt(nonce, ciphertext)
                .map_err(|e| e.to_string())?;
            return String::from_utf8(plaintext).map_err(|e| e.to_string());
        }

        Err(obfstr::obfstr!("数据未包含加密前缀，可能为明文").to_string())
    })
    .await
    .map_err(|e| format!("解密任务执行失败: {}", e))?;

    result
}

// ============ B-3: 大 blob 分块流式加密（ENC3） ============
//
// 背景：记忆/经历/视觉记忆等 blob 可达数 MB。ENC1/ENC2 是单块 AES-GCM：
// ① 每次加解密都要重跑 10 万次 PBKDF2，大 blob 与 1KB 字符串成本相同却叠加
//    全量 AES + base64（≈1.35×）双倍内存拷贝；② 单块格式无法增量处理。
//
// ENC3 设计：一次 PBKDF2 派生密钥，明文按块切分、每块独立随机 nonce +
// AES-GCM 认证加密。任何一块被篡改都会导致整体解密失败（认证完整性不变）。
//
// 格式：`ENC3:base64(salt[32] || count[u32 LE] || (nonce[12] || ct+tag[16]) × count)`
// 兼容性：仅新写入的大 blob 使用 ENC3；旧 ENC1/ENC2 数据继续走 decrypt_data，
// 前端统一经 blobCrypto.ts 分派，无需数据迁移。

/// 每块明文大小（1MB）。前端阈值为 5MB，超出即走分块。
const ENC3_CHUNK_SIZE: usize = 1024 * 1024;
/// AES-GCM 认证标签长度
const ENC3_TAG_LEN: usize = 16;
/// 分块数量上限（防止恶意构造的超大 count 触发无界内存分配）
const ENC3_MAX_CHUNKS: usize = 10_000;

/// 分块流式 AES-256-GCM 加密（ENC3 前缀），用于 MB 级大 blob
///
/// 前端调用方式：`invoke('encrypt_data_chunked', { data: string, password: string })`
///
/// # Arguments
/// - `data` — 待加密的明文（可为任意 UTF-8，按字节切块，块边界不破坏多字节字符：
///   解密侧先拼接完整字节序列再做一次 UTF-8 还原）
/// - `password` — 加密密码，空字符串时使用机器 ID
///
/// # Returns
/// - `Ok(String)` — `ENC3:base64(salt || count || (nonce||ct+tag)×N)`
/// - `Err(String)` — 密码解析失败、随机数生成失败或加密失败
///   分块加密核心（同步，供命令与单测复用）
fn encrypt_chunked_internal(pwd: &str, data: &str) -> Result<String, String> {
    let salt = generate_random_salt()?;
    let key = derive_aes_key_pbkdf2(pwd, &salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

    let bytes = data.as_bytes();
    let count = bytes.len().div_ceil(ENC3_CHUNK_SIZE).max(1);

    let mut out = Vec::with_capacity(
        PBKDF2_SALT_LEN + 4 + count * (NONCE_LEN + ENC3_CHUNK_SIZE + ENC3_TAG_LEN),
    );
    out.extend_from_slice(&salt);
    out.extend_from_slice(&(count as u32).to_le_bytes());

    for chunk in bytes.chunks(ENC3_CHUNK_SIZE) {
        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce_bytes).map_err(|e| e.to_string())?;
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher.encrypt(nonce, chunk).map_err(|e| e.to_string())?;
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ciphertext);
    }

    let b64 = general_purpose::STANDARD.encode(&out);
    Ok(format!("{}{}", obfstr::obfstr!("ENC3:"), b64))
}

#[tauri::command]
pub async fn encrypt_data_chunked(data: String, password: String) -> Result<String, String> {
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let pwd = resolve_password(&password)?;
        encrypt_chunked_internal(&pwd, &data)
    })
    .await
    .map_err(|e| format!("分块加密任务执行失败: {}", e))?;

    result
}

/// 分块流式 AES-256-GCM 解密（ENC3 前缀）
///
/// 前端调用方式：`invoke('decrypt_data_chunked', { encrypted: string, password: string })`
///
/// # Returns
/// - `Ok(String)` — 解密后的明文
/// - `Err(String)` — 前缀缺失、base64 解码失败、块数非法、任一块认证失败或 UTF-8 还原失败
///   分块解密核心（同步，供命令与单测复用）
fn decrypt_chunked_internal(pwd: &str, encrypted: &str) -> Result<String, String> {
    let stripped = encrypted
        .strip_prefix(obfstr::obfstr!("ENC3:"))
        .ok_or_else(|| obfstr::obfstr!("数据未包含 ENC3 前缀").to_string())?;
    let combined = general_purpose::STANDARD
        .decode(stripped)
        .map_err(|e| e.to_string())?;

    let header_len = PBKDF2_SALT_LEN + 4;
    if combined.len() < header_len {
        return Err("分块加密数据长度不足".to_string());
    }

    let salt = &combined[..PBKDF2_SALT_LEN];
    let count_bytes: [u8; 4] = combined[PBKDF2_SALT_LEN..header_len]
        .try_into()
        .map_err(|_| "分块头解析失败".to_string())?;
    let count = u32::from_le_bytes(count_bytes) as usize;
    if count == 0 || count > ENC3_MAX_CHUNKS {
        return Err(format!("分块数量非法: {}", count));
    }

    let key = derive_aes_key_pbkdf2(pwd, salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

    let mut plain = Vec::with_capacity(count * ENC3_CHUNK_SIZE);
    let mut offset = header_len;

    for i in 0..count {
        if combined.len() < offset + NONCE_LEN {
            return Err(format!("第 {} 块数据不完整", i + 1));
        }
        let nonce = Nonce::from_slice(&combined[offset..offset + NONCE_LEN]);
        offset += NONCE_LEN;

        // 非最后一块的密文长度固定为 chunk+tag；最后一块占剩余全部字节
        let remaining = combined.len() - offset;
        let ct_len = if i == count - 1 {
            remaining
        } else {
            ENC3_CHUNK_SIZE + ENC3_TAG_LEN
        };
        if remaining < ct_len {
            return Err(format!("第 {} 块密文长度不足", i + 1));
        }
        let ciphertext = &combined[offset..offset + ct_len];
        offset += ct_len;

        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| format!("第 {} 块解密失败（密码错误或数据被篡改）", i + 1))?;
        plain.extend_from_slice(&plaintext);
    }

    String::from_utf8(plain).map_err(|e| format!("解密结果不是有效的 UTF-8: {}", e))
}

#[tauri::command]
pub async fn decrypt_data_chunked(encrypted: String, password: String) -> Result<String, String> {
    // D-6: 安全模式（检测到调试器）下拒绝分块解密
    if crate::antidebug::is_debugger_detected() {
        return Err("安全模式（检测到调试器），拒绝解密数据".to_string());
    }
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let pwd = resolve_password(&password)?;
        decrypt_chunked_internal(&pwd, &encrypted)
    })
    .await
    .map_err(|e| format!("分块解密任务执行失败: {}", e))?;

    result
}

// ============ 内部辅助：计算字节的 SHA-256（供 petmod 模块复用）============

/// 计算字节切片的 SHA-256 十六进制值
///
/// 供 `import_petmod` 计算 .petmod 文件校验和使用。
///
/// # Arguments
/// - `bytes` — 待计算哈希的字节切片
///
/// # Returns
/// SHA-256 小写十六进制字符串（长度 64）
pub fn sha256_of_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    sha256_to_hex(&hasher.finalize())
}

/// 从文件路径派生模组文件夹名（不带扩展名）
///
/// 供 `import_petmod` 使用，避免 petmod 模块重复实现路径处理逻辑。
///
/// # Arguments
/// - `file_path` — .petmod 文件路径
///
/// # Returns
/// 文件名（不含扩展名），无法解析时返回 `"unknown_mod"`
pub fn derive_mod_name_from_path(file_path: &str) -> String {
    Path::new(file_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown_mod")
        .to_string()
}

// ============================================================
// 单元测试
// ============================================================
// 覆盖：PBKDF2 密钥派生、AES-256-GCM 加密/解密往返、
//       数据损坏检测、ENC1/ENC2 前缀格式、路径派生

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Key, Nonce};
    use base64::{engine::general_purpose, Engine};

    // ============ PBKDF2 密钥派生测试 ============

    #[test]
    fn test_derive_aes_key_pbkdf2_deterministic() {
        let salt = derive_salt("test-password");
        let key1 = derive_aes_key_pbkdf2("test-password", &salt);
        let key2 = derive_aes_key_pbkdf2("test-password", &salt);
        assert_eq!(key1, key2, "相同密码和 salt 应派生出相同密钥");
    }

    #[test]
    fn test_derive_aes_key_pbkdf2_different_password() {
        let salt = derive_salt("password1");
        let key1 = derive_aes_key_pbkdf2("password1", &salt);
        let key2 = derive_aes_key_pbkdf2("password2", &salt);
        assert_ne!(key1, key2, "不同密码应派生出不同密钥");
    }

    #[test]
    fn test_derive_aes_key_pbkdf2_different_salt() {
        let salt1 = derive_salt("password1");
        let salt2 = derive_salt("password2");
        let key1 = derive_aes_key_pbkdf2("same-password", &salt1);
        let key2 = derive_aes_key_pbkdf2("same-password", &salt2);
        assert_ne!(key1, key2, "不同 salt 应派生出不同密钥");
    }

    #[test]
    fn test_derive_aes_key_pbkdf2_length() {
        let salt = derive_salt("test");
        let key = derive_aes_key_pbkdf2("test", &salt);
        assert_eq!(key.len(), 32, "AES-256 密钥应为 32 字节");
    }

    #[test]
    fn test_derive_salt_deterministic() {
        let salt1 = derive_salt("test-password");
        let salt2 = derive_salt("test-password");
        assert_eq!(salt1, salt2, "相同密码应派生出相同 salt");
    }

    #[test]
    fn test_derive_salt_different() {
        let salt1 = derive_salt("password1");
        let salt2 = derive_salt("password2");
        assert_ne!(salt1, salt2, "不同密码应派生出不同 salt");
    }

    #[test]
    fn test_derive_salt_length() {
        let salt = derive_salt("test");
        assert_eq!(salt.len(), PBKDF2_SALT_LEN, "salt 应为 32 字节");
    }

    #[test]
    fn test_pbkdf2_iterations_meets_nist() {
        // NIST SP 800-132 推荐至少 1000 次迭代，本项目使用 100,000 次
        // 编译期断言（clippy 提示运行时断言为常量值）
        const _: () = assert!(PBKDF2_ITERATIONS >= 100_000, "PBKDF2 迭代次数应 >= 100,000");
    }

    // ============ SHA-256 / sha256_to_hex 已知向量测试 ============

    #[test]
    fn test_sha256_to_hex_empty() {
        let hex = sha256_to_hex(&[]);
        assert_eq!(hex, "");
    }

    #[test]
    fn test_sha256_to_hex_all_bytes() {
        // 测试 0x00 到 0xFF 的十六进制表示
        let bytes: Vec<u8> = (0..=255).collect();
        let hex = sha256_to_hex(&bytes);
        assert_eq!(hex.len(), 512); // 256 bytes * 2 hex chars
                                    // 验证前几个字节
        assert_eq!(&hex[0..2], "00");
        assert_eq!(&hex[2..4], "01");
        assert_eq!(&hex[510..512], "ff");
    }

    #[test]
    fn test_sha256_of_bytes_abc() {
        // SHA-256("abc") 的标准测试向量
        let hex = sha256_of_bytes(b"abc");
        assert_eq!(
            hex,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn test_sha256_of_bytes_long_message() {
        // SHA-256 of 1 million 'a' characters — 标准测试向量
        let data = "a".repeat(1_000_000);
        let hex = sha256_of_bytes(data.as_bytes());
        assert_eq!(
            hex,
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
    }

    // ============ derive_mod_name_from_path 测试 ============

    #[test]
    fn test_derive_mod_name_simple() {
        assert_eq!(derive_mod_name_from_path("my_mod.petmod"), "my_mod");
    }

    #[test]
    fn test_derive_mod_name_with_path() {
        // 使用平台特定的路径分隔符来测试带路径的文件名解析
        #[cfg(windows)]
        let path = r"C:\Users\Doro\Downloads\cool_mod.petmod";
        #[cfg(not(windows))]
        let path = "/home/user/mods/cool_mod.petmod";
        assert_eq!(derive_mod_name_from_path(path), "cool_mod");
    }

    #[test]
    fn test_derive_mod_name_unix_path() {
        assert_eq!(
            derive_mod_name_from_path("/home/user/mods/test_mod.petmod"),
            "test_mod"
        );
    }

    #[test]
    fn test_derive_mod_name_no_extension() {
        assert_eq!(derive_mod_name_from_path("no_extension"), "no_extension");
    }

    #[test]
    fn test_derive_mod_name_empty() {
        assert_eq!(derive_mod_name_from_path(""), "unknown_mod");
    }

    #[test]
    fn test_derive_mod_name_only_extension() {
        // .petmod 在大多数平台上被视为无扩展名的隐藏文件（dotfile），
        // file_stem() 返回 ".petmod" 本身而非 "unknown_mod"
        let result = derive_mod_name_from_path(".petmod");
        assert!(
            result == ".petmod" || result == "unknown_mod",
            "dotfile .petmod 应返回其本身或 unknown_mod，实际: {}",
            result
        );
    }

    #[test]
    fn test_derive_mod_name_unicode() {
        assert_eq!(derive_mod_name_from_path("猫咪模组.petmod"), "猫咪模组");
    }

    // ============ ENC2: PBKDF2 加密/解密往返测试 ============

    #[test]
    fn test_enc2_encrypt_decrypt_roundtrip() {
        let data = "Hello, SpiritPal! 这是一段测试数据。";
        let password = "test-password";

        // 模拟 encrypt_data 的 PBKDF2 路径
        let salt = derive_salt(password);
        let key = derive_aes_key_pbkdf2(password, &salt);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce_bytes).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, data.as_bytes()).unwrap();

        // 合并 nonce + ciphertext + salt（ENC2 格式）
        let mut combined = Vec::with_capacity(nonce_bytes.len() + ciphertext.len() + salt.len());
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);
        combined.extend_from_slice(&salt);

        let b64 = general_purpose::STANDARD.encode(&combined);
        let encrypted = format!("{}{}", ENC_PREFIX_V2, b64);

        // 验证前缀
        assert!(encrypted.starts_with(ENC_PREFIX_V2));

        // 模拟 decrypt_data 的 PBKDF2 路径
        let stripped = encrypted.strip_prefix(ENC_PREFIX_V2).unwrap();
        let decoded = general_purpose::STANDARD.decode(stripped).unwrap();

        let salt_offset = decoded.len() - PBKDF2_SALT_LEN;
        let nonce_bytes_dec = &decoded[..NONCE_LEN];
        let ciphertext_dec = &decoded[NONCE_LEN..salt_offset];
        let salt_dec = &decoded[salt_offset..];

        let key_dec = derive_aes_key_pbkdf2(password, salt_dec);
        let cipher_dec = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_dec));

        let plaintext = cipher_dec
            .decrypt(Nonce::from_slice(nonce_bytes_dec), ciphertext_dec)
            .unwrap();

        let decrypted = String::from_utf8(plaintext).unwrap();
        assert_eq!(decrypted, data);
    }

    #[test]
    fn test_enc2_encrypt_decrypt_empty_data() {
        let data = "";
        let password = "empty-test";

        let salt = derive_salt(password);
        let key = derive_aes_key_pbkdf2(password, &salt);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce_bytes).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, data.as_bytes()).unwrap();

        let mut combined = Vec::new();
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);
        combined.extend_from_slice(&salt);

        let b64 = general_purpose::STANDARD.encode(&combined);
        let encrypted = format!("{}{}", ENC_PREFIX_V2, b64);

        // 解密
        let stripped = encrypted.strip_prefix(ENC_PREFIX_V2).unwrap();
        let decoded = general_purpose::STANDARD.decode(stripped).unwrap();

        let salt_offset = decoded.len() - PBKDF2_SALT_LEN;
        let key_dec = derive_aes_key_pbkdf2(password, &decoded[salt_offset..]);
        let cipher_dec = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_dec));

        let plaintext = cipher_dec
            .decrypt(
                Nonce::from_slice(&decoded[..NONCE_LEN]),
                &decoded[NONCE_LEN..salt_offset],
            )
            .unwrap();

        assert_eq!(String::from_utf8(plaintext).unwrap(), data);
    }

    #[test]
    fn test_enc2_encrypt_decrypt_large_data() {
        // 1MB 数据
        let data: String = "A".repeat(1024 * 1024);
        let password = "large-data-test";

        let salt = derive_salt(password);
        let key = derive_aes_key_pbkdf2(password, &salt);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce_bytes).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, data.as_bytes()).unwrap();

        let mut combined = Vec::with_capacity(nonce_bytes.len() + ciphertext.len() + salt.len());
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);
        combined.extend_from_slice(&salt);

        let b64 = general_purpose::STANDARD.encode(&combined);
        let encrypted = format!("{}{}", ENC_PREFIX_V2, b64);

        // 解密
        let stripped = encrypted.strip_prefix(ENC_PREFIX_V2).unwrap();
        let decoded = general_purpose::STANDARD.decode(stripped).unwrap();

        let salt_offset = decoded.len() - PBKDF2_SALT_LEN;
        let key_dec = derive_aes_key_pbkdf2(password, &decoded[salt_offset..]);
        let cipher_dec = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_dec));

        let plaintext = cipher_dec
            .decrypt(
                Nonce::from_slice(&decoded[..NONCE_LEN]),
                &decoded[NONCE_LEN..salt_offset],
            )
            .unwrap();

        assert_eq!(String::from_utf8(plaintext).unwrap(), data);
    }

    #[test]
    fn test_enc2_encrypt_produces_different_ciphertext() {
        let data = "same data";
        let password = "nonce-test";

        let salt = derive_salt(password);
        let key = derive_aes_key_pbkdf2(password, &salt);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

        // 第一次加密
        let mut nonce1 = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce1).unwrap();
        let ct1 = cipher
            .encrypt(Nonce::from_slice(&nonce1), data.as_bytes())
            .unwrap();

        // 第二次加密（不同 nonce）
        let mut nonce2 = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce2).unwrap();
        let ct2 = cipher
            .encrypt(Nonce::from_slice(&nonce2), data.as_bytes())
            .unwrap();

        // 不同 nonce → 不同密文
        assert_ne!(ct1, ct2);
    }

    // ============ 数据损坏检测测试 ============

    #[test]
    fn test_decryption_fails_with_tampered_ciphertext() {
        let data = "sensitive data";
        let password = "corruption-test";

        let salt = derive_salt(password);
        let key = derive_aes_key_pbkdf2(password, &salt);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce_bytes).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);

        let mut ciphertext = cipher.encrypt(nonce, data.as_bytes()).unwrap();

        // 篡改密文中的某个字节
        ciphertext[0] ^= 0xFF;

        // 解密应失败（AES-GCM 认证标签校验不通过）
        let result = cipher.decrypt(nonce, ciphertext.as_ref());
        assert!(result.is_err(), "篡改密文后解密应失败");
    }

    #[test]
    fn test_decryption_fails_with_tampered_tag() {
        let data = "sensitive data";
        let password = "tag-test";

        let salt = derive_salt(password);
        let key = derive_aes_key_pbkdf2(password, &salt);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce_bytes).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);

        let mut ciphertext = cipher.encrypt(nonce, data.as_bytes()).unwrap();

        // 篡改认证标签的最后一个字节
        let last = ciphertext.len() - 1;
        ciphertext[last] ^= 0xFF;

        let result = cipher.decrypt(nonce, ciphertext.as_ref());
        assert!(result.is_err(), "篡改认证标签后解密应失败");
    }

    #[test]
    fn test_decryption_fails_with_wrong_password() {
        let data = "secret message";
        let password1 = "correct-password";

        let salt = derive_salt(password1);
        let key1 = derive_aes_key_pbkdf2(password1, &salt);
        let cipher1 = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key1));

        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce_bytes).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher1.encrypt(nonce, data.as_bytes()).unwrap();

        // 使用错误密码派生密钥
        let password2 = "wrong-password";
        let salt2 = derive_salt(password2);
        let key2 = derive_aes_key_pbkdf2(password2, &salt2);
        let cipher2 = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key2));

        let result = cipher2.decrypt(nonce, ciphertext.as_ref());
        assert!(result.is_err(), "使用错误密码解密应失败");
    }

    #[test]
    fn test_decryption_fails_with_truncated_data() {
        let data = "some data";
        let password = "truncation-test";

        let salt = derive_salt(password);
        let key = derive_aes_key_pbkdf2(password, &salt);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce_bytes).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, data.as_bytes()).unwrap();

        // 截断密文（移除最后 5 字节，包括部分认证标签）
        let truncated = &ciphertext[..ciphertext.len() - 5];
        let result = cipher.decrypt(nonce, truncated);
        assert!(result.is_err(), "截断密文后解密应失败");
    }

    // ============ ENC1 向后兼容性测试 ============

    #[test]
    fn test_enc1_encrypt_decrypt_roundtrip() {
        let data = "legacy data";
        let password = "legacy-test";

        // ENC1 使用 SHA-256 密钥派生
        let key = derive_aes_key(password);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce_bytes).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, data.as_bytes()).unwrap();

        // ENC1 格式：nonce + ciphertext（无 salt）
        let mut combined = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);

        let b64 = general_purpose::STANDARD.encode(&combined);
        let encrypted = format!("{}{}", ENC_PREFIX, b64);

        // 解密
        let stripped = encrypted.strip_prefix(ENC_PREFIX).unwrap();
        let decoded = general_purpose::STANDARD.decode(stripped).unwrap();

        assert!(decoded.len() >= NONCE_LEN);
        let (n, c) = decoded.split_at(NONCE_LEN);
        let plaintext = cipher.decrypt(Nonce::from_slice(n), c).unwrap();

        assert_eq!(String::from_utf8(plaintext).unwrap(), data);
    }

    // ============ ENC1/ENC2 交叉不兼容性测试 ============

    #[test]
    fn test_enc1_data_cannot_decrypt_with_enc2_key() {
        let data = "cross-test";
        let password = "cross-password";

        // ENC1 加密
        let key_sha = derive_aes_key(password);
        let cipher_sha = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_sha));

        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce_bytes).unwrap();
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher_sha.encrypt(nonce, data.as_bytes()).unwrap();

        // 尝试用 PBKDF2 密钥解密 ENC1 密文
        let salt = derive_salt(password);
        let key_pbkdf2 = derive_aes_key_pbkdf2(password, &salt);
        let cipher_pbkdf2 = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_pbkdf2));

        let result = cipher_pbkdf2.decrypt(nonce, ciphertext.as_ref());
        assert!(
            result.is_err(),
            "ENC1 密文不应被 PBKDF2 密钥解密（密钥不同）"
        );
    }

    // ============ 前缀常量测试 ============

    #[test]
    fn test_enc_prefix_v2_value() {
        assert_eq!(ENC_PREFIX_V2, "ENC2:");
    }

    #[test]
    fn test_enc_prefixes_different() {
        assert_ne!(ENC_PREFIX, ENC_PREFIX_V2);
    }

    // ============ nonce 长度测试 ============

    #[test]
    fn test_nonce_length_standard() {
        assert_eq!(NONCE_LEN, 12, "AES-GCM nonce 标准长度为 12 字节");
    }

    // ============ B-3: ENC3 分块流式加密 ============

    #[test]
    fn test_enc3_roundtrip_small_data() {
        let encrypted = encrypt_chunked_internal("pw", "你好，SpiritPal！").unwrap();
        assert!(encrypted.starts_with("ENC3:"));
        assert_eq!(
            decrypt_chunked_internal("pw", &encrypted).unwrap(),
            "你好，SpiritPal！"
        );
    }

    #[test]
    fn test_enc3_roundtrip_multibyte_crosses_chunk_boundary() {
        // 2.8MB：跨 3 个块；用多字节字符填充确保块边界落在多字节字符中间
        let unit = "喵🐾"; // 3+4 = 7 字节
        let mut data = String::with_capacity(400_000 * 7);
        for _ in 0..400_000 {
            data.push_str(unit);
        }
        assert!(data.len() > 2 * ENC3_CHUNK_SIZE, "测试数据必须跨多块");

        let encrypted = encrypt_chunked_internal("pw", &data).unwrap();
        assert_eq!(decrypt_chunked_internal("pw", &encrypted).unwrap(), data);
    }

    #[test]
    fn test_enc3_wrong_password_fails() {
        let encrypted = encrypt_chunked_internal("right", "secret").unwrap();
        assert!(decrypt_chunked_internal("wrong", &encrypted).is_err());
    }

    #[test]
    fn test_enc3_tampered_ciphertext_fails() {
        let encrypted = encrypt_chunked_internal("pw", "secret").unwrap();
        let mut decoded = general_purpose::STANDARD
            .decode(encrypted.strip_prefix("ENC3:").unwrap())
            .unwrap();
        // 篡改第一个密文字节（跳过 salt+count 头）
        let last = decoded.len() - 1;
        decoded[last] ^= 0xFF;
        let tampered = format!("ENC3:{}", general_purpose::STANDARD.encode(&decoded));
        assert!(decrypt_chunked_internal("pw", &tampered).is_err());
    }

    #[test]
    fn test_enc3_invalid_chunk_count_rejected() {
        // 构造 count=0 的非法包
        let mut payload = vec![0u8; PBKDF2_SALT_LEN];
        payload.extend_from_slice(&0u32.to_le_bytes());
        let enc = format!("ENC3:{}", general_purpose::STANDARD.encode(&payload));
        let err = decrypt_chunked_internal("pw", &enc).unwrap_err();
        assert!(err.contains("分块数量非法"));
    }

    #[test]
    fn test_enc3_rejects_non_enc3_input() {
        assert!(decrypt_chunked_internal("pw", "ENC2:abcd").is_err());
        assert!(decrypt_chunked_internal("pw", "plain").is_err());
    }
}
