//! Versioned download settings with visible failures and conflict-safe atomic writes.
use std::{path::PathBuf,sync::Mutex};
use serde::{Serialize,Deserialize};
use inkleet_managed_env::DownloadProxy;
use crate::storage;
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Document { pub version:u32, pub proxy:DownloadProxy }
#[derive(Clone,Serialize)]
pub struct Snapshot { pub settings:Document, pub revision:Option<String> }
pub struct DownloadSettings { path:PathBuf, gate:Mutex<()> }
impl DownloadSettings {
    pub fn new(root:PathBuf)->Self{Self{path:root.join("download-settings.json"),gate:Mutex::new(())}}
    fn check(&self)->Result<(),String>{
        for parent in self.path.ancestors(){
            if parent.is_symlink(){return Err("拒绝符号链接下载配置".into());}
        }
        Ok(())
    }
    fn load(&self)->Result<Snapshot,String>{
        self.check()?;
        let revision=storage::read(&self.path)?;
        if revision.as_ref().is_some_and(|s|s.len()>4096){return Err("下载配置超过大小限制".into());}
        let settings=match revision.as_deref(){
            None=>Document{version:1,proxy:DownloadProxy::default()},
            Some(text)=>serde_json::from_str::<Document>(text).map_err(|_|"下载配置损坏，原文件未修改")?,
        };
        if settings.version!=1{return Err("下载配置来自不支持的版本，原文件未修改".into());}
        settings.proxy.validated()?;
        Ok(Snapshot{settings,revision})
    }
    pub fn get(&self)->Result<Snapshot,String>{
        let _guard=self.gate.lock().map_err(|_|"下载配置锁不可用")?;self.load()
    }
    pub fn save(&self,proxy:DownloadProxy,expected:Option<String>)->Result<Snapshot,String>{
        let proxy=proxy.validated()?;
        if expected.as_ref().is_some_and(|s|s.len()>4096){return Err("配置版本无效".into());}
        let _guard=self.gate.lock().map_err(|_|"下载配置锁不可用")?;
        let previous=self.load()?;
        if previous.revision!=expected{return Err("下载配置已被其他窗口或程序修改，请重新读取后再保存".into());}
        let settings=Document{version:1,proxy};
        let text=serde_json::to_string_pretty(&settings).map_err(|_|"下载配置编码失败")?;
        // Keep the exact prior valid bytes before replacing. A late fsync error
        // must not destroy the user's only recoverable original configuration.
        if let Some(prior)=previous.revision.as_deref(){
            let backup=self.path.with_file_name("download-settings.previous.json");
            if backup.is_symlink(){return Err("拒绝符号链接配置备份".into());}
            let old=storage::read(&backup)?;
            storage::save(&backup,old.as_deref(),prior).map_err(|_|"无法保存原配置备份，未替换当前配置")?;
        }
        storage::save(&self.path,expected.as_deref(),&text).map_err(|error|format!("下载配置保存失败：{error}；请重新读取确认磁盘状态"))?;
        Ok(Snapshot{settings,revision:Some(text)})
    }
}
#[cfg(test)]mod tests{
    use super::*;use inkleet_managed_env::download_proxy::ProxyMode;
    fn custom()->DownloadProxy{DownloadProxy{mode:ProxyMode::Custom,url:"http://127.0.0.1:7890".into()}}
    #[test]fn saves_restarts_and_preserves_original_on_conflict(){
        let temp=tempfile::tempdir().unwrap();let store=DownloadSettings::new(temp.path().into());
        assert!(store.get().unwrap().revision.is_none());
        let one=store.save(custom(),None).unwrap();
        assert_eq!(DownloadSettings::new(temp.path().into()).get().unwrap().settings.proxy,one.settings.proxy);
        let two=store.save(DownloadProxy{mode:ProxyMode::Direct,url:String::new()},one.revision.clone()).unwrap();
        assert!(store.save(custom(),one.revision.clone()).is_err());
        assert_eq!(store.get().unwrap().revision,two.revision);
        assert_eq!(std::fs::read_to_string(temp.path().join("download-settings.previous.json")).unwrap(),one.revision.unwrap());
    }
    #[test]fn invalid_or_corrupt_settings_are_never_overwritten(){
        let temp=tempfile::tempdir().unwrap();let store=DownloadSettings::new(temp.path().into());
        let invalid=DownloadProxy{mode:ProxyMode::Custom,url:"http://user:secret@localhost:7".into()};
        assert!(store.save(invalid,None).is_err());assert!(!store.path.exists());
        std::fs::write(&store.path,"corrupt").unwrap();
        assert!(store.save(custom(),Some("corrupt".into())).is_err());
        assert_eq!(std::fs::read_to_string(&store.path).unwrap(),"corrupt");
    }
    #[test]fn failed_backup_keeps_previous_configuration(){
        let temp=tempfile::tempdir().unwrap();let store=DownloadSettings::new(temp.path().into());
        let old=store.save(custom(),None).unwrap();
        std::fs::create_dir(temp.path().join("download-settings.previous.json")).unwrap();
        assert!(store.save(DownloadProxy::default(),old.revision.clone()).is_err());
        assert_eq!(store.get().unwrap().revision,old.revision);
    }
}
