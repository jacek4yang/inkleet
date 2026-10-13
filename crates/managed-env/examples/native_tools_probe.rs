use inkleet_managed_env::{Manager,Report,process,rpc::Client};
use serde_json::{json,Value};
use std::{path::{Path,PathBuf},process::Command,sync::{Arc,atomic::AtomicBool,mpsc},time::{Duration,Instant}};
fn command(entry:&Path,work:&Path,paths:&[PathBuf])->Command{
    let mut command=Command::new(entry);command.current_dir(work).env_clear().env("PATH",std::env::join_paths(paths).unwrap())
        .env("HOME",work).env("USERPROFILE",work).env("TMP",work).env("TEMP",work)
        .env("ZIG_GLOBAL_CACHE_DIR",work.join("zig-cache")).env("ZIG_LOCAL_CACHE_DIR",work.join("zig-local"));
    if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}command
}
fn run(command:Command)->Result<process::Output,String>{
    let result=process::provision(command,Arc::new(AtomicBool::new(false)),Duration::from_secs(480),1024*1024)?;
    if result.exit_code!=Some(0)||result.timed_out||result.truncated{return Err(format!("Private compiler preparation failed: {result:?}"));}Ok(result)
}
fn event(rx:&mpsc::Receiver<Value>,name:&str)->Result<Value,String>{
    let deadline=Instant::now()+Duration::from_secs(45);
    loop{let value=rx.recv_timeout(deadline.saturating_duration_since(Instant::now())).map_err(|_|format!("Missing DAP event {name}"))?;
        if value.get("event").and_then(Value::as_str)==Some(name){return Ok(value);}
    }
}
#[tokio::main]async fn main()->Result<(),String>{
    let temp=tempfile::Builder::new().prefix("inkleet native 语言 ").tempdir().map_err(|e|e.to_string())?;
    let root=process::tool_path(&std::fs::canonicalize(temp.path()).map_err(|e|e.to_string())?);
    let manager=Manager::new(root.join("tools"));let report:Report=Arc::new(|_|{});
    let zig=manager.install("zig",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    let clangd=manager.install("clangd",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    let lldb=manager.install("codelldb",Arc::new(AtomicBool::new(false)),report).await?;
    let work=root.join("workspace");std::fs::create_dir(&work).map_err(|e|e.to_string())?;
    let paths=vec![zig.parent().unwrap().to_owned()];
    let empty=work.join("empty.cpp");std::fs::write(&empty,"").map_err(|e|e.to_string())?;
    let mut query=command(&zig,&work,&paths);query.args(["c++","-E","-v","-x","c++"]);
    if cfg!(windows){query.args(["-target","x86_64-windows-gnu"]);}
    #[cfg(target_os="linux")] query.args(["-target","x86_64-linux-gnu"]);
    query.arg(&empty);
    let queried=run(query)?;let mut includes=Vec::new();let mut inside=false;
    let zig_root=std::fs::canonicalize(zig.parent().unwrap()).map_err(|e|e.to_string())?;
    let mut target=None;
    for line in queried.stderr.lines(){
        let line=line.trim();
        if let Some(value)=line.strip_prefix("Target: "){target=Some(value.to_owned());}
        if line=="#include <...> search starts here:"{inside=true;continue;}
        if line=="End of search list."{inside=false;}
        if inside{
            let path=std::fs::canonicalize(line).map_err(|e|format!("Invalid private include: {line}: {e}"))?;
            if !path.starts_with(&zig_root){return Err(format!("Compiler attempted to use a non-private header directory: {}",path.display()));}
            includes.push(process::tool_path(&path));
        }
    }
    if includes.is_empty(){return Err(format!("No private C++ include directories: {}",queried.stderr));}
    let source=work.join("solution.cpp");let doc="#include <vector>\nvoid example() {\nstd::vector<int> values;\nvalues.push_back(1);\nvalues.\n}\n";
    std::fs::write(&source,doc).map_err(|e|e.to_string())?;
    let mut args=vec!["clang++".to_owned(),"-std=c++20".into(),"-nostdinc".into(),"-nostdinc++".into()];
    if let Some(target)=target{args.push(format!("--target={target}"));}
    for path in includes{args.push("-isystem".into());args.push(path.to_string_lossy().into());}
    args.push("-c".into());args.push(source.to_string_lossy().into());
    std::fs::write(work.join("compile_commands.json"),json!([{"directory":work,"file":source,"arguments":args}]).to_string()).map_err(|e|e.to_string())?;
    let mut cmd=command(&clangd,&work,&paths);cmd.args(["--background-index=false","--clang-tidy=false","--header-insertion=never","--enable-config=false","--log=error"]);
    let client=Client::spawn(cmd,json!({}),Arc::new(|_|{}))?;
    let uri=reqwest::Url::from_file_path(&source).map_err(|_|"C++ source URI")?.to_string();
    let root_uri=reqwest::Url::from_directory_path(&work).map_err(|_|"C++ workspace URI")?.to_string();
    let lsp=(||->Result<(),String>{
        client.request("initialize",json!({"processId":null,"rootUri":root_uri,"capabilities":{"general":{"positionEncodings":["utf-16"]},"textDocument":{"hover":{"contentFormat":["plaintext"]},"completion":{"completionItem":{"snippetSupport":false}}}}}),Duration::from_secs(30))?;
        client.notify("initialized",json!({}))?;client.notify("textDocument/didOpen",json!({"textDocument":{"uri":uri,"languageId":"cpp","version":1,"text":doc}}))?;
        let deadline=Instant::now()+Duration::from_secs(60);
        loop{
            let hover=client.request("textDocument/hover",json!({"textDocument":{"uri":uri},"position":{"line":3,"character":3}}),Duration::from_secs(10))?;
            if hover.to_string().contains("vector"){break;}
            if Instant::now()>deadline{return Err(format!("C++ hover unavailable: {hover}"));}
            std::thread::sleep(Duration::from_millis(300));
        }
        let completion=client.request("textDocument/completion",json!({"textDocument":{"uri":uri},"position":{"line":4,"character":7}}),Duration::from_secs(15))?;
        let items=completion.as_array().or_else(||completion.get("items").and_then(Value::as_array)).ok_or("C++ completion list")?;
        if !items.iter().any(|item|item.get("label").and_then(Value::as_str).is_some_and(|s|s.contains("push_back"))){return Err("Missing vector member completion".into());}
        let definition=client.request("textDocument/definition",json!({"textDocument":{"uri":uri},"position":{"line":2,"character":7}}),Duration::from_secs(15))?;
        if !definition.to_string().contains("file:"){return Err("C++ stdlib definition missing".into());}
        println!("CPP_LSP_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"hover":true,"completion":true,"stdlibDefinition":true,"privateHeadersOnly":true}));
        Ok(())
    })();
    if let Err(error)=&lsp{println!("CPP_LSP_FAILURE {error}; stderr={}",client.stderr());}
    let _=client.request("shutdown",Value::Null,Duration::from_secs(5));client.stop();
    let c_source=work.join("debug_subject.c");std::fs::write(&c_source,"int main(void) {\n int total=1;\n total+=2;\n return total;\n}\n").map_err(|e|e.to_string())?;
    let binary=work.join(if cfg!(windows){"subject.exe"}else{"subject"});let mut compile=command(&zig,&work,&paths);
    compile.args(["cc","-g","-O0"]);if cfg!(windows){compile.args(["-target","x86_64-windows-gnu"]);}#[cfg(target_os="linux")] compile.args(["-target","x86_64-linux-gnu"]);
    compile.arg(&c_source).arg("-o").arg(&binary);run(compile)?;
    let (tx,rx)=mpsc::sync_channel(128);let adapter=Arc::new(Client::spawn_dap(command(&lldb,&work,&paths),Arc::new(move|value|{if value.get("event").and_then(Value::as_str)!=Some("output"){let _=tx.try_send(value);}}))?);
    let dap=(||->Result<(),String>{
        adapter.request("initialize",json!({"clientID":"inkleet","adapterID":"lldb","pathFormat":"path","linesStartAt1":true,"columnsStartAt1":true,"supportsRunInTerminalRequest":false}),Duration::from_secs(30))?;
        let running=adapter.clone();let source=c_source.clone();let program=binary.clone();let cwd=work.clone();
        let launch=std::thread::spawn(move||running.request("launch",json!({"type":"lldb","request":"launch","program":program,"cwd":cwd,"terminal":"console","stopOnEntry":false}),Duration::from_secs(45)));
        event(&rx,"initialized")?;
        adapter.request("setBreakpoints",json!({"source":{"path":source},"breakpoints":[{"line":3}]}),Duration::from_secs(10))?;
        adapter.request("configurationDone",json!({}),Duration::from_secs(10))?;launch.join().map_err(|_|"LLDB launch worker")??;
        let stopped=event(&rx,"stopped")?;let thread=stopped.pointer("/body/threadId").and_then(Value::as_i64).ok_or("LLDB stopped thread")?;
        let stack=adapter.request("stackTrace",json!({"threadId":thread,"startFrame":0,"levels":10}),Duration::from_secs(10))?;
        let frame=stack.pointer("/stackFrames/0/id").and_then(Value::as_i64).ok_or("LLDB stack frame")?;
        let scopes=adapter.request("scopes",json!({"frameId":frame}),Duration::from_secs(10))?;
        let reference=scopes.pointer("/scopes/0/variablesReference").and_then(Value::as_i64).ok_or("LLDB locals")?;
        let variables=adapter.request("variables",json!({"variablesReference":reference}),Duration::from_secs(10))?;
        if !variables.to_string().contains("total"){return Err("LLDB local variable missing".into());}
        adapter.request("next",json!({"threadId":thread}),Duration::from_secs(10))?;event(&rx,"stopped")?;
        adapter.request("continue",json!({"threadId":thread}),Duration::from_secs(10))?;event(&rx,"terminated")?;
        println!("NATIVE_DAP_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"breakpoint":true,"stack":true,"variables":true,"stepOver":true,"continue":true,"termination":true,"stdioOnly":true}));
        Ok(())
    })();
    if let Err(error)=&dap{println!("NATIVE_DAP_FAILURE {error}; stderr={}",adapter.stderr());}
    adapter.stop();lsp?;dap
}
