//! Versioned download settings with visible failures and conflict-safe atomic writes.
use std::{path::PathBuf,sync::Mutex};
use serde::{Serialize,Deserialize};
use std::collections::BTreeMap;
use crate::storage;
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all="camelCase")]
pub struct Document { pub version:u32, #[serde(default)] pub vim:bool, #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="deserialize_tab_size")] pub tab_size:Option<u8>, pub format_on_save:bool, pub overrides:BTreeMap<String,bool> }
// Deserialize the present value directly as u8: explicit null is invalid.
// Missing fields use the serde default (None), with effective display width 4.
fn deserialize_tab_size<'de,D>(deserializer:D)->Result<Option<u8>,D::Error>
where D:serde::Deserializer<'de>{
    let value=u8::deserialize(deserializer)?;
    if !(1..=8).contains(&value){
        return Err(serde::de::Error::custom("tabSize must be an integer from 1 to 8"));
    }
    Ok(Some(value))
}
impl Default for Document{fn default()->Self{Self{version:1,vim:false,tab_size:None,format_on_save:true,overrides:BTreeMap::new()}}}
impl Document{
    fn validated(&self)->Result<(),String>{
        if self.tab_size.is_some_and(|value|!(1..=8).contains(&value)){
            return Err("编辑器 Tab 显示宽度必须是 1 到 8 的整数".into());
        }
        if self.version!=1||self.overrides.len()>6||self.overrides.keys().any(|k|!matches!(k.as_str(),"python3"|"rust"|"golang"|"c"|"cpp"|"java")){
            return Err("编辑器配置版本或语言覆盖无效".into());
        }
        Ok(())
    }
}
#[derive(Clone,Serialize)]
pub struct Snapshot { pub settings:Document, pub revision:Option<String> }
pub struct EditorSettings { path:PathBuf, gate:Mutex<()> }
impl EditorSettings {
    pub fn new(root:PathBuf)->Self{Self{path:root.join("editor-settings.json"),gate:Mutex::new(())}}
    fn check(&self)->Result<(),String>{
        for parent in self.path.ancestors(){
            if parent.is_symlink(){return Err("拒绝符号链接编辑器配置".into());}
        }
        Ok(())
    }
    fn load(&self)->Result<Snapshot,String>{
        self.check()?;
        let revision=storage::read(&self.path)?;
        if revision.as_ref().is_some_and(|s|s.len()>4096){return Err("编辑器配置超过大小限制".into());}
        let settings=match revision.as_deref(){
            None=>Document::default(),
            Some(text)=>serde_json::from_str::<Document>(text).map_err(|_|"编辑器配置损坏，原文件未修改")?,
        };
        if settings.version!=1{return Err("编辑器配置来自不支持的版本，原文件未修改".into());}
        settings.validated()?;
        Ok(Snapshot{settings,revision})
    }
    pub fn get(&self)->Result<Snapshot,String>{
        let _guard=self.gate.lock().map_err(|_|"编辑器配置锁不可用")?;self.load()
    }
    pub fn save(&self,settings:Document,expected:Option<String>)->Result<Snapshot,String>{
        settings.validated()?;
        if expected.as_ref().is_some_and(|s|s.len()>4096){return Err("配置版本无效".into());}
        let _guard=self.gate.lock().map_err(|_|"编辑器配置锁不可用")?;
        let previous=self.load()?;
        if previous.revision!=expected{return Err("编辑器配置已被其他窗口或程序修改，请重新读取后再保存".into());}
        let text=serde_json::to_string_pretty(&settings).map_err(|_|"编辑器配置编码失败")?;
        // Keep the exact prior valid bytes before replacing. A late fsync error
        // must not destroy the user's only recoverable original configuration.
        if let Some(prior)=previous.revision.as_deref(){
            let backup=self.path.with_file_name("editor-settings.previous.json");
            if backup.is_symlink(){return Err("拒绝符号链接配置备份".into());}
            let old=storage::read(&backup)?;
            storage::save(&backup,old.as_deref(),prior).map_err(|_|"无法保存原配置备份，未替换当前配置")?;
        }
        storage::save(&self.path,expected.as_deref(),&text).map_err(|error|format!("编辑器配置保存失败：{error}；请重新读取确认磁盘状态"))?;
        Ok(Snapshot{settings,revision:Some(text)})
    }
}

