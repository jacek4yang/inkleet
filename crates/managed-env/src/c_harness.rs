//! A true C translation unit linked to a separate typed serialization driver.
//! Generated C prototypes reject mismatched user function signatures at compile time.
use serde_json::{json,Value};
use std::{fs,path::Path};
const ADAPTER:&str=include_str!("c_harness.hpp");
fn shape(kind:&str)->Result<(&str,usize),String>{
    let mut base=kind;let mut depth=0;while let Some(inner)=base.strip_suffix("[]"){base=inner;depth+=1;}
    if depth>2{return Err("本地 C 驱动暂支持最多二维数组".into());}
    if !matches!(base,"integer"|"long"|"double"|"boolean"|"character"|"string"|"ListNode"|"TreeNode"|"void")||(base=="void"&&depth>0){return Err("此 C 类型尚未支持".into());}
    Ok((base,depth))
}
fn c_type(kind:&str)->Result<String,String>{
    let (base,depth)=shape(kind)?;
    let base=match base{"integer"=>"int","long"=>"long long","double"=>"double","boolean"=>"bool","character"=>"char","string"=>"char*","ListNode"=>"struct ListNode*","TreeNode"=>"struct TreeNode*","void"=>"void",_=>unreachable!()};
    Ok(format!("{base}{}", "*".repeat(depth)))
}
fn literal(value:&Value,kind:&str,budget:&mut usize)->Result<String,String>{
    if let Some(inner)=kind.strip_suffix("[]"){
        let values=value.as_array().ok_or("C 数组输入必须为 JSON 数组")?;
        *budget=budget.checked_sub(values.len()+1).ok_or("C 输入超过节点限制")?;
        let ty=c_type(inner)?;
        let mut code=format!("([]{{auto* p=static_cast<{ty}*>(std::calloc({},sizeof({ty})));if(!p)throw std::bad_alloc();",values.len().max(1));
        for (i,value) in values.iter().enumerate(){code+=&format!("p[{i}]={};",literal(value,inner,budget)?);}
        code+="return p;}())";return Ok(code);
    }
    let literal=crate::cpp_harness::literal(value,kind,budget)?;
    Ok(match kind{
        "string"=>format!("inkleet_c_string({literal})"),
        "ListNode"=>literal.replace("new ListNode(","inkleet_c_list("),
        "TreeNode"=>literal.replace("new TreeNode(","inkleet_c_tree("),
        _=>literal,
    })
}
fn convert(name:&str,kind:&str,size:&str,columns:&str)->Result<String,String>{
    Ok(match shape(kind)?.1{0=>format!("inkleet_c_value({name})"),1=>format!("inkleet_c_array({name},{size})"),2=>format!("inkleet_c_matrix({name},{size},{columns})"),_=>unreachable!()})
}
pub fn prepare(root:&Path,source:&str,metadata:&str,input:&str)->Result<(),String>{
    if source.len()>2*1024*1024{return Err("C 源码超过 2 MiB".into());}
    let config=crate::harness::configuration(metadata,input)?;
    let name=config["metadata"]["name"].as_str().ok_or("C 函数名缺失")?;
    let params=config["metadata"]["params"].as_array().ok_or("C 参数缺失")?;
    let returned=config["metadata"]["return"]["type"].as_str().ok_or("C 驱动需要明确返回类型")?;
    let return_type=c_type(returned)?;let return_depth=shape(returned)?.1;
    let mut prototype=String::from("#pragma once\n#include <stdlib.h>\n#include <stdio.h>\n#include <string.h>\n#include <stdbool.h>\n#include <stdint.h>\n#include <limits.h>\n#include <math.h>\nstruct ListNode{int val;struct ListNode* next;};\nstruct TreeNode{int val;struct TreeNode* left;struct TreeNode* right;};\n#ifdef __cplusplus\nextern \"C\" {\n#endif\n");
    let mut declarations=Vec::new();
    for param in params{
        let kind=param["type"].as_str().ok_or("C 参数类型缺失")?;declarations.push(c_type(kind)?);
        match shape(kind)?.1{1=>declarations.push("int".into()),2=>{declarations.push("int".into());declarations.push("int*".into());},_=>{}}
    }
    if return_depth>0{declarations.push("int*".into());}if return_depth==2{declarations.push("int**".into());}
    prototype+=&format!("{return_type} {name}({});\n#ifdef __cplusplus\n}}\n#endif\n",declarations.join(","));
    let mut driver=String::from("#include \"c_harness.hpp\"\nint main(){std::ofstream output(\"results.jsonl\",std::ios::binary|std::ios::trunc);if(!output)return 2;std::size_t total=0;\n");
    for (index,case) in config["cases"].as_array().ok_or("C 用例缺失")?.iter().enumerate(){
        let values=case.as_array().ok_or("C 用例无效")?;let mut budget=10000;let mut args=Vec::new();let mut after=Vec::new();driver+="{\n";
        for (i,param) in params.iter().enumerate(){
            let kind=param["type"].as_str().ok_or("C 参数类型缺失")?;let (_,depth)=shape(kind)?;
            driver+=&format!("{} arg{i}={};\n",c_type(kind)?,literal(&values[i],kind,&mut budget)?);args.push(format!("arg{i}"));
            let size=if depth>0{values[i].as_array().ok_or("C 数组参数无效")?.len()}else{0};
            if depth>0{driver+=&format!("int size{i}={size};\n");args.push(format!("size{i}"));}
            if depth==2{
                let columns=values[i].as_array().unwrap().iter().map(|row|row.as_array().map(|v|v.len()).ok_or("C 二维数组行无效")).collect::<Result<Vec<_>,_>>()?;
                let column_values=Value::Array(columns.iter().map(|n|json!(n)).collect());
                driver+=&format!("int* columns{i}={};\n",literal(&column_values,"integer[]",&mut budget)?);args.push(format!("columns{i}"));
            }
            after.push(convert(&format!("arg{i}"),kind,&format!("size{i}"),&format!("columns{i}"))?);
        }
        if return_depth>0{driver+="int result_size=0;\n";args.push("&result_size".into());}
        if return_depth==2{driver+="int* result_columns=nullptr;\n";args.push("&result_columns".into());}
        let invocation=format!("{name}({})",args.join(","));
        let call=if returned=="void"{format!("return {invocation};")}else{format!("auto result={invocation};return {};",convert("result",returned,"result_size","result_columns")?)};
        driver+=&format!("inkleet::run(output,total,{},[&](){{{call}}},[&](inkleet::Writer& w){{w.append(\"[\");",index+1);
        for (i,value) in after.iter().enumerate(){if i>0{driver+="w.append(\",\");";}driver+=&format!("w.write({value});");}
        driver+="w.append(\"]\");});\n}\n";
        if driver.len()>8*1024*1024{return Err("生成 C 驱动超过 8 MiB".into());}
    }
    driver+="return 0;}\n";
    // Inputs are malloc-owned; solutions may free or return them. Do not free
    // unknown aliasing returns twice. The bounded test process reclaims memory.
    fs::write(root.join("solution.c"),source).map_err(|_|"无法写入 C 源码")?;
    fs::write(root.join("prototype.h"),prototype).map_err(|_|"无法写入 C 原型")?;
    fs::write(root.join("cpp_harness.hpp"),crate::cpp_harness::HEADER).map_err(|_|"无法写入 C 序列化器")?;
    fs::write(root.join("c_harness.hpp"),ADAPTER).map_err(|_|"无法写入 C 类型适配")?;
    fs::write(root.join("harness.cpp"),driver).map_err(|_|"无法写入 C 调用驱动")?;
    Ok(())
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn c_prototypes_have_explicit_sizes(){
        let root=tempfile::tempdir().unwrap();
        prepare(root.path(),"int** identity(int** v,int n,int* cols,int* out,int** outcols){return v;}",r#"{"name":"identity","params":[{"name":"v","type":"integer[][]"}],"return":{"type":"integer[][]"}}"#,"[[1,2],[]]").unwrap();
        let header=fs::read_to_string(root.path().join("prototype.h")).unwrap();
        assert!(header.contains("int** identity(int**,int,int*,int*,int**);"));
        assert!(shape("integer[][][]").is_err());
        assert!(c_type("void[]").is_err());
    }
}
