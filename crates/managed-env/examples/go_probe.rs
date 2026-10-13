use inkleet_managed_env::{Manager,Report,rpc::Client};
use serde_json::{json,Value};
use std::{path::Path,process::Command,sync::{Arc,atomic::AtomicBool},time::{Duration,Instant}};
#[tokio::main]async fn main()->Result<(),String>{
    let temp=tempfile::Builder::new().prefix("inkleet go 语言 ").tempdir().map_err(|e|e.to_string())?;
    let root=inkleet_managed_env::process::tool_path(&std::fs::canonicalize(temp.path()).map_err(|e|e.to_string())?);
    let manager=Manager::new(root.join("tools"));let report:Report=Arc::new(|p|{if p.phase!="downloading"{println!("GO_INSTALL_STAGE {}",p.phase);}});
    let go=manager.install("go",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    let gopls=manager.install("gopls",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    assert_eq!(manager.installed("gopls")?,Some(gopls.clone()));
    let go_home=go.parent().and_then(Path::parent).ok_or("Go root")?;
    let work=root.join("workspace");std::fs::create_dir(&work).map_err(|e|e.to_string())?;
    std::fs::write(work.join("go.mod"),"module inkleet.fixture\n\ngo 1.27.0\n").map_err(|e|e.to_string())?;
    let doc="package fixture\nimport \"strings\"\nfunc example() {\nvar builder strings.Builder\nbuilder.WriteString(\"x\")\nbuilder.\n}\n";
    let source=work.join("solution.go");std::fs::write(&source,doc).map_err(|e|e.to_string())?;
    let uri=reqwest::Url::from_file_path(&source).map_err(|_|"Go source URI")?.to_string();
    let root_uri=reqwest::Url::from_directory_path(&work).map_err(|_|"Go workspace URI")?.to_string();
    let tool_temp=root.join("tool-temp");std::fs::create_dir(&tool_temp).map_err(|e|e.to_string())?;
    let config_home=root.join("tool-config");std::fs::create_dir(&config_home).map_err(|e|e.to_string())?;
    let mut command=Command::new(&gopls);
    command.current_dir(&work).env_clear().env("PATH",go.parent().unwrap()).env("GOROOT",go_home)
        .env("GOTOOLCHAIN","local").env("GOENV","off").env("GOWORK","off").env("CGO_ENABLED","0")
        .env("GOPROXY","off").env("GOSUMDB","off").env("GOTELEMETRY","off")
        .env("GOCACHE",root.join("go-cache")).env("GOPATH",root.join("go-path")).env("GOPLSCACHE",root.join("gopls-cache"))
        .env("HOME",&work).env("USERPROFILE",&work).env("TMP",&tool_temp).env("TEMP",&tool_temp).env("TMPDIR",&tool_temp).env("APPDATA",&config_home).env("LOCALAPPDATA",&config_home);
    if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
    let settings=json!({"staticcheck":false,"usePlaceholders":false,"completeUnimported":true,"buildFlags":["-mod=readonly"]});
    let notices=Arc::new(std::sync::Mutex::new(Vec::<String>::new()));let observed=notices.clone();
    let client=Client::spawn(command,json!({"gopls":settings}),Arc::new(move|value|{
        if matches!(value.get("method").and_then(Value::as_str),Some("window/logMessage"|"window/showMessage")){
            if let Ok(mut items)=observed.lock(){if items.len()<30{items.push(value.to_string().chars().take(2000).collect());}}
        }
    }))?;
    let result=(||->Result<(),String>{
        println!("GO_LSP_STAGE initialize");
        client.request("initialize",json!({"processId":null,"rootUri":root_uri,"workspaceFolders":[{"uri":root_uri,"name":"InkLeet Go"}],"initializationOptions":settings,"capabilities":{"general":{"positionEncodings":["utf-16"]},"workspace":{"configuration":true,"workspaceFolders":true},"textDocument":{"hover":{"contentFormat":["plaintext"]},"completion":{"completionItem":{"snippetSupport":false}}}}}),Duration::from_secs(45))?;
        client.notify("initialized",json!({}))?;
        client.notify("textDocument/didOpen",json!({"textDocument":{"uri":uri,"languageId":"go","version":1,"text":doc}}))?;
        println!("GO_LSP_STAGE hover");
        let deadline=Instant::now()+Duration::from_secs(90);
        loop{
            let hover=client.request("textDocument/hover",json!({"textDocument":{"uri":uri},"position":{"line":4,"character":2}}),Duration::from_secs(15));
            let hover=match hover{Ok(value)=>value,Err(error) if client.is_alive()&&Instant::now()<deadline=>{println!("GO_LSP_WAIT {error}");std::thread::sleep(Duration::from_millis(500));continue;},Err(error)=>return Err(error)};
            if hover.to_string().contains("Builder"){break;}
            if Instant::now()>deadline{return Err(format!("Go hover unavailable: {hover}"));}
            std::thread::sleep(Duration::from_millis(300));
        }
        println!("GO_LSP_STAGE completion");
        let completion=client.request("textDocument/completion",json!({"textDocument":{"uri":uri},"position":{"line":5,"character":8}}),Duration::from_secs(20))?;
        let items=completion.as_array().or_else(||completion.get("items").and_then(Value::as_array)).ok_or("Go completion list")?;
        if !items.iter().any(|item|item.get("label").and_then(Value::as_str).is_some_and(|s|s.starts_with("WriteString"))){return Err("Missing Builder member completion".into());}
        println!("GO_LSP_STAGE definition");
        let definition=client.request("textDocument/definition",json!({"textDocument":{"uri":uri},"position":{"line":3,"character":23}}),Duration::from_secs(15))?;
        let source_uri=definition.pointer("/0/uri").or_else(||definition.get("uri")).and_then(Value::as_str).ok_or("Go source definition")?;
        let path=reqwest::Url::parse(source_uri).map_err(|e|e.to_string())?.to_file_path().map_err(|_|"Go source file")?;
        let canonical=std::fs::canonicalize(&path).map_err(|e|e.to_string())?;
        assert!(canonical.starts_with(std::fs::canonicalize(go_home.join("src")).map_err(|e|e.to_string())?));
        assert!(std::fs::read_to_string(canonical).map_err(|e|e.to_string())?.contains("type Builder struct"));
        println!("GO_LSP_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"privateSourceBuild":true,"hover":true,"completion":true,"stdlibSource":true,"systemPathUsed":false}));
        Ok(())
    })();
    if let Err(error)=&result{println!("GO_LSP_FAILURE {error}; notices={:?}; stderr={}",notices.lock().ok(),client.stderr());}
    let _=client.request("shutdown",Value::Null,Duration::from_secs(5));client.stop();result
}
