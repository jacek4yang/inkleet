use std::{fs,path::{Path,PathBuf}};
use serde::{Serialize,Deserialize};
use crate::storage;
type Result<T>=std::result::Result<T,String>;
const MAX:usize=128;
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry{pub id:String,pub name:String,#[serde(default,skip_serializing_if="active")]pub archived:bool}
fn active(archived:&bool)->bool{!*archived}
#[derive(Serialize)]
pub struct Listing{pub entries:Vec<Entry>,pub archived:Vec<Entry>,pub unreadable:usize}
fn identifier(id:&str)->Result<()>{
 if id.len()!=32||!id.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){return Err("无效解答标识".into());}Ok(())
}
fn name(value:&str)->Result<String>{
 let text=value.trim();if text.is_empty()||text.chars().count()>80||text.len()>320||text.chars().any(char::is_control){return Err("解答名称须为 1–80 个字符".into());}Ok(text.into())
}
fn safe(path:&Path)->Result<()>{if path.is_symlink(){return Err("拒绝符号链接解答路径".into());}Ok(())}
fn directory(root:&Path,problem:&str,language:&str)->Result<PathBuf>{
 let original=storage::file_path(root,problem,language,"code")?;safe(root)?;
 let base=original.parent().ok_or("无效题目目录")?.join(".solutions");safe(&base)?;
 let result=base.join(language);safe(&result)?;Ok(result)
}
fn metadata(root:&Path,problem:&str,language:&str,id:&str)->Result<PathBuf>{
 let base=directory(root,problem,language)?;
 let path=if id=="default"{base.join("default.json")}else{identifier(id)?;let folder=base.join(id);safe(&folder)?;folder.join("name.json")};
 safe(&path)?;Ok(path)
}
fn read_entry(path:&Path,id:&str)->Result<Entry>{
 safe(path)?;let info=fs::metadata(path).map_err(|_|"解答记录不存在")?;
 if !info.is_file()||info.len()>2048{return Err("解答记录异常，请保留原文件".into());}
 let text=storage::read(path)?.ok_or("解答记录不存在")?;
 let entry:Entry=serde_json::from_str(&text).map_err(|_|"解答记录损坏，请保留原文件")?;
 if entry.id!=id||name(&entry.name)?!=entry.name{return Err("解答记录无效".into());}Ok(entry)
}
fn source_at(root:&Path,problem:&str,language:&str,id:&str)->Result<PathBuf>{
 let meta=metadata(root,problem,language,id)?;
 if read_entry(&meta,id)?.archived{return Err("解答已归档，请先恢复".into());}
 source_file(root,problem,language,&meta)
}
fn source_file(root:&Path,problem:&str,language:&str,meta:&Path)->Result<PathBuf>{
 let original=storage::file_path(root,problem,language,"code")?;
 let path=meta.parent().ok_or("无效解答目录")?.join(original.file_name().ok_or("无效源码名")?);safe(&path)?;
 let info=fs::metadata(&path).map_err(|_|"解答源码不存在，请恢复原文件")?;
 if !info.is_file(){return Err("解答源码不是普通文件".into());}Ok(path)
}
pub fn file_path(root:&Path,problem:&str,language:&str,kind:&str,solution:Option<&str>)->Result<PathBuf>{
 let original=storage::file_path(root,problem,language,kind)?;
 if kind=="notes"||solution.is_none()||solution==Some("default"){return Ok(original);}
 source_at(root,problem,language,solution.ok_or("无效解答标识")?)
}
pub fn list(root:&Path,problem:&str,language:&str)->Result<Listing>{
 let base=directory(root,problem,language)?;let default=metadata(root,problem,language,"default")?;
 let first=if default.exists(){read_entry(&default,"default")?}else{Entry{id:"default".into(),name:"默认解答".into(),archived:false}};
 if first.archived{return Err("默认解答不能归档，请检查解答记录".into());}
 let mut entries=vec![first];let mut archived=vec![];let mut unreadable=0;
 let dirs=match fs::read_dir(&base){Ok(v)=>v,Err(e)if e.kind()==std::io::ErrorKind::NotFound=>return Ok(Listing{entries,archived,unreadable}),Err(_)=>return Err("无法读取解答列表".into())};
 for (seen,item) in dirs.enumerate(){
  if seen>=MAX*2+20{return Err("解答目录条目过多，请备份后整理".into());}
  let item=item.map_err(|_|"无法读取解答目录条目")?;
  let Some(id)=item.file_name().to_str().map(str::to_owned)else{unreadable+=1;continue;};
  if id=="default.json"{continue;}
  if id.starts_with(".pending-"){unreadable+=1;continue;}
  let entry=(||->Result<Entry>{
   identifier(&id)?;let kind=item.file_type().map_err(|_|"无法检查解答目录")?;
   if kind.is_symlink()||!kind.is_dir(){return Err("解答目录异常".into());}
   let meta=metadata(root,problem,language,&id)?;source_file(root,problem,language,&meta)?;read_entry(&meta,&id)
  })();
  match entry{Ok(entry)=>if entry.archived{archived.push(entry)}else{entries.push(entry)},Err(_)=>unreadable+=1}
  if entries.len()+archived.len()>MAX{return Err("每种语言最多保存 128 份解答（含归档）".into());}
 }
 archived.sort_by(|a,b|a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
 entries[1..].sort_by(|a,b|a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
 Ok(Listing{entries,archived,unreadable})
}
fn unique(list:&Listing,id:&str,value:&str)->Result<()>{
 if list.unreadable>0{return Err("存在未完成或损坏的解答记录，请先备份并检查解答目录".into());}
 if list.entries.iter().chain(list.archived.iter()).any(|e|e.id!=id&&e.name.to_lowercase()==value.to_lowercase()){return Err("该语言已有同名解答".into());}Ok(())
}
#[cfg(unix)]fn sync_dir(path:&Path)->Result<()>{fs::File::open(path).and_then(|f|f.sync_all()).map_err(|_|"解答目录同步失败".into())}
#[cfg(not(unix))]fn sync_dir(_path:&Path)->Result<()>{Ok(())}
pub fn create(root:&Path,problem:&str,language:&str,id:&str,value:&str,code:&str)->Result<Entry>{
 identifier(id)?;let value=name(value)?;let listing=list(root,problem,language)?;
 if listing.entries.len()+listing.archived.len()>=MAX{return Err("每种语言最多保存 128 份解答（含归档）".into());}unique(&listing,id,&value)?;
 let base=directory(root,problem,language)?;fs::create_dir_all(&base).map_err(|_|"无法创建解答目录")?;
 let target=base.join(id);safe(&target)?;if target.exists(){return Err("解答标识已存在，请刷新列表".into());}
 let entry=Entry{id:id.into(),name:value,archived:false};
 let stage=tempfile::Builder::new().prefix(".pending-").tempdir_in(&base).map_err(|_|"无法创建暂存目录")?;
 let original=storage::file_path(root,problem,language,"code")?;
 storage::save(&stage.path().join(original.file_name().ok_or("无效源码名")?),None,code)?;
 storage::save(&stage.path().join("name.json"),None,&serde_json::to_string(&entry).map_err(|_|"无法编码解答名称")?)?;
 sync_dir(stage.path())?;
 // One directory publication; never expose metadata before initial source exists.
 fs::rename(stage.path(),&target).map_err(|_|"无法提交新解答，原解答未修改")?;
 sync_dir(&base)?;Ok(entry)
}
pub fn rename(root:&Path,problem:&str,language:&str,id:&str,expected:&str,value:&str)->Result<Entry>{
 let value=name(value)?;let listing=list(root,problem,language)?;
 let current=listing.entries.iter().find(|e|e.id==id).ok_or("解答不存在")?;
 if current.name!=expected{return Err("解答名称已变化，请刷新后重试".into());}unique(&listing,id,&value)?;
 let path=metadata(root,problem,language,id)?;let before=storage::read(&path)?;
 if let Some(text)=&before{
  let entry:Entry=serde_json::from_str(text).map_err(|_|"解答记录损坏")?;
  if entry.id!=id||entry.name!=expected||entry.archived{return Err("解答名称已变化，请刷新后重试".into());}
 }else if id!="default"||expected!="默认解答"{return Err("解答名称文件已变化".into());}
 let entry=Entry{id:id.into(),name:value,archived:false};
 storage::save(&path,before.as_deref(),&serde_json::to_string(&entry).map_err(|_|"无法编码解答名称")?)?;Ok(entry)
}
/// Archive is an atomic metadata transition, not deletion or a move. Keeping the
/// immutable directory retains source, crash-recovery drafts and conflict copies.
/// Callers hold Store::gate, the same lock used by save/checkpoint commands.
pub fn archive(root:&Path,problem:&str,language:&str,id:&str,expected:&str,code:&str,baseline:&str)->Result<Entry>{
 identifier(id)?; // The always-present default is deliberately not archivable.
 let listing=list(root,problem,language)?;
 let current=listing.entries.iter().find(|e|e.id==id).ok_or("解答不存在或已归档，请刷新列表")?;
 if current.name!=expected{return Err("解答名称已变化，请刷新后重试".into());}
 if listing.unreadable>0{return Err("存在未完成或损坏的解答记录，请先备份并检查解答目录".into());}
 let path=metadata(root,problem,language,id)?;let before=storage::read(&path)?.ok_or("解答记录不存在")?;
 let entry=read_entry(&path,id)?;
 if entry.archived||entry.name!=expected{return Err("解答记录已变化，请刷新后重试".into());}
 let source=source_at(root,problem,language,id)?;
 if storage::read(&source)?.as_deref()!=Some(baseline){return Err("源码文件已变化，请处理冲突后再归档".into());}
 // A checkpoint can race the command queue, or another process can have
 // updated the recovery draft. Never replace newer unsaved bytes merely because
 // the canonical source stayed unchanged. Old *clean* sidecars are irrelevant
 // only when the reviewed editor is itself exactly the current saved source.
 if let Some(draft)=crate::drafts::read(&source)?{
  if (draft.text!=code||draft.baseline.as_deref()!=Some(baseline))&&
     (code!=baseline||draft.baseline.as_deref()!=Some(draft.text.as_str())){
   return Err("恢复草稿已变化，请重新读取并确认归档".into());
  }
 }
 // Explicit confirmation preserves the exact captured editor draft without
 // overwriting the canonical source. A failed metadata write leaves it active.
 crate::drafts::write(&source,code.to_owned(),Some(baseline.to_owned()))?;
 let entry=Entry{archived:true,..entry};
 storage::save(&path,Some(&before),&serde_json::to_string(&entry).map_err(|_|"无法编码解答记录")?)?;
 Ok(entry)
}
pub fn restore(root:&Path,problem:&str,language:&str,id:&str,expected:&str)->Result<Entry>{
 identifier(id)?;
 let listing=list(root,problem,language)?;
 let current=listing.archived.iter().find(|e|e.id==id).ok_or("归档解答不存在或已恢复，请刷新列表")?;
 if current.name!=expected{return Err("解答名称已变化，请刷新后重试".into());}
 unique(&listing,id,expected)?;
 let path=metadata(root,problem,language,id)?;let before=storage::read(&path)?.ok_or("解答记录不存在")?;
 let entry=read_entry(&path,id)?;
 if !entry.archived||entry.name!=expected{return Err("归档记录已变化，请刷新后重试".into());}
 source_file(root,problem,language,&path)?;
 let entry=Entry{archived:false,..entry};
 storage::save(&path,Some(&before),&serde_json::to_string(&entry).map_err(|_|"无法编码解答记录")?)?;
 Ok(entry)
}
#[cfg(test)]mod tests{
 use super::*;const ID:&str="0123456789abcdef0123456789abcdef";
 #[test]fn defaults_are_unchanged_and_notes_shared(){
  let r=tempfile::tempdir().unwrap();let old=storage::file_path(r.path(),"lc-1","rust","code").unwrap();storage::save(&old,None,"old").unwrap();
  create(r.path(),"lc-1","rust",ID,"双指针","new").unwrap();
  assert_eq!(file_path(r.path(),"lc-1","rust","code",None).unwrap(),old);
  let named=file_path(r.path(),"lc-1","rust","code",Some(ID)).unwrap();assert_eq!(storage::read(&named).unwrap().as_deref(),Some("new"));
  assert_eq!(storage::read(&old).unwrap().as_deref(),Some("old"));
  assert_eq!(file_path(r.path(),"lc-1","rust","notes",Some(ID)).unwrap(),storage::file_path(r.path(),"lc-1","rust","notes").unwrap());
  rename(r.path(),"lc-1","rust",ID,"双指针","优化版").unwrap();assert_eq!(file_path(r.path(),"lc-1","rust","code",Some(ID)).unwrap(),named);
  assert!(rename(r.path(),"lc-1","rust",ID,"双指针","stale").is_err());
  rename(r.path(),"lc-1","rust","default","默认解答","初稿").unwrap();assert_eq!(list(r.path(),"lc-1","rust").unwrap().entries[0].name,"初稿");
  assert_eq!(list(r.path(),"lc-1","python3").unwrap().entries.len(),1);
 }
 #[test]fn failed_create_and_missing_source_never_fall_back(){
  let r=tempfile::tempdir().unwrap();
  for id in ["../escape","","default","ABCDEF0123456789abcdef0123456789a"]{assert!(create(r.path(),"lc-1","rust",id,"a","b").is_err());}
  assert!(create(r.path(),"lc-1","rust",ID,"默认解答","b").is_err());
  assert!(create(r.path(),"lc-1","rust",ID,"\n","b").is_err());
  assert!(create(r.path(),"lc-1","rust",ID,"large",&"x".repeat(2*1024*1024+1)).is_err());
  assert_eq!(list(r.path(),"lc-1","rust").unwrap().entries.len(),1);
  create(r.path(),"lc-1","rust",ID,"name","body").unwrap();let p=file_path(r.path(),"lc-1","rust","code",Some(ID)).unwrap();fs::remove_file(p).unwrap();
  assert!(file_path(r.path(),"lc-1","rust","code",Some(ID)).is_err());let list=list(r.path(),"lc-1","rust").unwrap();assert_eq!(list.entries.len(),1);assert_eq!(list.unreadable,1);
 }
 #[cfg(unix)]#[test]fn symlink_ancestors_rejected(){
  let r=tempfile::tempdir().unwrap();let outside=tempfile::tempdir().unwrap();fs::create_dir(r.path().join("lc-1")).unwrap();
  std::os::unix::fs::symlink(outside.path(),r.path().join("lc-1/.solutions")).unwrap();
  assert!(create(r.path(),"lc-1","rust",ID,"name","body").is_err());assert!(list(r.path(),"lc-1","rust").is_err());
 }
}

