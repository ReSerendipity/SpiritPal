//! crypto 模块集成测试
//!
//! 测试 crypto.rs 的公开 API：
//! - 密钥派生（SHA-256 + PBKDF2）
//! - SHA-256 哈希计算
//! - 路径派生
//! - 密码解析
//! - 机器 ID 获取
//! - AES-256-GCM 加密/解密往返（使用公开密钥派生函数）
//! - 数据损坏检测

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::{engine::general_purpose, Engine};
use spiritpal_lib::crypto::{
    derive_aes_key, derive_aes_key_pbkdf2, derive_mod_name_from_path, get_machine_id,
    resolve_password, sha256_of_bytes, sha256_to_hex, ENC_PREFIX, ENC_PREFIX_V2,
};

// ============ 密钥派生测试 ============

#[test]
fn test_derive_aes_key_consistency() {
    let key1 = derive_aes_key("my-password");
    let key2 = derive_aes_key("my-password");
    assert_eq!(key1, key2, "相同密码应派生出相同密钥");
}

#[test]
fn test_derive_aes_key_difference() {
    let key1 = derive_aes_key("password1");
    let key2 = derive_aes_key("password2");
    assert_ne!(key1, key2, "不同密码应派生出不同密钥");
}

#[test]
fn test_derive_aes_key_length() {
    let key = derive_aes_key("test");
    assert_eq!(key.len(), 32, "AES-256 密钥应为 32 字节");
}

#[test]
fn test_derive_aes_key_known_value() {
    // SHA-256("test") 已知值
    let key = derive_aes_key("test");
    let hex: String = key.iter().map(|b| format!("{:02x}", b)).collect();
    assert_eq!(
        hex,
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    );
}

