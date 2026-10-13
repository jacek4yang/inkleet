use inkleet_managed_env::{Manager,Report,process};
use std::{path::{Path,PathBuf},process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
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
#[tokio::main]
async fn main()->Result<(),String>{
    if std::env::var("INKLEET_LINKER_MODE").as_deref()==Ok("1"){
        let mut driver=Command::new(std::env::var_os("INKLEET_ZIG").ok_or("missing private linker")?);
        driver.arg("cc");
        if cfg!(windows){driver.args(["-target","x86_64-windows-gnu"]);}
        let status=driver.args(std::env::args_os().skip(1)).status().map_err(|e|e.to_string())?;
        std::process::exit(status.code().unwrap_or(1));
    }
    let temp=tempfile::Builder::new().prefix("inkleet compiler 空格 ").tempdir().map_err(|e|e.to_string())?;
    let root=process::tool_path(&std::fs::canonicalize(temp.path()).map_err(|e|e.to_string())?);
    let manager=Manager::new(root.join("tools"));let report:Report=Arc::new(|_|{});
    let mut install=std::collections::HashMap::new();
    for id in ["rustc","cargo","rust-std","rust-analyzer-preview","rust-src","zig"]{
        println!("Installing verified {id}");
        install.insert(id,manager.install(id,Arc::new(AtomicBool::new(false)),report.clone()).await?);
    }
    #[cfg(windows)] install.insert("rust-mingw",manager.install("rust-mingw",Arc::new(AtomicBool::new(false)),report.clone()).await?);
    let work=root.join("work");std::fs::create_dir(&work).map_err(|e|e.to_string())?;
    let rustc=install["rustc"].clone();let cargo=install["cargo"].clone();let zig=install["zig"].clone();
    let stdroot=install["rust-std"].parent().unwrap().to_path_buf();
    let rust_lib=rustc.parent().unwrap().parent().unwrap().join("lib");
    #[allow(unused_mut)] let mut paths=vec![rustc.parent().unwrap().to_owned(),rust_lib,cargo.parent().unwrap().to_owned(),zig.parent().unwrap().to_owned()];
    #[cfg(windows)] paths.push(install["rust-mingw"].parent().unwrap().to_owned());
    let version={let mut c=clean(&rustc,&work,&paths);c.arg("--version");checked(c)?};
    let cargo_version={let mut c=clean(&cargo,&work,&paths);c.arg("--version");checked(c)?};
    let ra_version={let mut c=clean(&install["rust-analyzer-preview"],&work,&paths);c.arg("--version");checked(c)?};
    
    let lsp_result=(|| -> Result<(),String> {
    let lsp_work=root.join("language-service");std::fs::create_dir(&lsp_work).map_err(|e|e.to_string())?;
    let cargo_manifest="[package]\nname=\"inkleet_fixture\"\nversion=\"0.0.0\"\nedition=\"2021\"\n[lib]\npath=\"solution.rs\"\n";
    std::fs::write(lsp_work.join("Cargo.toml"),cargo_manifest).map_err(|e|e.to_string())?;
    let doc="pub fn inspect() {\n    let mut numbers = Vec::<i32>::new();\n    numbers.push(1);\n    numbers.\n}\n";
    std::fs::write(lsp_work.join("solution.rs"),doc).map_err(|e|e.to_string())?;
    let source_root=install["rust-src"].parent().and_then(Path::parent).and_then(Path::parent).ok_or("Rust source root")?;
    let mut ra=clean(&install["rust-analyzer-preview"],&lsp_work,&paths);
    ra.env("RUSTC",&rustc).env("CARGO",&cargo).env("CARGO_HOME",lsp_work.join("cargo-home")).env("CARGO_NET_OFFLINE","true")
        .env("RA_LOG","project_model=debug").env("CARGO_ENCODED_RUSTFLAGS",format!("--sysroot\u{1f}{}",stdroot.display())).env("RUST_SRC_PATH",source_root);
    let mut config=serde_json::json!({"linkedProjects":[lsp_work.join("Cargo.toml")],"cargo":{"sysroot":stdroot,"sysrootSrc":source_root,"noDeps":false,"buildScripts":{"enable":false}},"procMacro":{"enable":false},"checkOnSave":false,"cachePriming":{"enable":false},"numThreads":2});
    if cfg!(windows){config["cargo"]["target"]=serde_json::json!("x86_64-pc-windows-gnu");}
    let notices=Arc::new(std::sync::Mutex::new(Vec::<String>::new()));let observed=notices.clone();
    let client=inkleet_managed_env::rpc::Client::spawn(ra,serde_json::json!({"rust-analyzer":config}),Arc::new(move|event|{
        if matches!(event.get("method").and_then(serde_json::Value::as_str),Some("window/logMessage"|"window/showMessage"|"experimental/serverStatus")){
            if let Ok(mut items)=observed.lock(){if items.len()<20{items.push(event.to_string().chars().take(1500).collect());}}
        }
    }))?;
    let uri=reqwest::Url::from_file_path(lsp_work.join("solution.rs")).map_err(|_|"Rust document URI")?.to_string();
    let root_uri=reqwest::Url::from_directory_path(&lsp_work).map_err(|_|"Rust workspace URI")?.to_string();
    client.request("initialize",serde_json::json!({"processId":null,"rootUri":root_uri,"workspaceFolders":[{"uri":root_uri,"name":"InkLeet fixture"}],"initializationOptions":config,"capabilities":{"general":{"positionEncodings":["utf-16"]},"workspace":{"configuration":true},"textDocument":{"hover":{"contentFormat":["plaintext"]},"completion":{"completionItem":{"snippetSupport":false}}}}}),Duration::from_secs(30))?;
    client.notify("initialized",serde_json::json!({}))?;
    client.notify("textDocument/didOpen",serde_json::json!({"textDocument":{"uri":uri,"languageId":"rust","version":1,"text":doc}}))?;
    let deadline=std::time::Instant::now()+Duration::from_secs(90);
    let hover=loop{
        let result=client.request("textDocument/hover",serde_json::json!({"textDocument":{"uri":uri},"position":{"line":2,"character":8}}),Duration::from_secs(10));
        let result=match result{Ok(value)=>value,Err(error) if client.is_alive()&&std::time::Instant::now()<deadline=>{println!("RUST_LSP_WAIT {error}");continue;},Err(error)=>return Err(error)};
        if result.to_string().contains("Vec"){break result;}
        if std::time::Instant::now()>deadline{
            let status=client.request("rust-analyzer/analyzerStatus",serde_json::json!({}),Duration::from_secs(5)).map(|value|value.to_string().chars().take(2000).collect::<String>());
            return Err(format!("Rust hover unavailable; last={result}; status={status:?}; notifications={:?}; diagnostic={}",notices.lock().ok(),client.stderr()));
        }
        std::thread::sleep(Duration::from_millis(300));
    };
    assert!(hover.to_string().contains("Vec"),"unexpected Rust hover: {hover}");
    let completion=client.request("textDocument/completion",serde_json::json!({"textDocument":{"uri":uri},"position":{"line":3,"character":12}}),Duration::from_secs(15))?;
    let items=completion.as_array().or_else(||completion.get("items").and_then(serde_json::Value::as_array)).ok_or("Rust completion list")?;
    println!("RUST_COMPLETION_DIAGNOSTIC {}",serde_json::json!({"count":items.len(),"push":items.iter().enumerate().filter(|(_,item)|item.get("label").and_then(serde_json::Value::as_str).is_some_and(|s|s.starts_with("push"))).take(2).collect::<Vec<_>>()}));
    assert!(items.iter().any(|item|item.get("label").and_then(serde_json::Value::as_str).is_some_and(|s|s.starts_with("push"))),"missing Rust Vec member completion");
    let definition=client.request("textDocument/definition",serde_json::json!({"textDocument":{"uri":uri},"position":{"line":1,"character":23}}),Duration::from_secs(15))?;
    assert!(definition.to_string().contains("file:"),"missing real Rust source definition");
    let _=client.request("shutdown",serde_json::Value::Null,Duration::from_secs(5));client.stop();
    println!("RUST_LSP_RESULT {}",serde_json::json!({"platform":inkleet_managed_env::platform(),"hover":true,"completion":true,"stdlibDefinition":true,"systemPathUsed":false}));

    Ok(())
    })();
    if let Err(error)=&lsp_result{println!("RUST_LSP_FAILURE {error}");}

    let extension=if cfg!(windows){".exe"}else{""};
    for (filename,source,driver) in [
        ("check.c","#include <stdio.h>\nint main(void){printf(\"6\\n\");return 0;}\n","cc"),
        ("check.cpp","#include <vector>\n#include <iostream>\nint main(){std::vector<int> v{1,2,3};int sum=0;for(int x:v)sum+=x;std::cout<<sum<<'\\n';}\n","c++")
    ]{
        let source_path=work.join(filename);std::fs::write(&source_path,source).map_err(|e|e.to_string())?;
        let output=work.join(format!("{filename}-run{extension}"));
        let mut command=clean(&zig,&work,&paths);command.arg(driver);
        if cfg!(windows){command.args(["-target","x86_64-windows-gnu"]);}
        command.arg(&source_path).arg("-o").arg(&output);
        checked(command)?;
        assert_eq!(checked(clean(&output,&work,&paths))?.trim(),"6");
    }
    let rust_source=work.join("check.rs");std::fs::write(&rust_source,"fn main(){let value=std::thread::spawn(||{let v=vec![1,2,3];v.iter().sum::<i32>()}).join().unwrap();assert!(std::panic::catch_unwind(||panic!(\"fixture\")).is_err());println!(\"{}\",value);}\n").map_err(|e|e.to_string())?;
    let output=work.join(format!("check-rust{extension}"));
    let mut command=clean(&rustc,&work,&paths);
    command.arg(&rust_source).arg("--edition=2021").arg("--sysroot").arg(&stdroot)
        .arg("-C").arg(format!("linker={}",std::env::current_exe().map_err(|e|e.to_string())?.display()))
        .args(["-C","linker-flavor=gcc"]).arg("-o").arg(&output)
        .env("INKLEET_LINKER_MODE","1").env("INKLEET_ZIG",&zig);
    if cfg!(windows){
        command.args(["--target","x86_64-pc-windows-gnu"]);
        let mingw_target=install["rust-mingw"].parent().and_then(Path::parent).and_then(Path::parent).ok_or("Rust MinGW layout")?;
        command.arg("-L").arg(format!("native={}",mingw_target.join("lib/self-contained").display()));
    }
    checked(command)?;
    assert_eq!(checked(clean(&output,&work,&paths))?.trim(),"6");
    println!("COMPILER_RESULT {}",serde_json::json!({"platform":inkleet_managed_env::platform(),"rust":version.trim(),"cargo":cargo_version.trim(),"rustAnalyzer":ra_version.trim(),"rustCompileRun":true,"cCompileRun":true,"cppCompileRun":true,"systemPathUsed":false,"stdlibSource":install["rust-src"].is_file()}));
    lsp_result
}
