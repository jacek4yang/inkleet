use inkleet_managed_env::{Manager,Report,process,rpc::Client};
use serde_json::{json,Value};
use std::{fs,path::Path,process::Command,sync::{Arc,atomic::AtomicBool,mpsc},time::{Duration,Instant}};
fn environment(command:&mut Command,go:&Path,root:&Path){
    let tmp=root.join("temp");fs::create_dir_all(&tmp).unwrap();
    command.current_dir(root).env_clear().env("PATH",go.parent().unwrap()).env("GOROOT",go.parent().unwrap().parent().unwrap())
        .env("HOME",root).env("USERPROFILE",root).env("TMP",&tmp).env("TEMP",&tmp).env("TMPDIR",&tmp)
        .env("APPDATA",&tmp).env("LOCALAPPDATA",&tmp).env("GOENV","off").env("GOWORK","off").env("GOTOOLCHAIN","local")
        .env("CGO_ENABLED","0").env("GOPROXY","off").env("GOSUMDB","off").env("GOTELEMETRY","off")
        .env("GOCACHE",root.parent().unwrap().join("go-cache")).env("GOPATH",root.join("go-path"));
    if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
}

fn event(rx:&mpsc::Receiver<Value>,name:&str)->Result<Value,String>{
    let deadline=Instant::now()+Duration::from_secs(30);
    loop{let remaining=deadline.saturating_duration_since(Instant::now());let value=rx.recv_timeout(remaining).map_err(|_|format!("Go DAP {name} event timeout"))?;
        if value.get("event").and_then(Value::as_str)==Some(name){return Ok(value);}}
}
#[tokio::main]async fn main()->Result<(),String>{
    let temp=tempfile::Builder::new().prefix("inkleet go 调试 ").tempdir().map_err(|e|e.to_string())?;
    let root=process::tool_path(&fs::canonicalize(temp.path()).map_err(|e|e.to_string())?);
    let manager=Manager::new(root.join("tools"));let report:Report=Arc::new(|_|{});
    let go=process::tool_path(&manager.install("go",Arc::new(AtomicBool::new(false)),report.clone()).await?);
    let delve=process::tool_path(&manager.install("delve",Arc::new(AtomicBool::new(false)),report).await?);
    let work=root.join("workspace");fs::create_dir(&work).map_err(|e|e.to_string())?;
    let source=work.join("solution.go");
    fs::write(&source,"package main\nimport \"fmt\"\nfunc main(){\n total:=1\n total+=2\n fmt.Println(total)\n}\n").map_err(|e|e.to_string())?;
    let binary=work.join(if cfg!(windows){"solution.exe"}else{"solution"});
    let mut compile=Command::new(&go);environment(&mut compile,&go,&work);
    compile.args(["build","-gcflags=all=-N -l","-buildvcs=false","-o"]).arg(&binary).arg(&source);
    let output=process::run(compile,Arc::new(AtomicBool::new(false)),Duration::from_secs(120),64*1024)?;
    if output.exit_code!=Some(0){return Err(format!("Go debug compile: {output:?}"));}
    let mut command=Command::new(delve);environment(&mut command,&go,&work);
    let(tx,rx)=mpsc::sync_channel(128);
    let adapter=Arc::new(Client::spawn_delve(command,Arc::new(move|event|{let _=tx.try_send(event);}))?);
    let result=(||->Result<(),String>{
        adapter.request("initialize",json!({"clientID":"inkleet","adapterID":"go","pathFormat":"path","linesStartAt1":true,"columnsStartAt1":true,"supportsRunInTerminalRequest":false}),Duration::from_secs(20))?;
        let running=adapter.clone();let program=binary.clone();let cwd=work.clone();
        let launch=std::thread::spawn(move||running.request("launch",json!({"type":"go","request":"launch","mode":"exec","program":program,"cwd":cwd,"outputMode":"remote","stopOnEntry":false}),Duration::from_secs(45)));
        event(&rx,"initialized")?;
        let points=adapter.request("setBreakpoints",json!({"source":{"path":source},"breakpoints":[{"line":5}]}),Duration::from_secs(15))?;
        if points.pointer("/breakpoints/0/verified").and_then(Value::as_bool)!=Some(true){return Err(format!("Go breakpoint unverified: {points}"));}
        adapter.request("configurationDone",json!({}),Duration::from_secs(10))?;launch.join().map_err(|_|"Go launch worker")??;
        let stopped=event(&rx,"stopped")?;
        let thread=stopped.pointer("/body/threadId").and_then(Value::as_i64).ok_or("Go stopped thread")?;
        let stack=adapter.request("stackTrace",json!({"threadId":thread,"startFrame":0,"levels":10}),Duration::from_secs(10))?;
        if stack.pointer("/stackFrames/0/line").and_then(Value::as_i64)!=Some(5){return Err(format!("Unexpected Go pause: {stack}"));}
        let frame=stack.pointer("/stackFrames/0/id").and_then(Value::as_i64).ok_or("Go stack frame")?;
        let scopes=adapter.request("scopes",json!({"frameId":frame}),Duration::from_secs(10))?;
        let reference=scopes.pointer("/scopes/0/variablesReference").and_then(Value::as_i64).ok_or("Go locals")?;
        let variables=adapter.request("variables",json!({"variablesReference":reference}),Duration::from_secs(10))?;
        if !variables.to_string().contains("total"){return Err(format!("Go total variable missing: {variables}"));}
        adapter.request("next",json!({"threadId":thread}),Duration::from_secs(10))?;event(&rx,"stopped")?;
        adapter.request("continue",json!({"threadId":thread}),Duration::from_secs(10))?;event(&rx,"terminated")?;
        println!("GO_DAP_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"breakpoint":true,"stack":true,"variables":true,"stepOver":true,"continue":true,"termination":true,"loopbackOnly":true,"privateCompiler":true}));
        Ok(())
    })();
    if let Err(error)=&result{println!("GO_DAP_FAILURE {error}; stderr={}",adapter.stderr());}
    adapter.stop();result
}
