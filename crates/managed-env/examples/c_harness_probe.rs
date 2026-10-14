use inkleet_managed_env::{Manager,Report,process,c_harness};
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
    c_harness::prepare(&work,source,&metadata,input)?;
    let binary=work.join(if cfg!(windows){"solution.exe"}else{"solution"});
    let object=work.join("solution.o");
    let mut c=Command::new(zig);clean(&mut c,zig,&work,base);
    c.args(["cc","-std=c11","-pedantic-errors","-O0","-g","-include"]).arg(work.join("prototype.h"));
    if cfg!(windows){c.args(["-target","x86_64-windows-gnu"]);}
    #[cfg(target_os="linux")] c.args(["-target","x86_64-linux-gnu"]);
    c.arg("-c").arg(work.join("solution.c")).arg("-o").arg(&object);
    let output=process::run(c,Arc::new(AtomicBool::new(false)),Duration::from_secs(120),64*1024)?;
    if output.exit_code!=Some(0){return Err(format!("C source compile {index}: {output:?}"));}
    let mut compile=Command::new(zig);clean(&mut compile,zig,&work,base);
    compile.args(["c++","-std=c++20","-O0","-g"]);
    if cfg!(windows){compile.args(["-target","x86_64-windows-gnu"]);}
    #[cfg(target_os="linux")] compile.args(["-target","x86_64-linux-gnu"]);
    compile.arg(work.join("harness.cpp")).arg(&object).arg("-o").arg(&binary);
    let output=process::provision(compile,Arc::new(AtomicBool::new(false)),Duration::from_secs(480),64*1024)?;
    if output.exit_code!=Some(0){return Err(format!("C harness compile {index}: {output:?}"));}
    let mut run=Command::new(binary);clean(&mut run,zig,&work,base);
    let output=process::run(run,Arc::new(AtomicBool::new(false)),Duration::from_secs(10),64*1024)?;
    if output.exit_code!=Some(0){return Err(format!("C harness run {index}: {output:?}"));}
    let records=fs::read_to_string(work.join("results.jsonl")).map_err(|e|e.to_string())?;
    let record:Value=serde_json::from_str(records.trim()).map_err(|e|e.to_string())?;
    match expected{Some(value)=>{assert_eq!(record["ok"],true,"{record}");assert_eq!(if void{&record["argumentsAfterCall"]}else{&record["value"]},&value,"{record}");},None=>{assert_eq!(record["ok"],false,"{record}");assert!(record["error"].is_string());}}
    assert_eq!(fs::read_to_string(work.join("solution.c")).map_err(|e|e.to_string())?,source);
    println!("C_HARNESS_CASE {index} PASS");
    Ok(())
}
#[tokio::main]async fn main()->Result<(),String>{
    let temp=tempfile::Builder::new().prefix("inkleet C 驱动 ").tempdir().map_err(|e|e.to_string())?;
    let root=process::tool_path(&fs::canonicalize(temp.path()).map_err(|e|e.to_string())?);
    let manager=Manager::new(root.join("tools"));let report:Report=Arc::new(|_|{});
    let zig=process::tool_path(&manager.install("zig",Arc::new(AtomicBool::new(false)),report).await?);
    case(&zig,&root,0,"int* identity(int* restrict v,int n,int* count){*count=n;return v;}","integer[]","[1,2,3]",Some(json!([1,2,3])),false)?;
    case(&zig,&root,1,"int** identity(int** v,int n,int* cols,int* count,int** outcols){*count=n;*outcols=cols;return v;}","integer[][]","[[1,2],[],[3]]",Some(json!([[1,2],[],[3]])),false)?;
    case(&zig,&root,2,"char** identity(char** v,int n,int* count){*count=n;return v;}","string[]",r#"["你好","a\nb",""]"#,Some(json!(["你好","a\nb",""])),false)?;
    case(&zig,&root,3,"struct ListNode* identity(struct ListNode* n){return n;}","ListNode","[1,2,3]",Some(json!([1,2,3])),false)?;
    case(&zig,&root,4,"struct TreeNode* identity(struct TreeNode* n){return n;}","TreeNode","[1,null,2,3]",Some(json!([1,null,2,3])),false)?;
    case(&zig,&root,5,"long long identity(long long n){return n;}","long","9007199254740993",Some(json!(9007199254740993_i64)),false)?;
    case(&zig,&root,6,"void identity(int* v,int n){for(int i=0;i<n/2;i++){int t=v[i];v[i]=v[n-1-i];v[n-1-i]=t;}}","integer[]","[1,2,3]",Some(json!([[3,2,1]])),true)?;
    case(&zig,&root,7,"int* identity(int* v,int n,int* count){*count=10001;return v;}","integer[]","[1]",None,false)?;
    case(&zig,&root,8,"bool* identity(bool* v,int n,int* count){*count=n;return v;}","boolean[]","[true,false]",Some(json!([true,false])),false)?;
    case(&zig,&root,9,"struct ListNode* identity(struct ListNode* n){n->next=n;return n;}","ListNode","[1]",None,false)?;
    case(&zig,&root,10,"#include <stdlib.h>\n#include <string.h>\nint* identity(int* v,int n,int* count){*count=n;int* out=malloc((n?n:1)*sizeof(int));if(!out){*count=0;return NULL;}memcpy(out,v,n*sizeof(int));return out;}","integer[]","[3,-1,8]",Some(json!([3,-1,8])),false)?;
    case(&zig,&root,11,"#include <stdint.h>\nlong long identity(long long n){int64_t value=n;return value;}","long","9007199254740993",Some(json!(9007199254740993_i64)),false)?;
    println!("C_HARNESS_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"cases":12,"explicitIncludes":true,"sourcePreserved":true,"dialect":"C11","separateTranslationUnit":true,"arrays":true,"matrixLengths":true,"list":true,"tree":true,"exactInteger":true,"escapedUnicode":true,"voidMutation":true,"badLengthRejected":true,"cycleRejected":true,"systemPathUsed":false}));
    Ok(())
}
