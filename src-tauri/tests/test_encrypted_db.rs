//! encrypted_db 模块集成测试
//!
//! 测试数据库加密的数据流（Base64 往返），
//! 模拟 encrypt_db_at_rest / decrypt_db_at_rest 的数据编解码路径。

use base64::{engine::general_purpose, Engine};

// ============ Base64 往返测试（模拟数据库加密数据流）============

#[test]
fn test_db_base64_roundtrip_binary() {
    // 模拟数据库文件内容（全字节值）
    let original: Vec<u8> = (0..=255).collect();
    let encoded = general_purpose::STANDARD.encode(&original);
    let decoded = general_purpose::STANDARD.decode(&encoded).unwrap();
    assert_eq!(decoded, original);
}

#[test]
fn test_db_base64_roundtrip_empty() {
    let original: Vec<u8> = vec![];
    let encoded = general_purpose::STANDARD.encode(&original);
    let decoded = general_purpose::STANDARD.decode(&encoded).unwrap();
    assert_eq!(decoded, original);
}

#[test]
fn test_db_base64_roundtrip_sqlite_header() {
    // SQLite 文件以 "SQLite format 3\0" 开头
    let original = b"SQLite format 3\x00test database content";
    let encoded = general_purpose::STANDARD.encode(original);
    let decoded = general_purpose::STANDARD.decode(&encoded).unwrap();
    assert_eq!(decoded, original);
    // 验证 SQLite 头部特征保留
    assert_eq!(&decoded[0..16], b"SQLite format 3\x00");
}

#[test]
fn test_db_base64_roundtrip_large() {
    // 模拟 1MB 数据库文件
    let original: Vec<u8> = (0..1024 * 1024).map(|i| (i % 256) as u8).collect();
    let encoded = general_purpose::STANDARD.encode(&original);
    let decoded = general_purpose::STANDARD.decode(&encoded).unwrap();
    assert_eq!(decoded, original);
}

#[test]
fn test_db_base64_roundtrip_unicode() {
    let original = "数据库内容 — 记忆数据 🐱".as_bytes();
    let encoded = general_purpose::STANDARD.encode(original);
    let decoded = general_purpose::STANDARD.decode(&encoded).unwrap();
    assert_eq!(decoded, original);
}

#[test]
fn test_db_base64_preserves_sqlite_page_structure() {
    // SQLite 页大小通常为 4096 字节
    let page: Vec<u8> = (0..4096).map(|i| (i % 256) as u8).collect();
    let encoded = general_purpose::STANDARD.encode(&page);
    let decoded = general_purpose::STANDARD.decode(&encoded).unwrap();
    assert_eq!(decoded.len(), 4096);
    assert_eq!(decoded, page);
}

#[test]
fn test_db_base64_known_value() {
    // 验证已知编码值
    assert_eq!(
        general_purpose::STANDARD.encode(b"SpiritPal DB"),
        "U3Bpcml0UGFsIERC"
    );
}

// ============ 加密数据格式模拟测试 ============
// 模拟 encrypt_db_at_rest 的流程：read → base64 encode → encrypt → write
// 此处仅测试 base64 部分，加密部分在 test_crypto.rs 中测试

#[test]
fn test_db_encrypt_decrypt_data_flow() {
    // 模拟数据库内容
    let db_content =
        b"SQLite format 3\x00CREATE TABLE memories (id INTEGER PRIMARY KEY, content TEXT);";

    // 步骤 1: 转为 base64（模拟 encrypt_db_at_rest 中的一步）
    let content_b64 = general_purpose::STANDARD.encode(db_content);

    // 步骤 2: 解码还原（模拟 decrypt_db_at_rest 中的一步）
    let restored = general_purpose::STANDARD.decode(&content_b64).unwrap();

    assert_eq!(restored, db_content);
    // 验证 SQLite 头部保留
    assert_eq!(&restored[0..16], b"SQLite format 3\x00");
}
