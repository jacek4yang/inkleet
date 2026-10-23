//! Read and restore only bounded, app-format conflict records for one solution.
use std::{fs,io::Read,path::{Path,PathBuf},time::UNIX_EPOCH};
use serde::{Serialize,Deserialize};
const MAX_RECORD:u64=26*1024*1024;
const MAX_TEXT:usize=2*1024*1024;
#[derive(Serialize,Deserialize)]
pub struct Record{pub format:String,pub file:String,pub local:String,pub external:Option<String>,pub choice:String}
#[derive(Serialize)]
pub struct Entry{pub id:String,pub modified:u64,pub bytes:u64}
#[derive(Serialize)]
pub struct Listing{pub entries:Vec<Entry>,pub unreadable:usize}
fn directory(path:&Path)->Result<PathBuf,String>{
    let parent=path.parent().ok_or("恢复路径无效")?;
    if parent.is_symlink(){return Err("拒绝符号链接题目目录".into());}
    let dir=parent.join(".inkleet-recovery");
    if dir.is_symlink(){return Err("拒绝符号链接恢复目录".into());}
    Ok(dir)
}
fn record_path(path:&Path,id:&str)->Result<PathBuf,String>{
    if id.len()>100||!id.starts_with("conflict-")||!id.ends_with(".json")||!id.bytes().all(|b|b.is_ascii_alphanumeric()||matches!(b,b'-'|b'_'|b'.')){return Err("恢复副本标识无效".into());}
    let file=directory(path)?.join(id);
    if file.is_symlink(){return Err("拒绝符号链接恢复副本".into());}
    Ok(file)
}
pub fn read(path:&Path,id:&str)->Result<Record,String>{
    let file=fs::File::open(record_path(path,id)?).map_err(|_|"无法读取恢复副本")?;
    let meta=file.metadata().map_err(|_|"无法检查恢复副本")?;
    if !meta.is_file()||meta.len()>MAX_RECORD{return Err("恢复副本类型或大小无效".into());}
    let mut data=Vec::new();file.take(MAX_RECORD+1).read_to_end(&mut data).map_err(|_|"恢复副本读取失败")?;
    if data.len() as u64>MAX_RECORD{return Err("恢复副本超过大小限制".into());}
    let record:Record=serde_json::from_slice(&data).map_err(|_|"恢复副本格式损坏")?;
    if record.format!="inkleet-conflict-v1"||Some(record.file.as_str())!=path.file_name().and_then(|s|s.to_str())||record.local.len()>MAX_TEXT||record.external.as_ref().is_some_and(|s|s.len()>MAX_TEXT)||!matches!(record.choice.as_str(),"local"|"external"){return Err("恢复副本不属于当前文件或格式无效".into());}
    Ok(record)
}
pub fn list(path:&Path)->Result<Listing,String>{
    let dir=directory(path)?;
    let iter=match fs::read_dir(dir){Ok(v)=>v,Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(Listing{entries:vec![],unreadable:0}),Err(_)=>return Err("无法打开恢复目录".into())};
    let mut entries=Vec::new();let mut unreadable=0;let mut count=0;let mut bytes=0u64;
    for entry in iter{
        count+=1;if count>1000{return Err("恢复目录条目过多，请先手动备份整理".into());}
        let entry=entry.map_err(|_|"恢复目录条目不可用")?;
        let id=entry.file_name().to_string_lossy().into_owned();
        let meta=fs::symlink_metadata(entry.path()).map_err(|_|"恢复条目信息不可用")?;
        bytes=bytes.saturating_add(meta.len());
        if bytes>64*1024*1024{return Err("恢复目录超过 64 MiB，请先手动备份整理".into());}
        if !meta.is_file()||meta.file_type().is_symlink(){unreadable+=1;continue;}
        match read(path,&id){
            Ok(_)=>entries.push(Entry{id,bytes:meta.len(),modified:meta.modified().ok().and_then(|t|t.duration_since(UNIX_EPOCH).ok()).map(|d|d.as_secs()).unwrap_or(0)}),
            Err(_)=>{
                // Valid records for another language are not corruption.
                // Only count a warning when this record cannot be identified.
                let raw=fs::File::open(entry.path()).ok().and_then(|f|{
                    if meta.len()>MAX_RECORD{return None;}
                    let mut data=Vec::new();f.take(MAX_RECORD+1).read_to_end(&mut data).ok()?;
                    if data.len() as u64>MAX_RECORD{return None;}serde_json::from_slice::<Record>(&data).ok()
                });
                if !raw.is_some_and(|r|r.format=="inkleet-conflict-v1"&&r.file!=path.file_name().unwrap_or_default().to_string_lossy()){unreadable+=1;}
            }
        }
    }
    entries.sort_by(|a,b|b.modified.cmp(&a.modified).then_with(||a.id.cmp(&b.id)));
    Ok(Listing{entries,unreadable})
}
pub fn restore(path:&Path,id:&str,side:&str,reviewed:Option<&str>,expected:Option<&str>,local:&str)->Result<crate::storage::ResolvedConflict,String>{
    let record=read(path,id)?;
    let chosen=match side{"local"=>Some(record.local.as_str()),"external"=>record.external.as_deref(),_=>return Err("恢复版本无效".into())};
    if chosen!=reviewed{return Err("恢复副本已变化，请重新预览后确认".into());}
    // Preserve the current editor and file before replacing either. A deleted
    // historical file becomes an explicitly selected blank draft, not deletion.
    let preserved=crate::storage::resolve_conflict(path,expected,local,"external")?;
    let text=chosen.unwrap_or("");
    crate::storage::save(path,expected,text)?;
    Ok(crate::storage::ResolvedConflict{text:Some(text.to_owned()),backup:preserved.backup})
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn restored_record_preserves_current_versions_and_rejects_stale_review(){
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("notes.md");
        fs::write(&path,"old external").unwrap();
        let first=crate::storage::resolve_conflict(&path,Some("old external"),"old local","external").unwrap();
        fs::write(&path,"current external").unwrap();
        assert_eq!(list(&path).unwrap().entries.len(),1);
        assert!(restore(&path,&first.backup,"local",Some("tampered"),Some("current external"),"current draft").is_err());
        assert!(restore(&path,&first.backup,"local",Some("old local"),Some("stale"),"current draft").is_err());
        let result=restore(&path,&first.backup,"local",Some("old local"),Some("current external"),"current draft").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(),"old local");
        let backup=read(&path,&result.backup).unwrap();assert_eq!(backup.local,"current draft");assert_eq!(backup.external.as_deref(),Some("current external"));
        assert_eq!(list(&path).unwrap().entries.len(),2);
        assert!(read(&path,"../notes.md").is_err());
        assert!(read(&dir.path().join("solution.rs"),&first.backup).is_err());
    }
    #[test]fn corrupt_and_symlink_records_never_become_restore_targets(){
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("notes.md");
        let recovery=directory(&path).unwrap();fs::create_dir(&recovery).unwrap();
        fs::write(recovery.join("conflict-bad.json"),"not json").unwrap();
        assert_eq!(list(&path).unwrap().unreadable,1);
        assert!(read(&path,"conflict-bad.json").is_err());
        #[cfg(unix)]{
            fs::write(dir.path().join("outside.json"),"{}").unwrap();
            std::os::unix::fs::symlink(dir.path().join("outside.json"),recovery.join("conflict-link.json")).unwrap();
            assert!(read(&path,"conflict-link.json").is_err());
        }
    }
}
