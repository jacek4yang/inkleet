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
    if language=="cpp"{let headers=inkleet_managed_env::cpp_harness::STANDARD_PRELUDE;return (format!("{headers}using namespace std;\n{text}"),headers.lines().count() as u32+1);}

    let prefix=match language{
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

/// Normalize a server rename into bounded edits of this exact user document.
/// Reject multi-file operations and every edit touching implicit helper code.
pub fn rename_edits(value:&Value,uri:&str,prefix:u32,text:&str,version:u32)->Result<Value,String>{
    let mut edits=Vec::new();
    if value.is_null(){return Err("此符号不能重命名".into());}
    if !value.is_object(){return Err("语言服务返回的重命名格式无效".into());}
    if value.get("changes").is_some()&&value.get("documentChanges").is_some(){return Err("拒绝含重复编辑表示的重命名".into());}
    // We do not advertise change-annotation support. Never strip a server's
    // confirmation requirement while normalizing into plain source edits.
    if let Some(annotations)=value.get("changeAnnotations"){
        if !annotations.as_object().is_some_and(|items|items.is_empty()){
            return Err("此重命名含需审阅的变更注释，当前无法安全应用".into());
        }
    }
    if let Some(changes)=value.get("changes"){
        let changes=changes.as_object().ok_or("重命名文件列表无效")?;
        for (target,items) in changes{
            if target!=uri{return Err("此重命名涉及其他文件，当前仅支持本题源码内重命名".into());}
            edits.extend(items.as_array().ok_or("重命名编辑列表无效")?.iter().cloned());
        }
    }
    if let Some(changes)=value.get("documentChanges"){
        for change in changes.as_array().ok_or("重命名文件操作无效")?{
            if change.get("kind").is_some()||change.pointer("/textDocument/uri").and_then(Value::as_str)!=Some(uri){return Err("拒绝跨文件或文件系统重命名操作".into());}
            if let Some(v)=change.pointer("/textDocument/version").filter(|v|!v.is_null()){
                if v.as_u64()!=Some(u64::from(version)){return Err("重命名使用了过期的文档版本".into());}
            }
            edits.extend(change.get("edits").and_then(Value::as_array).ok_or("缺少重命名编辑")?.iter().cloned());
        }
    }
    if edits.is_empty()||edits.len()>512{return Err("重命名没有有效编辑或超过 512 处限制".into());}
    let lines=text.split('\n').collect::<Vec<_>>();
    fn point(value:&Value,lines:&[&str])->Option<(usize,usize)>{
        let line=usize::try_from(value.get("line")?.as_u64()?).ok()?;
        let column=usize::try_from(value.get("character")?.as_u64()?).ok()?;
        let source=lines.get(line)?;let mut units=0;
        for ch in source.chars(){if units==column{return Some((line,column));}units+=ch.len_utf16();}
        (units==column).then_some((line,column))
    }
    let mut spans=Vec::new();let mut total=0usize;
    for item in &mut edits{
        if item.get("annotationId").is_some(){
            return Err("此重命名含需审阅的变更注释，当前无法安全应用".into());
        }
        let inserted=item.get("newText").and_then(Value::as_str).ok_or("重命名替换文本无效")?;
        total=total.checked_add(inserted.len()).ok_or("重命名文本过大")?;
        if inserted.len()>65536||total>2*1024*1024{return Err("重命名替换文本超过限制".into());}
        let span=item.get_mut("range").ok_or("重命名范围缺失")?;
        if !range(span,prefix){return Err("重命名涉及语言环境辅助代码，无法自动应用".into());}
        let start=point(&span["start"],&lines).ok_or("重命名起点越界或拆分 Unicode 字符")?;
        let end=point(&span["end"],&lines).ok_or("重命名终点越界或拆分 Unicode 字符")?;
        if start>end{return Err("重命名范围顺序无效".into());}
        spans.push((start,end));
    }
    spans.sort_unstable();
    for pair in spans.windows(2){if pair[1].0<pair[0].1||pair[1].0==pair[0].0{return Err("重命名编辑相互重叠".into());}}
    Ok(Value::Array(edits))
}
#[cfg(test)]mod rename_tests{
    use super::*;use serde_json::json;
    fn edit(line:u32,start:u32,end:u32)->Value{json!({"range":{"start":{"line":line,"character":start},"end":{"line":line,"character":end}},"newText":"renamed"})}
    #[test]fn rename_maps_source_and_rejects_other_files_helpers_and_old_versions(){
        let uri="file:///solution.rs";
        let valid=json!({"changes":{(uri):[edit(2,0,3)]}});
        let result=rename_edits(&valid,uri,2,"old",4).unwrap();assert_eq!(result[0]["range"]["start"]["line"],0);
        for bad in [
            json!({"changes":{"file:///secret.rs":[edit(2,0,3)]}}),
            json!({"changes":{(uri):[edit(1,0,1)]}}),
            json!({"changes":{(uri):[edit(3,0,1)]}}),
            json!({"changes":{(uri):[edit(2,0,3),edit(2,1,2)]}}),
            json!({"documentChanges":[{"kind":"rename","oldUri":uri,"newUri":"file:///other.rs"}]}),
            json!({"documentChanges":[{"textDocument":{"uri":uri,"version":3},"edits":[edit(2,0,3)]}]}),
        ]{assert!(rename_edits(&bad,uri,2,"old",4).is_err(),"{bad}");}
    }
    #[test]fn rename_never_discards_change_annotation_confirmation(){
        let uri="file:///solution.rs";
        let ordinary=edit(0,0,3);
        let mut annotated=ordinary.clone();annotated["annotationId"]=json!("review");
        for bad in [
            json!({"documentChanges":[{"textDocument":{"uri":uri,"version":1},"edits":[annotated.clone()]}],"changeAnnotations":{"review":{"label":"Review rename","needsConfirmation":true}}}),
            json!({"documentChanges":[{"textDocument":{"uri":uri,"version":1},"edits":[annotated.clone()]}]}),
            json!({"changes":{(uri):[ordinary.clone(),annotated]}}),
            json!({"changes":{(uri):[ordinary.clone()]},"changeAnnotations":{"review":{"label":"Review rename","needsConfirmation":false}}}),
            json!({"changes":{(uri):[ordinary.clone()]},"changeAnnotations":null}),
        ]{assert!(rename_edits(&bad,uri,0,"old",1).is_err(),"{bad}");}
        assert!(rename_edits(&json!({"changes":{(uri):[ordinary]},"changeAnnotations":{}}),uri,0,"old",1).is_ok());
    }
    #[test]fn rename_never_splits_utf16_surrogate_pairs(){
        let uri="file:///solution.rs";
        assert!(rename_edits(&json!({"changes":{(uri):[edit(0,1,2)]}}),uri,0,"🦀x",1).is_err());
        assert!(rename_edits(&json!({"changes":{(uri):[edit(0,2,3)]}}),uri,0,"🦀x",1).is_ok());
    }
}


