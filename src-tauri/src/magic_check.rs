//! 上传文件魔数（Magic Number）校验模块，对齐其他项目（TTS/Image/SeedVR2）的输入防护。
//!
//! # 背景
//! SpiritPal 对接外部多模态 / 全模态大语言模型，聊天中可能上传图片、音频等
//! 非文字内容；同时支持 `.petmod`（zip 格式）角色模组导入。为阻止伪装文件
//! （如把 `.exe` 改名 `.png`、伪装媒体数据）混入，本模块在 Rust 端做纵深防御，
//! 通过读取文件头字节判断真实类型，与声明扩展名比对。
//!
//! # 支持的格式
//! - 图片：PNG / JPEG / GIF / BMP / WebP / TIFF
//! - 音频：WAV / MP3 / FLAC / OGG / M4A
//! - 视频：MP4 / MOV / WebM / MKV
//! - 压缩包：ZIP（`.petmod` 使用）
//!
//! # 使用方式（Rust 内部）
//! ```rust,ignore
//! use crate::magic_check::validate_magic;
//! validate_magic(&bytes, ".png")?;
//! ```
//!
//! 前端聊天上传时通过 Tauri 命令 [`crate::validate_upload_magic`] 调用。

/// 检测到的文件类型元信息
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    Image,
    Audio,
    Video,
    Archive,
}

impl FileKind {
    // 仅供 detect_file_kind 使用；detect_file_kind 是聊天上传自动识别的预留 API
    fn as_str(self) -> &'static str {
        match self {
            FileKind::Image => "image",
            FileKind::Audio => "audio",
            FileKind::Video => "video",
            FileKind::Archive => "archive",
        }
    }
}

/// 魔数签名表：{扩展名: (魔数, 偏移量, 文件类别)}
///
/// 偏移量指魔数在文件头中的起始字节位置（如 WebP 的 "WEBP" 位于偏移 8）。
const MAGIC_SIGNATURES: &[(&str, &[u8], usize, FileKind)] = &[
    // 图片
    (".png", b"\x89PNG\r\n\x1a\n", 0, FileKind::Image),
    (".jpg", b"\xff\xd8\xff", 0, FileKind::Image),
    (".jpeg", b"\xff\xd8\xff", 0, FileKind::Image),
    (".gif", b"GIF8", 0, FileKind::Image),
    (".bmp", b"BM", 0, FileKind::Image),
    (".webp", b"WEBP", 8, FileKind::Image),
    (".tif", b"II*\x00", 0, FileKind::Image),
    (".tiff", b"II*\x00", 0, FileKind::Image),
    (".tif", b"MM\x00*", 0, FileKind::Image),
    (".tiff", b"MM\x00*", 0, FileKind::Image),
    // 音频
    (".wav", b"WAVE", 8, FileKind::Audio),
    (".mp3", b"\xff\xfb", 0, FileKind::Audio),
    (".flac", b"fLaC", 0, FileKind::Audio),
    (".ogg", b"OggS", 0, FileKind::Audio),
    (".m4a", b"ftyp", 4, FileKind::Audio),
    // 视频
    (".mp4", b"ftyp", 4, FileKind::Video),
    (".mov", b"ftyp", 4, FileKind::Video),
    (".webm", b"\x1a\x45\xdf\xa3", 0, FileKind::Video),
    (".mkv", b"\x1a\x45\xdf\xa3", 0, FileKind::Video),
    // 压缩包（.petmod 是 zip 格式）
    (".zip", b"PK\x03\x04", 0, FileKind::Archive),
    (".petmod", b"PK\x03\x04", 0, FileKind::Archive),
];

/// 读取文件头用于魔数比对的字节数
const HEADER_READ_SIZE: usize = 12;

/// 从文件字节中提取用于魔数校验的头部
fn header_of(content: &[u8]) -> &[u8] {
    let len = content.len().min(HEADER_READ_SIZE);
    &content[..len]
}

/// 判断字节是否为指定扩展名对应的合法文件内容。
///
/// # 参数
/// - `content` — 文件二进制内容（至少前 12 字节）
/// - `file_ext` — 声明扩展名（含前导点，小写），如 `.png`、`.petmod`
///
/// # 返回
/// - `Ok(())` — 扩展名与魔数匹配
/// - `Err(String)` — 不匹配或无法识别
pub fn validate_magic(content: &[u8], file_ext: &str) -> Result<(), String> {
    let ext = file_ext.trim().to_ascii_lowercase();
    if !ext.starts_with('.') {
        return Err(format!("非法扩展名: {}", file_ext));
    }
    if content.is_empty() {
        return Err("文件内容为空".into());
    }

    let header = header_of(content);
    let mut matched = false;
    for (sig_ext, magic, offset, _kind) in MAGIC_SIGNATURES {
        if *sig_ext != ext {
            continue;
        }
        matched = true;
        if header.len() >= offset + magic.len()
            && &header[*offset..*offset + magic.len()] == *magic
        {
            return Ok(());
        }
    }

    if matched {
        Err(format!(
            "文件扩展名 {ext} 与实际文件内容不匹配（魔数校验失败），文件可能已被伪装或损坏"
        ))
    } else {
        Err(format!("不支持或未登记的文件扩展名: {ext}"))
    }
}

/// 自动检测文件字节对应的媒体类别（不依赖扩展名）。
///
/// 供前端聊天上传时自动识别真实类型，无需用户声明扩展名。
/// 当前为聊天上传功能的预留 API，尚未被命令暴露。
#[allow(dead_code)]
pub fn detect_file_kind(content: &[u8]) -> Option<(FileKind, &'static str)> {
    let header = header_of(content);
    for (_sig_ext, magic, offset, kind) in MAGIC_SIGNATURES {
        if header.len() >= offset + magic.len()
            && &header[*offset..*offset + magic.len()] == *magic
        {
            return Some((*kind, kind.as_str()));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> Vec<u8> {
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec()
    }

    fn jpg() -> Vec<u8> {
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01".to_vec()
    }

    fn zip() -> Vec<u8> {
        b"PK\x03\x04\x14\x00\x00\x00\x08\x00".to_vec()
    }

    fn fake_png() -> Vec<u8> {
        // 伪装为 PNG 后缀，但内容不是 PNG 头
        b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00".to_vec()
    }

    #[test]
    fn validates_known_formats() {
        assert!(validate_magic(&png(), ".png").is_ok());
        assert!(validate_magic(&jpg(), ".jpg").is_ok());
        assert!(validate_magic(&jpg(), ".jpeg").is_ok());
        assert!(validate_magic(&zip(), ".petmod").is_ok());
        assert!(validate_magic(&zip(), ".zip").is_ok());
    }

    #[test]
    fn detects_extension_mismatch() {
        // 伪装文件：声明 PNG 但实为可执行文件
        assert!(validate_magic(&fake_png(), ".png").is_err());
        // 声明 jpg 但实为 png
        assert!(validate_magic(&png(), ".jpg").is_err());
    }

    #[test]
    fn rejects_empty_and_unknown() {
        assert!(validate_magic(&[], ".png").is_err());
        assert!(validate_magic(&png(), ".exe").is_err());
    }

    #[test]
    fn detect_kind_works() {
        assert_eq!(detect_file_kind(&png()), Some((FileKind::Image, "image")));
        assert_eq!(detect_file_kind(&zip()), Some((FileKind::Archive, "archive")));
        assert_eq!(detect_file_kind(&fake_png()), None);
    }
}