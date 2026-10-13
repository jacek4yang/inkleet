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
    #[test]fn rejects_unsupported_types_and_magic_names(){
        assert!(configuration(&META.replace("twoSum","__dict__"),"[]\n0").is_err());
        assert!(configuration(&META.replace("integer[]","Node"),"[]\n0").is_err());
        assert!(configuration(&META.replace("integer[]","integer[][][][][]"),"[]\n0").is_err());
    }
}
