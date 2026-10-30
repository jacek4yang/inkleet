//! Converts bounded JSON input using reviewed problem metadata. No expression evaluation.
use serde_json::{json,Value};
use std::{fs,path::Path};
pub const PYTHON_HARNESS:&str=include_str!("python_harness.py");
fn identifier(value:&str)->bool{
    !value.is_empty()&&value.len()<=128&&!value.starts_with("__")&&value.bytes().enumerate().all(|(i,c)|c.is_ascii_alphabetic()||c==b'_'||(i>0&&c.is_ascii_digit()))
}
pub(crate) fn supported_type(value:&str)->bool{
    let mut base=value;let mut depth=0;
    while let Some(inner)=base.strip_suffix("[]"){base=inner;depth+=1;}
    depth<=4&&matches!(base,"integer"|"long"|"double"|"boolean"|"string"|"character"|"ListNode"|"TreeNode"|"NestedInteger")
}
fn parameters(value:&Value)->Result<&Vec<Value>,String>{
    let params=value.as_array().filter(|p|p.len()<=32).ok_or("本地驱动需要 0–32 个函数参数")?;
    for p in params{
        if !p.get("name").and_then(Value::as_str).is_some_and(identifier)||!p.get("type").and_then(Value::as_str).is_some_and(supported_type){return Err("此参数类型尚未支持本地运行，请使用力扣运行".into());}
    }Ok(params)
}
pub fn is_design(meta:&Value)->bool{meta.get("systemdesign").and_then(Value::as_bool)==Some(true)||meta.get("classname").is_some_and(|v|!v.is_null())}
fn design_configuration(meta:&Value,values:Vec<Value>)->Result<Value,String>{
    let classname=meta["classname"].as_str().filter(|s|identifier(s)).ok_or("设计类名称无效")?;
    parameters(&meta["constructor"]["params"])?;
    let methods=meta["methods"].as_array().filter(|m|!m.is_empty()&&m.len()<=64).ok_or("设计类需要 1–64 个明确声明的方法")?;
    let mut names=std::collections::HashSet::new();
    for method in methods{
        let name=method["name"].as_str().filter(|s|identifier(s)&&*s!=classname).ok_or("设计类方法名无效")?;
        if !names.insert(name){return Err("设计类重载方法暂不支持".into());}
        parameters(&method["params"])?;
        let returned=method["return"]["type"].as_str().ok_or("设计类方法返回类型缺失")?;
        if returned!="void"&&!supported_type(returned){return Err("此设计类返回类型尚未支持".into());}
    }
    if values.is_empty()||values.len()%2!=0||values.len()/2>100{return Err("设计类输入需要操作名数组和参数数组，每组两个 JSON 值".into());}
    let mut total=0usize;let mut cases=Vec::new();
    for pair in values.chunks(2){
        let operations=pair[0].as_array().filter(|a|!a.is_empty()&&a.len()<=200).ok_or("每组设计类输入需要 1–200 个操作")?;
        let arguments=pair[1].as_array().filter(|a|a.len()==operations.len()).ok_or("操作与参数数组长度不匹配")?;
        total+=operations.len();if total>1000{return Err("一批设计类输入最多 1000 个操作".into());}
        for (index,(operation,args)) in operations.iter().zip(arguments).enumerate(){
            let name=operation.as_str().ok_or("设计类操作名必须为字符串")?;
            let params=if index==0{
                if name!=classname{return Err("第一个操作必须是设计类构造函数".into());}
                parameters(&meta["constructor"]["params"])?
            }else{
                let method=methods.iter().find(|m|m["name"].as_str()==Some(name)).ok_or("设计类操作未在题目元数据中声明")?;
                parameters(&method["params"])?
            };
            if args.as_array().map(Vec::len)!=Some(params.len()){return Err("设计类操作参数数量不匹配".into());}
        }
        cases.push(pair.to_vec());
    }
    Ok(json!({"metadata":{"systemdesign":true,"classname":classname,"constructor":meta["constructor"],"methods":methods,"params":[]},"cases":cases}))
}
pub fn configuration(metadata:&str,input:&str)->Result<Value,String>{
    if metadata.len()>64*1024||input.len()>1024*1024{return Err("题目元数据或用例超过本地运行限制".into());}
    let meta:Value=serde_json::from_str(metadata).map_err(|_|"题目元数据无效")?;
    let values=serde_json::Deserializer::from_str(input).into_iter::<Value>().collect::<std::result::Result<Vec<_>,_>>().map_err(|_|"用例必须是连续 JSON 值，每个参数一个值；不执行 Python 表达式")?;
    if is_design(&meta){return design_configuration(&meta,values);}
    let name=meta.get("name").and_then(Value::as_str).filter(|s|identifier(s)).ok_or("当前题型没有可调用的普通函数或已支持的设计类")?;
    let params=parameters(&meta["params"])?;
    let count=params.len().max(1);
    if values.is_empty()||values.len()%count!=0||values.len()/count>100{return Err("用例参数数量不匹配或超过 100 组".into());}
    let cases:Vec<Vec<Value>>=if params.is_empty(){
        if values.iter().any(|v|v.as_array().is_none_or(|a|!a.is_empty())){return Err("无参数函数每次调用使用一个空数组 []".into());}
        values.iter().map(|_|vec![]).collect()
    }else{values.chunks(params.len()).map(|v|v.to_vec()).collect()};
    Ok(json!({"metadata":{"name":name,"params":params,"return":meta.get("return").cloned().unwrap_or(Value::Null)},"cases":cases}))
}
pub fn ordinary_configuration(metadata:&str,input:&str)->Result<Value,String>{
    let config=configuration(metadata,input)?;
    if is_design(&config["metadata"]){return Err("此语言的设计类驱动尚未支持；当前支持 Python 与 Rust".into());}
    if config["metadata"]["params"].as_array().into_iter().flatten().chain(std::iter::once(&config["metadata"]["return"])).any(|p|p["type"].as_str().is_some_and(|s|s.trim_end_matches("[]")=="NestedInteger")){return Err("NestedInteger 本地驱动当前仅支持 Python 与 Rust".into());}
    Ok(config)
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
    let configuration=ordinary_configuration(metadata,input)?;
    let source=source.trim_start_matches('\u{feff}');
    let tokens=go_tokens(source);
    let has_package=tokens.first()==Some(&"package");
    if has_package&&tokens.get(1)!=Some(&"main"){return Err("本地 Go 驱动需要无 package 声明的力扣函数，或 package main".into());}
    if tokens.windows(2).any(|pair|pair==["func","main"]){return Err("请保留题目函数；本地 Go 驱动会提供 main 入口".into());}
    let source=source.trim_start_matches('\u{feff}');
    let solution=if has_package{source.to_owned()}else{format!("package main\n//line solution.go:1\n{source}")};
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
        assert_eq!(fs::read_to_string(temp.path().join("solution.go")).unwrap(),format!("package main\n//line solution.go:1\n{source}"));
        assert!(!fs::read_to_string(temp.path().join("harness.go")).unwrap().contains("__INKLEET_FUNCTION__"));
        assert!(prepare_go(temp.path(),"package other\nfunc identity(){}",metadata,"[]").is_err());
        assert!(prepare_go(temp.path(),"func main(){}",metadata,"[]").is_err());
    }
}

