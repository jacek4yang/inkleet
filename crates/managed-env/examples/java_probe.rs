use inkleet_managed_env::{Manager,Report,rpc::Client};
use serde_json::{json,Value};
use std::{path::Path,sync::{Arc,Mutex,atomic::AtomicBool},process::Command,time::{Duration,Instant}};
fn copy_config(from:&Path,to:&Path)->Result<(),String>{
    std::fs::create_dir(to).map_err(|e|e.to_string())?;
    for entry in std::fs::read_dir(from).map_err(|e|e.to_string())?{
        let entry=entry.map_err(|e|e.to_string())?;let meta=entry.file_type().map_err(|e|e.to_string())?;
        if meta.is_symlink(){return Err("Configuration link rejected".into());}
        let dest=to.join(entry.file_name());
        if meta.is_dir(){copy_config(&entry.path(),&dest)?;}else if meta.is_file(){std::fs::copy(entry.path(),dest).map_err(|e|e.to_string())?;}
    }
    Ok(())
}
#[tokio::main]async fn main()->Result<(),String>{
    let temp=tempfile::Builder::new().prefix("inkleet java 语言 ").tempdir().map_err(|e|e.to_string())?;
    let root=std::fs::canonicalize(temp.path()).map_err(|e|e.to_string())?;
    let manager=Manager::new(root.join("tools"));let report:Report=Arc::new(|_|{});
    let java=manager.install("jdk",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    let launcher=manager.install("jdtls",Arc::new(AtomicBool::new(false)),report).await?;
    let java_home=java.parent().and_then(Path::parent).ok_or("Java root")?;
    let jdt_home=launcher.parent().and_then(Path::parent).ok_or("JDTLS root")?;
    let config_name=if cfg!(target_os="macos"){"config_mac"}else if cfg!(windows){"config_win"}else{"config_linux"};
    let config=root.join("configuration");copy_config(&jdt_home.join(config_name),&config)?;
    let work=root.join("workspace");std::fs::create_dir(&work).map_err(|e|e.to_string())?;
    let source=work.join("Main.java");
    let doc="import java.util.ArrayList;\nclass Main {\nvoid example() {\nArrayList<String> names = new ArrayList<>();\nnames.add(\"x\");\nnames.\n}\n}\n";
    std::fs::write(&source,doc).map_err(|e|e.to_string())?;
    let uri=reqwest::Url::from_file_path(&source).map_err(|_|"source URI")?.to_string();
    let root_uri=reqwest::Url::from_directory_path(&work).map_err(|_|"workspace URI")?.to_string();
    let mut command=Command::new(&java);
    command.args(["-Xms64m","-Xmx512m","-Djava.awt.headless=true","-Dfile.encoding=UTF-8","-Declipse.application=org.eclipse.jdt.ls.core.id1","-Dosgi.bundles.defaultStartLevel=4","-Declipse.product=org.eclipse.jdt.ls.core.product","--add-modules=ALL-SYSTEM","--add-opens","java.base/java.util=ALL-UNNAMED","--add-opens","java.base/java.lang=ALL-UNNAMED"])
        .arg("-jar").arg(&launcher).arg("-configuration").arg(&config).arg("-data").arg(root.join("jdt-data"))
        .current_dir(&work).env_clear().env("PATH",java.parent().unwrap()).env("JAVA_HOME",java_home)
        .env("HOME",&work).env("USERPROFILE",&work).env("TMP",&work).env("TEMP",&work).env("LANG","C.UTF-8").env("LC_ALL","C.UTF-8");
    if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
    let settings=json!({"java":{"home":java_home,"autobuild":{"enabled":false},"import":{"maven":{"enabled":false},"gradle":{"enabled":false}},"configuration":{"runtimes":[{"name":"JavaSE-25","path":java_home,"default":true}],"updateBuildConfiguration":"disabled"},"project":{"referencedLibraries":[]}}});
    let notices=Arc::new(Mutex::new(Vec::<String>::new()));let events=notices.clone();
    let client=Client::spawn(command,settings.clone(),Arc::new(move|event|{
        if matches!(event.get("method").and_then(Value::as_str),Some("window/logMessage"|"window/showMessage"|"language/status")){
            if let Ok(mut messages)=events.lock(){if messages.len()<20{messages.push(event.to_string().chars().take(1000).collect());}}
        }
    }))?;
    let result=(||->Result<(),String>{
        client.request("initialize",json!({"processId":null,"rootUri":root_uri,"workspaceFolders":[{"uri":root_uri,"name":"InkLeet Java"}],"initializationOptions":{"settings":settings,"workspaceFolders":[root_uri],"extendedClientCapabilities":{"classFileContentsSupport":true}},"capabilities":{"workspace":{"configuration":true,"workspaceFolders":true},"textDocument":{"hover":{"contentFormat":["plaintext"]},"completion":{"completionItem":{"snippetSupport":false}},"publishDiagnostics":{"versionSupport":true}}}}),Duration::from_secs(90))?;
        client.notify("initialized",json!({}))?;
        client.notify("textDocument/didOpen",json!({"textDocument":{"uri":uri,"languageId":"java","version":1,"text":doc}}))?;
        let deadline=Instant::now()+Duration::from_secs(90);
        loop{
            let hover=client.request("textDocument/hover",json!({"textDocument":{"uri":uri},"position":{"line":4,"character":2}}),Duration::from_secs(15))?;
            if hover.to_string().contains("ArrayList"){break;}
            if Instant::now()>deadline{return Err(format!("Java hover unavailable: {hover}"));}
            std::thread::sleep(Duration::from_millis(500));
        }
        let completion=client.request("textDocument/completion",json!({"textDocument":{"uri":uri},"position":{"line":5,"character":6}}),Duration::from_secs(20))?;
        let items=completion.as_array().or_else(||completion.get("items").and_then(Value::as_array)).ok_or("completion list")?;
        if !items.iter().any(|item|item.get("label").and_then(Value::as_str).is_some_and(|s|s.starts_with("add"))){return Err("Missing Java member completion".into());}
        let definition=client.request("textDocument/definition",json!({"textDocument":{"uri":uri},"position":{"line":3,"character":5}}),Duration::from_secs(20))?;
        if definition.is_null()||definition.as_array().is_some_and(Vec::is_empty){return Err("Missing Java standard library definition".into());}
        println!("JAVA_LSP_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"hover":true,"completion":true,"stdlibDefinition":true,"definition":definition,"systemPathUsed":false}));
        Ok(())
    })();
    if let Err(error)=&result{println!("JAVA_LSP_FAILURE {error}; stderr={}; notices={:?}",client.stderr(),notices.lock().ok());}
    let _=client.request("shutdown",Value::Null,Duration::from_secs(5));client.stop();
    result
}
