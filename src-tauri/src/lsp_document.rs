//! Virtual language scaffolding never changes the user's saved/submitted source.
use serde_json::Value;
use inkleet_managed_env::lsp_scaffold::Context;
pub fn contextual_source(language:&str,text:&str,context:&Context)->(String,u32){
    if language=="python3"{if let Some(wrapped)=context.python_source(text){return wrapped;}}
    let (base,prefix)=source(language,text);
    let (before,after)=context.fragments(language,text);
    let extra=before.lines().count() as u32;
    (format!("{before}{base}{after}"),prefix+extra)
}
pub fn source(language:&str,text:&str)->(String,u32){
    let prefix=match language{
        "cpp"=>"#include <vector>\n#include <string>\n#include <algorithm>\n#include <array>\n#include <map>\n#include <unordered_map>\n#include <set>\n#include <unordered_set>\n#include <queue>\n#include <stack>\n#include <deque>\n#include <list>\n#include <tuple>\n#include <utility>\n#include <numeric>\n#include <functional>\n#include <limits>\n#include <climits>\n#include <cmath>\n#include <cstdint>\nusing namespace std;\n",
        "c"=>"#include <stdlib.h>\n#include <stdio.h>\n#include <string.h>\n#include <stdbool.h>\n#include <stdint.h>\n#include <limits.h>\n#include <math.h>\n",
        _=>"",
    };
    if !prefix.is_empty(){return(format!("{prefix}{text}"),prefix.lines().count() as u32);}
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
    #[test]fn c_family_headers_remain_virtual(){
        for language in ["c","cpp"]{
            let original="int solve(){return 0;}";
            let (wrapped,prefix)=source(language,original);
            assert!(prefix>0);assert!(wrapped.ends_with(original));
            assert_eq!(wrapped.lines().count(),prefix as usize+1);
        }
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


/// Definition locations in the current virtual document must map back to the
/// editable source, while standard-library locations keep their original lines.
pub fn definition(value:&mut Value,document_uri:&str,prefix:u32){
    if prefix==0{return;}
    fn map(value:&mut Value,uri:&str,prefix:u32)->bool{
        if let Some(origin)=value.get_mut("originSelectionRange"){if !range(origin,prefix){return false;}}
        let same=value.get("uri").or_else(||value.get("targetUri")).and_then(Value::as_str)==Some(uri);
        if same{
            for key in ["range","targetRange","targetSelectionRange"]{
                if let Some(span)=value.get_mut(key){if !range(span,prefix){return false;}}
            }
        }
        true
    }
    if let Some(locations)=value.as_array_mut(){locations.retain_mut(|item|map(item,document_uri,prefix));}
    else if value.is_object()&&!map(value,document_uri,prefix){*value=Value::Null;}
}
#[cfg(test)]mod definition_tests{
    use super::*;use serde_json::json;
    #[test]fn definition_maps_only_current_virtual_source(){
        let span=|line|json!({"start":{"line":line,"character":0},"end":{"line":line,"character":3}});
        let mut value=json!([
            {"uri":"file:///solution.cpp","range":span(23)},
            {"uri":"file:///stdlib/vector","range":span(23)},
            {"targetUri":"file:///solution.cpp","targetRange":span(24),"targetSelectionRange":span(24),"originSelectionRange":span(25)},
            {"uri":"file:///solution.cpp","range":span(2)}
        ]);
        definition(&mut value,"file:///solution.cpp",21);
        assert_eq!(value.as_array().unwrap().len(),3);
        assert_eq!(value[0]["range"]["start"]["line"],2);
        assert_eq!(value[1]["range"]["start"]["line"],23);
        assert_eq!(value[2]["targetSelectionRange"]["start"]["line"],3);
        assert_eq!(value[2]["originSelectionRange"]["start"]["line"],4);
    }
}

#[cfg(test)]mod scaffold_tests{
    use super::*;
    #[test]fn generated_types_preserve_editable_line_mapping(){
        let context=Context::parse(Some(r#"{"params":[{"type":"ListNode"},{"type":"TreeNode"}]}"#)).unwrap();
        for language in ["rust","java","golang","c","cpp"]{
            let original="// source with no trailing newline";
            let (wrapped,prefix)=contextual_source(language,original,&context);
            assert_eq!(wrapped.lines().nth(prefix as usize),Some(original));
            assert!(wrapped.contains("ListNode"));assert!(wrapped.contains("TreeNode"));
        }
        let (rust,prefix)=contextual_source("rust","#![allow(dead_code)]\nimpl Solution{}", &context);
        assert_eq!(prefix,0);assert!(rust.starts_with("#![allow(dead_code)]"));assert!(rust.contains("pub struct Solution;"));
    }
}
