//! Typed Rust calls with separate source files and bounded JSON serialization.
use serde_json::Value;
use std::{fs,path::Path};
const SUPPORT:&str=include_str!("rust_harness_support.rs");
fn rust_type(kind:&str)->Result<String,String>{
    if let Some(inner)=kind.strip_suffix("[]"){return Ok(format!("Vec<{}>",rust_type(inner)?));}
    Ok(match kind{"integer"=>"i32","long"=>"i64","double"=>"f64","boolean"=>"bool","string"=>"String","character"=>"char","void"=>"()","ListNode"=>"Option<Box<ListNode>>","TreeNode"=>"Option<std::rc::Rc<std::cell::RefCell<TreeNode>>>",_=>return Err("此 Rust 类型尚未支持".into())}.into())
}
fn escaped(value:&str)->String{value.chars().map(|c|format!("\\u{{{:x}}}",c as u32)).collect()}
fn literal(value:&Value,kind:&str,budget:&mut usize)->Result<String,String>{
    *budget=budget.checked_sub(1).ok_or("Rust 输入超过节点限制")?;
    if let Some(inner)=kind.strip_suffix("[]"){
        let values=value.as_array().ok_or("Rust 数组必须为 JSON 数组")?;
        return Ok(format!("vec![{}]",values.iter().map(|v|literal(v,inner,budget)).collect::<Result<Vec<_>,_>>()?.join(",")));
    }
    Ok(match kind{
        "integer"=>format!("{}_i32",i32::try_from(value.as_i64().ok_or("Rust integer 必须是 i32 整数")?).map_err(|_|"Rust integer 超出 i32")?),
        "long"=>{let n=value.as_i64().ok_or("Rust long 超出 i64 或不是整数")?;if n==i64::MIN{"i64::MIN".into()}else{format!("{n}_i64")}},
        "double"=>{let n=value.as_f64().filter(|n|n.is_finite()).ok_or("Rust double 必须为有限数字")?;format!("{n:?}_f64")},
        "boolean"=>value.as_bool().ok_or("Rust boolean 必须为布尔值")?.to_string(),
        "string"=>format!("String::from(\"{}\")",escaped(value.as_str().ok_or("Rust string 必须为字符串")?)),
        "character"=>{let s=value.as_str().ok_or("Rust character 必须为单个字符")?;if s.chars().count()!=1{return Err("Rust character 必须为单个 Unicode 字符".into());}format!("'{}'",escaped(s))},
        "ListNode"|"TreeNode"=>{
            if value.is_null(){return Ok("None".into());}
            let nodes=value.as_array().ok_or("Rust 节点必须为 JSON 数组")?;
            if nodes.len()>10000{return Err("Rust 节点超过限制".into());}
            let mut values=Vec::new();
            let mut available=1usize;
            for node in nodes{
                if kind=="TreeNode"{
                    if available==0{return Err("树中存在无法连接的节点".into());}available-=1;
                    if node.is_null(){values.push("None".into());continue;}
                    available+=2;
                }
                let n=literal(node,"integer",budget)?;
                values.push(if kind=="TreeNode"{format!("Some({n})")}else{n});
            }
            format!("inkleet_harness::{}(&[{}])",if kind=="ListNode"{"list"}else{"tree"},values.join(","))
        },
        _=>return Err("此 Rust 参数类型尚未支持".into())
    })
}
fn identifier(name:&str)->bool{!name.is_empty()&&name.len()<=128&&name.bytes().enumerate().all(|(i,b)|b.is_ascii_alphabetic()||b==b'_'||(i>0&&b.is_ascii_digit()))}
fn snake(name:&str)->String{
    let bytes=name.as_bytes();let mut out=String::new();
    for (i,&b) in bytes.iter().enumerate(){
        if b.is_ascii_uppercase()&&i>0&&(bytes[i-1].is_ascii_lowercase()||bytes[i-1].is_ascii_digit()||bytes.get(i+1).is_some_and(u8::is_ascii_lowercase)){out.push('_');}
        out.push((b as char).to_ascii_lowercase());
    }out
}
pub fn prepare(root:&Path,source:&str,metadata:&str,input:&str)->Result<(),String>{
    if source.len()>2*1024*1024{return Err("Rust 源码超过 2 MiB".into());}
    let config=crate::harness::configuration(metadata,input)?;
    let meta:Value=serde_json::from_str(metadata).map_err(|_|"Rust 元数据无效")?;
    if meta.get("inkleetRustSignatureError").is_some(){return Err("官方 Rust 函数签名暂无法解析，请使用力扣运行".into());}
    let base=config["metadata"]["name"].as_str().ok_or("Rust 函数名缺失")?;
    let name=meta["inkleetRustName"].as_str().map(str::to_owned).unwrap_or_else(||snake(base));
    if !identifier(&name){return Err("Rust 函数名无效".into());}
    let params=config["metadata"]["params"].as_array().ok_or("Rust 参数缺失")?;
    let returned=config["metadata"]["return"]["type"].as_str().ok_or("Rust 返回类型缺失")?;
    let return_type=rust_type(returned)?;
    let modes=if let Some(value)=meta.get("inkleetRustParameterModes"){
        let items=value.as_array().filter(|a|a.len()==params.len()).ok_or("Rust 参数传递方式数量不匹配")?;
        items.iter().map(|v|v.as_str().filter(|v|matches!(*v,"move"|"ref"|"mut")).map(str::to_owned).ok_or("Rust 参数传递方式无效".to_owned())).collect::<Result<Vec<_>,_>>()?
    }else{vec!["move".to_owned();params.len()]};
    let free=meta["inkleetFunctionStyle"].as_str()==Some("free");
    let types=params.iter().filter_map(|p|p["type"].as_str()).chain(std::iter::once(returned)).collect::<Vec<_>>();
    let list=types.iter().any(|t|t.contains("ListNode"));let tree=types.iter().any(|t|t.contains("TreeNode"));
    let mut driver=String::from("#![allow(dead_code,unused_mut,unused_variables)]\n");
    if !free{driver+="pub struct Solution;\n";}
    if list{driver+=LIST_TYPES;}if tree{driver+=TREE_TYPES;}
    driver+="include!(\"solution.rs\");\nmod inkleet_harness{\n";driver+=SUPPORT;
    if list{driver+=LIST_SUPPORT;}if tree{driver+=TREE_SUPPORT;}driver+="}\n";
    driver+="fn main()->Result<(),String>{use inkleet_harness::Json as _;let mut output=std::fs::File::create(\"results.jsonl\").map_err(|e|e.to_string())?;let mut total=0;\n";
    for (index,case) in config["cases"].as_array().ok_or("Rust 用例缺失")?.iter().enumerate(){
        let values=case.as_array().ok_or("Rust 用例无效")?;let mut budget=10000;
        driver+="{let outcome=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||->Result<String,String>{\n";
        let mut args=Vec::new();let mut after=Vec::new();let mut unavailable=Vec::new();
        for (i,param) in params.iter().enumerate(){
            let kind=param["type"].as_str().ok_or("Rust 参数类型缺失")?;
            driver+=&format!("let mut arg{i}:{}={};\n",rust_type(kind)?,literal(&values[i],kind,&mut budget)?);
            args.push(format!("{}arg{i}",match modes[i].as_str(){"mut"=>"&mut ","ref"=>"& ",_=>""}));
            let is_copy=matches!(kind,"integer"|"long"|"double"|"boolean"|"character");
            if modes[i]=="move"&&!is_copy{after.push("w.push(\"null\")?;".to_owned());unavailable.push(i);}
            else{after.push(format!("arg{i}.json(&mut w)?;"));}
        }
        driver+=&format!("let result:{return_type}={}r#{name}({});\n",if free{""}else{"Solution::"},args.join(","));
        driver+=&format!("let mut w=inkleet_harness::Writer::new();w.push(\"{{\\\"case\\\":{},\\\"ok\\\":true,\\\"value\\\":\")?;result.json(&mut w)?;\n",index+1);
        if returned=="void"{
            driver+="w.push(\",\\\"argumentsAfterCall\\\":[\")?;";
            for (i,statement) in after.iter().enumerate(){if i>0{driver+="w.push(\",\")?;";}driver+=statement;}
            driver+="w.push(\"]\")?;";
            if !unavailable.is_empty(){driver+=&format!("w.push(\",\\\"argumentsUnavailable\\\":{:?}\")?;",unavailable);}
        }
        driver+="w.push(\"}\")?;Ok(w.text)}));\n";
        driver+=&format!("inkleet_harness::emit({},outcome,&mut output,&mut total)?;}}\n",index+1);
        if driver.len()>8*1024*1024{return Err("生成 Rust 驱动超过 8 MiB".into());}
    }
    driver+="Ok(())}\n";
    fs::write(root.join("solution.rs"),source).map_err(|_|"无法写入 Rust 源码快照")?;
    fs::write(root.join("harness.rs"),driver).map_err(|_|"无法写入 Rust 驱动")?;
    Ok(())
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn rust_literals_bound_values_and_escape_source(){
        assert!(literal(&serde_json::json!(2147483648_i64),"integer",&mut 100).is_err());
        assert_eq!(literal(&serde_json::json!(i64::MIN),"long",&mut 100).unwrap(),"i64::MIN");
        assert!(literal(&serde_json::json!([null,1]),"TreeNode",&mut 100).is_err());
        assert!(literal(&serde_json::json!("';panic!();"),"character",&mut 100).is_err());
        assert_eq!(snake("twoSum"),"two_sum");assert_eq!(snake("getURLValue"),"get_url_value");
    }
    #[test]fn rust_snapshot_and_mutable_call_are_separate(){
        let root=tempfile::tempdir().unwrap();let source="impl Solution { pub fn reverse(v:&mut Vec<i32>){v.reverse();} }";
        prepare(root.path(),source,r#"{"name":"reverse","params":[{"name":"v","type":"integer[]"}],"return":{"type":"void"},"inkleetRustParameterModes":["mut"]}"#,"[1,2]").unwrap();
        assert_eq!(fs::read_to_string(root.path().join("solution.rs")).unwrap(),source);
        let code=fs::read_to_string(root.path().join("harness.rs")).unwrap();
        assert!(code.contains("Solution::r#reverse(&mut arg0)"));assert!(code.contains("arg0.json(&mut w)"));
    }
}

