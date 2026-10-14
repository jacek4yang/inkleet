use inkleet_managed_env::{Manager,Report,harness,process};
use serde_json::{json,Value};
use std::{fs,path::Path,process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
fn environment(command:&mut Command,go:&Path,root:&Path){
    let tmp=root.join("temp");fs::create_dir_all(&tmp).unwrap();
    command.current_dir(root).env_clear().env("PATH",go.parent().unwrap()).env("GOROOT",go.parent().unwrap().parent().unwrap())
        .env("HOME",root).env("USERPROFILE",root).env("TMP",&tmp).env("TEMP",&tmp).env("TMPDIR",&tmp)
        .env("APPDATA",&tmp).env("LOCALAPPDATA",&tmp).env("GOENV","off").env("GOWORK","off").env("GOTOOLCHAIN","local")
        .env("CGO_ENABLED","0").env("GOPROXY","off").env("GOSUMDB","off").env("GOTELEMETRY","off")
        .env("GOCACHE",root.parent().unwrap().join("go-cache")).env("GOPATH",root.join("go-path"));
    if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
}
fn case(go:&Path,base:&Path,index:usize,source:&str,kind:&str,input:&str,expected:Option<Value>)->Result<(),String>{
    let root=base.join(format!("case-{index}"));fs::create_dir(&root).map_err(|e|e.to_string())?;
    let metadata=json!({"name":"identity","params":[{"name":"value","type":kind}],"return":{"type":kind}}).to_string();
    harness::prepare_go(&root,source,&metadata,input)?;
    let binary=root.join(if cfg!(windows){"solution.exe"}else{"solution"});
    let mut compile=Command::new(go);environment(&mut compile,go,&root);
    compile.args(["build","-trimpath","-buildvcs=false","-o"]).arg(&binary).args(["solution.go","nodes.go","harness.go"]);
    let output=process::run(compile,Arc::new(AtomicBool::new(false)),Duration::from_secs(120),64*1024)?;
    if output.exit_code!=Some(0){return Err(format!("Go compile {index}: {output:?}"));}
    let mut run=Command::new(&binary);environment(&mut run,go,&root);
    let output=process::run(run,Arc::new(AtomicBool::new(false)),Duration::from_secs(10),64*1024)?;
    if output.exit_code!=Some(0){return Err(format!("Go run {index}: {output:?}"));}
    let text=fs::read_to_string(root.join("results.jsonl")).map_err(|e|e.to_string())?;
    let record:Value=serde_json::from_str(text.trim()).map_err(|e|e.to_string())?;
    if let Some(expected)=expected{assert_eq!(record["ok"],true,"{record}");assert_eq!(record["value"],expected,"{record}");}
    else{assert_eq!(record["ok"],false,"{record}");assert!(record["error"].is_string());}
    let original=source.trim_start_matches('\u{feff}');
    let expected_source=if original.starts_with("package main"){original.to_owned()}else{format!("package main\n//line solution.go:1\n{original}")};
    assert_eq!(fs::read_to_string(root.join("solution.go")).map_err(|e|e.to_string())?,expected_source);
    println!("GO_HARNESS_CASE {index} PASS");
    Ok(())
}
#[tokio::main]async fn main()->Result<(),String>{
    let temp=tempfile::Builder::new().prefix("inkleet go 驱动 ").tempdir().map_err(|e|e.to_string())?;
    let root=process::tool_path(&fs::canonicalize(temp.path()).map_err(|e|e.to_string())?);
    let manager=Manager::new(root.join("tools"));let report:Report=Arc::new(|_|{});
    let go=process::tool_path(&manager.install("go",Arc::new(AtomicBool::new(false)),report).await?);
    case(&go,&root,0,"func identity(value []int) []int { return value }","integer[]","[1,2,3]",Some(json!([1,2,3])))?;
    case(&go,&root,1,"func identity(value *ListNode) *ListNode { return value }","ListNode","[1,2,3]",Some(json!([1,2,3])))?;
    case(&go,&root,2,"func identity(value *TreeNode) *TreeNode { return value }","TreeNode","[1,null,2,3]",Some(json!([1,null,2,3])))?;
    case(&go,&root,3,"func identity(value [][]byte) [][]byte { return value }","character[][]",r#"[["a","b"],["c"]]"#,Some(json!([["a","b"],["c"]])))?;
    case(&go,&root,4,"func identity(value int64) int64 { return value }","long","9007199254740993",Some(json!(9007199254740993_i64)))?;
    case(&go,&root,5,"func identity(value int64) int64 { return value }","long","9223372036854775808",None)?;
    case(&go,&root,6,"func identity(value int) int { panic(\"fixture\") }","integer","1",None)?;
    case(&go,&root,7,"func identity(value *ListNode) *ListNode { value.Next=value; return value }","ListNode","[1]",None)?;
    case(&go,&root,8,"import s \"strings\"\nfunc identity(value string) string { return s.ToUpper(value) }","string",r#""ab中文""#,Some(json!("AB中文")))?;
    case(&go,&root,9,"import \"slices\"\nfunc identity(value []int) []int { slices.Sort(value); return value }","integer[]","[3,-1,8]",Some(json!([-1,3,8])))?;
    case(&go,&root,10,"type ListNode struct { Val int; Next *ListNode }\nfunc identity(value *ListNode) *ListNode { return value }","ListNode","[1,2,3]",Some(json!([1,2,3])))?;
    case(&go,&root,11,"package main\ntype TreeNode struct { Val int; Left,Right *TreeNode }\nfunc identity(value *TreeNode) *TreeNode { return value }","TreeNode","[1,null,2,3]",Some(json!([1,null,2,3])))?;
    println!("GO_HARNESS_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"cases":12,"explicitImports":true,"authoredHelpers":true,"sourceMappingPreserved":true,"arrays":true,"list":true,"tree":true,"characters":true,"exactInteger":true,"overflowRejected":true,"panicCaptured":true,"cycleRejected":true,"systemPathUsed":false}));
    Ok(())
}