#[cfg(test)]mod recovery_identity_tests{
 use super::*;
 const A:&str="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
 const B:&str="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
 #[test]fn recovery_and_conflict_copies_cannot_cross_solutions(){
  let root=tempfile::tempdir().unwrap();
  create(root.path(),"lc-1","rust",A,"A","original A").unwrap();
  create(root.path(),"lc-1","rust",B,"B","original B").unwrap();
  let a=file_path(root.path(),"lc-1","rust","code",Some(A)).unwrap();
  let b=file_path(root.path(),"lc-1","rust","code",Some(B)).unwrap();
  fs::write(&a,"external A").unwrap();
  assert!(storage::save(&a,Some("original A"),"local A").is_err());
  let resolved=storage::resolve_conflict(&a,Some("external A"),"local A","external").unwrap();
  assert_eq!(storage::read(&a).unwrap().as_deref(),Some("external A"));
  assert_eq!(storage::read(&b).unwrap().as_deref(),Some("original B"));
  assert!(crate::recovery::read(&b,&resolved.backup).is_err());
  let restored=crate::recovery::restore(&a,&resolved.backup,"local",Some("local A"),Some("external A"),"external A").unwrap();
  assert_eq!(restored.text.as_deref(),Some("local A"));
  assert_eq!(storage::read(&b).unwrap().as_deref(),Some("original B"));
 }
 #[test]fn same_id_across_six_languages_is_isolated_but_notes_are_shared(){
  let root=tempfile::tempdir().unwrap();let mut sources=std::collections::HashSet::new();let mut notes=std::collections::HashSet::new();
  for language in ["python3","rust","golang","c","cpp","java"]{
   create(root.path(),"lc-1",language,A,"同名解答",language).unwrap();
   let source=file_path(root.path(),"lc-1",language,"code",Some(A)).unwrap();
   assert_eq!(storage::read(&source).unwrap().as_deref(),Some(language));sources.insert(source);
   notes.insert(file_path(root.path(),"lc-1",language,"notes",Some(A)).unwrap());
  }
  assert_eq!(sources.len(),6);assert_eq!(notes.len(),1);
 }
}

