
use serde_json::{json,Value};
use std::{collections::VecDeque,io::Write,path::Path,sync::Mutex};
static RECORDS:Mutex<VecDeque<Value>>=Mutex::new(VecDeque::new());

fn item(value:&Value)->Option<Value>{
    let label=value.get("label")?.as_str()?.trim_start();
    if label.len()>512||!["push","WriteString","HashMap","inkleet_add"].iter().any(|name|label==*name||label.strip_prefix(*name).is_some_and(|tail|tail.starts_with('(')||tail.starts_with('<'))){return None;}
    let source=value.pointer("/textEdit/newText").or_else(||value.get("insertText")).and_then(Value::as_str).map(|text|text.chars().take(512).collect::<String>());
    Some(json!({"label":label,"format":value.get("insertTextFormat").map(|v|v.as_u64()).unwrap_or(Some(1)),
        "mode":value.get("insertTextMode").map(|v|v.as_u64()).unwrap_or(Some(1)),
        "token":value.get("_inkleetCompletion").and_then(Value::as_u64),"source":source,
        "additional":value.get("additionalTextEdits").and_then(Value::as_array).map_or(0,Vec::len)}))
}
fn record(root:&Path,value:Value){
    if !crate::lsp_launch::snippet_validation_enabled(){return;}
    let result=(||->Result<(),String>{
        let mut records=RECORDS.lock().map_err(|_|"trace lock")?;
        records.push_back(value);while records.len()>32{records.pop_front();}
        let mut bytes=serde_json::to_vec(&*records).map_err(|_|"trace encoding")?;
        while bytes.len()>1024*1024&&!records.is_empty(){records.pop_front();bytes=serde_json::to_vec(&*records).map_err(|_|"trace encoding")?;}
        std::fs::create_dir_all(root).map_err(|_|"trace directory")?;
        let mut file=tempfile::NamedTempFile::new_in(root).map_err(|_|"trace temporary file")?;
        file.write_all(&bytes).map_err(|_|"trace write")?;
        file.persist(root.join("native-snippet-validation.json")).map_err(|_|"trace replace")?;
        Ok(())
    })();
    if let Err(error)=result{eprintln!("Native snippet validation trace unavailable: {error}");}
}
pub(crate) fn started(root:&Path,id:u64,language:&str){
    if !crate::lsp_launch::snippet_validation_enabled(){return;}
    record(root,json!({"kind":"start","id":id,"language":language,"snippets":crate::lsp_launch::snippet_support_enabled(language)}));
}
pub(crate) fn completion(root:&Path,id:u64,version:u32,sequence:u64,language:&str,request:Value,response:&Value){
    if !crate::lsp_launch::snippet_validation_enabled(){return;}
    let values=response.as_array().or_else(||response.get("items").and_then(Value::as_array));
    let items=values.map(|values|values.iter().take(5000).filter_map(item).take(16).collect::<Vec<_>>()).unwrap_or_default();
    let count=values.map_or(0,Vec::len);
    let labels=values.map(|values|values.iter().take(32).filter_map(|value|value.get("label").and_then(Value::as_str)).map(|label|label.chars().take(64).collect::<String>()).collect::<Vec<_>>()).unwrap_or_default();
    record(root,json!({"kind":"completion","id":id,"version":version,"sequence":sequence,"language":language,"snippets":crate::lsp_launch::snippet_support_enabled(language),"request":request,"count":count,"labels":labels,"items":items}));
}
pub(crate) fn resolved(root:&Path,id:u64,version:u32,token:u64,response:&Value){
    if !crate::lsp_launch::snippet_validation_enabled(){return;}
    if let Some(item)=item(response){record(root,json!({"kind":"resolve","id":id,"version":version,"token":token,"item":item}));}
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn trace_is_allowlisted_and_bounded(){
        assert!(item(&json!({"label":"unrelated","insertText":"secret"})).is_none());
        let value=item(&json!({"label":"push","insertTextFormat":2,"insertText":"x".repeat(10000),"data":{"private":"not copied"}})).unwrap();
        assert_eq!(value["source"].as_str().unwrap().len(),512);
        assert_eq!(value["format"],json!(2));assert!(value.get("data").is_none());
    }
    #[test]fn trace_has_no_default_side_effect_and_is_opt_in(){
        let root=tempfile::tempdir().unwrap();started(root.path(),777,"rust");
        let file=root.path().join("native-snippet-validation.json");
        if crate::lsp_launch::snippet_validation_enabled(){
            let records:Value=serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();
            assert!(records.as_array().unwrap().iter().any(|r|r["id"]==json!(777)&&r["snippets"]==json!(crate::lsp_launch::snippet_support_enabled("rust"))));
        }else{assert!(!file.exists());}
    }
    #[test]fn trace_retains_bounded_unmatched_response_metadata(){
        let root=tempfile::tempdir().unwrap();
        let response=json!((0..40).map(|_|json!({"label":"x".repeat(1000),"data":{"private":"not copied"}})).collect::<Vec<_>>());
        completion(root.path(),888,3,4,"rust",json!({"line":0,"character":60,"prefix":0}),&response);
        let file=root.path().join("native-snippet-validation.json");
        if crate::lsp_launch::snippet_validation_enabled(){
            let records:Value=serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();
            let entry=records.as_array().unwrap().iter().find(|r|r["id"]==json!(888)).unwrap();
            assert_eq!(entry["count"],json!(40));assert_eq!(entry["labels"].as_array().unwrap().len(),32);
            assert_eq!(entry["labels"][0].as_str().unwrap().len(),64);assert_eq!(entry["items"],json!([]));
            assert_eq!(entry["request"]["character"],json!(60));assert!(entry.get("data").is_none());
        }else{assert!(!file.exists());}
    }

}
