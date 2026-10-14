use inkleet_managed_env::{Manager,Report,process,cpp_harness};
use serde_json::{json,Value};
use std::{fs,path::Path,process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
fn clean(command:&mut Command,zig:&Path,work:&Path,base:&Path){
    command.current_dir(work).env_clear().env("PATH",zig.parent().unwrap()).env("HOME",work).env("USERPROFILE",work)
        .env("TMP",work).env("TEMP",work).env("ZIG_GLOBAL_CACHE_DIR",base.join("zig-cache")).env("ZIG_LOCAL_CACHE_DIR",work.join("zig-local"));
    if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
}
fn case(zig:&Path,base:&Path,index:usize,source:&str,kind:&str,input:&str,expected:Option<Value>,void:bool)->Result<(),String>{
    let work=base.join(format!("case-{index}"));fs::create_dir(&work).map_err(|e|e.to_string())?;
    let metadata=json!({"name":"identity","params":[{"name":"value","type":kind}],"return":{"type":if void{"void"}else{kind}}}).to_string();
    cpp_harness::prepare(&work,source,&metadata,input)?;
    let binary=work.join(if cfg!(windows){"solution.exe"}else{"solution"});
    let mut compile=Command::new(zig);clean(&mut compile,zig,&work,base);
    compile.args(["c++","-std=c++20","-O0","-g"]);
    if cfg!(windows){compile.args(["-target","x86_64-windows-gnu"]);}
    #[cfg(target_os="linux")] compile.args(["-target","x86_64-linux-gnu"]);
    compile.arg(work.join("harness.cpp")).arg("-o").arg(&binary);
    let output=process::provision(compile,Arc::new(AtomicBool::new(false)),Duration::from_secs(480),64*1024)?;
    if output.exit_code!=Some(0){return Err(format!("C++ harness compile {index}: {output:?}"));}
    let mut run=Command::new(binary);clean(&mut run,zig,&work,base);
    let output=process::run(run,Arc::new(AtomicBool::new(false)),Duration::from_secs(10),64*1024)?;
    if output.exit_code!=Some(0){return Err(format!("C++ harness run {index}: {output:?}"));}
    let records=fs::read_to_string(work.join("results.jsonl")).map_err(|e|e.to_string())?;
    let record:Value=serde_json::from_str(records.trim()).map_err(|e|e.to_string())?;
    match expected{Some(value)=>{assert_eq!(record["ok"],true,"{record}");assert_eq!(if void{&record["argumentsAfterCall"]}else{&record["value"]},&value,"{record}");},None=>{assert_eq!(record["ok"],false,"{record}");assert!(record["error"].is_string());}}
    assert_eq!(fs::read_to_string(work.join("solution.cpp")).map_err(|e|e.to_string())?,source,"source snapshot changed");
    println!("CPP_HARNESS_CASE {index} PASS");
    Ok(())
}
#[tokio::main]async fn main()->Result<(),String>{
    let temp=tempfile::Builder::new().prefix("inkleet C++ 驱动 ").tempdir().map_err(|e|e.to_string())?;
    let root=process::tool_path(&fs::canonicalize(temp.path()).map_err(|e|e.to_string())?);
    let manager=Manager::new(root.join("tools"));let report:Report=Arc::new(|_|{});
    let zig=process::tool_path(&manager.install("zig",Arc::new(AtomicBool::new(false)),report).await?);
    case(&zig,&root,0,"class Solution{public:vector<vector<bool>> identity(vector<vector<bool>>& v){return v;}};","boolean[][]","[[true,false],[]]",Some(json!([[true,false],[]])),false)?;
    case(&zig,&root,1,"class Solution{public:ListNode* identity(ListNode* n){return n;}};","ListNode","[1,2,3]",Some(json!([1,2,3])),false)?;
    case(&zig,&root,2,"class Solution{public:TreeNode* identity(TreeNode* n){return n;}};","TreeNode","[1,null,2,3]",Some(json!([1,null,2,3])),false)?;
    case(&zig,&root,3,"class Solution{public:long long identity(long long n){return n;}};","long","-9223372036854775808",Some(json!(-9223372036854775808_i64)),false)?;
    case(&zig,&root,4,"class Solution{public:string identity(string s){return s;}};","string",r#""你好\";\n\\end""#,Some(json!("你好\";\n\\end")),false)?;
    case(&zig,&root,5,"class Solution{public:void identity(vector<int>& v){reverse(v.begin(),v.end());}};","integer[]","[1,2,3]",Some(json!([[3,2,1]])),true)?;
    case(&zig,&root,6,"class Solution{public:ListNode* identity(ListNode* n){n->next=n;return n;}};","ListNode","[1]",None,false)?;
    case(&zig,&root,7,"class Solution{public:TreeNode* identity(TreeNode* n){return n;}};","TreeNode","[]",Some(Value::Null),false)?;
    case(&zig,&root,8,"#include <unordered_map>\nclass Solution{public:int identity(int n){std::unordered_map<int,int> m;m[1]=n;return m.at(1);}};","integer","42",Some(json!(42)),false)?;
    case(&zig,&root,9,"struct ListNode{int val;ListNode* next;ListNode(int v):val(v),next(nullptr){}};class Solution{public:ListNode* identity(ListNode* n){return n;}};","ListNode","[1,2,3]",Some(json!([1,2,3])),false)?;
    case(&zig,&root,10,"struct TreeNode{int val;TreeNode* left;TreeNode* right;TreeNode(int v):val(v),left(nullptr),right(nullptr){}};class Solution{public:TreeNode* identity(TreeNode* n){return n;}};","TreeNode","[1,null,2,3]",Some(json!([1,null,2,3])),false)?;
    case(&zig,&root,11,"class Solution{public:string identity(string s){std::ostringstream out;out<<s;return out.str();}};","string",r#""中文""#,Some(json!("中文")),false)?;
    println!("CPP_HARNESS_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"cases":12,"explicitImports":true,"authoredHelpers":true,"sourcePreserved":true,"arrays":true,"list":true,"tree":true,"exactInteger":true,"escapedUnicode":true,"voidMutation":true,"cycleRejected":true,"systemPathUsed":false}));
    Ok(())
}
