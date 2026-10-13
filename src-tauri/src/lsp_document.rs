//! Virtual language scaffolding never changes the user's saved/submitted source.
use serde_json::Value;
pub fn source(language:&str,text:&str)->(String,u32){
    if language=="golang"&&!go_package(text){(format!("package main\n{text}"),1)}else{(text.to_owned(),0)}
}
fn go_package(text:&str)->bool{
    let mut rest=text.trim_start_matches('\u{feff}').trim_start();
    loop{
        if let Some(comment)=rest.strip_prefix("//"){
            let Some((_,tail))=comment.split_once('\n')else{return false};rest=tail.trim_start();
        }else if let Some(comment)=rest.strip_prefix("/*"){
            let Some((_,tail))=comment.split_once("*/")else{return false};rest=tail.trim_start();
        }else{break;}
    }
    rest.strip_prefix("package").is_some_and(|tail|tail.chars().next().is_some_and(char::is_whitespace))
}
fn position(value:&mut Value,prefix:u32)->bool{
    let Some(line)=value.get("line").and_then(Value::as_u64)else{return false};
    if line<u64::from(prefix){return false;}
    value["line"]=Value::from(line-u64::from(prefix));true
}
fn range(value:&mut Value,prefix:u32)->bool{
    let Some(start)=value.get_mut("start")else{return false};if !position(start,prefix){return false;}
    let Some(end)=value.get_mut("end")else{return false};position(end,prefix)
}
fn edit(value:&mut Value,prefix:u32)->bool{
    let mut found=false;
    for key in ["range","insert","replace"]{if let Some(span)=value.get_mut(key){found=true;if !range(span,prefix){return false;}}}
    found
}
pub fn response(kind:&str,value:&mut Value,prefix:u32){
    if prefix==0{return;}
    match kind{
        "hover"=>{if let Some(span)=value.get_mut("range"){if !range(span,prefix){*value=Value::Null;}}},
        "completion"=>{
            let items=if value.is_array(){value.as_array_mut()}else{value.get_mut("items").and_then(Value::as_array_mut)};
            if let Some(items)=items{items.retain_mut(|item|{
                if let Some(primary)=item.get_mut("textEdit"){if !edit(primary,prefix){return false;}}
                if let Some(additional)=item.get_mut("additionalTextEdits").and_then(Value::as_array_mut){
                    for e in additional{if !edit(e,prefix){return false;}}
                }
                true
            });}
        },
        _=>{}
    }
}
pub fn diagnostics(value:&mut Value,prefix:u32){
    if prefix==0{return;}
    if let Some(items)=value.get_mut("diagnostics").and_then(Value::as_array_mut){
        items.retain_mut(|item|item.get_mut("range").is_some_and(|span|range(span,prefix)));
    }
}
#[cfg(test)]mod tests{
    use super::*;use serde_json::json;
    #[test]fn virtual_go_package_preserves_source(){
        let text="// package mentioned in comment\nfunc solve() {}";
        let (wrapped,prefix)=source("golang",text);assert_eq!(prefix,1);assert_eq!(wrapped,format!("package main\n{text}"));
        for text in ["package foo\n", "// header\npackage main\n", "/* header */\npackage fixture\n","\u{feff}package main\n"]{assert_eq!(source("golang",text),(text.to_owned(),0));}
        assert_eq!(source("python3","print(1)"),("print(1)".into(),0));
    }
    #[test]fn completion_and_diagnostics_map_only_editable_lines(){
        let span=|line|json!({"start":{"line":line,"character":0},"end":{"line":line,"character":1}});
        let mut completion=json!({"items":[{"label":"valid","textEdit":{"range":span(2),"newText":"foo"},"additionalTextEdits":[{"range":span(1),"newText":"import \"fmt\"\n"}]},{"label":"unsafe","textEdit":{"range":span(0),"newText":"bad"}}]});
        response("completion",&mut completion,1);assert_eq!(completion["items"].as_array().unwrap().len(),1);
        assert_eq!(completion["items"][0]["textEdit"]["range"]["start"]["line"],1);
        assert_eq!(completion["items"][0]["additionalTextEdits"][0]["range"]["start"]["line"],0);
        let mut errors=json!({"version":2,"diagnostics":[{"range":span(3)},{"range":span(0)}]});
        diagnostics(&mut errors,1);assert_eq!(errors["diagnostics"].as_array().unwrap().len(),1);assert_eq!(errors["diagnostics"][0]["range"]["start"]["line"],2);
    }
}