#[cfg(test)]mod tests{
    // macOS temp roots may be reached through /var -> /private/var. Resolve
    // only the test-owned root; production symlink refusal remains unchanged.
    use super::*;
    #[test]fn tab_size_defaults_bounds_and_round_trip(){
        let legacy=r#"{"version":1,"formatOnSave":true,"overrides":{}}"#;
        let absent:Document=serde_json::from_str(legacy).unwrap();
        assert_eq!(absent.tab_size,None);
        assert_eq!(absent.tab_size.unwrap_or(4),4);
        assert_eq!(Document::default().tab_size,None);
        assert!(!serde_json::to_value(&absent).unwrap().as_object().unwrap().contains_key("tabSize"));
        for width in [1u8,4,8]{
            let mut value=serde_json::from_str::<serde_json::Value>(legacy).unwrap();
            value["tabSize"]=serde_json::json!(width);
            let parsed:Document=serde_json::from_value(value).unwrap();
            assert_eq!(parsed.tab_size,Some(width));
            assert!(parsed.validated().is_ok());
            assert_eq!(parsed.version,1);
            let encoded=serde_json::to_string(&parsed).unwrap();
            assert_eq!(serde_json::from_str::<Document>(&encoded).unwrap().tab_size,Some(width));
        }
    }
    #[test]fn tab_size_rejects_malformed_present_values(){
        for value in [
            serde_json::json!(0),serde_json::json!(9),serde_json::json!(-1),
            serde_json::json!(1.5),serde_json::Value::Null,serde_json::json!("4"),
            serde_json::json!(true),
        ]{
            let input=serde_json::json!({"version":1,"formatOnSave":true,"overrides":{},"tabSize":value});
            assert!(serde_json::from_value::<Document>(input).is_err());
        }
        for width in [0u8,9]{
            let mut invalid=Document::default();invalid.tab_size=Some(width);
            assert!(invalid.validated().is_err());
        }
    }
    #[test]fn tab_size_persistence_keeps_cas_and_backup(){
        let dir=tempfile::tempdir().unwrap();let store=EditorSettings::new(dir.path().canonicalize().unwrap());
        let original=store.save(Document::default(),None).unwrap();
        let mut next=original.settings.clone();next.tab_size=Some(8);
        let saved=store.save(next,original.revision.clone()).unwrap();
        assert_eq!(EditorSettings::new(dir.path().canonicalize().unwrap()).get().unwrap().settings.tab_size,Some(8));
        assert_eq!(std::fs::read_to_string(dir.path().join("editor-settings.previous.json")).unwrap(),original.revision.unwrap());
        assert!(store.save(Document::default(),None).is_err());
        assert_eq!(store.get().unwrap().revision,saved.revision);
    }
    #[test]fn legacy_vim_default_and_persistence(){
        let old:Document=serde_json::from_str(r#"{"version":1,"formatOnSave":false,"overrides":{}}"#).unwrap();
        assert!(!old.vim);
        let dir=tempfile::tempdir().unwrap();let store=EditorSettings::new(dir.path().canonicalize().unwrap());
        let mut next=old;next.vim=true;let saved=store.save(next,None).unwrap();
        assert!(EditorSettings::new(dir.path().canonicalize().unwrap()).get().unwrap().settings.vim);
        assert!(store.save(Document::default(),None).is_err());assert_eq!(store.get().unwrap().revision,saved.revision);
    }
    #[test]fn defaults_cas_overrides_and_restart(){
        let dir=tempfile::tempdir().unwrap();let store=EditorSettings::new(dir.path().canonicalize().unwrap());
        assert!(store.get().unwrap().settings.format_on_save);
        let mut settings=Document::default();settings.overrides.insert("rust".into(),false);
        let saved=store.save(settings,None).unwrap();
        assert_eq!(EditorSettings::new(dir.path().canonicalize().unwrap()).get().unwrap().settings.overrides["rust"],false);
        assert!(store.save(Document::default(),None).is_err());
        assert_eq!(store.get().unwrap().revision,saved.revision);
        let mut invalid=Document::default();invalid.overrides.insert("shell".into(),true);
        assert!(store.save(invalid,saved.revision).is_err());
    }
    #[test]fn corrupt_or_failed_persistence_keeps_original(){
        let dir=tempfile::tempdir().unwrap();let store=EditorSettings::new(dir.path().canonicalize().unwrap());
        let old=store.save(Document::default(),None).unwrap();
        std::fs::create_dir(dir.path().join("editor-settings.previous.json")).unwrap();
        assert!(store.save(Document::default(),old.revision.clone()).is_err());
        assert_eq!(store.get().unwrap().revision,old.revision);
        std::fs::write(&store.path,"broken").unwrap();
        assert!(store.save(Document::default(),Some("broken".into())).is_err());
        assert_eq!(std::fs::read_to_string(&store.path).unwrap(),"broken");
    }
}


#[cfg(all(test,unix))]
mod symlink_regression_tests {
    use super::*;
    use std::os::unix::fs::symlink;
    #[test]
    fn refuses_linked_root_config_and_backup_without_changing_targets() {
        let temp=tempfile::tempdir().unwrap();
        let root=temp.path().canonicalize().unwrap();
        let real=root.join("real");std::fs::create_dir(&real).unwrap();
        let alias=root.join("alias");symlink(&real,&alias).unwrap();
        let linked=EditorSettings::new(alias);
        assert!(linked.get().is_err());
        assert!(linked.save(Document::default(),None).is_err());
        assert!(!real.join("editor-settings.json").exists());
        let target=root.join("untouched");std::fs::write(&target,"original").unwrap();
        let store=EditorSettings::new(real.clone());
        symlink(&target,&store.path).unwrap();
        assert!(store.get().is_err());
        assert!(store.save(Document::default(),None).is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(),"original");
        std::fs::remove_file(&store.path).unwrap();
        let saved=store.save(Document::default(),None).unwrap();
        symlink(&target,real.join("editor-settings.previous.json")).unwrap();
        assert!(store.save(Document::default(),saved.revision.clone()).is_err());
        assert_eq!(store.get().unwrap().revision,saved.revision);
        assert_eq!(std::fs::read_to_string(&target).unwrap(),"original");
    }
}
