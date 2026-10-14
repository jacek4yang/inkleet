//! Negotiated completion triggers, bounded independently of server payload size.
use serde_json::{json,Value};
pub fn triggers(provider:&Value)->Vec<String>{
    let mut result=Vec::new();
    if let Some(values)=provider.get("triggerCharacters").and_then(Value::as_array){
        for value in values.iter().take(128){
            if let Some(s)=value.as_str(){
                if s.chars().count()==1&&!s.chars().any(char::is_control)&&!result.iter().any(|x|x==s){result.push(s.to_owned());}
            }
            if result.len()==32{break;}
        }
    }
    result
}
pub fn context(value:Option<&Value>,triggers:&[String])->Result<Value,String>{
    let Some(value)=value else{return Ok(json!({"triggerKind":1}));};
    let object=value.as_object().ok_or("补全上下文无效")?;
    if object.keys().any(|key|key!="triggerKind"&&key!="triggerCharacter"){return Err("补全上下文字段无效".into());}
    match value.get("triggerKind").and_then(Value::as_u64){
        Some(1|3) if value.get("triggerCharacter").is_none()=>Ok(value.clone()),
        Some(2) if value.get("triggerCharacter").and_then(Value::as_str).is_some_and(|s|triggers.iter().any(|x|x==s))=>Ok(value.clone()),
        _=>Err("补全触发字符或类型无效".into())
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn provider_triggers_are_bounded_deduplicated_and_valid(){
        assert_eq!(triggers(&json!({"triggerCharacters":[".",":",".","->","\n",null,3,"中"]})),vec![".",":","中"]);
        assert!(triggers(&Value::Null).is_empty());
        let values:Vec<String>=(0..128).map(|i|char::from_u32(0x400+i).unwrap().to_string()).collect();
        assert_eq!(triggers(&json!({"triggerCharacters":values})).len(),32);
    }
    #[test]fn request_context_only_accepts_negotiated_triggers(){
        let supported=vec![".".to_owned()];
        assert_eq!(context(None,&supported).unwrap(),json!({"triggerKind":1}));
        for kind in [1,3]{assert!(context(Some(&json!({"triggerKind":kind})),&supported).is_ok());}
        assert!(context(Some(&json!({"triggerKind":2,"triggerCharacter":"."})),&supported).is_ok());
        for invalid in [json!({"triggerKind":0}),json!({"triggerKind":2}),json!({"triggerKind":2,"triggerCharacter":":"}),json!({"triggerKind":1,"triggerCharacter":"."}),json!({"triggerKind":3,"extra":true}),Value::Null]{
            assert!(context(Some(&invalid),&supported).is_err());
        }
    }
}
