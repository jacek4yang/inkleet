use inkleet_managed_env::{Manager,Report,process,rust_harness};
use serde_json::{json,Value};
use std::{fs,path::{Path,PathBuf},process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
fn clean(program:&Path,work:&Path,paths:&[PathBuf])->Command{
    let mut command=Command::new(program);
    command.current_dir(work).env_clear().env("HOME",work).env("USERPROFILE",work)
        .env("TMP",work).env("TEMP",work).env("PATH",std::env::join_paths(paths).unwrap())
        .env("ZIG_GLOBAL_CACHE_DIR",work.join("zig-cache")).env("ZIG_LOCAL_CACHE_DIR",work.join("zig-local"));
    if let Some(rust_lib)=paths.get(1){command.env("LD_LIBRARY_PATH",rust_lib).env("DYLD_LIBRARY_PATH",rust_lib);}
    if let Some(root)=std::env::var_os("SystemRoot"){command.env("SystemRoot",root);}
    command
}
fn checked(command:Command)->Result<String,String>{
    println!("COMPILER_COMMAND {:?} {:?}",command.get_program(),command.get_args().collect::<Vec<_>>());
    let result=process::provision(command,Arc::new(AtomicBool::new(false)),Duration::from_secs(480),1024*1024)?;
    if result.exit_code!=Some(0)||result.timed_out||result.truncated{return Err(format!("compiler probe failed: {:?}",result));}
    Ok(result.stdout)
}

fn case(install:&std::collections::HashMap<&str,PathBuf>,root:&Path,index:usize,source:&str,kind:&str,input:&str,expected:Option<Value>,mode:&str,void:bool)->Result<(),String>{
    let work=root.join(format!("case-{index}"));fs::create_dir(&work).map_err(|e|e.to_string())?;
    let metadata=json!({"name":"identity","params":[{"name":"value","type":kind}],"return":{"type":if void{"void"}else{kind}},"inkleetRustParameterModes":[mode]}).to_string();
    rust_harness::prepare(&work,source,&metadata,input)?;
    let rustc=process::tool_path(&install["rustc"]);let zig=process::tool_path(&install["zig"]);
    let stdroot=process::tool_path(install["rust-std"].parent().unwrap());
    let paths=vec![rustc.parent().unwrap().to_owned(),rustc.parent().unwrap().parent().unwrap().join("lib"),zig.parent().unwrap().to_owned()];
    let output=work.join(if cfg!(windows){"solution.exe"}else{"solution"});
    let mut command=clean(&rustc,&work,&paths);
    command.arg(work.join("harness.rs")).args(["--edition=2021","-g","-C","opt-level=0"]).arg("--sysroot").arg(&stdroot).arg("-o").arg(&output);
    if cfg!(windows){
        let lld=rustc.parent().unwrap().parent().unwrap().join("lib/rustlib/x86_64-pc-windows-msvc/bin/rust-lld.exe");
        command.arg("-C").arg(format!("linker={}",lld.display())).args(["-C","link-self-contained=yes","-C","linker-flavor=ld.lld","--target","x86_64-pc-windows-gnu"]);
        let mingw=process::tool_path(&install["rust-mingw"]).parent().and_then(Path::parent).and_then(Path::parent).ok_or("MinGW layout")?.join("lib/self-contained");
        command.arg("-L").arg(format!("native={}",mingw.display()));
    }else{
        command.arg("-C").arg(format!("linker={}",std::env::current_exe().map_err(|e|e.to_string())?.display())).args(["-C","linker-flavor=gcc"]).env("INKLEET_LINKER_MODE","1").env("INKLEET_ZIG",zig);
    }
    checked(command)?;checked(clean(&output,&work,&[]))?;
    let records=fs::read_to_string(work.join("results.jsonl")).map_err(|e|e.to_string())?;
    let record:Value=serde_json::from_str(records.trim()).map_err(|e|e.to_string())?;
    match expected{
        Some(value)=>{assert_eq!(record["ok"],true,"{record}");assert_eq!(if void{&record["argumentsAfterCall"]}else{&record["value"]},&value,"{record}");},
        None=>{assert_eq!(record["ok"],false,"{record}");assert!(record["error"].is_string());}
    }
    assert_eq!(fs::read_to_string(work.join("solution.rs")).unwrap(),source);
    println!("RUST_HARNESS_CASE {index} PASS");Ok(())
}
#[tokio::main]async fn main()->Result<(),String>{
    if std::env::var("INKLEET_LINKER_MODE").as_deref()==Ok("1"){
        let status=Command::new(std::env::var_os("INKLEET_ZIG").ok_or("private Zig")?).arg("cc").args(std::env::args_os().skip(1)).status().map_err(|e|e.to_string())?;
        std::process::exit(status.code().unwrap_or(1));
    }
    let temp=tempfile::Builder::new().prefix("inkleet Rust 驱动 ").tempdir().map_err(|e|e.to_string())?;
    let root=process::tool_path(&fs::canonicalize(temp.path()).map_err(|e|e.to_string())?);
    let manager=Manager::new(root.join("tools"));let report:Report=Arc::new(|_|{});
    let mut install=std::collections::HashMap::new();
    for id in ["rustc","rust-std","zig"]{install.insert(id,manager.install(id,Arc::new(AtomicBool::new(false)),report.clone()).await?);}
    #[cfg(windows)] install.insert("rust-mingw",manager.install("rust-mingw",Arc::new(AtomicBool::new(false)),report).await?);
    case(&install,&root,0,"impl Solution{pub fn identity(v:Vec<Vec<bool>>)->Vec<Vec<bool>>{v}}","boolean[][]","[[true,false],[]]",Some(json!([[true,false],[]])),"move",false)?;
    case(&install,&root,1,"impl Solution{pub fn identity(v:Option<Box<ListNode>>)->Option<Box<ListNode>>{v}}","ListNode","[1,2,3]",Some(json!([1,2,3])),"move",false)?;
    case(&install,&root,2,"use std::{rc::Rc,cell::RefCell}; impl Solution{pub fn identity(v:Option<Rc<RefCell<TreeNode>>>)->Option<Rc<RefCell<TreeNode>>>{v}}","TreeNode","[1,null,2,3]",Some(json!([1,null,2,3])),"move",false)?;
    case(&install,&root,3,"impl Solution{pub fn identity(v:i64)->i64{v}}","long","-9223372036854775808",Some(json!(i64::MIN)),"move",false)?;
    case(&install,&root,4,"impl Solution{pub fn identity(v:String)->String{v}}","string",r#""你好\";\n\\end""#,Some(json!("你好\";\n\\end")),"move",false)?;
    case(&install,&root,5,"impl Solution{pub fn identity(v:&mut Vec<i32>){v.reverse();}}","integer[]","[1,2,3]",Some(json!([[3,2,1]])),"mut",true)?;
    case(&install,&root,6,"impl Solution{pub fn identity(v:i32)->i32{panic!(\"fixture panic\")}}","integer","1",None,"move",false)?;
    case(&install,&root,7,"use std::{rc::Rc,cell::RefCell}; impl Solution{pub fn identity(v:Option<Rc<RefCell<TreeNode>>>)->Option<Rc<RefCell<TreeNode>>>{let n=v.as_ref().unwrap();n.borrow_mut().left=Some(n.clone());v}}","TreeNode","[1]",None,"move",false)?;
    case(&install,&root,8,"impl Solution{pub fn identity(v:Vec<char>)->Vec<char>{v}}","character[]",r#"["中","\"","🦀"]"#,Some(json!(["中","\"","🦀"])),"move",false)?;
    case(&install,&root,9,"impl Solution{pub fn identity(v:Option<Box<ListNode>>)->Option<Box<ListNode>>{v}}","ListNode","[]",Some(Value::Null),"move",false)?;
    println!("RUST_HARNESS_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"cases":10,"arrays":true,"nodes":true,"exactInteger":true,"unicode":true,"mutableBorrow":true,"panic":true,"cycleRejected":true,"systemPathUsed":false}));
    Ok(())
}
