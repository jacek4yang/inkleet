use std::{fs, io::Write, path::{Path, PathBuf}};

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

pub fn read(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) if text.len() <= 2 * 1024 * 1024 => Ok(Some(text)),
        Ok(_) => Err("文件超过 2 MiB 限制".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("无法读取本机文件".into()),
    }
}

pub fn save(path: &Path, expected: Option<&str>, text: &str) -> Result<(), String> {
    if text.len() > 2 * 1024 * 1024 { return Err("正文超过 2 MiB 限制".into()); }
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