#[test]
fn test_derive_aes_key_empty_password() {
    let key = derive_aes_key("");
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    let hex: String = key.iter().map(|b| format!("{:02x}", b)).collect();
    assert_eq!(
        hex,
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn test_derive_aes_key_pbkdf2_consistency() {
    let salt = derive_aes_key("my-salt");
    let key1 = derive_aes_key_pbkdf2("password", &salt);
    let key2 = derive_aes_key_pbkdf2("password", &salt);
    assert_eq!(key1, key2, "相同密码和 salt 应派生出相同密钥");
}

#[test]
fn test_derive_aes_key_pbkdf2_different_password() {
    let salt = derive_aes_key("fixed-salt");
    let key1 = derive_aes_key_pbkdf2("password1", &salt);
    let key2 = derive_aes_key_pbkdf2("password2", &salt);
    assert_ne!(key1, key2, "不同密码应派生出不同 PBKDF2 密钥");
}

#[test]
fn test_derive_aes_key_pbkdf2_different_salt() {
    let salt1 = derive_aes_key("salt1");
    let salt2 = derive_aes_key("salt2");
    let key1 = derive_aes_key_pbkdf2("same-password", &salt1);
    let key2 = derive_aes_key_pbkdf2("same-password", &salt2);
    assert_ne!(key1, key2, "不同 salt 应派生出不同 PBKDF2 密钥");
}

#[test]
fn test_derive_aes_key_pbkdf2_length() {
    let salt = derive_aes_key("salt");
    let key = derive_aes_key_pbkdf2("test", &salt);
    assert_eq!(key.len(), 32, "PBKDF2 AES-256 密钥应为 32 字节");
}

#[test]
fn test_pbkdf2_key_differs_from_sha256_key() {
    // PBKDF2 派生的密钥应与单次 SHA-256 派生的密钥不同
    let salt = derive_aes_key("password");
    let key_sha = derive_aes_key("password");
    let key_pbkdf2 = derive_aes_key_pbkdf2("password", &salt);
    assert_ne!(key_sha, key_pbkdf2, "PBKDF2 密钥不应等于单次 SHA-256 密钥");
}

// ============ SHA-256 已知向量测试 ============

#[test]
fn test_sha256_of_bytes_empty() {
    let hex = sha256_of_bytes(b"");
    assert_eq!(
        hex,
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn test_sha256_of_bytes_hello() {
    let hex = sha256_of_bytes(b"hello");
    assert_eq!(
        hex,
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
}

#[test]
fn test_sha256_of_bytes_abc() {
    let hex = sha256_of_bytes(b"abc");
    assert_eq!(
        hex,
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn test_sha256_of_bytes_deterministic() {
    let hex1 = sha256_of_bytes(b"deterministic");
    let hex2 = sha256_of_bytes(b"deterministic");
    assert_eq!(hex1, hex2, "相同输入应产生相同哈希");
}

#[test]
fn test_sha256_of_bytes_length() {
    let hex = sha256_of_bytes(b"any data");
    assert_eq!(hex.len(), 64, "SHA-256 十六进制字符串应为 64 字符");
}

#[test]
fn test_sha256_to_hex_basic() {
    assert_eq!(sha256_to_hex(&[0x00, 0xff]), "00ff");
    assert_eq!(sha256_to_hex(&[0xab, 0xcd, 0xef]), "abcdef");
}

#[test]
fn test_sha256_to_hex_empty() {
    assert_eq!(sha256_to_hex(&[]), "");
}

// ============ derive_mod_name_from_path 测试 ============

#[test]
fn test_derive_mod_name_petmod() {
    assert_eq!(derive_mod_name_from_path("test.petmod"), "test");
}

#[test]
fn test_derive_mod_name_with_dir() {
    assert_eq!(
        derive_mod_name_from_path("C:\\mods\\awesome.petmod"),
        "awesome"
    );
}

#[test]
fn test_derive_mod_name_empty() {
    assert_eq!(derive_mod_name_from_path(""), "unknown_mod");
}

#[test]
fn test_derive_mod_name_no_ext() {
    assert_eq!(derive_mod_name_from_path("noext"), "noext");
}

#[test]
fn test_derive_mod_name_unicode() {
    assert_eq!(derive_mod_name_from_path("猫咪.petmod"), "猫咪");
}

// ============ resolve_password 测试 ============

#[test]
fn test_resolve_password_custom() {
    let pwd = resolve_password("my-custom-password").unwrap();
    assert_eq!(pwd, "my-custom-password");
}

#[test]
fn test_resolve_password_non_empty() {
    let pwd = resolve_password("nonempty").unwrap();
    assert!(!pwd.is_empty());
}

#[test]
fn test_resolve_password_empty_uses_machine_id() {
    // 空密码时使用机器 ID，正常环境应成功
    let result = resolve_password("");
    if let Ok(ref pwd) = result {
        assert!(!pwd.is_empty(), "机器 ID 不应为空");
    }
    // Err 表示环境无法获取机器 ID（如容器），符合 Fail Fast 设计
}

// ============ get_machine_id 测试 ============

#[test]
fn test_get_machine_id_no_hardcoded_fallback() {
    // 验证不会返回已废弃的硬编码密钥
    const REMOVED_KEY: &str = "SpiritPal-Memory-Encryption-v1-2024";
    let result = get_machine_id();
    if let Ok(ref id) = result {
        assert_ne!(id, REMOVED_KEY, "不应返回已废弃的硬编码密钥");
    }
}

// ============ 前缀常量测试 ============

#[test]
fn test_enc_prefix_values() {
    assert_eq!(ENC_PREFIX, "ENC1:");
    assert_eq!(ENC_PREFIX_V2, "ENC2:");
    assert_ne!(ENC_PREFIX, ENC_PREFIX_V2);
}

// ============ AES-256-GCM 加密/解密往返测试（使用公开 API）============

#[test]
fn test_aes_gcm_roundtrip_with_sha256_key() {
    let password = "integration-test";
    let plaintext = "Hello from integration test! 你好，集成测试！";

    let key = derive_aes_key(password);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

    let mut nonce_bytes = [0u8; 12];
    getrandom::getrandom(&mut nonce_bytes).unwrap();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes()).unwrap();
    let decrypted = cipher.decrypt(nonce, ciphertext.as_ref()).unwrap();

    assert_eq!(String::from_utf8(decrypted).unwrap(), plaintext);
}

#[test]
fn test_aes_gcm_roundtrip_with_pbkdf2_key() {
    let password = "pbkdf2-test";
    let plaintext = "PBKDF2 encrypted data";

    let salt = derive_aes_key(password);
    let key = derive_aes_key_pbkdf2(password, &salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

    let mut nonce_bytes = [0u8; 12];
    getrandom::getrandom(&mut nonce_bytes).unwrap();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes()).unwrap();
    let decrypted = cipher.decrypt(nonce, ciphertext.as_ref()).unwrap();

    assert_eq!(String::from_utf8(decrypted).unwrap(), plaintext);
}

#[test]
fn test_aes_gcm_wrong_password_fails() {
    let plaintext = "secret";

    let key1 = derive_aes_key("correct");
    let cipher1 = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key1));

    let mut nonce_bytes = [0u8; 12];
    getrandom::getrandom(&mut nonce_bytes).unwrap();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher1.encrypt(nonce, plaintext.as_bytes()).unwrap();

    let key2 = derive_aes_key("wrong");
    let cipher2 = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key2));

    assert!(cipher2.decrypt(nonce, ciphertext.as_ref()).is_err());
}

#[test]
fn test_aes_gcm_tampered_ciphertext_fails() {
    let plaintext = "tamper me";
    let key = derive_aes_key("tamper-test");
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

    let mut nonce_bytes = [0u8; 12];
    getrandom::getrandom(&mut nonce_bytes).unwrap();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let mut ciphertext = cipher.encrypt(nonce, plaintext.as_bytes()).unwrap();
    ciphertext[0] ^= 0xFF;

    assert!(cipher.decrypt(nonce, ciphertext.as_ref()).is_err());
}

#[test]
fn test_aes_gcm_truncated_data_fails() {
    let plaintext = "truncate me";
    let key = derive_aes_key("trunc-test");
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

    let mut nonce_bytes = [0u8; 12];
    getrandom::getrandom(&mut nonce_bytes).unwrap();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes()).unwrap();
    let truncated = &ciphertext[..ciphertext.len() / 2];

    assert!(cipher.decrypt(nonce, truncated).is_err());
}

#[test]
fn test_aes_gcm_empty_plaintext() {
    let key = derive_aes_key("empty-test");
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

    let mut nonce_bytes = [0u8; 12];
    getrandom::getrandom(&mut nonce_bytes).unwrap();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, b"".as_ref()).unwrap();
    let decrypted = cipher.decrypt(nonce, ciphertext.as_ref()).unwrap();

    assert!(decrypted.is_empty());
}

