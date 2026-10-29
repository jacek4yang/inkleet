//! Only server-issued, version-owned source edits are exposed to the editor.
//! No executeCommand, applyEdit, resource operation or cross-file write is allowed.
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn provider(value: &Value) -> bool { value == &Value::Bool(true) || value.is_object() }
pub fn capabilities() -> Value {
    json!({"dynamicRegistration":false,"codeActionLiteralSupport":{"codeActionKind":{"valueSet":["quickfix","refactor","refactor.extract","refactor.inline","refactor.rewrite"]}},"isPreferredSupport":true,"disabledSupport":true,"dataSupport":true,"resolveSupport":{"properties":["edit"]}})
}
fn admissible(value: &Value) -> bool {
    value.is_object() && value.get("title").and_then(Value::as_str).is_some_and(|s|!s.trim().is_empty() && s.len() <= 1024)
        && !value.get("disabled").is_some_and(|v|!v.is_null())
        && !value.get("command").is_some_and(|v|!v.is_null())
        && value.get("kind").and_then(Value::as_str).is_some_and(|k| k=="quickfix" || k.starts_with("quickfix.") || k=="refactor" || k.starts_with("refactor."))
}

#[derive(Default)]
pub struct Cache { version:u32, sequence:u64, next:u64, items:HashMap<u64,Value> }
impl Cache {
    pub fn clear(&mut self) { self.items.clear(); }
    pub fn remember(&mut self, response:&Value, version:u32, sequence:u64, can_resolve:bool, uri:&str, prefix:u32, text:&str)->Result<Value,String> {
        if version<self.version || sequence<self.sequence {return Err("代码操作请求已经过期".into());}
        self.clear();self.version=version;self.sequence=sequence;
        if response.is_null(){return Ok(json!([]));}
        let items=response.as_array().ok_or("代码操作列表格式无效")?;
        let mut result=Vec::new();let mut bytes=0usize;
        for action in items.iter().take(256) {
            if !admissible(action){continue;}
            if action.get("edit").is_some() {
                if normalize(action,uri,prefix,text,version).is_err(){continue;}
            } else if !can_resolve || action.get("data").is_none() {continue;}
            let size=serde_json::to_vec(action).map_err(|_|"代码操作格式无效")?.len();
            if size>256*1024 || bytes.saturating_add(size)>1024*1024 {continue;}
            self.next=self.next.checked_add(1).filter(|n|*n<=9_007_199_254_740_991).ok_or("代码操作标识耗尽，请重连")?;
            bytes+=size;self.items.insert(self.next,action.clone());
            result.push(json!({"token":self.next,"title":action["title"],"kind":action["kind"],"preferred":action.get("isPreferred")==Some(&Value::Bool(true))}));
            if result.len()==64{break;}
        }
        Ok(Value::Array(result))
    }
    pub fn get(&self, token:u64, version:u32)->Result<Value,String> {
        if version!=self.version {return Err("代码操作快照已经过期".into());}
        self.items.get(&token).cloned().ok_or_else(||"代码操作已过期，请重新请求".into())
    }
}
pub fn validate_resolved(original:&Value, resolved:&Value)->Result<(),String> {
    if !admissible(resolved) || original.get("title")!=resolved.get("title") || original.get("kind")!=resolved.get("kind") {
        return Err("代码操作解析改变了操作身份或包含不支持的命令".into());
    }
    Ok(())
}
pub fn normalize(action:&Value,uri:&str,prefix:u32,text:&str,version:u32)->Result<Value,String> {
    if !admissible(action){return Err("此代码操作不是可安全预览的源码编辑".into());}
    let edit=action.get("edit").ok_or("此代码操作没有源码编辑")?;
    crate::lsp_document::rename_edits(edit,uri,prefix,text,version).map_err(|error|error.replace("重命名","代码操作"))
}
pub fn position(text:&str,line:u32,character:u32)->Result<(),String> {
    let row=text.split('\n').nth(line as usize).ok_or("代码操作行号越界")?;
    let mut units=0u32;
    for ch in row.chars(){if units==character{return Ok(());}units+=ch.len_utf16() as u32;}
    if units==character {Ok(())}else{Err("代码操作列号越界或拆分 Unicode 字符".into())}
}

#[cfg(test)]mod tests {
    use super::*;
    fn action(uri:&str)->Value {json!({"title":"Make mutable","kind":"quickfix","edit":{"changes":{(uri):[{"range":{"start":{"line":1,"character":4},"end":{"line":1,"character":4}},"newText":"mut "}]}}})}
    #[test]fn current_document_only_and_token_lifetime(){
        let uri="file:///owned.rs";let text="let value = 1;";let a=action(uri);let mut cache=Cache::default();
        let result=cache.remember(&json!([a]),3,1,true,uri,1,text).unwrap();let token=result[0]["token"].as_u64().unwrap();
        assert_eq!(normalize(&cache.get(token,3).unwrap(),uri,1,text,3).unwrap()[0]["range"]["start"]["line"],0);
        assert!(cache.get(token,2).is_err());cache.clear();assert!(cache.get(token,3).is_err());
        assert!(cache.remember(&json!([]),2,0,true,uri,1,text).is_err());
    }
    #[test]fn rejects_commands_files_annotations_and_helpers(){
        let uri="file:///owned.rs";let text="let value = 1;";let a=action(uri);
        let mut command=a.clone();command["command"]=json!({"command":"anything"});
        let mut disabled=a.clone();disabled["disabled"]=json!({"reason":"no"});
        let mut helper=a.clone();helper["edit"]["changes"][uri][0]["range"]["start"]["line"]=json!(0);
        let mut resource=a.clone();resource["edit"]=json!({"documentChanges":[{"kind":"delete","uri":uri}]});
        let mut annotated=a.clone();annotated["edit"]["changeAnnotations"]=json!({"a":{"label":"Review","needsConfirmation":true}});
        for bad in [command,disabled,helper,resource,annotated,action("file:///outside.rs")] {
            assert!(normalize(&bad,uri,1,text,3).is_err());
            assert_eq!(Cache::default().remember(&json!([bad]),3,1,true,uri,1,text).unwrap(),json!([]));
        }
    }
    #[test]fn unresolved_actions_are_owned_and_resolve_cannot_execute_commands(){
        let original=json!({"title":"Extract variable","kind":"refactor.extract","data":{"opaque":1}});
        let mut cache=Cache::default();
        assert_eq!(cache.remember(&json!([original]),1,1,false,"file:///owned.rs",0,"x").unwrap(),json!([]));
        assert_eq!(cache.remember(&json!([original]),1,2,true,"file:///owned.rs",0,"x").unwrap().as_array().unwrap().len(),1);
        let mut resolved=original.clone();resolved["command"]=json!({"command":"run"});assert!(validate_resolved(&original,&resolved).is_err());
        resolved=original.clone();resolved["title"]=json!("changed");assert!(validate_resolved(&original,&resolved).is_err());
    }
    #[test]fn unicode_positions_are_exact(){
        assert!(position("a😀z",0,1).is_ok());assert!(position("a😀z",0,3).is_ok());
        assert!(position("a😀z",0,2).is_err());assert!(position("a😀z",0,5).is_err());assert!(position("x",1,0).is_err());
    }
}
