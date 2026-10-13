use inkleet_managed_env::{Manager,Report,process,java_harness,java_runtime::Runtime,java_debug,rpc::Client};
use serde_json::{json,Value};
use std::{fs,path::Path,process::Command,sync::{Arc,atomic::AtomicBool,mpsc},time::{Duration,Instant}};

fn event(rx:&mpsc::Receiver<Value>,name:&str)->Result<Value,String>{
    let deadline=Instant::now()+Duration::from_secs(30);
    loop{let remaining=deadline.saturating_duration_since(Instant::now());let value=rx.recv_timeout(remaining).map_err(|_|format!("Java DAP {name} event timeout"))?;
        if value.get("event").and_then(Value::as_str)==Some(name){return Ok(value);}}
}
#[tokio::main]async fn main()->Result<(),String>{
    let temp=tempfile::Builder::new().prefix("inkleet java 调试 ").tempdir().map_err(|e|e.to_string())?;
    let root=process::tool_path(&fs::canonicalize(temp.path()).map_err(|e|e.to_string())?);
    let manager=Manager::new(root.join("tools"));let report:Report=Arc::new(|_|{});
    for id in ["jdk","jdtls","java-debug"]{manager.install(id,Arc::new(AtomicBool::new(false)),report.clone()).await?;}
    #[cfg(windows)] manager.install("zig",Arc::new(AtomicBool::new(false)),report).await?;
    let runtime=Runtime::prepare(&manager,Arc::new(AtomicBool::new(false)))?;
    let work=root.join("workspace");fs::create_dir(&work).map_err(|e|e.to_string())?;
    let source=work.join("Solution.java");
    java_harness::prepare(&work,"class Solution {\n public int identity(int[] values) {\n int total=1;\n total+=2;\n return total;\n }\n}\n",r#"{"name":"identity","params":[{"name":"values","type":"integer[]"}],"return":{"type":"integer"}}"#,"[1,2]")?;
    let mut compile=runtime.command(&work,&[],"com.sun.tools.javac.Main")?;
    compile.args(["-encoding","UTF-8","-g","-proc:none","Solution.java","InkLeetNodes.java","InkLeetJson.java","InkLeetHarness.java"]);
    let output=process::compile(compile,Arc::new(AtomicBool::new(false)),Duration::from_secs(120),64*1024)?;
    if output.exit_code!=Some(0){return Err(format!("Java debug compile: {output:?}"));}
    let (command,java_home)=java_debug::prepare(&manager,&work,Arc::new(AtomicBool::new(false)))?;
    let(tx,rx)=mpsc::sync_channel(128);
    let adapter=Arc::new(Client::spawn_dap(command,Arc::new(move|event|{let _=tx.try_send(event);}))?);
    let result=(||->Result<(),String>{
        adapter.request("initialize",json!({"clientID":"inkleet","adapterID":"java","pathFormat":"path","linesStartAt1":true,"columnsStartAt1":true,"supportsRunInTerminalRequest":false}),Duration::from_secs(20))?;
        let running=adapter.clone();let java=java_home.join("bin/java");let cwd=work.clone();
        let launch=std::thread::spawn(move||running.request("launch",json!({"type":"java","request":"launch","mainClass":"InkLeetHarness","javaExec":java,"classPaths":[cwd],"sourcePaths":[cwd],"cwd":cwd,"console":"internalConsole","encoding":"UTF-8","vmArgs":"-Xmx256m","stopOnEntry":false}),Duration::from_secs(45)));
        event(&rx,"initialized")?;
        let points=adapter.request("setBreakpoints",json!({"source":{"path":source},"breakpoints":[{"line":4}]}),Duration::from_secs(15))?;
        if points.pointer("/breakpoints/0").is_none(){return Err(format!("Java breakpoint missing: {points}"));}
        adapter.request("configurationDone",json!({}),Duration::from_secs(10))?;launch.join().map_err(|_|"Java launch worker")??;
        let stopped=event(&rx,"stopped")?;
        let thread=stopped.pointer("/body/threadId").and_then(Value::as_i64).ok_or("Java stopped thread")?;
        let stack=adapter.request("stackTrace",json!({"threadId":thread,"startFrame":0,"levels":10}),Duration::from_secs(10))?;
        if stack.pointer("/stackFrames/0/line").and_then(Value::as_i64)!=Some(4){return Err(format!("Unexpected Java pause: {stack}"));}
        let frame=stack.pointer("/stackFrames/0/id").and_then(Value::as_i64).ok_or("Java stack frame")?;
        let scopes=adapter.request("scopes",json!({"frameId":frame}),Duration::from_secs(10))?;
        let reference=scopes.pointer("/scopes/0/variablesReference").and_then(Value::as_i64).ok_or("Java locals")?;
        let variables=adapter.request("variables",json!({"variablesReference":reference}),Duration::from_secs(10))?;
        let total=|variables:&Value|variables.get("variables").and_then(Value::as_array).and_then(|items|items.iter().find(|v|v["name"]=="total")).and_then(|v|v["value"].as_str()).map(str::to_owned);
        if total(&variables).as_deref()!=Some("1"){return Err(format!("Java initial local wrong: {variables}"));}
        adapter.request("next",json!({"threadId":thread}),Duration::from_secs(10))?;event(&rx,"stopped")?;
        let stack=adapter.request("stackTrace",json!({"threadId":thread,"startFrame":0,"levels":10}),Duration::from_secs(10))?;
        let frame=stack.pointer("/stackFrames/0/id").and_then(Value::as_i64).ok_or("Java stepped frame")?;
        let scopes=adapter.request("scopes",json!({"frameId":frame}),Duration::from_secs(10))?;
        let reference=scopes.pointer("/scopes/0/variablesReference").and_then(Value::as_i64).ok_or("Java stepped locals")?;
        let variables=adapter.request("variables",json!({"variablesReference":reference}),Duration::from_secs(10))?;
        if total(&variables).as_deref()!=Some("3"){return Err(format!("Java local did not change after step: {variables}"));}
        adapter.request("continue",json!({"threadId":thread}),Duration::from_secs(10))?;event(&rx,"terminated")?;
        println!("JAVA_DAP_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"breakpoint":true,"stack":true,"variables":true,"stepOver":true,"continue":true,"termination":true,"loopbackOnly":true,"privateCompiler":true,"originalSourceLine":4,"variableChanged":true}));
        Ok(())
    })();
    if let Err(error)=&result{println!("JAVA_DAP_FAILURE {error}; stderr={}",adapter.stderr());}
    adapter.stop();result
}