pub const LIST_TYPES:&str=r#"#[derive(PartialEq, Eq, Clone, Debug)]
pub struct ListNode { pub val:i32, pub next:Option<Box<ListNode>> }
impl ListNode { pub fn new(val:i32)->Self { Self{val,next:None} } }
"#;
pub const TREE_TYPES:&str=r#"#[derive(PartialEq, Eq, Debug)]
pub struct TreeNode { pub val:i32, pub left:Option<std::rc::Rc<std::cell::RefCell<TreeNode>>>, pub right:Option<std::rc::Rc<std::cell::RefCell<TreeNode>>> }
impl TreeNode { pub fn new(val:i32)->Self { Self{val,left:None,right:None} } }
"#;
const LIST_SUPPORT:&str=r#"
pub fn list(values:&[i32])->Option<Box<crate::ListNode>>{
    let mut result=None;for &value in values.iter().rev(){result=Some(Box::new(crate::ListNode{val:value,next:result}));}result
}
impl Json for crate::ListNode{fn json(&self,w:&mut Writer)->Result<(),String>{
    w.node()?;w.push("[")?;let mut node=Some(self);let mut first=true;
    while let Some(value)=node{if !first{w.push(",")?;}first=false;value.val.json(w)?;node=value.next.as_deref();}w.push("]")
}}
"#;
const TREE_SUPPORT:&str=r#"
pub fn tree(values:&[Option<i32>])->Option<std::rc::Rc<std::cell::RefCell<crate::TreeNode>>>{
    use std::{rc::Rc,cell::RefCell,collections::VecDeque};
    let value=values.first().copied().flatten()?;let root=Rc::new(RefCell::new(crate::TreeNode::new(value)));let mut queue=VecDeque::from([root.clone()]);let mut index=1;
    while let Some(parent)=queue.pop_front(){
        for side in 0..2{if index>=values.len(){break;}if let Some(value)=values[index]{let node=Rc::new(RefCell::new(crate::TreeNode::new(value)));if side==0{parent.borrow_mut().left=Some(node.clone());}else{parent.borrow_mut().right=Some(node.clone());}queue.push_back(node);}index+=1;}
    }Some(root)
}
impl Json for std::rc::Rc<std::cell::RefCell<crate::TreeNode>>{fn json(&self,w:&mut Writer)->Result<(),String>{
    use std::{rc::Rc,collections::{HashSet,VecDeque}};
    let mut pending=VecDeque::from([Some(self.clone())]);let mut values=Vec::<Option<i32>>::new();let mut seen=HashSet::new();
    while let Some(node)=pending.pop_front(){
        if let Some(node)=node{
            if !seen.insert(Rc::as_ptr(&node)){return Err("cyclic or shared tree result".into());}
            if seen.len()>10000{return Err("tree exceeds result limit".into());}
            let node=node.try_borrow().map_err(|_|"tree node is already borrowed")?;
            values.push(Some(node.val));pending.push_back(node.left.clone());pending.push_back(node.right.clone());
        }else{values.push(None);}
    }
    while values.last()==Some(&None){values.pop();}values.json(w)
}}
"#;
