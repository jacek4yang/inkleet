//! Separate crash-recovery snapshots. Never writes the canonical source.
use serde::{Deserialize,Serialize};
use std::{fs,io::{Read,Write},path::{Path,PathBuf}};
const MAX_TEXT:usize=2*1024*1024;
const MAX_RECORD:usize=24*1024*1024;
#[derive(Clone,Serialize,Deserialize)]
pub struct Record{pub version:u8,pub file:String,pub text:String,pub baseline:Option<String>}
fn file_name(path:&Path)->Result<String,String>{path.file_name().and_then(|s|s.to_str()).map(str::to_owned).ok_or("草稿文件名无效".into())}
fn location(path:&Path)->Result<PathBuf,String>{
    let parent=path.parent().ok_or("草稿目录无效")?;
    if parent.is_symlink(){return Err("拒绝符号链接草稿目录".into());}
    let dir=parent.join(".inkleet-drafts");
    if dir.is_symlink(){return Err("拒绝符号链接草稿目录".into());}
    let target=dir.join(format!("{}.json",file_name(path)?));
    if target.is_symlink(){return Err("拒绝符号链接草稿文件".into());}
    Ok(target)
}
fn validate(record:&Record,path:&Path)->Result<(),String>{
    if record.version!=1||record.file!=file_name(path)?{return Err("恢复草稿身份不匹配".into());}
    if record.text.len()>MAX_TEXT||record.baseline.as_ref().is_some_and(|s|s.len()>MAX_TEXT){return Err("恢复草稿超过 2 MiB 限制".into());}
    Ok(())
}
pub fn read(path:&Path)->Result<Option<Record>,String>{
    let target=location(path)?;
    let file=match fs::File::open(target){Ok(v)=>v,Err(e)if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),Err(_)=>return Err("无法读取恢复草稿".into())};
    if !file.metadata().map_err(|_|"无法检查恢复草稿")?.is_file(){return Err("恢复草稿不是普通文件".into());}
    let mut bytes=Vec::new();file.take((MAX_RECORD+1)as u64).read_to_end(&mut bytes).map_err(|_|"无法读取恢复草稿")?;
    if bytes.len()>MAX_RECORD{return Err("恢复草稿记录超过限制".into());}
    let record:Record=serde_json::from_slice(&bytes).map_err(|_|"恢复草稿损坏，原文件已保留")?;
    validate(&record,path)?;Ok(Some(record))
}
pub fn write(path:&Path,text:String,baseline:Option<String>)->Result<(),String>{
    let record=Record{version:1,file:file_name(path)?,text,baseline};validate(&record,path)?;
    let target=location(path)?;if target.exists(){read(path)?;}let dir=target.parent().ok_or("草稿目录无效")?;
    fs::create_dir_all(dir).map_err(|_|"无法创建恢复草稿目录")?;
    let bytes=serde_json::to_vec(&record).map_err(|_|"无法编码恢复草稿")?;
    if bytes.len()>MAX_RECORD{return Err("恢复草稿记录超过限制".into());}
    let mut temp=tempfile::NamedTempFile::new_in(dir).map_err(|_|"无法创建恢复草稿临时文件")?;
    temp.write_all(&bytes).map_err(|_|"无法写入恢复草稿")?;temp.as_file().sync_all().map_err(|_|"恢复草稿同步失败")?;
    temp.persist(&target).map_err(|_|"恢复草稿原子替换失败")?;
    #[cfg(unix)]fs::File::open(dir).and_then(|f|f.sync_all()).map_err(|_|"恢复草稿目录同步失败")?;
    Ok(())
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn draft_never_changes_canonical_and_keeps_baseline(){
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("solution.rs");
        fs::write(&path,"saved").unwrap();
        write(&path,"dirty".into(),Some("saved".into())).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(),"saved");
        let record=read(&path).unwrap().unwrap();assert_eq!(record.text,"dirty");assert_eq!(record.baseline.as_deref(),Some("saved"));
        assert!(write(&path,"x".repeat(MAX_TEXT+1),None).is_err());assert_eq!(read(&path).unwrap().unwrap().text,"dirty");
        fs::write(&path,"external").unwrap();assert_eq!(read(&path).unwrap().unwrap().baseline.as_deref(),Some("saved"));
    }
    #[test]fn rejects_corruption_identity_and_symlinks(){
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("notes.md");write(&path,"draft".into(),None).unwrap();
        let target=location(&path).unwrap();fs::write(&target,r#"{"version":1,"file":"other","text":"x","baseline":null}"#).unwrap();assert!(read(&path).is_err());
        fs::write(&target,b"broken").unwrap();assert!(read(&path).is_err());assert_eq!(fs::read(&target).unwrap(),b"broken");
        #[cfg(unix)]{fs::remove_file(&target).unwrap();std::os::unix::fs::symlink(dir.path().join("outside"),&target).unwrap();assert!(write(&path,"bad".into(),None).is_err());}
    }
}
