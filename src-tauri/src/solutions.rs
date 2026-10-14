use std::{fs,path::{Path,PathBuf}};
use serde::{Serialize,Deserialize};
use crate::storage;
type Result<T>=std::result::Result<T,String>;
const MAX:usize=128;
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry{pub id:String,pub name:String}
#[derive(Serialize)]
pub struct Listing{pub entries:Vec<Entry>,pub unreadable:usize}
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
 let meta=metadata(root,problem,language,id)?;read_entry(&meta,id)?;
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
 let first=if default.exists(){read_entry(&default,"default")?}else{Entry{id:"default".into(),name:"默认解答".into()}};
 let mut entries=vec![first];let mut unreadable=0;
 let dirs=match fs::read_dir(&base){Ok(v)=>v,Err(e)if e.kind()==std::io::ErrorKind::NotFound=>return Ok(Listing{entries,unreadable}),Err(_)=>return Err("无法读取解答列表".into())};
 for (seen,item) in dirs.enumerate(){
  if seen>=MAX*2+20{return Err("解答目录条目过多，请备份后整理".into());}
  let item=item.map_err(|_|"无法读取解答目录条目")?;
  let Some(id)=item.file_name().to_str().map(str::to_owned)else{unreadable+=1;continue;};
  if id=="default.json"{continue;}
  if id.starts_with(".pending-"){unreadable+=1;continue;}
  let entry=(||->Result<Entry>{
   identifier(&id)?;let kind=item.file_type().map_err(|_|"无法检查解答目录")?;
   if kind.is_symlink()||!kind.is_dir(){return Err("解答目录异常".into());}
   source_at(root,problem,language,&id)?;read_entry(&metadata(root,problem,language,&id)?,&id)
  })();
  match entry{Ok(entry)=>entries.push(entry),Err(_)=>unreadable+=1}
  if entries.len()>MAX{return Err("每种语言最多保存 128 份解答".into());}
 }
 entries[1..].sort_by(|a,b|a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
 Ok(Listing{entries,unreadable})
}
fn unique(list:&Listing,id:&str,value:&str)->Result<()>{
 if list.unreadable>0{return Err("存在未完成或损坏的解答记录，请先备份并检查解答目录".into());}
 if list.entries.iter().any(|e|e.id!=id&&e.name.to_lowercase()==value.to_lowercase()){return Err("该语言已有同名解答".into());}Ok(())
}
#[cfg(unix)]fn sync_dir(path:&Path)->Result<()>{fs::File::open(path).and_then(|f|f.sync_all()).map_err(|_|"解答目录同步失败".into())}
#[cfg(not(unix))]fn sync_dir(_path:&Path)->Result<()>{Ok(())}
pub fn create(root:&Path,problem:&str,language:&str,id:&str,value:&str,code:&str)->Result<Entry>{
 identifier(id)?;let value=name(value)?;let listing=list(root,problem,language)?;
 if listing.entries.len()>=MAX{return Err("每种语言最多保存 128 份解答".into());}unique(&listing,id,&value)?;
 let base=directory(root,problem,language)?;fs::create_dir_all(&base).map_err(|_|"无法创建解答目录")?;
 let target=base.join(id);safe(&target)?;if target.exists(){return Err("解答标识已存在，请刷新列表".into());}
 let entry=Entry{id:id.into(),name:value};
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
  if entry.id!=id||entry.name!=expected{return Err("解答名称已变化，请刷新后重试".into());}
 }else if id!="default"||expected!="默认解答"{return Err("解答名称文件已变化".into());}
 let entry=Entry{id:id.into(),name:value};
 storage::save(&path,before.as_deref(),&serde_json::to_string(&entry).map_err(|_|"无法编码解答名称")?)?;Ok(entry)
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