#[cfg(test)]mod design_tests{
    use super::*;
    fn meta()->Value{json!({"systemdesign":true,"classname":"Counter","constructor":{"params":[]},"methods":[{"name":"add","params":[{"name":"value","type":"integer"}],"return":{"type":"void"}},{"name":"get","params":[],"return":{"type":"integer"}}]})}
    #[test]fn design_sequences_are_explicit_bounded_and_allow_only_metadata_methods(){
        let metadata=meta().to_string();
        let good=r#"["Counter","add","get"] [[],[2],[]]"#;
        let config=configuration(&metadata,&format!("{good}\n{good}")).unwrap();
        assert_eq!(config["cases"].as_array().unwrap().len(),2);
        assert!(is_design(&config["metadata"]));
        for input in [r#"["get"] [[]]"#,r#"["Counter","Counter"] [[],[]]"#,r#"["Counter","unknown"] [[],[]]"#,r#"["Counter","add"] [[],[]]"#,r#"["Counter"] []"#,r#"["Counter"]"#]{assert!(configuration(&metadata,input).is_err(),"{input}");}
        assert!(ordinary_configuration(&metadata,good).unwrap_err().contains("Python"));
        let mut duplicate=meta();let first=duplicate["methods"][0].clone();duplicate["methods"].as_array_mut().unwrap().push(first);
        assert!(configuration(&duplicate.to_string(),good).is_err());
        assert!(configuration(&metadata.replace("add","__dict__"),good).is_err());
        assert!(configuration(&metadata.replace("integer","Node"),good).is_err());
        let operations=std::iter::once(json!("Counter")).chain((0..200).map(|_|json!("get"))).collect::<Vec<_>>();
        assert!(configuration(&metadata,&format!("{} {}",json!(operations),json!(vec![Vec::<Value>::new();201]))).is_err());
    }
    #[test]fn zero_parameters_require_an_explicit_empty_array_per_call(){
        let meta=r#"{"name":"answer","params":[],"return":{"type":"integer"}}"#;
        assert_eq!(configuration(meta,"[]\n[]").unwrap()["cases"],json!([[],[]]));
        for input in ["","[1]","null","{}","[]\n0"]{assert!(configuration(meta,input).is_err());}
    }
    #[test]fn nested_integer_is_not_silently_enabled_for_other_adapters(){
        let meta=r#"{"name":"identity","params":[{"name":"value","type":"NestedInteger[]"}],"return":{"type":"NestedInteger[]"}}"#;
        assert!(configuration(meta,"[1,[2]]").is_ok());
        assert!(ordinary_configuration(meta,"[1,[2]]").is_err());
    }
}
