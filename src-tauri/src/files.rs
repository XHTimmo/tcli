use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const TEXT_LIMIT: u64 = 2 * 1024 * 1024;
const IMAGE_LIMIT: u64 = 10 * 1024 * 1024;
static SAVE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
pub struct FileDocument {
    path: String,
    kind: &'static str,
    content: String,
    revision: String,
    format: String,
}

fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(crate::err)?;
    let metadata = file.metadata().map_err(crate::err)?;
    if !metadata.is_file() {
        return Err("只能打开普通文件".into());
    }
    if metadata.len() > limit {
        return Err(format!("文件过大，最多支持 {} MiB", limit / 1024 / 1024));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).map_err(crate::err)?;
    if bytes.len() as u64 > limit {
        return Err("文件读取过程中超出大小限制".into());
    }
    Ok(bytes)
}

fn text_content(bytes: &[u8]) -> Result<(&str, bool, bool), String> {
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let text = std::str::from_utf8(if bom { &bytes[3..] } else { bytes })
        .map_err(|_| "暂不支持此编码，请使用 UTF-8 文本文件".to_string())?;
    if text.chars().any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t' | '\u{c}')) {
        return Err("此文件包含二进制内容，无法作为文本编辑".into());
    }
    let crlf = text.contains("\r\n") && !text.replace("\r\n", "").contains('\n');
    Ok((text, bom, crlf))
}

fn image_mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

fn read_document(path: &Path) -> Result<FileDocument, String> {
    let path = fs::canonicalize(path).map_err(crate::err)?;
    let mime = image_mime(&path);
    let bytes = read_bounded(&path, if mime.is_some() { IMAGE_LIMIT } else { TEXT_LIMIT })?;
    let revision = revision(&bytes);
    let (kind, content, format) = if let Some(mime) = mime {
        ("image", format!("data:{mime};base64,{}", STANDARD.encode(&bytes)), format!("{:.1} KiB", bytes.len() as f64 / 1024.0))
    } else {
        let (text, bom, crlf) = text_content(&bytes)?;
        ("text", text.replace("\r\n", "\n"), format!("UTF-8{} · {}", if bom { " BOM" } else { "" }, if crlf { "CRLF" } else { "LF" }))
    };
    Ok(FileDocument { path: path.to_string_lossy().into_owned(), kind, content, revision, format })
}

#[tauri::command]
pub fn read_file(path: String) -> Result<FileDocument, String> {
    read_document(Path::new(&path))
}

fn save_document(path: &Path, content: &str, expected: &str) -> Result<String, String> {
    let _lock = SAVE_LOCK.lock().map_err(crate::err)?;
    // Resolve links so replacing the file does not replace a symlink itself.
    let path: PathBuf = fs::canonicalize(path).map_err(crate::err)?;
    let original = read_bounded(&path, TEXT_LIMIT)?;
    if revision(&original) != expected {
        return Err("文件已被其他程序修改，尚未保存。请先复制需要保留的修改，再重新读取文件。".into());
    }
    let (_, bom, crlf) = text_content(&original)?;
    let permissions = fs::metadata(&path).map_err(crate::err)?.permissions();
    if permissions.readonly() {
        return Err("文件为只读，无法保存".into());
    }
    let normalized = content.replace("\r\n", "\n");
    let encoded = if crlf { normalized.replace('\n', "\r\n") } else { normalized };
    let mut bytes = Vec::new();
    if bom { bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]); }
    bytes.extend_from_slice(encoded.as_bytes());
    if bytes.len() as u64 > TEXT_LIMIT {
        return Err("内容超过 2 MiB，无法保存".into());
    }
    // Write beside the original, then replace it atomically so a failed write cannot truncate it.
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("文件路径无效")?).map_err(crate::err)?;
    temp.write_all(&bytes).map_err(crate::err)?;
    temp.as_file().set_permissions(permissions).map_err(crate::err)?;
    temp.as_file().sync_all().map_err(crate::err)?;
    if revision(&read_bounded(&path, TEXT_LIMIT)?) != expected {
        return Err("文件在保存期间发生变化，请重新读取后再保存".into());
    }
    temp.persist(&path).map_err(crate::err)?;
    Ok(revision(&bytes))
}

#[tauri::command]
pub fn save_file(path: String, content: String, revision: String) -> Result<String, String> {
    save_document(Path::new(&path), &content, &revision)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_preserves_bom_crlf_and_detects_external_edits() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("中文.txt");
        fs::write(&path, b"\xef\xbb\xbfhello\r\nworld\r\n").unwrap();
        let doc = read_document(&path).unwrap();
        assert_eq!(doc.content, "hello\nworld\n");
        assert_eq!(doc.format, "UTF-8 BOM · CRLF");
        let saved = save_document(&path, "你好\nworld\n", &doc.revision).unwrap();
        assert_eq!(fs::read(&path).unwrap(), "\u{feff}你好\r\nworld\r\n".as_bytes());
        fs::write(&path, "external").unwrap();
        assert!(save_document(&path, "overwrite", &saved).unwrap_err().contains("其他程序"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
    }

    #[test]
    fn rejects_binary_large_and_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        fs::write(&path, [0, 1, 2]).unwrap();
        assert!(read_document(&path).is_err());
        fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(read_document(&path).is_err());
        File::create(&path).unwrap().set_len(TEXT_LIMIT + 1).unwrap();
        assert!(read_document(&path).is_err());
        fs::remove_file(&path).unwrap();
        assert!(read_document(&path).is_err());
        assert!(save_document(&path, "new", "old").is_err());
        assert!(!path.exists());
    }

    #[test]
    fn empty_text_and_image_preview() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.txt");
        fs::write(&path, "").unwrap();
        let doc = read_document(&path).unwrap();
        let rev = save_document(&path, "first\n", &doc.revision).unwrap();
        assert_eq!(revision(&fs::read(&path).unwrap()), rev);
        assert_eq!(fs::read_to_string(&path).unwrap(), "first\n");
        let image = dir.path().join("test.PNG");
        fs::write(&image, [137, 80, 78, 71]).unwrap();
        let preview = read_document(&image).unwrap();
        assert_eq!(preview.kind, "image");
        assert!(preview.content.starts_with("data:image/png;base64,"));
    }
}