/// Bounded current-solution references; hide virtual helpers and other files.
pub fn references(value:&Value,uri:&str,prefix:u32,text:&str)->Result<Value,String>{
    use serde_json::json;
    if value.is_null(){return Ok(json!({"locations":[],"omitted":0}));}
    let items=value.as_array().ok_or("引用结果格式无效")?;
    if items.len()>10000{return Err("引用结果超过安全处理上限".into());}
    let lines=text.split('\n').collect::<Vec<_>>();
    fn point(value:&Value,lines:&[&str])->Option<(usize,usize)>{
        let row=usize::try_from(value.get("line")?.as_u64()?).ok()?;
        let col=usize::try_from(value.get("character")?.as_u64()?).ok()?;
        let line=lines.get(row)?;let mut units=0;
        for ch in line.chars(){if units==col{return Some((row,col));}units+=ch.len_utf16();}
        (units==col).then_some((row,col))
    }
    let mut locations=Vec::new();let mut omitted=0usize;let mut seen=std::collections::BTreeSet::new();
    for item in items{
        if item.get("uri").and_then(Value::as_str)!=Some(uri){omitted+=1;continue;}
        let mut span=item.get("range").cloned().ok_or("引用缺少位置")?;
        if !range(&mut span,prefix){omitted+=1;continue;}
        let Some(start)=point(&span["start"],&lines)else{omitted+=1;continue};
        let Some(end)=point(&span["end"],&lines)else{omitted+=1;continue};
        if start>end{return Err("引用范围顺序无效".into());}
        if !seen.insert((start,end)){continue;}
        if locations.len()>=500{omitted+=1;continue;}
        locations.push(json!({"range":span}));
    }
    Ok(json!({"locations":locations,"omitted":omitted}))
}
#[cfg(test)]mod reference_tests{
    use super::*;use serde_json::json;
    fn loc(uri:&str,line:u32,col:u32,end:u32)->Value{json!({"uri":uri,"range":{"start":{"line":line,"character":col},"end":{"line":line,"character":end}}})}
    #[test]fn references_map_only_current_editable_utf16_positions(){
        let uri="file:///solution.py";
        let value=json!([loc(uri,2,2,5),loc(uri,2,2,5),loc(uri,1,0,1),loc(uri,3,0,1),loc("file:///private.py",2,0,1),loc(uri,2,1,2)]);
        let result=references(&value,uri,2,"🦀foo").unwrap();
        assert_eq!(result["locations"].as_array().unwrap().len(),1);
        assert_eq!(result["locations"][0]["range"]["start"]["line"],0);
        assert_eq!(result["omitted"],4);
        assert!(result.to_string().find("private").is_none());
    }
    #[test]fn references_are_bounded_and_null_is_empty(){
        assert_eq!(references(&Value::Null,"file:///s",0,"").unwrap()["locations"],json!([]));
        assert!(references(&json!({}),"file:///s",0,"").is_err());
        assert!(references(&Value::Array(vec![Value::Null;10001]),"file:///s",0,"").is_err());
        let text=(0..600).map(|_|"x").collect::<Vec<_>>().join("\n");
        let value=Value::Array((0..600).map(|i|loc("file:///s",i,0,1)).collect());
        let result=references(&value,"file:///s",0,&text).unwrap();
        assert_eq!(result["locations"].as_array().unwrap().len(),500);assert_eq!(result["omitted"],100);
    }
}


