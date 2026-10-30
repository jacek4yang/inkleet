//! Executes authored local-runner fixtures with runner Rust/Python, not managed-tool or GUI qualification.
use inkleet_managed_env::{harness,process,rust_harness};
use serde_json::{json,Value};
use std::{fs,path::Path,process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
fn checked(mut command:Command,root:&Path)->Result<(),String>{
    command.current_dir(root);
    let output=process::provision(command,Arc::new(AtomicBool::new(false)),Duration::from_secs(45),1024*1024)?;
    if output.exit_code!=Some(0)||output.timed_out||output.truncated{return Err(format!("fixture process failed: {output:?}"));}Ok(())
}
fn run(root:&Path,label:&str,language:&str,source:&str,metadata:&Value,input:&str,expected:Value)->Result<(),String>{
    let work=root.join(format!("{language}-{label}"));fs::create_dir(&work).map_err(|e|e.to_string())?;
    if language=="rust"{
        rust_harness::prepare(&work,source,&metadata.to_string(),input)?;
        let output=work.join(if cfg!(windows){"fixture.exe"}else{"fixture"});
        let mut compiler=Command::new(std::env::var_os("INKLEET_PROBE_RUSTC").unwrap_or_else(||"rustc".into()));
        compiler.arg("--edition=2021").arg(work.join("harness.rs")).arg("-o").arg(&output);
        checked(compiler,&work)?;checked(Command::new(output),&work)?;
    }else{
        harness::prepare(&work,source,&metadata.to_string(),input)?;
        let mut python=Command::new(std::env::var_os("INKLEET_PROBE_PYTHON").unwrap_or_else(||if cfg!(windows){"python".into()}else{"python3".into()}));
        python.arg(work.join("harness.py"));checked(python,&work)?;
    }
    let records=fs::read_to_string(work.join("results.jsonl")).map_err(|e|e.to_string())?;
    let records=records.lines().map(serde_json::from_str::<Value>).collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    let expected=expected.as_array().ok_or("expected array")?;
    if records.len()!=expected.len(){return Err(format!("{label}: wrong result count"));}
    for (index,(record,want)) in records.iter().zip(expected).enumerate(){
        if record["case"]!=index+1{return Err(format!("{label}: wrong case identity"));}
        if want=="ERROR"{if record["ok"]!=false||!record["error"].is_string(){return Err(format!("{label}: expected error: {record}"));}}
        else if record["ok"]!=true||record["value"]!=*want{return Err(format!("{label}: expected {want}, got {record}"));}
    }
    let file=if language=="rust"{"solution.rs"}else{"solution.py"};
    if fs::read_to_string(work.join(file)).map_err(|e|e.to_string())?!=source{return Err("source snapshot changed".into());}
    println!("LOCAL_FEATURE_CASE {language} {label} PASS");Ok(())
}
fn main()->Result<(),String>{
    let temp=tempfile::Builder::new().prefix("inkleet design 本地 ").tempdir().map_err(|e|e.to_string())?;
    let root=process::tool_path(&fs::canonicalize(temp.path()).map_err(|e|e.to_string())?);
    let ledger=json!({"systemdesign":true,"classname":"Ledger","constructor":{"params":[{"name":"initial","type":"long"}]},"methods":[
        {"name":"add","params":[{"name":"value","type":"long"}],"return":{"type":"void"}},
        {"name":"lastValue","params":[],"return":{"type":"long"}},
        {"name":"values","params":[],"return":{"type":"long[]"}},
        {"name":"fail","params":[],"return":{"type":"integer"}}]});
    let rust_ledger="struct Ledger { values:Vec<i64> } impl Ledger { fn new(initial:i64)->Self{Self{values:vec![initial]}} fn add(&mut self,value:i64){self.values.push(value);} fn last_value(&self)->i64{*self.values.last().unwrap()} fn values(&self)->Vec<i64>{self.values.clone()} fn fail(&self)->i32{panic!(\"fixture failure\")} }";
    let python_ledger="class Ledger:\n def __init__(self, initial): self.items = [initial]\n def add(self, value): self.items.append(value)\n def lastValue(self): return self.items[-1]\n def values(self): return self.items\n def fail(self): raise ValueError('fixture failure')\n";
    let input=r#"["Ledger","values","add","lastValue","values"]
[[9007199254740993],[],[7],[],[]]
["Ledger","fail"]
[[0],[]]
["Ledger","lastValue"]
[[42],[]]"#;
    for (language,source) in [("rust",rust_ledger),("python",python_ledger)]{
        run(&root,"state-and-error",language,source,&ledger,input,json!([[null,[9007199254740993_i64],null,7,[9007199254740993_i64,7]],"ERROR",[null,42]]))?;
    }
    let counter=json!({"systemdesign":true,"classname":"Counter","constructor":{"params":[]},"methods":[{"name":"total","params":[],"return":{"type":"integer"}}]});
    let counter_input=r#"["Counter","total"] [[],[]]"#;
    run(&root,"missing-class","python","# Intentionally missing the design class\n",&counter,counter_input,json!(["ERROR"]))?;
    run(&root,"explicit-class-import","python","from collections import Counter\n",&counter,counter_input,json!([[null,0]]))?;
    let nested=json!({"systemdesign":true,"classname":"NestedIterator","constructor":{"params":[{"name":"nestedList","type":"NestedInteger[]"}]},"methods":[
        {"name":"next","params":[],"return":{"type":"integer"}},{"name":"hasNext","params":[],"return":{"type":"boolean"}}]});
    let rust_nested="struct NestedIterator { values:std::vec::IntoIter<i32> } impl NestedIterator { fn new(nested_list:Vec<NestedInteger>)->Self{fn flatten(v:NestedInteger,out:&mut Vec<i32>){match v{NestedInteger::Int(n)=>out.push(n),NestedInteger::List(list)=>for item in list{flatten(item,out)}}}let mut out=Vec::new();for v in nested_list{flatten(v,&mut out);}Self{values:out.into_iter()}} fn next(&mut self)->i32{self.values.next().unwrap()} fn has_next(&self)->bool{self.values.len()>0} }";
    let python_nested="class NestedIterator:\n def __init__(self, nestedList):\n  self.items=[]\n  def flatten(node):\n   if node.isInteger(): self.items.append(node.getInteger())\n   else:\n    for child in node.getList(): flatten(child)\n  for node in nestedList: flatten(node)\n def next(self): return self.items.pop(0)\n def hasNext(self): return bool(self.items)\n";
    let input=r#"["NestedIterator","hasNext","next","next","next","hasNext"]
[[[[],[1,[2]],3]],[],[],[],[],[]]"#;
    for (language,source) in [("rust",rust_nested),("python",python_nested)]{
        run(&root,"nested-iterator",language,source,&nested,input,json!([[null,true,1,2,3,false]]))?;
    }
    let nested_value=json!({"name":"identity","params":[{"name":"value","type":"NestedInteger"}],"return":{"type":"NestedInteger"}});
    run(&root,"nested-value","rust","impl Solution{pub fn identity(value:NestedInteger)->NestedInteger{value}}",&nested_value,"[1,[2,[]],-3]",json!([[1,[2,[]],-3]]))?;
    run(&root,"nested-value","python","class Solution:\n def identity(self, value): return value\n",&nested_value,"[1,[2,[]],-3]",json!([[1,[2,[]],-3]]))?;
    run(&root,"nested-invalid","python","class Solution:\n def identity(self, value): return value\n",&nested_value,"null\ntrue\n1.5\n2147483648",json!(["ERROR","ERROR","ERROR","ERROR"]))?;
    run(&root,"nested-cycle","python","class Solution:\n def identity(self, value):\n  result=NestedInteger()\n  result.add(result)\n  return result\n",&nested_value,"[]",json!(["ERROR"]))?;
    let zero=json!({"name":"answer","params":[],"return":{"type":"integer"}});
    run(&root,"zero-parameters","rust","impl Solution{pub fn answer()->i32{42}}",&zero,"[]\n[]",json!([42,42]))?;
    run(&root,"zero-parameters","python","class Solution:\n def answer(self): return 42\n",&zero,"[]\n[]",json!([42,42]))?;
    println!("LOCAL_FEATURE_RESULT {}",json!({"platform":std::env::consts::OS,"cases":12,"rust":true,"python":true,"designSequences":true,"missingClassRejected":true,"nestedInteger":true,"nestedInvalidRejected":true,"nestedCycleRejected":true,"zeroParameters":true,"exactInteger":true,"stateIsolation":true,"errorIsolation":true,"sourceUnchanged":true,"managedToolchainQualification":false,"nativeGuiQualification":false}));Ok(())
}
