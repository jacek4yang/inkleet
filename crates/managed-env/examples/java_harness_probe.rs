use inkleet_managed_env::{Manager,Report,process,java_harness};
use serde_json::{json,Value};
use std::{fs,path::Path,process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
fn case(runtime:&inkleet_managed_env::java_runtime::Runtime,root:&Path,index:usize,source:&str,kind:&str,input:&str,expected:Option<Value>,returned:&str)->Result<(),String>{
    let work=root.join(format!("case-{index}"));fs::create_dir(&work).map_err(|e|e.to_string())?;
    let metadata=json!({"name":"identity","params":[{"name":"value","type":kind}],"return":{"type":returned}}).to_string();
    java_harness::prepare(&work,source,&metadata,input)?;
    let mut compile=runtime.command(&work,&[std::ffi::OsString::from("-Djava.class.path=.")],"com.sun.tools.javac.Main")?;
    compile.args(["-encoding","UTF-8","-g","-proc:none","Solution.java","InkLeetNodes.java","InkLeetJson.java","InkLeetHarness.java"]);
    let output=process::compile(compile,Arc::new(AtomicBool::new(false)),Duration::from_secs(120),64*1024)?;
    if output.exit_code!=Some(0)||output.timed_out||output.truncated{return Err(format!("Java compile {index}: {output:?}"));}
    let run=runtime.command(&work,&["-Xmx256m","-Dstdout.encoding=UTF-8","-Dstderr.encoding=UTF-8","-Djava.class.path=."].map(std::ffi::OsString::from),"InkLeetHarness")?;
    let output=process::run(run,Arc::new(AtomicBool::new(false)),Duration::from_secs(10),64*1024)?;
    if output.exit_code!=Some(0)||output.timed_out||output.truncated{return Err(format!("Java run {index}: {output:?}"));}
    let records=fs::read_to_string(work.join("results.jsonl")).map_err(|e|e.to_string())?;
    let record:Value=serde_json::from_str(records.trim()).map_err(|e|e.to_string())?;
    match expected{
        Some(value)=>{assert_eq!(record["ok"],true,"{record}");assert_eq!(if returned=="void"{&record["argumentsAfterCall"]}else{&record["value"]},&value,"{record}");},
        None=>{assert_eq!(record["ok"],false,"{record}");assert!(record["error"].is_string());}
    }
    assert_eq!(fs::read_to_string(work.join("original-snapshot.java")).unwrap(),source);
    println!("JAVA_HARNESS_CASE {index} PASS");Ok(())
}
#[tokio::main]async fn main()->Result<(),String>{
    let temp=tempfile::Builder::new().prefix("inkleet Java 驱动 ").tempdir().map_err(|e|e.to_string())?;
    let root=process::tool_path(&fs::canonicalize(temp.path()).map_err(|e|e.to_string())?);
    let manager=Manager::new(root.join("tools"));let report:Report=Arc::new(|_|{});
    manager.install("jdk",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    #[cfg(windows)] manager.install("zig",Arc::new(AtomicBool::new(false)),report).await?;
    let runtime=inkleet_managed_env::java_runtime::Runtime::prepare(&manager,Arc::new(AtomicBool::new(false)))?;
    case(&runtime,&root,0,"class Solution{boolean[][] identity(boolean[][] v){return v;}}","boolean[][]","[[true,false],[]]",Some(json!([[true,false],[]])),"boolean[][]")?;
    case(&runtime,&root,1,"class Solution{ListNode identity(ListNode v){return v;}}","ListNode","[1,2,3]",Some(json!([1,2,3])),"ListNode")?;
    case(&runtime,&root,2,"class Solution{TreeNode identity(TreeNode v){return v;}}","TreeNode","[1,null,2,3]",Some(json!([1,null,2,3])),"TreeNode")?;
    case(&runtime,&root,3,"class Solution{long identity(long v){return v;}}","long","-9223372036854775808",Some(json!(i64::MIN)),"long")?;
    case(&runtime,&root,4,"class Solution{String identity(String v){return v;}}","string",r#""你好\";\n\\end🦀""#,Some(json!("你好\";\n\\end🦀")),"string")?;
    case(&runtime,&root,5,"class Solution{void identity(int[] v){for(int i=0,j=v.length-1;i<j;i++,j--){int t=v[i];v[i]=v[j];v[j]=t;}}}","integer[]","[1,2,3]",Some(json!([[3,2,1]])),"void")?;
    case(&runtime,&root,6,"class Solution{int identity(int v){throw new IllegalArgumentException(\"fixture\");}}","integer","1",None,"integer")?;
    case(&runtime,&root,7,"class Solution{TreeNode identity(TreeNode v){v.left=v;return v;}}","TreeNode","[1]",None,"TreeNode")?;
    case(&runtime,&root,8,"class Solution{List<List<Integer>> identity(int v){return List.of(List.of(v),List.of());}}","integer","1",Some(json!([[1],[]])),"list<list<integer>>")?;
    case(&runtime,&root,9,"class Solution{char[] identity(char[] v){return v;}}","character[]",r#"["中","\"","\n"]"#,Some(json!(["中","\"","\n"])),"character[]")?;
    case(&runtime,&root,10,"import java.util.List; class Solution{List<List<Integer>> identity(int v){return List.of(List.of(v),List.of());}}","integer","1",Some(json!([[1],[]])),"integer[][]")?;
    case(&runtime,&root,11,"import java.util.List; class Solution{List<String> identity(String v){return List.of(v);}}","string",r#""中文""#,Some(json!(["中文"])),"string[]")?;
    case(&runtime,&root,12,"import java.util.HashMap; class Solution{int identity(int v){HashMap<String,Integer> m=new HashMap<>();m.put(\"v\",v);return m.get(\"v\");}}","integer","42",Some(json!(42)),"integer")?;
    case(&runtime,&root,13,"class ListNode{int val;ListNode next;ListNode(int v,ListNode n){val=v;next=n;}} class Solution{ListNode identity(ListNode v){return v;}}","ListNode","[1,2,3]",Some(json!([1,2,3])),"ListNode")?;
    println!("JAVA_HARNESS_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"cases":14,"officialCollectionMetadata":true,"explicitImports":true,"authoredHelpers":true,"arrays":true,"nodes":true,"exactInteger":true,"unicode":true,"voidMutation":true,"exceptions":true,"cycleRejected":true,"genericLists":true,"systemPathUsed":false}));
    Ok(())
}
