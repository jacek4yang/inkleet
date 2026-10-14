use serde_json::Value;
use std::collections::HashMap;
#[derive(Default)]
pub struct CompletionCache{version:u32,generation:u64,next:u64,items:HashMap<u64,Value>}
impl CompletionCache{
    pub fn clear(&mut self){self.items.clear();}
    pub fn remember(&mut self,value:&mut Value,version:u32,generation:u64){
        if version<self.version||generation<self.generation{return;}
        self.items.clear();self.version=version;self.generation=generation;
        let items=if value.is_array(){value.as_array_mut()}else{value.get_mut("items").and_then(Value::as_array_mut)};
        let Some(items)=items else{return};let mut bytes=0usize;
        for item in items.iter_mut().take(5000){
            if !item.is_object(){continue;}
            item.as_object_mut().unwrap().remove("_inkleetCompletion");
            let Ok(encoded)=serde_json::to_vec(item)else{continue};
            if encoded.len()>131072||bytes.saturating_add(encoded.len())>8*1024*1024{continue;}
            let Some(id)=self.next.checked_add(1)else{break};self.next=id;bytes+=encoded.len();
            self.items.insert(id,item.clone());item["_inkleetCompletion"]=Value::from(id);
        }
    }
    pub fn get(&self,id:u64,version:u32)->Result<Value,String>{
        if version!=self.version{return Err("补全快照已经过期".into());}
        self.items.get(&id).cloned().ok_or_else(||"补全候选已经过期，请重新触发补全".into())
    }
}
pub fn validate_resolved(original:&Value,resolved:&Value)->Result<(),String>{
    if !resolved.is_object(){return Err("补全解析结果无效".into());}
    for key in ["label","filterText","sortText","insertText","insertTextFormat","textEdit"]{
        if original.get(key)!=resolved.get(key){return Err("补全解析改变了原始替换内容".into());}
    }
    if original.pointer("/data/imports").and_then(Value::as_array).is_some_and(|items|!items.is_empty()){
        if !resolved.get("additionalTextEdits").and_then(Value::as_array).is_some_and(|edits|edits.iter().any(|edit|edit.get("newText").and_then(Value::as_str).is_some_and(|s|!s.is_empty())&&!original.get("additionalTextEdits").and_then(Value::as_array).is_some_and(|before|before.contains(edit)))){
            return Err("语言服务未解析所需导入，未应用任何修改，请重新触发补全".into());
        }
    }
    Ok(())
}
#[cfg(test)]mod tests{
    use super::*;use serde_json::json;
    #[test]fn original_server_item_is_retained_and_handles_expire(){
        let mut cache=CompletionCache::default();
        let original=json!({"label":"HashMap","data":{"opaque":1},"textEdit":{"range":{"start":{"line":7,"character":2},"end":{"line":7,"character":7}},"newText":"HashMap"}});
        let mut response=json!({"items":[original.clone()]});cache.remember(&mut response,3,1);
        let id=response["items"][0]["_inkleetCompletion"].as_u64().unwrap();
        assert_eq!(cache.get(id,3).unwrap(),original);assert!(cache.get(id,4).is_err());
        cache.remember(&mut json!([{"label":"next"}]),3,2);assert!(cache.get(id,3).is_err());cache.clear();assert!(cache.items.is_empty());
    }
    #[test]fn cache_bounds_and_resolve_preserves_primary_edit(){
        let mut cache=CompletionCache::default();let mut huge=json!([{"label":"x","data":"a".repeat(131073)}]);cache.remember(&mut huge,1,1);
        assert!(cache.items.is_empty());assert!(huge[0].get("_inkleetCompletion").is_none());
        let original=json!({"label":"HashMap","insertText":"HashMap"});
        let mut resolved=original.clone();resolved["additionalTextEdits"]=json!([]);assert!(validate_resolved(&original,&resolved).is_ok());
        resolved["insertText"]=json!("other");assert!(validate_resolved(&original,&resolved).is_err());
    }
    #[test]fn late_response_cannot_expire_newer_visible_candidates(){
        let mut cache=CompletionCache::default();let mut newest=json!([{"label":"new"}]);cache.remember(&mut newest,4,2);
        let id=newest[0]["_inkleetCompletion"].as_u64().unwrap();
        cache.remember(&mut json!([{"label":"old"}]),4,1);
        assert_eq!(cache.get(id,4).unwrap()["label"],"new");
    }
    #[test]fn unresolved_auto_import_response_never_inserts_identifier_alone(){
        let original=json!({"label":"HashMap","insertText":"HashMap","data":{"imports":[{"full_import_path":"std::collections::HashMap"}]}});
        let mut unresolved=original.clone();unresolved.as_object_mut().unwrap().remove("data");
        assert!(validate_resolved(&original,&unresolved).is_err());
        unresolved["additionalTextEdits"]=json!([]);assert!(validate_resolved(&original,&unresolved).is_err());
        unresolved["additionalTextEdits"]=json!([{"newText":"use std::collections::HashMap;"}]);assert!(validate_resolved(&original,&unresolved).is_ok());
        let mut auxiliary=original.clone();auxiliary["additionalTextEdits"]=json!([{"newText":"auxiliary edit"}]);let mut fallback=auxiliary.clone();fallback.as_object_mut().unwrap().remove("data");assert!(validate_resolved(&auxiliary,&fallback).is_err());
    }

}
