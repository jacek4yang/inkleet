//! Read-only source snapshots and definition coordinates, owned by one LSP session.
use serde::Serialize;
use serde_json::Value;
use std::{collections::{BTreeSet,HashMap},sync::Arc};
const MAX_SOURCE:usize=2*1024*1024;
const MAX_BYTES:usize=16*1024*1024;
const MAX_RECORDS:usize=32;
const MAX_ID:u64=9_007_199_254_740_991;
#[derive(Clone,Serialize)]
pub struct Content {pub text:String,pub name:String,pub declaration:bool,pub language:String}
pub struct Record {pub id:u64,pub uri:String,pub content:Content,pub solution_version:Option<u32>}
struct Entry {record:Arc<Record>,used:u64,bytes:usize}
#[derive(Default)]
pub struct Registry {next:u64,tick:u64,bytes:usize,entries:HashMap<u64,Entry>}
impl Registry {
 fn touch(&mut self)->u64{self.tick=self.tick.saturating_add(1);self.tick}
 pub fn find(&mut self,uri:&str,version:Option<u32>)->Option<Arc<Record>>{
  let tick=self.touch();
  self.entries.values_mut().find(|e|e.record.uri==uri&&e.record.solution_version==version).map(|e|{e.used=tick;e.record.clone()})
 }
 pub fn get(&mut self,id:u64)->Result<Arc<Record>,String>{
  let tick=self.touch();let e=self.entries.get_mut(&id).ok_or("SOURCE_SNAPSHOT_EXPIRED")?;e.used=tick;Ok(e.record.clone())
 }
 pub fn contains(&self,record:&Arc<Record>)->bool{self.entries.get(&record.id).is_some_and(|e|Arc::ptr_eq(&e.record,record))}
 #[cfg(test)]
 pub fn insert(&mut self,uri:String,content:Content,version:Option<u32>)->Result<(Arc<Record>,Vec<Arc<Record>>),String>{self.insert_with(uri,content,version,|_,_|Ok(()))}
 pub fn insert_with(&mut self,uri:String,mut content:Content,version:Option<u32>,mut notify:impl FnMut(bool,&Record)->Result<(),String>)->Result<(Arc<Record>,Vec<Arc<Record>>),String>{
  if uri.is_empty()||uri.len()>8192||content.text.len()>MAX_SOURCE||content.name.len()>4096||content.language.len()>32{return Err("源码快照超过安全限制".into());}
  content.text=content.text.replace("\r\n","\n").replace('\r',"\n");
  if let Some(existing)=self.find(&uri,version){if existing.content.text==content.text{return Ok((existing,vec![]));}}
  let bytes=content.text.len()+uri.len()+content.name.len()+content.language.len();
  let id=self.next.checked_add(1).filter(|n|*n<=MAX_ID).ok_or("源码快照标识已耗尽，请重连")?;
  let same=self.entries.values().find(|e|e.record.uri==uri).map(|e|e.record.id);
  if same.is_some_and(|id|Arc::strong_count(&self.entries[&id].record)>1){return Err("源码正在被查询，请稍后重新打开".into());}
  let mut victims=Vec::new();let mut available=self.bytes;let mut count=self.entries.len();
  if let Some(id)=same{victims.push(id);available-=self.entries[&id].bytes;count-=1;}
  let mut candidates=self.entries.iter().filter(|(id,e)|!victims.contains(id)&&Arc::strong_count(&e.record)==1).map(|(id,e)|(*id,e.used)).collect::<Vec<_>>();
  candidates.sort_by_key(|&(id,used)|(used,id));
  for (id,_) in candidates{
   if count<MAX_RECORDS&&available+bytes<=MAX_BYTES{break;}
   victims.push(id);available-=self.entries[&id].bytes;count-=1;
  }
  if count>=MAX_RECORDS||available+bytes>MAX_BYTES{return Err("源码缓存正在使用中，请关闭部分查看后重试".into());}
  let mut removed=Vec::new();
  for id in victims{
   notify(false,&self.entries[&id].record)?;
   if let Some(old)=self.entries.remove(&id){self.bytes-=old.bytes;removed.push(old.record);}
  }
  let record=Arc::new(Record{id,uri,content,solution_version:version});
  notify(true,&record)?;
  self.next=id;let used=self.touch();
  self.bytes+=bytes;self.entries.insert(id,Entry{record:record.clone(),used,bytes});Ok((record,removed))
 }
}
#[derive(Clone,Debug,Serialize,PartialEq,Eq,PartialOrd,Ord)]
pub struct Position {pub line:u32,pub character:u32}
#[derive(Clone,Debug,Serialize,PartialEq,Eq,PartialOrd,Ord)]
pub struct Range {pub start:Position,pub end:Position}
#[derive(Clone,Debug,Serialize)]
pub struct Target {pub uri:String,pub range:Range}
#[derive(Serialize)]
pub struct Targets {pub locations:Vec<Target>,pub omitted:usize}
fn point(value:&Value)->Option<Position>{Some(Position{line:u32::try_from(value.get("line")?.as_u64()?).ok()?,character:u32::try_from(value.get("character")?.as_u64()?).ok()?})}
pub fn valid_position(text:&str,line:u32,character:u32)->bool{
 let Some(text)=text.split('\n').nth(line as usize)else{return false};
 let mut units=0u32;for ch in text.trim_end_matches('\r').chars(){if units==character{return true;}units+=ch.len_utf16() as u32;}
 units==character
}
pub fn targets(value:&Value,solution_uri:&str,solution_prefix:u32,solution_text:&str)->Result<Targets,String>{
 let items=match value{Value::Null=>vec![],Value::Array(a) if a.len()<=256=>a.iter().collect(),Value::Array(_)=>return Err("定义结果超过安全处理上限".into()),Value::Object(_)=>vec![value],_=>return Err("定义结果格式无效".into())};
 let mut result=Targets{locations:vec![],omitted:0};let mut seen=BTreeSet::new();
 for item in items{
  let parsed=(||{
   let linked=item.get("targetUri").is_some();
   let uri=item.get(if linked{"targetUri"}else{"uri"})?.as_str()?;
   if uri.is_empty()||uri.len()>8192||uri.chars().any(char::is_control)||!(uri.starts_with("file://")||uri.starts_with("jdt://contents/")){return None;}
   let value=item.get(if linked{"targetSelectionRange"}else{"range"})?;
   let mut range=Range{start:point(value.get("start")?)?,end:point(value.get("end")?)?};
   if range.start>range.end{return None;}
   if uri==solution_uri{
    range.start.line=range.start.line.checked_sub(solution_prefix)?;
    range.end.line=range.end.line.checked_sub(solution_prefix)?;
    if !valid_position(solution_text,range.start.line,range.start.character)||!valid_position(solution_text,range.end.line,range.end.character){return None;}
   }
   Some(Target{uri:uri.into(),range})
  })();
  let Some(target)=parsed else{result.omitted+=1;continue};
  if !seen.insert((target.uri.clone(),target.range.clone())){continue;}
  if result.locations.len()>=32{result.omitted+=1;continue;}
  result.locations.push(target);
 }
 Ok(result)
}
#[cfg(test)]mod tests{
 use super::*;use serde_json::json;
 fn content(text:&str)->Content{Content{text:text.into(),name:"source.rs".into(),declaration:false,language:"rust".into()}}
 fn range(line:u32,col:u32,end:u32)->Value{json!({"start":{"line":line,"character":col},"end":{"line":line,"character":end}})}
 #[test]fn opaque_handles_reuse_owned_snapshot_and_preserve_unicode_lines(){
  let mut r=Registry::default();let (a,_)=r.insert("file:///a.rs".into(),content("x\r\n🦀\r"),None).unwrap();
  assert_eq!(a.content.text,"x\n🦀\n");let (b,e)=r.insert("file:///a.rs".into(),content("x\n🦀\n"),None).unwrap();assert_eq!(a.id,b.id);assert!(e.is_empty());assert!(r.contains(&a));assert!(r.get(999).is_err());
  assert!(valid_position(&a.content.text,1,2));assert!(!valid_position(&a.content.text,1,1));assert!(valid_position(&a.content.text,2,0));assert!(!valid_position(&a.content.text,3,0));
 }
 #[test]fn transport_failure_keeps_registry_consistent(){
  let mut r=Registry::default();let (a,_)=r.insert("file:///a.rs".into(),content("old"),None).unwrap();let id=a.id;drop(a);
  assert!(r.insert_with("file:///a.rs".into(),content("new"),None,|open,_|{assert!(!open);Err("full".into())}).is_err());
  assert_eq!(r.get(id).unwrap().content.text,"old");
  assert!(r.insert_with("file:///b.rs".into(),content("new"),None,|open,_|{assert!(open);Err("full".into())}).is_err());
  assert!(r.find("file:///b.rs",None).is_none());assert!(r.find("file:///a.rs",None).is_some());
  let mut events=vec![];
  let (b,_)=r.insert_with("file:///a.rs".into(),content("new"),None,|open,_|{events.push(open);Ok(())}).unwrap();
  assert_eq!(events,vec![false,true]);assert_eq!(b.content.text,"new");
  r.insert_with("file:///a.rs".into(),content("new"),None,|_,_|panic!("duplicate lifecycle")).unwrap();
 }
 #[test]fn snapshots_are_not_replaced_while_a_request_pins_them(){
  let mut r=Registry::default();let (a,_)=r.insert("file:///a.rs".into(),content("old"),None).unwrap();
  assert!(r.insert("file:///a.rs".into(),content("new"),None).is_err());let old=a.id;drop(a);
  let (b,e)=r.insert("file:///a.rs".into(),content("new"),None).unwrap();assert_ne!(old,b.id);assert_eq!(e.len(),1);assert!(r.get(old).is_err());
 }
 #[test]fn cache_evicts_only_unpinned_lru_and_rejects_oversize_without_mutation(){
  let mut r=Registry::default();let (pin,_)=r.insert("file:///pin.rs".into(),content("p"),None).unwrap();
  for i in 0..40{r.insert(format!("file:///{i}.rs"),content("x"),None).unwrap();}
  assert!(r.contains(&pin));assert_eq!(r.entries.len(),MAX_RECORDS);
  let count=r.entries.len();assert!(r.insert("file:///huge.rs".into(),content(&"x".repeat(MAX_SOURCE+1)),None).is_err());assert_eq!(r.entries.len(),count);
  let mut r=Registry::default();for i in 0..10{r.insert(format!("file:///{i}.rs"),content(&"x".repeat(MAX_SOURCE)),None).unwrap();}
  assert!(r.bytes<=MAX_BYTES);assert!(r.entries.len()<10);
 }
 #[test]fn fully_pinned_registry_refuses_new_source_without_eviction(){
  let mut r=Registry::default();let mut pins=vec![];
  for i in 0..MAX_RECORDS{pins.push(r.insert(format!("file:///{i}.rs"),content("x"),None).unwrap().0);}
  assert!(r.insert("file:///extra.rs".into(),content("x"),None).is_err());assert!(pins.iter().all(|p|r.contains(p)));
 }
 #[test]fn external_origin_targets_map_solution_once_and_leave_library_offsets_exact(){
  let v=json!([
   {"targetUri":"file:///solution.rs","targetRange":range(0,0,1),"targetSelectionRange":range(3,2,3),"originSelectionRange":range(90,0,4)},
   {"uri":"file:///library.rs","range":range(90,0,4)},
   {"uri":"file:///solution.rs","range":range(1,0,1)},
   {"uri":"file:///solution.rs","range":range(4,0,1)},
   {"uri":"file:///solution.rs","range":range(3,1,2)}
  ]);
  let t=targets(&v,"file:///solution.rs",3,"🦀x").unwrap();assert_eq!(t.locations.len(),2);assert_eq!(t.omitted,3);
  assert_eq!(t.locations[0].range.start,Position{line:0,character:2});assert_eq!(t.locations[1].range.start.line,90);
 }
 #[test]fn targets_are_bounded_deduplicated_and_preserve_jdt_uri_bytes(){
  let uri="jdt://contents/a.jar/a/A.class?=abc%20xyz";
  let item=json!({"uri":uri,"range":range(1,0,2)});
  let t=targets(&json!([item.clone(),item]),"file:///s",0,"").unwrap();assert_eq!(t.locations.len(),1);assert_eq!(t.locations[0].uri,uri);
  let many=Value::Array((0..40).map(|n|json!({"uri":format!("file:///{n}.rs"),"range":range(0,0,0)})).collect());
  let t=targets(&many,"file:///s",0,"").unwrap();assert_eq!(t.locations.len(),32);assert_eq!(t.omitted,8);
  assert!(targets(&Value::Array(vec![Value::Null;257]),"file:///s",0,"").is_err());
 }
}
