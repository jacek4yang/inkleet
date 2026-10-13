//! Application-owned tools. This is environment isolation, NOT a security sandbox.
//! Only compiled-in, hash-pinned packages can be installed; callers never pass URLs.
mod archive;
pub mod protocol;
pub mod rpc;
pub mod process;
pub mod harness;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf},
    sync::{Arc, atomic::{AtomicBool, Ordering}}, time::Duration};
type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Package {
    pub id: String, pub platform: String, pub version: String, pub url: String,
    pub sha256: String, pub size: u64, pub archive: String, pub prefix: String,
    pub entry: String, pub license: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Progress { pub phase: &'static str, pub downloaded: u64, pub total: u64 }
pub type Report = Arc<dyn Fn(Progress) + Send + Sync>;
#[derive(Clone)]
pub struct Manager { root: PathBuf }
#[derive(Serialize, Deserialize)]
struct Receipt { package_hash: String, entry_hash: String }
pub fn platform() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux","x86_64") => "linux-x64", ("windows","x86_64") => "windows-x64",
        ("macos","x86_64") => "macos-x64", ("macos","aarch64") => "macos-arm64",
        _ => "unsupported",
    }
}
pub fn catalogue() -> Vec<Package> {
    serde_json::from_str(include_str!("../packages.json")).expect("reviewed built-in manifest")
}
pub fn package(id: &str) -> Result<Package> {
    catalogue().into_iter().find(|p| p.id == id && (p.platform == platform() || p.platform == "any"))
        .ok_or_else(|| "该工具尚未支持当前平台".into())
}
fn canceled(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) { Err("安装已取消；可稍后继续下载".into()) } else { Ok(()) }
}
fn io<T>(r: std::io::Result<T>) -> Result<T> { r.map_err(|e| format!("工具文件操作失败：{e}")) }
fn hash_file(path: &Path, cancel: &AtomicBool) -> Result<String> {
    let mut f = io(File::open(path))?;
    let mut h = Sha256::new(); let mut buf = [0u8; 65536];
    loop { canceled(cancel)?; let n = io(f.read(&mut buf))?; if n == 0 { break } h.update(&buf[..n]); }
    Ok(format!("{:x}", h.finalize()))
}
fn regular(path: &Path) -> Result<()> {
    let m = io(fs::symlink_metadata(path))?;
    if m.file_type().is_symlink() || !m.is_file() { return Err("工具路径不是普通文件".into()); }
    Ok(())
}
fn directory(path: &Path) -> Result<()> {
    // Reject an existing symlink in every ancestor, including a replaced app-owned root.
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(m) if m.file_type().is_symlink() || !m.is_dir() => return Err("工具目录含不安全的链接或非目录".into()),
            Ok(_) => {}, Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
            Err(e) => return Err(format!("无法检查工具目录：{e}")),
        }
    }
    io(fs::create_dir_all(path))
}
fn host_allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && matches!(url.host_str(), Some("github.com" | "release-assets.githubusercontent.com" | "objects.githubusercontent.com" | "nodejs.org" | "static.rust-lang.org" | "ziglang.org" | "files.pythonhosted.org" | "go.dev" | "dl.google.com"))
}
impl Manager {
    pub fn new(root: PathBuf) -> Self { Self { root } }
    fn destination(&self, p: &Package) -> PathBuf { self.root.join("packages").join(format!("{}-{}", p.id, p.sha256)) }
    pub fn installed(&self, id: &str) -> Result<Option<PathBuf>> {
        let p = package(id)?; let dest = self.destination(&p);
        if !dest.exists() { return Ok(None); }
        directory(&dest)?;
        let receipt = dest.join(".inkleet-receipt.json"); regular(&receipt)?;
        if io(fs::metadata(&receipt))?.len() > 4096 { return Err("工具安装记录损坏，请修复".into()); }
        let r: Receipt = serde_json::from_slice(&io(fs::read(receipt))?).map_err(|_| "工具安装记录损坏")?;
        let entry = dest.join(&p.entry); regular(&entry)?;
        if r.package_hash != p.sha256 || r.entry_hash != hash_file(&entry, &AtomicBool::new(false))? {
            return Err("工具文件校验失败，请修复".into());
        }
        Ok(Some(entry))
    }
    pub async fn install(&self, id: &str, cancel: Arc<AtomicBool>, report: Report) -> Result<PathBuf> {
        let p = package(id)?;
        if platform() == "unsupported" { return Err("当前平台尚不支持本地开发环境".into()); }
        directory(&self.root)?;
        let locks = self.root.join("locks"); directory(&locks)?;
        let lock_path = locks.join(format!("{}.lock", p.id));
        if lock_path.exists() { regular(&lock_path)?; }
        let lock = io(OpenOptions::new().read(true).write(true).create(true).truncate(false).open(lock_path))?;
        lock.try_lock().map_err(|_| "此工具正在另一个安装任务中，请稍后重试")?;
        if let Ok(Some(entry)) = self.installed(id) { return Ok(entry); }
        canceled(&cancel)?;
        let downloads = self.root.join("downloads"); directory(&downloads)?;
        let partial = downloads.join(format!("{}.part", p.sha256));
        download(&p, &partial, &cancel, &report).await?;
        canceled(&cancel)?;
        let manager = self.clone();
        let verified_cancel = cancel.clone();
        let entry = tokio::task::spawn_blocking(move || -> Result<PathBuf> {
            report(Progress { phase: "verifying", downloaded: p.size, total: p.size });
            if hash_file(&partial, &verified_cancel)? != p.sha256 {
                // A bad cache can never become executable; truncate only this app-owned partial.
                io(OpenOptions::new().write(true).truncate(true).open(&partial))?;
                return Err("下载校验失败，已丢弃损坏内容；请重试".into());
            }
            canceled(&verified_cancel)?;
            let packages = manager.root.join("packages"); directory(&packages)?;
            let stage = io(tempfile::Builder::new().prefix(".install-").tempdir_in(&packages))?;
            report(Progress { phase: "extracting", downloaded: p.size, total: p.size });
            if p.archive == "raw" {
                archive::safe_path(&p.entry)?;
                io(fs::copy(&partial, stage.path().join(&p.entry)))?;
            } else {
                match p.archive.as_str() {
                    "tar-gz"=>archive::extract(&partial,stage.path(),&p.prefix,&verified_cancel),
                    "tar-xz"=>archive::extract_xz(&partial,stage.path(),&p.prefix,&verified_cancel),
                    "zip"=>archive::extract_zip(&partial,stage.path(),&p.prefix,&verified_cancel),
                    _=>Err("不支持的分发包格式".into()),
                }.map_err(|e|format!("解压工具失败：{e}"))?;
            }
            let entry = stage.path().join(&p.entry); regular(&entry)?;
            let receipt = Receipt { package_hash: p.sha256.clone(), entry_hash: hash_file(&entry, &verified_cancel)? };
            let receipt_file = stage.path().join(".inkleet-receipt.json");
            let mut f = io(OpenOptions::new().write(true).create_new(true).open(receipt_file))?;
            io(f.write_all(&serde_json::to_vec(&receipt).map_err(|_| "无法写入安装记录")?))?; io(f.sync_all())?; drop(f);
            canceled(&verified_cancel)?;
            let dest = manager.destination(&p);
            // Repair never deletes an existing installation. Keep it for diagnostics/rollback.
            if dest.exists() {
                directory(&dest)?;
                let backup = io(tempfile::Builder::new().prefix(".repair-").tempdir_in(&packages))?;
                io(fs::rename(&dest, backup.path().join("previous")))?;
                let _ = backup.keep();
            }
            io(fs::rename(stage.path(), &dest)).map_err(|e| format!("激活工具目录失败：{e}"))?;
            #[cfg(unix)] io(File::open(&packages).and_then(|f| f.sync_all()))?;
            Ok(dest.join(p.entry))
        }).await.map_err(|_| "工具安装任务中断")??;
        drop(lock);
        Ok(entry)
    }
}
async fn download(p: &Package, path: &Path, cancel: &AtomicBool, report: &Report) -> Result<()> {
    if path.exists() { regular(path)?; }
    let mut offset = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if offset > p.size { io(OpenOptions::new().write(true).truncate(true).open(path))?; offset = 0; }
    if offset == p.size { return Ok(()); }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10)).read_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(900))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 5 || !host_allowed(attempt.url()) { attempt.error("untrusted tool download redirect") }
            else { attempt.follow() }
        })).build().map_err(|_| "无法创建工具下载连接")?;
    let url = reqwest::Url::parse(&p.url).map_err(|_| "工具清单地址错误")?;
    if !host_allowed(&url) { return Err("工具下载来源不受信任".into()); }
    canceled(cancel)?;
    let mut request = client.get(url).header("Accept-Encoding", "identity");
    if offset > 0 { request = request.header("Range", format!("bytes={offset}-")); }
    let mut response = request.send().await.map_err(|_| "下载连接失败，已保留断点，可重试")?;
    canceled(cancel)?;
    if response.status() == reqwest::StatusCode::PARTIAL_CONTENT && offset > 0 {
        let expected = format!("bytes {offset}-{}/{}", p.size - 1, p.size);
        if response.headers().get("Content-Range").and_then(|v| v.to_str().ok()) != Some(expected.as_str()) {
            return Err("服务器返回了不一致的下载断点".into());
        }
    } else if response.status() == reqwest::StatusCode::OK { offset = 0; }
    else { return Err(format!("工具下载失败（HTTP {}），可重试", response.status().as_u16())); }
    let mut file = io(OpenOptions::new().create(true).write(true).append(offset > 0).truncate(offset == 0).open(path))?;
    report(Progress { phase: "downloading", downloaded: offset, total: p.size });
    while let Some(chunk) = response.chunk().await.map_err(|_| "下载中断，已保留断点，可重试")? {
        canceled(cancel)?;
        offset = offset.checked_add(chunk.len() as u64).ok_or("下载长度溢出")?;
        if offset > p.size { return Err("下载超过清单允许大小".into()); }
        io(file.write_all(&chunk))?;
        report(Progress { phase: "downloading", downloaded: offset, total: p.size });
    }
    io(file.sync_all())?;
    if offset != p.size { return Err("下载不完整，已保留断点，可重试".into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn manifest_is_pinned_and_unique() {
        let mut keys = std::collections::HashSet::new();
        for p in catalogue() {
            assert!(keys.insert((p.id.clone(), p.platform.clone())));
            assert_eq!(p.sha256.len(), 64); assert!(p.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
            assert!(p.size > 0 && p.size < 512 * 1024 * 1024);
            assert!(host_allowed(&reqwest::Url::parse(&p.url).unwrap()));
            assert!(matches!(p.archive.as_str(), "tar-gz" | "tar-xz" | "zip" | "raw"));
            archive::safe_path(&p.entry).unwrap();
        }
    }
    #[test] fn hostile_download_hosts_are_rejected() {
        for url in ["http://github.com/x", "https://github.com.evil.test/x", "https://user@github.com/x", "https://nodejs.org:8443/x"] {
            assert!(!host_allowed(&reqwest::Url::parse(url).unwrap()));
        }
    }
    #[test] fn canceled_install_does_not_start_network() {
        assert!(canceled(&AtomicBool::new(true)).is_err());
    }
    #[cfg(unix)] #[test] fn symlink_root_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(temp.path(), temp.path().join("link")).unwrap();
        assert!(directory(&temp.path().join("link/nested")).is_err());
    }
}