/// Normalize prepareRename ranges into this exact source; never expose scaffolding.
pub fn prepare_rename(value:&Value,prefix:u32,text:&str,line:u32,character:u32)->Result<Value,String>{
    use serde_json::json;
    if value.is_null(){return Err("此位置不能重命名".into());}
    let object=value.as_object().ok_or("重命名准备结果无效")?;
    if object.contains_key("defaultBehavior"){return Err("语言服务返回未支持的默认重命名范围".into());}
    let mut span=if let Some(span)=object.get("range"){span.clone()}else{value.clone()};
    if !range(&mut span,prefix){return Err("重命名范围涉及语言环境辅助代码".into());}
    let lines=text.split('\n').collect::<Vec<_>>();
    fn point(v:&Value,lines:&[&str])->Option<(usize,usize)>{
        let row=usize::try_from(v.get("line")?.as_u64()?).ok()?;
        let column=usize::try_from(v.get("character")?.as_u64()?).ok()?;
        let source=lines.get(row)?;let mut units=0;
        for ch in source.chars(){if units==column{return Some((row,column));}units+=ch.len_utf16();}
        (units==column).then_some((row,column))
    }
    let start=point(&span["start"],&lines).ok_or("重命名起点越界或拆分 Unicode 字符")?;
    let end=point(&span["end"],&lines).ok_or("重命名终点越界或拆分 Unicode 字符")?;
    let cursor=point(&json!({"line":line,"character":character}),&lines).ok_or("重命名光标位置无效")?;
    if start>=end||cursor<start||cursor>end{return Err("重命名范围不包含当前符号".into());}
    let placeholder=match object.get("placeholder"){
        None=>Value::Null,
        Some(Value::String(name)) if !name.is_empty()&&name.len()<=512=>Value::String(name.clone()),
        _=>return Err("重命名占位名称无效".into()),
    };
    Ok(json!({"supported":true,"range":span,"placeholder":placeholder}))
}
#[cfg(test)]mod prepare_rename_tests{
    use super::*;use serde_json::json;
    fn span(line:u32,start:u32,end:u32)->Value{json!({"start":{"line":line,"character":start},"end":{"line":line,"character":end}})}
    #[test]fn prepare_maps_valid_range_and_placeholder(){
        let direct=prepare_rename(&span(2,0,3),2,"old",0,1).unwrap();
        assert_eq!(direct["range"]["start"]["line"],0);assert_eq!(direct["supported"],true);
        let named=prepare_rename(&json!({"range":span(2,0,3),"placeholder":"old"}),2,"old",0,3).unwrap();
        assert_eq!(named["placeholder"],"old");
    }
    #[test]fn prepare_rejects_helpers_malformed_ranges_and_unsupported_default_behavior(){
        for bad in [Value::Null,json!([]),json!({"defaultBehavior":true}),span(1,0,1),span(3,0,1),span(2,2,1),span(2,1,1),span(2,0,4),json!({"range":span(2,0,3),"placeholder":false}),json!({"range":span(2,0,3),"placeholder":"x".repeat(513)})]{
            assert!(prepare_rename(&bad,2,"old",0,1).is_err(),"{bad}");
        }
        assert!(prepare_rename(&span(0,0,1),0,"old",0,2).is_err());
    }
    #[test]fn prepare_checks_utf16_boundaries(){
        assert!(prepare_rename(&span(0,0,2),0,"🦀x",0,1).is_err());
        assert!(prepare_rename(&span(0,1,2),0,"🦀x",0,2).is_err());
        assert!(prepare_rename(&span(0,2,3),0,"🦀x",0,2).is_ok());
    }
}