#[cfg(test)]mod archive_tests{
 use super::*;
 const A:&str="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
 const B:&str="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
 #[test]fn archive_restore_keeps_source_dirty_draft_recovery_and_notes_across_reload(){
  let root=tempfile::tempdir().unwrap();
  create(root.path(),"lc-1","rust",A,"完整解答名称","saved").unwrap();
  let path=file_path(root.path(),"lc-1","rust","code",Some(A)).unwrap();
  let notes=file_path(root.path(),"lc-1","rust","notes",Some(A)).unwrap();storage::save(&notes,None,"shared notes").unwrap();
  let backup=storage::resolve_conflict(&path,Some("saved"),"prior draft","external").unwrap().backup;
  let archived=archive(root.path(),"lc-1","rust",A,"完整解答名称","unsaved newest draft","saved").unwrap();assert!(archived.archived);
  assert_eq!(storage::read(&path).unwrap().as_deref(),Some("saved"));
  assert_eq!(crate::drafts::read(&path).unwrap().unwrap().text,"unsaved newest draft");
  assert!(file_path(root.path(),"lc-1","rust","code",Some(A)).is_err());
  let listing=list(root.path(),"lc-1","rust").unwrap();assert_eq!(listing.entries.len(),1);assert_eq!(listing.archived.len(),1);assert_eq!(listing.unreadable,0);
  // No in-memory archive registry: rereading disk is enough after restart.
  let restored=restore(root.path(),"lc-1","rust",A,"完整解答名称").unwrap();assert!(!restored.archived);
  assert_eq!(file_path(root.path(),"lc-1","rust","code",Some(A)).unwrap(),path);
  assert_eq!(crate::drafts::read(&path).unwrap().unwrap().baseline.as_deref(),Some("saved"));
  assert_eq!(crate::recovery::read(&path,&backup).unwrap().local,"prior draft");
  assert_eq!(storage::read(&notes).unwrap().as_deref(),Some("shared notes"));
 }
 #[test]fn stale_duplicate_and_default_transitions_fail_without_overwriting(){
  let root=tempfile::tempdir().unwrap();create(root.path(),"lc-1","rust",A,"A","source").unwrap();
  assert!(archive(root.path(),"lc-1","rust","default","默认解答","draft","").is_err());
  assert!(archive(root.path(),"lc-1","rust",A,"stale","draft","source").is_err());
  assert!(archive(root.path(),"lc-1","rust",A,"A","draft","stale source").is_err());
  let path=file_path(root.path(),"lc-1","rust","code",Some(A)).unwrap();assert!(crate::drafts::read(&path).unwrap().is_none());
  archive(root.path(),"lc-1","rust",A,"A","draft","source").unwrap();
  assert!(archive(root.path(),"lc-1","rust",A,"A","new draft","source").is_err());
  assert!(rename(root.path(),"lc-1","rust",A,"A","new name").is_err());
  assert!(create(root.path(),"lc-1","rust",B,"a","other").is_err());
  assert!(restore(root.path(),"lc-1","rust",A,"wrong").is_err());
  assert_eq!(crate::drafts::read(&path).unwrap().unwrap().text,"draft");
  restore(root.path(),"lc-1","rust",A,"A").unwrap();assert!(restore(root.path(),"lc-1","rust",A,"A").is_err());
  assert_eq!(storage::read(&path).unwrap().as_deref(),Some("source"));
 }
 #[test]fn archive_checks_live_source_and_never_modifies_other_languages(){
  let root=tempfile::tempdir().unwrap();
  for lang in ["rust","python3"]{create(root.path(),"lc-1",lang,A,"A",lang).unwrap();}
  let path=file_path(root.path(),"lc-1","rust","code",Some(A)).unwrap();fs::write(&path,"external").unwrap();
  assert!(archive(root.path(),"lc-1","rust",A,"A","draft","rust").is_err());
  assert_eq!(list(root.path(),"lc-1","rust").unwrap().entries.len(),2);
  archive(root.path(),"lc-1","rust",A,"A","draft","external").unwrap();
  assert_eq!(list(root.path(),"lc-1","python3").unwrap().entries.len(),2);
  assert_eq!(storage::read(&file_path(root.path(),"lc-1","python3","code",Some(A)).unwrap()).unwrap().as_deref(),Some("python3"));
 }
 #[test]fn all_six_languages_restore_the_same_immutable_id_and_active_schema(){
  let root=tempfile::tempdir().unwrap();
  for lang in ["python3","rust","golang","c","cpp","java"]{
   create(root.path(),"lc-1",lang,A,"same name",lang).unwrap();
   let meta=metadata(root.path(),"lc-1",lang,A).unwrap();
   let json:serde_json::Value=serde_json::from_str(&fs::read_to_string(&meta).unwrap()).unwrap();assert!(json.get("archived").is_none());
   archive(root.path(),"lc-1",lang,A,"same name",lang,lang).unwrap();
   assert_eq!(list(root.path(),"lc-1",lang).unwrap().archived[0].id,A);
   restore(root.path(),"lc-1",lang,A,"same name").unwrap();
   let json:serde_json::Value=serde_json::from_str(&fs::read_to_string(&meta).unwrap()).unwrap();assert!(json.get("archived").is_none());
   let source=file_path(root.path(),"lc-1",lang,"code",Some(A)).unwrap();assert_eq!(storage::read(&source).unwrap().as_deref(),Some(lang));
  }
 }
 #[test]fn newer_dirty_recovery_cannot_be_replaced_by_a_late_archive(){
  let root=tempfile::tempdir().unwrap();create(root.path(),"lc-1","rust",A,"A","source").unwrap();
  let path=file_path(root.path(),"lc-1","rust","code",Some(A)).unwrap();
  crate::drafts::write(&path,"newer draft".into(),Some("source".into())).unwrap();
  assert!(archive(root.path(),"lc-1","rust",A,"A","older draft","source").is_err());
  assert!(archive(root.path(),"lc-1","rust",A,"A","source","source").is_err());
  assert_eq!(crate::drafts::read(&path).unwrap().unwrap().text,"newer draft");
  assert_eq!(list(root.path(),"lc-1","rust").unwrap().entries.len(),2);
  archive(root.path(),"lc-1","rust",A,"A","newer draft","source").unwrap();
  restore(root.path(),"lc-1","rust",A,"A").unwrap();
  assert_eq!(crate::drafts::read(&path).unwrap().unwrap().text,"newer draft");
 }
 #[test]fn old_clean_sidecar_does_not_block_archiving_new_saved_source(){
  let root=tempfile::tempdir().unwrap();create(root.path(),"lc-1","rust",A,"A","source").unwrap();
  let path=file_path(root.path(),"lc-1","rust","code",Some(A)).unwrap();
  crate::drafts::write(&path,"old saved".into(),Some("old saved".into())).unwrap();
  archive(root.path(),"lc-1","rust",A,"A","source","source").unwrap();
  assert_eq!(crate::drafts::read(&path).unwrap().unwrap().text,"source");
 }
 #[test]fn corrupt_archive_and_missing_source_are_not_silently_restored(){
  let root=tempfile::tempdir().unwrap();create(root.path(),"lc-1","rust",A,"A","source").unwrap();
  let path=file_path(root.path(),"lc-1","rust","code",Some(A)).unwrap();archive(root.path(),"lc-1","rust",A,"A","draft","source").unwrap();
  fs::remove_file(&path).unwrap();assert!(restore(root.path(),"lc-1","rust",A,"A").is_err());
  let listing=list(root.path(),"lc-1","rust").unwrap();assert_eq!(listing.unreadable,1);assert!(listing.archived.is_empty());
 }
 #[cfg(unix)]#[test]fn archive_and_restore_reject_symlink_source_and_metadata(){
  let root=tempfile::tempdir().unwrap();let outside=tempfile::tempdir().unwrap();
  create(root.path(),"lc-1","rust",A,"A","source").unwrap();
  let path=file_path(root.path(),"lc-1","rust","code",Some(A)).unwrap();let target=outside.path().join("outside");fs::write(&target,"source").unwrap();fs::remove_file(&path).unwrap();std::os::unix::fs::symlink(&target,&path).unwrap();
  assert!(archive(root.path(),"lc-1","rust",A,"A","bad","source").is_err());
  assert_eq!(fs::read_to_string(target).unwrap(),"source");
 }
}
