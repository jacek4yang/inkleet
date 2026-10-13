use std::{fs, io::{Read, Write}, path::{Path, PathBuf}};

pub fn file_path(root: &Path, problem: &str, language: &str, kind: &str) -> Result<PathBuf, String> {
    if problem.is_empty() || problem.len() > 120 ||
       !problem.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err("无效题目标识".into());
    }
    let ext = match language {
        "python3" => "py", "rust" => "rs", "golang" => "go",
        "c" => "c", "cpp" => "cpp", "java" => "java",
        _ => return Err("不支持的语言".into()),
    };
    let name = match kind {
        "code" => format!("solution.{ext}"), "notes" => "notes.md".into(),
        _ => return Err("不支持的文件类型".into()),
    };
    let dir = root.join(problem);
    if dir.is_symlink() { return Err("拒绝符号链接目录".into()); }
    let path = dir.join(name);
    if path.is_symlink() { return Err("拒绝符号链接文件".into()); }
    Ok(path)
}

const MAX_BYTES: usize = 2 * 1024 * 1024;
pub fn read(path: &Path) -> Result<Option<String>, String> {
    // 限制实际读取量，不能先读完整个异常大文件再检查大小。
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取本机文件".into()),
    };
    if !file.metadata().map_err(|_| "无法检查本机文件")?.is_file() {
        return Err("拒绝读取非普通文件".into());
    }
    let mut bytes = Vec::new();
    file.take((MAX_BYTES + 1) as u64).read_to_end(&mut bytes).map_err(|_| "无法读取本机文件")?;
    if bytes.len() > MAX_BYTES { return Err("文件超过 2 MiB 限制".into()); }
    String::from_utf8(bytes).map(Some).map_err(|_| "文件不是有效 UTF-8 文本".into())
}

pub fn save(path: &Path, expected: Option<&str>, text: &str) -> Result<(), String> {
    if text.len() > MAX_BYTES { return Err("正文超过 2 MiB 限制".into()); }
    if read(path)?.as_deref() != expected { return Err("外部文件已变化，保留两份内容后再处理".into()); }
    let parent = path.parent().ok_or("无效目录")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建目录")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建临时文件")?;
    temp.write_all(text.as_bytes()).map_err(|_| "无法写入正文")?;
    temp.as_file().sync_all().map_err(|_| "正文同步失败")?;
    temp.persist(path).map_err(|_| "原子替换失败")?;
    #[cfg(unix)]
    fs::File::open(parent).and_then(|f| f.sync_all()).map_err(|_| "目录同步失败")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_escape_and_unknown_language() {
        let d = tempfile::tempdir().unwrap();
        for p in ["", "../escape", "a/b", ".", "a\\b"] {
            assert!(file_path(d.path(), p, "rust", "notes").is_err());
        }
        assert!(file_path(d.path(), "ok", "shell", "code").is_err());
    }
    #[test]
    fn source_is_plain_text_and_conflict_is_preserved() {
        let d = tempfile::tempdir().unwrap();
        let p = file_path(d.path(), "sample", "rust", "notes").unwrap();
        save(&p, None, "# 中文笔记").unwrap();
        assert_eq!(read(&p).unwrap().as_deref(), Some("# 中文笔记"));
        save(&p, Some("# 中文笔记"), "second").unwrap();
        assert!(save(&p, Some("# 中文笔记"), "stale overwrite").is_err());
        assert_eq!(read(&p).unwrap().as_deref(), Some("second"));
    }
    #[test]
    fn bounded_reader_rejects_oversize_and_invalid_utf8() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("large.txt");
        let file = fs::File::create(&path).unwrap();
        file.set_len(64 * 1024 * 1024).unwrap();
        assert_eq!(read(&path).unwrap_err(), "文件超过 2 MiB 限制");
        fs::write(&path, [0xff, 0xfe]).unwrap();
        assert_eq!(read(&path).unwrap_err(), "文件不是有效 UTF-8 文本");
        fs::write(&path, "边界文本").unwrap();
        assert_eq!(read(&path).unwrap().as_deref(), Some("边界文本"));
    }
    #[test]
    fn six_languages_have_distinct_files_but_shared_notes() {
        let d = tempfile::tempdir().unwrap();
        let langs = ["python3", "rust", "golang", "c", "cpp", "java"];
        let mut paths = std::collections::HashSet::new();
        for l in langs { paths.insert(file_path(d.path(), "sample", l, "code").unwrap()); }
        assert_eq!(paths.len(), 6);
        assert_eq!(file_path(d.path(), "sample", "rust", "notes").unwrap(),
                   file_path(d.path(), "sample", "cpp", "notes").unwrap());
    }
}
