//! Typed C++ literals come only from validated JSON metadata, never expressions.
use serde_json::Value;
use std::{fs,path::Path};
pub(crate) const HEADER:&str=include_str!("cpp_harness.hpp");
pub const STANDARD_PRELUDE:&str=include_str!("cpp_standard.hpp");
fn cpp_type(kind:&str)->Result<String,String>{
    if let Some(inner)=kind.strip_suffix("[]"){return Ok(format!("std::vector<{}>",cpp_type(inner)?));}
    Ok(match kind{"integer"=>"int","long"=>"long long","double"=>"double","boolean"=>"bool","string"=>"std::string","character"=>"char","ListNode"=>"ListNode*","TreeNode"=>"TreeNode*",_=>return Err("此 C++ 参数类型尚未支持".into())}.into())
}
fn string_literal(value:&str)->String{
    let bytes=value.as_bytes().iter().map(|b|format!("\\x{b:02x}")).collect::<String>();
    format!("std::string(\"{bytes}\",{})",value.len())
}
fn integer(value:&Value)->Result<i32,String>{value.as_i64().and_then(|n|i32::try_from(n).ok()).ok_or("integer 超出 C++ 32 位整数范围".into())}
pub(crate) fn literal(value:&Value,kind:&str,budget:&mut usize)->Result<String,String>{
    *budget=budget.checked_sub(1).ok_or("用例超过 10000 个节点")?;
    if let Some(inner)=kind.strip_suffix("[]"){
        let values=value.as_array().ok_or("数组参数必须是 JSON 数组")?;
        if values.len()>10000{return Err("数组参数超过大小限制".into());}
        let items=values.iter().map(|v|literal(v,inner,budget)).collect::<Result<Vec<_>,_>>()?;
        return Ok(format!("{}{{{}}}",cpp_type(kind)?,items.join(",")));
    }
    match kind{
        "integer"=>Ok(integer(value)?.to_string()),
        "long"=>{let n=value.as_i64().ok_or("long 超出 C++ 64 位整数范围")?;Ok(if n==i64::MIN{"(-9223372036854775807LL-1)".into()}else{format!("{n}LL")})},
        "double"=>{let n=value.as_f64().filter(|n|n.is_finite()).ok_or("double 必须是有限数值")?;Ok(format!("{n:?}"))},
        "boolean"=>value.as_bool().map(|v|v.to_string()).ok_or("boolean 必须是 JSON 布尔值".into()),
        "string"=>value.as_str().map(string_literal).ok_or("string 必须是 JSON 字符串".into()),
        "character"=>{let s=value.as_str().ok_or("character 必须是 JSON 字符串")?;if s.len()!=1||!s.is_ascii(){return Err("本地 C++ character 暂只支持单个 ASCII 字符".into());}Ok(format!("static_cast<char>({})",s.as_bytes()[0]))},
        "ListNode"|"TreeNode"=>{
            if value.is_null(){return Ok(format!("static_cast<{kind}*>(nullptr)"));}
            let values=value.as_array().ok_or("节点输入必须是数组或 null")?;
            *budget=budget.checked_sub(values.len()).ok_or("节点参数超过大小限制")?;
            if values.is_empty(){return Ok(format!("static_cast<{kind}*>(nullptr)"));}
            if kind=="ListNode"{
                let mut body=String::from("([]{");
                for (i,v) in values.iter().enumerate(){body+=&format!("auto* n{i}=new ListNode({});",integer(v)?);}
                for i in 1..values.len(){body+=&format!("n{}->next=n{i};",i-1);}
                body+="return n0;}())";Ok(body)
            }else{
                if values[0].is_null(){if values.iter().any(|v|!v.is_null()){return Err("二叉树存在没有根节点的值".into());}return Ok("static_cast<TreeNode*>(nullptr)".into());}
                let mut body=String::from("([]{");
                for (i,v) in values.iter().enumerate(){if !v.is_null(){body+=&format!("auto* n{i}=new TreeNode({});",integer(v)?);}}
                let mut queue=std::collections::VecDeque::from([0]);let mut index=1;
                while let Some(parent)=queue.pop_front(){
                    for side in ["left","right"]{
                        if index>=values.len(){break;}
                        if !values[index].is_null(){body+=&format!("n{parent}->{side}=n{index};");queue.push_back(index);}
                        index+=1;
                    }
                }
                if values[index..].iter().any(|v|!v.is_null()){return Err("二叉树有不可达节点".into());}
                body+="return n0;}())";Ok(body)
            }
        },
        _=>Err("此 C++ 类型尚未支持".into())
    }
}
pub fn prepare(root:&Path,source:&str,metadata:&str,input:&str)->Result<(),String>{
    if source.len()>2*1024*1024{return Err("C++ 源码超过 2 MiB".into());}
    let config=crate::harness::ordinary_configuration(metadata,input)?;
    let raw:Value=serde_json::from_str(metadata).map_err(|_|"题目元数据无效")?;
    let style=raw.get("inkleetFunctionStyle").and_then(Value::as_str).unwrap_or("solution");
    if !matches!(style,"solution"|"free"){return Err("C++ 函数调用形式尚未支持".into());}
    let name=config["metadata"]["name"].as_str().ok_or("函数名缺失")?;
    let params=config["metadata"]["params"].as_array().ok_or("参数缺失")?;
    let types=params.iter().map(|p|p["type"].as_str().ok_or("参数类型缺失")).collect::<Result<Vec<_>,_>>()?;
    let mut driver=String::from("#include \"cpp_harness.hpp\"\nusing namespace std;\n");
    driver+=&crate::lsp_scaffold::Context::parse(Some(metadata))?.fragments("cpp",source).0;
    driver+="#include \"solution.cpp\"\nint main(){std::ofstream output(\"results.jsonl\",std::ios::binary|std::ios::trunc);if(!output)return 2;std::size_t total=0;\n";
    for (index,case) in config["cases"].as_array().ok_or("用例缺失")?.iter().enumerate(){
        driver+="{\n";let values=case.as_array().ok_or("用例无效")?;let mut budget=10000;
        for (i,kind) in types.iter().enumerate(){driver+=&format!("{} arg{i}={};\n",cpp_type(kind)?,literal(&values[i],kind,&mut budget)?);}
        let args=(0..types.len()).map(|i|format!("arg{i}")).collect::<Vec<_>>().join(",");
        let call=if style=="solution"{format!("Solution{{}}.{name}({args})")}else{format!("{name}({args})")};
        driver+=&format!("inkleet::run(output,total,{},[&](){{return {call};}},[&](inkleet::Writer& w){{w.append(\"[\");",index+1);
        for i in 0..types.len(){if i>0{driver+="w.append(\",\");";}driver+=&format!("w.write(arg{i});");}
        driver+="w.append(\"]\");});\n}\n";
        if driver.len()>8*1024*1024{return Err("生成的 C++ 驱动超过 8 MiB".into());}
    }
    driver+="return 0;}\n";
    fs::write(root.join("solution.cpp"),source).map_err(|_|"无法写入 C++ 源码快照")?;
    fs::write(root.join("cpp_standard.hpp"),STANDARD_PRELUDE).map_err(|_|"无法写入 C++ 标准库声明")?;
    fs::write(root.join("cpp_harness.hpp"),HEADER).map_err(|_|"无法写入 C++ 序列化驱动")?;
    fs::write(root.join("harness.cpp"),driver).map_err(|_|"无法写入 C++ 调用驱动")?;
    Ok(())
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn literals_are_typed_and_not_executable(){
        let mut budget=10000;
        assert_eq!(literal(&serde_json::json!("\"; system(\"bad\");"),"string",&mut budget).unwrap(),string_literal("\"; system(\"bad\");"));
        assert!(literal(&serde_json::json!(2147483648_i64),"integer",&mut budget).is_err());
        assert_eq!(literal(&serde_json::json!(-9223372036854775808_i64),"long",&mut budget).unwrap(),"(-9223372036854775807LL-1)");
        assert!(literal(&serde_json::json!([null,1]),"TreeNode",&mut budget).is_err());
        assert!(literal(&Value::Null,"integer[]",&mut budget).is_err());
        assert_eq!(literal(&serde_json::json!([]),"ListNode",&mut budget).unwrap(),"static_cast<ListNode*>(nullptr)");
    }
    #[test]fn source_snapshot_stays_separate_and_unmodified(){
        let root=tempfile::tempdir().unwrap();let source="class Solution {public:int sum(vector<int>& v){return 0;}};";
        prepare(root.path(),source,r#"{"name":"sum","params":[{"name":"v","type":"integer[]"}],"return":{"type":"integer"}}"#,"[1,2]").unwrap();
        assert_eq!(fs::read_to_string(root.path().join("solution.cpp")).unwrap(),source);
        assert!(fs::read_to_string(root.path().join("harness.cpp")).unwrap().contains("Solution{}.sum(arg0)"));
    }
}

#[cfg(test)]mod authored_helper_tests {
    use super::*;
    #[test]fn authored_nodes_and_standard_headers_stay_consistent(){
        let root=tempfile::tempdir().unwrap();
        let source="struct ListNode { int val; ListNode* next; ListNode(int v):val(v),next(nullptr){} }; class Solution{public:ListNode* identity(ListNode* n){return n;}};";
        let metadata=r#"{"name":"identity","params":[{"name":"n","type":"ListNode"}],"return":{"type":"ListNode"}}"#;
        prepare(root.path(),source,metadata,"[1,2]").unwrap();
        let driver=fs::read_to_string(root.path().join("harness.cpp")).unwrap();
        assert!(!driver.contains("struct ListNode"));
        assert_eq!(fs::read_to_string(root.path().join("solution.cpp")).unwrap(),source);
        assert_eq!(fs::read_to_string(root.path().join("cpp_standard.hpp")).unwrap(),STANDARD_PRELUDE);
        for header in ["sstream","iomanip","stdexcept","unordered_map"]{assert!(STANDARD_PRELUDE.contains(&format!("#include <{header}>")));}
    }
}
