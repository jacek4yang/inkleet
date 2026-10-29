use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64,Ordering};

// Completion intent is ordered at the frontend issuance boundary, not by the
// order in which spawn_blocking workers happen to execute. RPC IDs stay private.
pub fn admit_sequence(latest:&AtomicU64,sequence:Option<u64>)->Result<u64,String>{
    let sequence=sequence.filter(|n|*n>0&&*n<=9_007_199_254_740_991).ok_or("补全请求序号无效")?;
    latest.fetch_update(Ordering::Relaxed,Ordering::Relaxed,|old|if sequence>old{Some(sequence)}else{None}).map_err(|_|"补全请求已经过期".to_owned())?;
    Ok(sequence)
}

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
// Primary identity validation precedes coordinate mapping. Python import hints
// additionally require lsp_document::validate_completion_import on the mapped
// edits and exact authored snapshot; an inserted substring is not import proof.
pub fn validate_resolved(original:&Value,resolved:&Value)->Result<(),String>{
    if !resolved.is_object(){return Err("补全解析结果无效".into());}
    for key in ["label","filterText","sortText","insertText","insertTextFormat","insertTextMode","textEdit"]{
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
    #[test]fn resolve_cannot_change_or_introduce_indentation_mode(){
        let original=json!({"label":"call","insertTextFormat":2,"insertTextMode":1,"insertText":"call($1)"});
        let mut resolved=original.clone();resolved["insertTextMode"]=json!(2);assert!(validate_resolved(&original,&resolved).is_err());
        resolved=original.clone();resolved.as_object_mut().unwrap().remove("insertTextMode");assert!(validate_resolved(&original,&resolved).is_err());
        let absent=json!({"label":"call","insertText":"call"});let mut added=absent.clone();added["insertTextMode"]=json!(2);assert!(validate_resolved(&absent,&added).is_err());
        assert!(validate_resolved(&original,&original).is_ok());
    }
    #[test]fn late_response_cannot_expire_newer_visible_candidates(){
        let mut cache=CompletionCache::default();let mut newest=json!([{"label":"new"}]);cache.remember(&mut newest,4,2);
        let id=newest[0]["_inkleetCompletion"].as_u64().unwrap();
        cache.remember(&mut json!([{"label":"old"}]),4,1);
        assert_eq!(cache.get(id,4).unwrap()["label"],"new");
    }
    #[test]fn issuer_order_survives_reversed_worker_admission(){
        let order=AtomicU64::new(0);let mut cache=CompletionCache::default();
        let newer=admit_sequence(&order,Some(2)).unwrap();
        let mut b=json!([{"label":"B"}]);cache.remember(&mut b,1,newer);
        let token=b[0]["_inkleetCompletion"].as_u64().unwrap();
        assert!(admit_sequence(&order,Some(1)).is_err());
        assert_eq!(cache.get(token,1).unwrap()["label"],"B");
        assert!(admit_sequence(&order,Some(2)).is_err());
        assert_eq!(admit_sequence(&AtomicU64::new(0),Some(1)).unwrap(),1);
    }
    #[test]fn issuer_order_survives_reversed_responses_and_publication_race(){
        let order=AtomicU64::new(0);let mut cache=CompletionCache::default();
        let older=admit_sequence(&order,Some(1)).unwrap();
        let newer=admit_sequence(&order,Some(2)).unwrap();
        let mut b=json!([{"label":"B"}]);cache.remember(&mut b,7,newer);
        let token=b[0]["_inkleetCompletion"].as_u64().unwrap();
        // Even if A passed an earlier atomic check, the cache cannot regress.
        cache.remember(&mut json!([{"label":"A"}]),7,older);
        assert_eq!(cache.get(token,7).unwrap()["label"],"B");
        assert_ne!(order.load(Ordering::Relaxed),older);
    }
    #[test]fn concurrent_admission_keeps_highest_issuer_sequence(){
        let order=AtomicU64::new(0);let barrier=std::sync::Barrier::new(16);
        std::thread::scope(|scope|{
            let mut tasks=Vec::new();
            for n in 1..=16 {let order=&order;let barrier=&barrier;tasks.push((n,scope.spawn(move||{barrier.wait();admit_sequence(order,Some(n))})));}
            for (n,task) in tasks {let result=task.join().unwrap();if n==16{assert_eq!(result.unwrap(),16);}}
        });
        assert_eq!(order.load(Ordering::Relaxed),16);
    }
    #[test]fn invalid_sequences_do_not_advance_admission(){
        let order=AtomicU64::new(0);
        for sequence in [None,Some(0),Some(9_007_199_254_740_992),Some(u64::MAX)]{
            assert!(admit_sequence(&order,sequence).is_err());
            assert_eq!(order.load(Ordering::Relaxed),0);
        }
        assert_eq!(admit_sequence(&order,Some(9_007_199_254_740_991)).unwrap(),9_007_199_254_740_991);
        assert!(admit_sequence(&order,Some(1)).is_err());
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
