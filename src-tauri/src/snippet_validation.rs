
use serde_json::{json,Value};
use std::{collections::VecDeque,io::Write,path::Path,sync::Mutex};
static RECORDS:Mutex<VecDeque<Value>>=Mutex::new(VecDeque::new());


fn point(value:&Value)->Option<Value>{
    let line=value.get("line")?.as_u64()?;
    let character=value.get("character")?.as_u64()?;
    if line>u32::MAX as u64||character>u32::MAX as u64{return None;}
    Some(json!({"line":line,"character":character}))
}
fn edit_range(value:&Value)->Option<Value>{
    Some(json!({"start":point(value.get("start")?)?,"end":point(value.get("end")?)?}))
}

fn item(value:&Value,default_mode:u8)->Option<Value>{
    let label=value.get("label")?.as_str()?.trim_start();
    if label.len()>512||!["push","WriteString","HashMap","inkleet_add","inkleet_test"].iter().any(|name|label==*name||label.strip_prefix(*name).is_some_and(|tail|tail.starts_with('(')||tail.starts_with('<'))){return None;}
    let source=value.pointer("/textEdit/newText").or_else(||value.get("insertText")).and_then(Value::as_str).map(|text|text.chars().take(512).collect::<String>());
    Some(json!({"label":label,"format":value.get("insertTextFormat").map(|v|v.as_u64()).unwrap_or(Some(1)),
        "mode":value.get("insertTextMode").and_then(Value::as_u64),
        "defaultMode":default_mode,"effectiveMode":value.get("insertTextMode").map(Value::as_u64).unwrap_or(Some(default_mode as u64)),
        "modePresent":value.get("insertTextMode").is_some(),"range":value.pointer("/textEdit/range").and_then(edit_range),
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
pub(crate) fn started(root:&Path,id:u64,language:&str,default_mode:u8){
    if !crate::lsp_launch::snippet_validation_enabled(){return;}
    record(root,json!({"kind":"start","id":id,"language":language,"defaultMode":default_mode,"snippets":crate::lsp_launch::snippet_support_enabled(language)}));
}
pub(crate) fn completion(root:&Path,id:u64,version:u32,sequence:u64,language:&str,default_mode:u8,request:Value,response:&Value){
    if !crate::lsp_launch::snippet_validation_enabled(){return;}
    let values=response.as_array().or_else(||response.get("items").and_then(Value::as_array));
    let items=values.map(|values|values.iter().take(5000).filter_map(|value|item(value,default_mode)).take(16).collect::<Vec<_>>()).unwrap_or_default();
    let count=values.map_or(0,Vec::len);
    let labels=values.map(|values|values.iter().take(32).filter_map(|value|value.get("label").and_then(Value::as_str)).map(|label|label.chars().take(64).collect::<String>()).collect::<Vec<_>>()).unwrap_or_default();
    record(root,json!({"kind":"completion","id":id,"version":version,"sequence":sequence,"language":language,"defaultMode":default_mode,"snippets":crate::lsp_launch::snippet_support_enabled(language),"request":request,"count":count,"labels":labels,"items":items}));
}
pub(crate) fn resolved(root:&Path,id:u64,version:u32,token:u64,default_mode:u8,response:&Value){
    if !crate::lsp_launch::snippet_validation_enabled(){return;}
    if let Some(item)=item(response,default_mode){record(root,json!({"kind":"resolve","id":id,"version":version,"token":token,"item":item}));}
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn trace_is_allowlisted_and_bounded(){
        assert!(item(&json!({"label":"unrelated","insertText":"secret"}),1).is_none());
        let value=item(&json!({"label":"push","insertTextFormat":2,"insertText":"x".repeat(10000),"data":{"private":"not copied"}}),1).unwrap();
        assert_eq!(value["source"].as_str().unwrap().len(),512);
        assert_eq!(value["format"],json!(2));assert!(value.get("data").is_none());
    }
    #[test]fn trace_has_no_default_side_effect_and_is_opt_in(){
        let root=tempfile::tempdir().unwrap();started(root.path(),777,"rust",1);
        let file=root.path().join("native-snippet-validation.json");
        if crate::lsp_launch::snippet_validation_enabled(){
            let records:Value=serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();
            assert!(records.as_array().unwrap().iter().any(|r|r["id"]==json!(777)&&r["snippets"]==json!(crate::lsp_launch::snippet_support_enabled("rust"))));
        }else{assert!(!file.exists());}
    }
    #[test]fn trace_retains_bounded_unmatched_response_metadata(){
        let root=tempfile::tempdir().unwrap();
        let response=json!((0..40).map(|_|json!({"label":"x".repeat(1000),"data":{"private":"not copied"}})).collect::<Vec<_>>());
        completion(root.path(),888,3,4,"rust",1,json!({"line":0,"character":60,"prefix":0}),&response);
        let file=root.path().join("native-snippet-validation.json");
        if crate::lsp_launch::snippet_validation_enabled(){
            let records:Value=serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();
            let entry=records.as_array().unwrap().iter().find(|r|r["id"]==json!(888)).unwrap();
            assert_eq!(entry["count"],json!(40));assert_eq!(entry["labels"].as_array().unwrap().len(),32);
            assert_eq!(entry["labels"][0].as_str().unwrap().len(),64);assert_eq!(entry["items"],json!([]));
            assert_eq!(entry["request"]["character"],json!(60));assert!(entry.get("data").is_none());
        }else{assert!(!file.exists());}
    }

    #[test]fn trace_retains_only_bounded_explicit_edit_coordinates(){
        let value=item(&json!({"label":"inkleet_test","insertTextFormat":2,"insertTextMode":2,"textEdit":{"range":{"start":{"line":3,"character":8,"extra":"not copied"},"end":{"line":3,"character":18}},"newText":"inkleet_test();"},"documentation":"not copied"}),1).unwrap();
        assert_eq!(value["mode"],json!(2));assert_eq!(value["modePresent"],json!(true));
        assert_eq!(value["range"],json!({"start":{"line":3,"character":8},"end":{"line":3,"character":18}}));
        assert!(value.get("documentation").is_none());
        assert!(point(&json!({"line":-1,"character":0})).is_none());
        assert!(point(&json!({"line":0,"character":4294967296u64})).is_none());
    }

    #[test]fn trace_distinguishes_raw_mode_from_session_default(){
        let absent=item(&json!({"label":"push","insertText":"push"}),2).unwrap();
        assert!(absent["mode"].is_null());assert_eq!(absent["modePresent"],json!(false));
        assert_eq!(absent["defaultMode"],json!(2));assert_eq!(absent["effectiveMode"],json!(2));
        let explicit=item(&json!({"label":"push","insertTextMode":1}),2).unwrap();
        assert_eq!(explicit["mode"],json!(1));assert_eq!(explicit["effectiveMode"],json!(1));
        let invalid=item(&json!({"label":"push","insertTextMode":null}),2).unwrap();
        assert_eq!(invalid["modePresent"],json!(true));assert!(invalid["effectiveMode"].is_null());
    }

}
