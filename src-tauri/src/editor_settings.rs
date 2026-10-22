//! Versioned download settings with visible failures and conflict-safe atomic writes.
use std::{path::PathBuf,sync::Mutex};
use serde::{Serialize,Deserialize};
use std::collections::BTreeMap;
use crate::storage;
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all="camelCase")]
pub struct Document { #[serde(deserialize_with="deserialize_version")] pub version:u32, #[serde(default)] pub vim:bool, #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="deserialize_tab_size")] pub tab_size:Option<u8>, pub format_on_save:bool, #[serde(deserialize_with="deserialize_overrides")] pub overrides:BTreeMap<String,bool>,
 #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="deserialize_present")] pub theme:Option<Theme>,
 #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="deserialize_font_size")] pub font_size:Option<u8>,
 #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="deserialize_present")] pub line_height:Option<f64>,
 #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="deserialize_present")] pub word_wrap:Option<bool>,
 #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="deserialize_present")] pub line_numbers:Option<bool>,
 #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="deserialize_present")] pub indent_guides:Option<bool>,
 #[serde(default,skip_serializing_if="Option::is_none",deserialize_with="deserialize_present")] pub highlight_active_line:Option<bool>,
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="lowercase")]
pub enum Theme{Light,Dark,System}
fn deserialize_present<'de,D,T>(deserializer:D)->Result<Option<T>,D::Error> where D:serde::Deserializer<'de>,T:Deserialize<'de>{
 T::deserialize(deserializer).map(Some)
}
fn deserialize_overrides<'de,D>(deserializer:D)->Result<BTreeMap<String,bool>,D::Error> where D:serde::Deserializer<'de>{
 struct UniqueMap;
 impl<'de> serde::de::Visitor<'de> for UniqueMap{
  type Value=BTreeMap<String,bool>;
  fn expecting(&self,f:&mut std::fmt::Formatter)->std::fmt::Result{write!(f,"unique language override keys")}
  fn visit_map<A:serde::de::MapAccess<'de>>(self,mut map:A)->Result<Self::Value,A::Error>{
   let mut out=BTreeMap::new();
   while let Some((key,value))=map.next_entry::<String,bool>()?{
    if out.insert(key,value).is_some(){return Err(serde::de::Error::custom("duplicate language override"));}
   }
   Ok(out)
  }
 }
 deserializer.deserialize_map(UniqueMap)
}
// Match JSON integer semantics across the frontend, JSON Schema and disk parser.
fn deserialize_integer<'de,D>(deserializer:D,min:u32,max:u32)->Result<u32,D::Error>
where D:serde::Deserializer<'de>{
 let value=serde_json::Number::deserialize(deserializer)?.as_f64().ok_or_else(||serde::de::Error::custom("expected an integer"))?;
 if !value.is_finite()||value.fract()!=0.0||value<f64::from(min)||value>f64::from(max){return Err(serde::de::Error::custom("integer outside allowed range"));}
 Ok(value as u32)
}
fn deserialize_version<'de,D:serde::Deserializer<'de>>(deserializer:D)->Result<u32,D::Error>{deserialize_integer(deserializer,1,1)}
fn deserialize_font_size<'de,D:serde::Deserializer<'de>>(deserializer:D)->Result<Option<u8>,D::Error>{deserialize_integer(deserializer,10,32).map(|v|Some(v as u8))}
fn deserialize_tab_size<'de,D:serde::Deserializer<'de>>(deserializer:D)->Result<Option<u8>,D::Error>{deserialize_integer(deserializer,1,8).map(|v|Some(v as u8))}
impl Default for Document{fn default()->Self{Self{version:1,vim:false,tab_size:None,format_on_save:true,overrides:BTreeMap::new(),theme:None,font_size:None,line_height:None,word_wrap:None,line_numbers:None,indent_guides:None,highlight_active_line:None}}}
impl Document{
    fn validated(&self)->Result<(),String>{
        if self.font_size.is_some_and(|v|!(10..=32).contains(&v))||self.line_height.is_some_and(|v|!v.is_finite()||!(1.2..=2.4).contains(&v)){return Err("编辑器字号或行高超出允许范围".into());}

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

#[cfg(test)]mod appearance_tests{
 use super::*;
 #[test]fn accepts_options_and_rejects_null_unknown_duplicates(){
  let text=r#"{"version":1,"formatOnSave":true,"overrides":{"rust":false},"theme":"dark","fontSize":18,"lineHeight":1.6,"wordWrap":true,"lineNumbers":false,"indentGuides":false,"highlightActiveLine":false}"#;
  let value:Document=serde_json::from_str(text).unwrap();value.validated().unwrap();
  assert_eq!(value.font_size,Some(18));assert!(!value.vim);
  for bad in [
   r#"{"version":1,"formatOnSave":true,"overrides":{"rust":true,"rust":false}}"#,
   r#"{"version":1,"formatOnSave":true,"overrides":{"rust":true,"\u0072ust":false}}"#,
   r#"{"version":1,"formatOnSave":true,"overrides":{},"theme":"unknown"}"#,
   r#"{"version":1,"formatOnSave":true,"overrides":{},"theme":null}"#,
   r#"{"version":1,"formatOnSave":true,"overrides":{},"wordWrap":null}"#,
   r#"{"version":1,"formatOnSave":true,"overrides":{},"fontSize":null}"#,
   r#"{"version":1,"formatOnSave":true,"overrides":{},"lineHeight":null}"#,
   r#"{"version":1,"formatOnSave":true,"overrides":{},"typo":true}"#
  ]{assert!(serde_json::from_str::<Document>(bad).is_err(),"{bad}");}
 }
 #[test]fn invalid_ranges_keep_disk_and_backup_unchanged(){
  let dir=tempfile::tempdir().unwrap();let store=EditorSettings::new(dir.path().canonicalize().unwrap());
  let original=store.save(Document::default(),None).unwrap();
  let mut bad=Document::default();bad.font_size=Some(9);assert!(store.save(bad,original.revision.clone()).is_err());
  let mut bad=Document::default();bad.line_height=Some(5.0);assert!(store.save(bad,original.revision.clone()).is_err());
  assert_eq!(store.get().unwrap().revision,original.revision);
  assert!(!dir.path().join("editor-settings.previous.json").exists());
 }
}

#[cfg(test)]mod integer_token_tests{
 use super::*;
 #[test]fn accepts_integral_decimal_and_exponent_tokens(){
  let parsed:Document=serde_json::from_str(r#"{"version":1e0,"formatOnSave":true,"overrides":{},"fontSize":14.0,"tabSize":4e0}"#).unwrap();
  assert_eq!(parsed.version,1);assert_eq!(parsed.font_size,Some(14));assert_eq!(parsed.tab_size,Some(4));
  assert!(parsed.validated().is_ok());
 }
}