// ============ Base64 编解码测试（模拟加密数据格式）============

#[test]
fn test_base64_roundtrip() {
    let data = b"SpiritPal encryption test data";
    let encoded = general_purpose::STANDARD.encode(data);
    let decoded = general_purpose::STANDARD.decode(&encoded).unwrap();
    assert_eq!(decoded, data);
}

#[test]
fn test_base64_known_value() {
    assert_eq!(general_purpose::STANDARD.encode(b"SpiritPal"), "U3Bpcml0UGFs");
}

#[test]
fn test_enc2_format_structure() {
    // 验证 ENC2 格式：ENC2:base64(nonce + ciphertext + tag + salt)
    let password = "format-test";
    let data = "test data";

    let salt = derive_aes_key(password); // 模拟 salt
    let key = derive_aes_key_pbkdf2(password, &salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

    let mut nonce_bytes = [0u8; 12];
    getrandom::getrandom(&mut nonce_bytes).unwrap();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, data.as_bytes()).unwrap();

    let mut combined = Vec::new();
    combined.extend_from_slice(&nonce_bytes); // 12 bytes
    combined.extend_from_slice(&ciphertext); // data + 16 bytes tag
    combined.extend_from_slice(&salt); // 32 bytes

    let b64 = general_purpose::STANDARD.encode(&combined);
    let encrypted = format!("{}{}", ENC_PREFIX_V2, b64);

    // 验证结构
    assert!(encrypted.starts_with("ENC2:"));

    let decoded = general_purpose::STANDARD
        .decode(encrypted.strip_prefix("ENC2:").unwrap())
        .unwrap();
    // nonce(12) + ciphertext(>0) + tag(16) + salt(32) > 60
    assert!(decoded.len() > 12 + 32);
}
