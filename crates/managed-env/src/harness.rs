//! Converts bounded JSON input using reviewed problem metadata. No expression evaluation.
use serde_json::{json,Value};
use std::{fs,path::Path};
pub const PYTHON_HARNESS:&str=include_str!("python_harness.py");
fn identifier(value:&str)->bool{
    !value.is_empty()&&value.len()<=128&&!value.starts_with("__")&&value.bytes().enumerate().all(|(i,c)|c.is_ascii_alphabetic()||c==b'_'||(i>0&&c.is_ascii_digit()))
}
fn supported_type(value:&str)->bool{
    let mut base=value;let mut depth=0;
    while let Some(inner)=base.strip_suffix("[]"){base=inner;depth+=1;}
    depth<=4&&matches!(base,"integer"|"long"|"double"|"boolean"|"string"|"character"|"ListNode"|"TreeNode")
}
pub fn configuration(metadata:&str,input:&str)->Result<Value,String>{
    if metadata.len()>64*1024||input.len()>1024*1024{return Err("题目元数据或用例超过本地运行限制".into());}
    let meta:Value=serde_json::from_str(metadata).map_err(|_|"题目元数据无效")?;
    let name=meta.get("name").and_then(Value::as_str).filter(|s|identifier(s)).ok_or("当前题型没有可调用的普通函数；设计类题暂不支持本地驱动")?;
    if meta.get("systemdesign").and_then(Value::as_bool)==Some(true){return Err("设计类题暂不支持本地驱动".into());}
    let params=meta.get("params").and_then(Value::as_array).filter(|p|!p.is_empty()&&p.len()<=32).ok_or("本地驱动需要 1–32 个函数参数")?;
    for p in params{
        if !p.get("name").and_then(Value::as_str).is_some_and(identifier)||!p.get("type").and_then(Value::as_str).is_some_and(supported_type){return Err("此参数类型尚未支持本地运行，请使用力扣运行".into());}
    }
    let values=serde_json::Deserializer::from_str(input).into_iter::<Value>().collect::<std::result::Result<Vec<_>,_>>().map_err(|_|"用例必须是连续 JSON 值，每个参数一个值；不执行 Python 表达式")?;
    if values.is_empty()||values.len()%params.len()!=0||values.len()/params.len()>100{return Err("用例参数数量不匹配或超过 100 组".into());}
    let cases:Vec<Vec<Value>>=values.chunks(params.len()).map(|v|v.to_vec()).collect();
    Ok(json!({"metadata":{"name":name,"params":params,"return":meta.get("return").cloned().unwrap_or(Value::Null)},"cases":cases}))
}
pub fn prepare(root:&Path,source:&str,metadata:&str,input:&str)->Result<(),String>{
    if source.len()>2*1024*1024{return Err("源码超过 2 MiB".into());}
    let configuration=configuration(metadata,input)?;
    // root is a newly created private temporary directory, never an arbitrary UI path.
    fs::write(root.join("solution.py"),source).map_err(|_|"无法保存运行源码快照")?;
    fs::write(root.join("input.json"),serde_json::to_vec(&configuration).map_err(|_|"用例编码失败")?).map_err(|_|"无法写入运行用例")?;
    fs::write(root.join("harness.py"),PYTHON_HARNESS).map_err(|_|"无法写入本地驱动")?;
    Ok(())
}
#[cfg(test)]mod tests{
    use super::*;
    const META:&str=r#"{"name":"twoSum","params":[{"name":"nums","type":"integer[]"},{"name":"target","type":"integer"}],"return":{"type":"integer[]"}}"#;
    #[test]fn groups_json_values_without_expression_evaluation(){
        let config=configuration(META,"[2,7,11,15]\n9\n[3,2,4]\n6").unwrap();
        assert_eq!(config["cases"].as_array().unwrap().len(),2);
        assert!(configuration(META,"__import__('os').system('bad')\n9").is_err());
        assert!(configuration(META,"[1,2]").is_err());
    }
    #[test]fn integer_inputs_never_round_through_binary_float(){
        let meta=r#"{"name":"identity","params":[{"name":"value","type":"long"}]}"#;
        let exact="900719925474099312345678901234567890";
        let result=configuration(meta,exact).unwrap();
        assert_eq!(result["cases"][0][0].to_string(),exact);
    }
    #[test]fn rejects_unsupported_types_and_magic_names(){
        assert!(configuration(&META.replace("twoSum","__dict__"),"[]\n0").is_err());
        assert!(configuration(&META.replace("integer[]","Node"),"[]\n0").is_err());
        assert!(configuration(&META.replace("integer[]","integer[][][][][]"),"[]\n0").is_err());
    }
}


