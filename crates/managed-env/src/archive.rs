use crate::{Result, io, canceled};
use std::{collections::HashSet, fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}, sync::atomic::AtomicBool};
const MAX_FILE: u64 = 256 * 1024 * 1024;
const MAX_TOTAL: u64 = 1024 * 1024 * 1024;

pub(crate) fn safe_path(value: &str) -> Result<PathBuf> {
    if value.is_empty() || value.len() > 4096 || value.starts_with('/') || value.contains('\\')
        || value.contains(':') || value.chars().any(char::is_control) {
        return Err("压缩包路径不安全".into());
    }
    let mut out = PathBuf::new();
    for part in value.split('/') {
        if part.is_empty() || part == "." { continue; }
        if part == ".." || part.ends_with('.') || part.ends_with(' ') { return Err("压缩包路径越界".into()); }
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if matches!(stem.as_str(), "CON"|"PRN"|"AUX"|"NUL") || (stem.len()==4 && (stem.starts_with("COM")||stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit()) {
            return Err("压缩包含系统保留文件名".into());
        }
        out.push(part);
    }
    if out.as_os_str().is_empty() { return Err("压缩包路径为空".into()); }
    Ok(out)
}
fn stripped(value: &str, prefix: &str) -> Result<PathBuf> {
    let path = safe_path(value)?;
    let path = path.strip_prefix(prefix).map_err(|_| "压缩包根目录不匹配")?;
    Ok(path.to_path_buf())
}
fn link_target(path: &Path, target: &str, hard: bool, prefix: &str) -> Result<PathBuf> {
    if hard { return stripped(target, prefix); }
    if target.starts_with('/') || target.contains('\\') || target.contains(':') || target.chars().any(char::is_control) { return Err("压缩包链接越界".into()); }
    let mut result = path.parent().unwrap_or(Path::new("")).to_path_buf();
    for part in target.split('/') {
        match part {
            "" | "." => {},
            ".." => { if !result.pop() { return Err("压缩包链接逃逸".into()); } },
            p => result.push(safe_path(p)?),
        }
    }
    if result.as_os_str().is_empty() { return Err("压缩包链接指向根目录".into()); }
    Ok(result)
}
fn copy_cancelled(mut from: impl Read, to: &mut File, expected: u64, cancel: &AtomicBool) -> Result<()> {
    let mut copied = 0u64; let mut buffer = [0u8; 65536];
    loop {
        canceled(cancel)?;
        let n = io(from.read(&mut buffer))?;
        if n == 0 { break; }
        copied += n as u64; if copied > expected { return Err("解压内容长度超限".into()); }
        io(to.write_all(&buffer[..n]))?;
    }
    if copied != expected { return Err("压缩包内容截断".into()); }
    Ok(())
}
pub(crate) fn extract(archive: &Path, root: &Path, prefix: &str, cancel: &AtomicBool) -> Result<()> {
    extract_reader(flate2::read::GzDecoder::new(io(File::open(archive))?), root, prefix, cancel)
}
fn extract_reader(reader: impl Read, root: &Path, prefix: &str, cancel: &AtomicBool) -> Result<()> {
    let mut archive = tar::Archive::new(reader);
    let mut total = 0u64; let mut count = 0usize; let mut seen = HashSet::new(); let mut links = Vec::new();
    for item in io(archive.entries())? {
        canceled(cancel)?; count += 1; if count > 50000 { return Err("压缩包文件数量超限".into()); }
        let mut entry = io(item)?;
        let bytes = entry.path_bytes().into_owned();
        let path = stripped(std::str::from_utf8(&bytes).map_err(|_| "压缩包路径编码无效")?, prefix)?;
        let kind = entry.header().entry_type();
        if path.as_os_str().is_empty() && kind.is_dir() { continue; }
        if path.as_os_str().is_empty() { return Err("压缩包根条目类型无效".into()); }
        if !kind.is_dir() && !seen.insert(path.clone()) { return Err("压缩包重复文件路径".into()); }
        let dest = root.join(&path);
        if kind.is_dir() { io(fs::create_dir_all(dest))?; continue; }
        if kind.is_symlink() || kind.is_hard_link() {
            let target = entry.link_name_bytes().ok_or("压缩包链接缺少目标")?.into_owned();
            let target = link_target(&path, std::str::from_utf8(&target).map_err(|_| "链接编码无效")?, kind.is_hard_link(), prefix)?;
            links.push((path, target)); continue;
        }
        if !kind.is_file() { return Err("压缩包包含设备、稀疏文件或其他不支持条目".into()); }
        let size = io(entry.header().size())?;
        total = total.checked_add(size).ok_or("解压总长度溢出")?;
        if size > MAX_FILE || total > MAX_TOTAL { return Err("解压内容大小超限".into()); }
        io(fs::create_dir_all(dest.parent().ok_or("压缩包路径无父目录")?))?;
        let mut file = io(OpenOptions::new().write(true).create_new(true).open(&dest)).map_err(|e| format!("创建分发文件 {} 失败：{e}", path.display()))?;
        copy_cancelled(&mut entry, &mut file, size, cancel)?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            let mode = io(entry.header().mode())?;
            io(file.set_permissions(fs::Permissions::from_mode(if mode & 0o111 != 0 { 0o755 } else { 0o644 })))?;
        }
        io(file.sync_all())?;
    }
    // Materialize validated file links after all regular files. No symlinks are ever created.
    // This avoids Windows developer-mode requirements and archive symlink traversal.
    for _ in 0..32 {
        if links.is_empty() { return Ok(()); }
        let mut pending = Vec::new(); let mut progressed = false;
        for (path, target) in links {
            canceled(cancel)?;
            let source = root.join(&target);
            if !source.exists() { pending.push((path, target)); continue; }
            let meta = io(fs::symlink_metadata(&source))?;
            if !meta.is_file() || meta.file_type().is_symlink() { return Err("压缩包目录链接不受支持".into()); }
            total = total.checked_add(meta.len()).ok_or("链接复制长度溢出")?;
            if total > MAX_TOTAL || meta.len() > MAX_FILE { return Err("链接复制总量超限".into()); }
            let dest = root.join(&path); io(fs::create_dir_all(dest.parent().ok_or("链接路径无父目录")?))?;
            let mut file = io(OpenOptions::new().write(true).create_new(true).open(&dest))?;
            copy_cancelled(io(File::open(source))?, &mut file, meta.len(), cancel)?;
            io(file.set_permissions(meta.permissions()))?; io(file.sync_all())?;
            progressed = true;
        }
        links = pending;
        if !progressed { break; }
    }
    if links.is_empty() { Ok(()) } else { Err("压缩包链接循环、缺失或过深".into()) }
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn rejects_traversal_and_windows_escape() {
        for p in ["../x", "/x", "C:/x", "a\\b", "a/../b", "a/NUL.txt", "a. /x", "x\0y"] { assert!(safe_path(p).is_err(), "{p}"); }
        assert_eq!(safe_path("./a/b").unwrap(), PathBuf::from("a/b"));
        assert!(link_target(Path::new("bin/python"), "../../escape", false, "python").is_err());
        assert_eq!(link_target(Path::new("bin/python"), "../lib/python", false, "python").unwrap(), PathBuf::from("lib/python"));
    }
    fn tar_bytes(link: Option<&str>) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        let mut h = tar::Header::new_gnu(); h.set_size(3); h.set_mode(0o755); h.set_cksum();
        builder.append_data(&mut h, "python/bin/real", &b"abc"[..]).unwrap();
        if let Some(target) = link {
            let mut h = tar::Header::new_gnu(); h.set_size(0); h.set_mode(0o777); h.set_entry_type(tar::EntryType::Symlink);
            builder.append_link(&mut h, "python/bin/python", target).unwrap();
        }
        builder.into_inner().unwrap()
    }
    #[test] fn links_become_regular_files_only() {
        let d = tempfile::tempdir().unwrap();
        extract_reader(&tar_bytes(Some("real"))[..], d.path(), "python", &AtomicBool::new(false)).unwrap();
        assert_eq!(fs::read(d.path().join("bin/python")).unwrap(), b"abc");
        assert!(!fs::symlink_metadata(d.path().join("bin/python")).unwrap().file_type().is_symlink());
    }
    #[test] fn escaping_links_never_extract() {
        let d = tempfile::tempdir().unwrap();
        assert!(extract_reader(&tar_bytes(Some("../../escape"))[..], d.path(), "python", &AtomicBool::new(false)).is_err());
        assert!(!d.path().join("bin/python").exists());
    }
    #[test] fn cancellation_leaves_no_executable() {
        let d = tempfile::tempdir().unwrap();
        assert!(extract_reader(&tar_bytes(None)[..], d.path(), "python", &AtomicBool::new(true)).is_err());
        assert!(!d.path().join("bin/real").exists());
    }
    #[test] fn truncated_archive_is_rejected() {
        let d = tempfile::tempdir().unwrap(); let bytes=tar_bytes(None);
        assert!(extract_reader(&bytes[..513], d.path(), "python", &AtomicBool::new(false)).is_err());
    }
}
