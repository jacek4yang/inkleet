//! Library navigation is separate from the editable solution's RPC lane.
use super::*;
use crate::source_navigation::{Content,Record,Targets};
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Snapshot {
 pub source_id:u64,pub uri:String,
 #[serde(flatten)]pub content:Content,
}
fn primary_alias(uri:&str,primary:&str)->bool {
 if uri==primary{return true;}
 let path=|value:&str|reqwest::Url::parse(value).ok().and_then(|u|u.to_file_path().ok()).and_then(|p|std::fs::canonicalize(p).ok());
 matches!((path(uri),path(primary)),(Some(a),Some(b)) if a==b)
}
fn lifecycle(session:&Session,open:bool,record:&Record)->Result<()> {
 // JDT class-file handles are virtual and must retain their original query.
 if record.uri.starts_with("jdt://"){return Ok(());}
 if open {
  let language=match record.content.language.as_str(){"python3"=>"python","golang"=>"go",other=>other};
  session.client.notify("textDocument/didOpen",json!({"textDocument":{"uri":record.uri,"languageId":language,"version":1,"text":record.content.text}}))
 } else {session.client.notify("textDocument/didClose",json!({"textDocument":{"uri":record.uri}}))}
}
impl Services {
 pub fn acquire_source(&self,id:u64,version:u32,uri:&str)->Result<Snapshot> {
  let session=self.session(id)?;
  if uri.len()>8192||uri.chars().any(char::is_control){return Err("源码地址无效".into());}
  if primary_alias(uri,&session.uri){return Err("请在原代码编辑器中查看当前解答".into());}
  {
   let document=session.document.lock().map_err(|_|"文档状态不可用")?;
   if document.version!=version{return Err("解答已更新，请重新跳转".into());}
   let mut sources=session.sources.lock().map_err(|_|"源码快照状态不可用")?;
   if let Some(record)=sources.find(uri,None) {
    self.session(id)?;
    return Ok(Snapshot{source_id:record.id,uri:record.uri.clone(),content:record.content.clone()});
   }
  }
  session.source_reads.fetch_update(Ordering::AcqRel,Ordering::Acquire,|n|(n<2).then_some(n+1)).map_err(|_|"正在读取源码，请稍后重试")?;
  struct Permit<'a>(&'a std::sync::atomic::AtomicUsize);
  impl Drop for Permit<'_>{fn drop(&mut self){self.0.fetch_sub(1,Ordering::Release);}}
  let _permit=Permit(&session.source_reads);
  let mut source=self.read_source(id,uri)?;
  if session.language=="c"&&(source.name.ends_with(".h")||!source.name.contains('.')){source.language="c".into();}
  self.session(id)?;
  let document=session.document.lock().map_err(|_|"文档状态不可用")?;
  if document.version!=version{return Err("解答已更新，请重新跳转".into());}
  // Lock spans only bounded queue admission, never server waits. Duplicate reads
  // publish once, and a failed didClose leaves the original open-state owned.
  let mut sources=session.sources.lock().map_err(|_|"源码快照状态不可用")?;
  self.session(id)?;
  let (record,_)=sources.insert_with(uri.into(),Content{text:source.text,name:source.name,declaration:source.declaration,language:source.language},None,|open,record|lifecycle(&session,open,record))?;
  self.session(id)?;
  Ok(Snapshot{source_id:record.id,uri:record.uri.clone(),content:record.content.clone()})
 }
 pub fn source_definition(&self,id:u64,source_id:u64,version:u32,line:u32,character:u32,sequence:u64)->Result<Targets> {
  let session=self.session(id)?;
  let record=session.sources.lock().map_err(|_|"源码快照状态不可用")?.get(source_id)?;
  if !crate::source_navigation::valid_position(&record.content.text,line,character){return Err("源码位置无效".into());}
  let (sequence,request)={
   let mut requests=session.source_requests.lock().map_err(|_|"源码导航状态不可用")?;
   let document=session.document.lock().map_err(|_|"文档状态不可用")?;
   if document.version!=version{return Err("解答已更新，请重新跳转".into());}
   requests.begin(Some(sequence),||{
    let request=session.client.begin_cancellable_lsp_request("textDocument/definition",json!({"textDocument":{"uri":record.uri},"position":{"line":line,"character":character}}))?;
    let cancel=request.canceller();Ok((request,cancel))
   })?
  };
  let result=request.wait(Duration::from_secs(8));
  let mut requests=session.source_requests.lock().map_err(|_|"源码导航状态不可用")?;
  requests.finish(sequence);
  let response=result?;
  if !requests.is_current(sequence){return Err("忽略已取消的源码导航".into());}
  let document=session.document.lock().map_err(|_|"文档状态不可用")?;
  if document.version!=version{return Err("解答已更新，请重新跳转".into());}
  self.session(id)?;
  if !session.sources.lock().map_err(|_|"源码快照状态不可用")?.contains(&record){return Err("SOURCE_SNAPSHOT_EXPIRED".into());}
  let result=crate::source_navigation::targets(&response,&session.uri,document.prefix,&document.text)?;
  let mut allowed=session.approved_sources.lock().map_err(|_|"源码引用状态不可用")?;
  for target in &result.locations {
   if target.uri.starts_with("jdt://contents/")&&allowed.len()<256{allowed.insert(target.uri.clone());}
  }
  Ok(result)
 }
 pub fn cancel_source_navigation(&self,id:u64,through:u64)->Result<()> {
  let session=self.session(id)?;
  let result=session.source_requests.lock().map_err(|_|"源码导航状态不可用")?.cancel_through(through);
  result
 }
}
#[cfg(test)]mod tests {
 use super::*;
 #[test]fn primary_source_aliases_cannot_open_a_stale_disk_scaffold(){
  let temp=tempfile::tempdir().unwrap();let path=temp.path().join("solution.rs");std::fs::write(&path,"scaffold").unwrap();
  let uri=reqwest::Url::from_file_path(&path).unwrap().to_string();
  assert!(primary_alias(&uri,&uri));
  let alternate=reqwest::Url::from_file_path(temp.path().join(".").join("solution.rs")).unwrap().to_string();
  assert!(primary_alias(&alternate,&uri));assert!(!primary_alias("jdt://contents/A.class?x",&uri));
  #[cfg(unix)]{
   let link=temp.path().join("alias.rs");std::os::unix::fs::symlink(&path,&link).unwrap();
   assert!(primary_alias(reqwest::Url::from_file_path(link).unwrap().as_str(),&uri));
  }
 }
}
