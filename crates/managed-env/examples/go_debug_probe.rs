use inkleet_managed_env::{Manager,Report,process,harness,rpc::Client};
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
    harness::prepare_go(&work,"func identity(values []int) int {\n total:=1\n total+=2\n return total\n}\n",r#"{"name":"identity","params":[{"name":"values","type":"integer[]"}],"return":{"type":"integer"}}"#,"[1,2]")?;
    let binary=work.join(if cfg!(windows){"solution.exe"}else{"solution"});
    let mut compile=Command::new(&go);environment(&mut compile,&go,&work);
    compile.args(["build","-gcflags=all=-N -l","-buildvcs=false","-o"]).arg(&binary).args(["solution.go","nodes.go","harness.go"]);
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
        let points=adapter.request("setBreakpoints",json!({"source":{"path":source},"breakpoints":[{"line":3}]}),Duration::from_secs(15))?;
        if points.pointer("/breakpoints/0/verified").and_then(Value::as_bool)!=Some(true){return Err(format!("Go breakpoint unverified: {points}"));}
        adapter.request("configurationDone",json!({}),Duration::from_secs(10))?;launch.join().map_err(|_|"Go launch worker")??;
        let stopped=event(&rx,"stopped")?;
        let thread=stopped.pointer("/body/threadId").and_then(Value::as_i64).ok_or("Go stopped thread")?;
        let stack=adapter.request("stackTrace",json!({"threadId":thread,"startFrame":0,"levels":10}),Duration::from_secs(10))?;
        if stack.pointer("/stackFrames/0/line").and_then(Value::as_i64)!=Some(3){return Err(format!("Unexpected Go pause: {stack}"));}
        let frame=stack.pointer("/stackFrames/0/id").and_then(Value::as_i64).ok_or("Go stack frame")?;
        let scopes=adapter.request("scopes",json!({"frameId":frame}),Duration::from_secs(10))?;
        let reference=scopes.pointer("/scopes/0/variablesReference").and_then(Value::as_i64).ok_or("Go locals")?;
        let variables=adapter.request("variables",json!({"variablesReference":reference}),Duration::from_secs(10))?;
        let total=|variables:&Value|variables.get("variables").and_then(Value::as_array).and_then(|items|items.iter().find(|v|v["name"]=="total")).and_then(|v|v["value"].as_str()).map(str::to_owned);
        if total(&variables).as_deref()!=Some("1"){return Err(format!("Go initial local wrong: {variables}"));}
        adapter.request("next",json!({"threadId":thread}),Duration::from_secs(10))?;event(&rx,"stopped")?;
        let stack=adapter.request("stackTrace",json!({"threadId":thread,"startFrame":0,"levels":10}),Duration::from_secs(10))?;
        let frame=stack.pointer("/stackFrames/0/id").and_then(Value::as_i64).ok_or("Go stepped frame")?;
        let scopes=adapter.request("scopes",json!({"frameId":frame}),Duration::from_secs(10))?;
        let reference=scopes.pointer("/scopes/0/variablesReference").and_then(Value::as_i64).ok_or("Go stepped locals")?;
        let variables=adapter.request("variables",json!({"variablesReference":reference}),Duration::from_secs(10))?;
        if total(&variables).as_deref()!=Some("3"){return Err(format!("Go local did not change after step: {variables}"));}
        adapter.request("continue",json!({"threadId":thread}),Duration::from_secs(10))?;event(&rx,"terminated")?;
        println!("GO_DAP_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"breakpoint":true,"stack":true,"variables":true,"stepOver":true,"continue":true,"termination":true,"loopbackOnly":true,"privateCompiler":true,"originalSourceLine":3,"variableChanged":true}));
        Ok(())
    })();
    if let Err(error)=&result{println!("GO_DAP_FAILURE {error}; stderr={}",adapter.stderr());}
    adapter.stop();result
}