pub const GO_HARNESS:&str=include_str!("go_harness.go");
fn go_tokens(source:&str)->Vec<&str>{
    let bytes=source.as_bytes();let mut tokens=Vec::new();let mut i=0;
    while i<bytes.len(){
        if bytes[i].is_ascii_whitespace(){i+=1;continue;}
        if bytes.get(i..i+2)==Some(b"//"){i+=2;while i<bytes.len()&&bytes[i]!=b'\n'{i+=1;}continue;}
        if bytes.get(i..i+2)==Some(b"/*"){i+=2;while i+1<bytes.len()&&&bytes[i..i+2]!=b"*/"{i+=1;}i=(i+2).min(bytes.len());continue;}
        if matches!(bytes[i],b'"'|b'\''|b'\x60'){
            let quote=bytes[i];i+=1;
            while i<bytes.len(){if bytes[i]==quote{i+=1;break;}if quote!=b'\x60'&&bytes[i]==b'\\'{i=(i+2).min(bytes.len());}else{i+=1;}}
            continue;
        }
        if bytes[i].is_ascii_alphabetic()||bytes[i]==b'_'{
            let start=i;i+=1;while i<bytes.len()&&(bytes[i].is_ascii_alphanumeric()||bytes[i]==b'_'){i+=1;}
            tokens.push(&source[start..i]);continue;
        }
        if bytes[i].is_ascii(){tokens.push(&source[i..i+1]);}i+=1;
    }
    tokens
}
pub fn prepare_go(root:&Path,source:&str,metadata:&str,input:&str)->Result<(),String>{
    if source.len()>2*1024*1024{return Err("源码超过 2 MiB".into());}
    let configuration=configuration(metadata,input)?;
    let source=source.trim_start_matches('\u{feff}');
    let tokens=go_tokens(source);
    let has_package=tokens.first()==Some(&"package");
    if has_package&&tokens.get(1)!=Some(&"main"){return Err("本地 Go 驱动需要无 package 声明的力扣函数，或 package main".into());}
    if tokens.windows(2).any(|pair|pair==["func","main"]){return Err("请保留题目函数；本地 Go 驱动会提供 main 入口".into());}
    let source=source.trim_start_matches('\u{feff}');
    let solution=if has_package{source.to_owned()}else{format!("package main\n{source}")};
    let mut definitions=String::from("package main\n");
    let metadata_text=configuration["metadata"].to_string();
    for (name,definition) in [("ListNode","type ListNode struct { Val int; Next *ListNode }\n"),("TreeNode","type TreeNode struct { Val int; Left, Right *TreeNode }\n")]{
        let declared=tokens.windows(2).any(|pair|pair==["type",name]);
        if metadata_text.contains(name)&&!declared{definitions.push_str(definition);}
    }
    let function=configuration["metadata"]["name"].as_str().ok_or("Go 函数名缺失")?;
    fs::write(root.join("solution.go"),solution).map_err(|_|"无法写入 Go 源码快照")?;
    fs::write(root.join("nodes.go"),definitions).map_err(|_|"无法写入 Go 节点类型")?;
    fs::write(root.join("harness.go"),GO_HARNESS.replace("__INKLEET_FUNCTION__",function)).map_err(|_|"无法写入 Go 本地驱动")?;
    fs::write(root.join("input.json"),serde_json::to_vec(&configuration).map_err(|_|"Go 用例编码失败")?).map_err(|_|"无法写入 Go 用例")?;
    Ok(())
}
#[cfg(test)]mod go_tests{
    use super::*;
    #[test]fn go_tokens_ignore_comments_and_literals(){
        assert_eq!(go_tokens("// type ListNode\n/* func main */ package main\nvar s=\"type TreeNode\""),vec!["package","main","var","s","="]);
        assert_eq!(go_tokens("type ListNode struct { Val int }")[..2],["type","ListNode"]);
    }
    #[test]fn go_driver_preserves_snapshot_and_rejects_other_entrypoints(){
        let temp=tempfile::tempdir().unwrap();
        let metadata=r#"{"name":"identity","params":[{"name":"value","type":"ListNode"}],"return":{"type":"ListNode"}}"#;
        let source="// type ListNode is supplied by the harness\nfunc identity(value *ListNode) *ListNode { return value }";
        prepare_go(temp.path(),source,metadata,"[1,2]").unwrap();
        assert!(fs::read_to_string(temp.path().join("nodes.go")).unwrap().contains("type ListNode struct"));
        assert_eq!(fs::read_to_string(temp.path().join("solution.go")).unwrap(),format!("package main\n{source}"));
        assert!(!fs::read_to_string(temp.path().join("harness.go")).unwrap().contains("__INKLEET_FUNCTION__"));
        assert!(prepare_go(temp.path(),"package other\nfunc identity(){}",metadata,"[]").is_err());
        assert!(prepare_go(temp.path(),"func main(){}",metadata,"[]").is_err());
    }
}
