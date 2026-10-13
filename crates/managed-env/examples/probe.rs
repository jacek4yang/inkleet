use inkleet_managed_env::{Manager, Report, platform};
use std::{sync::{Arc, atomic::AtomicBool}, time::Duration};
#[tokio::main]
async fn main() -> Result<(), String> {
    let temp = tempfile::Builder::new().prefix("inkleet managed 环境 ").tempdir().map_err(|e|e.to_string())?;
    let base=std::fs::canonicalize(temp.path()).map_err(|e|e.to_string())?;
    let manager=Manager::new(base.join("tools"));
    let report: Report=Arc::new(|p| { if p.phase!="downloading" { println!("PHASE {}",p.phase); } });
    let python=manager.install("python",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    let again=manager.install("python",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    assert_eq!(python,again);
    let work=base.join("work");std::fs::create_dir(&work).map_err(|e|e.to_string())?;
    let script="import sys, json, pathlib, inspect, collections, ssl, sqlite3; assert sys.flags.isolated; assert sys.version_info[:2] == (3,14); assert pathlib.Path(inspect.getsourcefile(collections)).is_file(); print(json.dumps({'version':sys.version.split()[0],'stdlibSource':True,'ssl':ssl.OPENSSL_VERSION,'sqlite':sqlite3.sqlite_version}))";
    let mut command=tokio::process::Command::new(&python);
    command.args(["-I","-c",script]).current_dir(&work).env_clear().env("HOME",&work).env("USERPROFILE",&work).env("TEMP",&work).env("TMP",&work).env("PATH",python.parent().unwrap()).kill_on_drop(true);
    if let Some(root)=std::env::var_os("SystemRoot"){command.env("SystemRoot",root);}
    let result=tokio::time::timeout(Duration::from_secs(30),command.output()).await.map_err(|_|"private python timed out")?.map_err(|e|e.to_string())?;
    if !result.status.success(){return Err(format!("private python failed: {}",String::from_utf8_lossy(&result.stderr)));}
    let pyright=manager.install("pyright",Arc::new(AtomicBool::new(false)),report).await?;
    assert!(pyright.is_file());
    let node=manager.install("node",Arc::new(AtomicBool::new(false)),Arc::new(|_|{})).await?;
    let workspace=work.clone();let python_path=python.clone();
    let lsp=tokio::task::spawn_blocking(move || -> Result<serde_json::Value,String> {
        use inkleet_managed_env::rpc::Client;
        use serde_json::json;
        let mut command=std::process::Command::new(&node);
        command.arg(&pyright).arg("--stdio").current_dir(&workspace).env_clear()
            .env("PATH",node.parent().unwrap()).env("HOME",&workspace).env("USERPROFILE",&workspace)
            .env("TEMP",&workspace).env("TMP",&workspace);
        if let Some(root)=std::env::var_os("SystemRoot"){command.env("SystemRoot",root);}
        let settings=json!({"pythonPath":python_path,"analysis":{"typeCheckingMode":"basic","autoSearchPaths":false,"useLibraryCodeForTypes":true}});
        let client=Client::spawn(command,settings.clone(),Arc::new(|_|{}))?;
        let uri=reqwest::Url::from_directory_path(&workspace).map_err(|_|"workspace URI")?.to_string();
        let initialized=client.request("initialize",json!({"processId":null,"rootUri":uri,"capabilities":{"general":{"positionEncodings":["utf-16"]},"textDocument":{"hover":{"contentFormat":["plaintext"]},"completion":{"completionItem":{"snippetSupport":false}}},"workspaceFolders":[{"uri":uri,"name":"InkLeet"}]}),Duration::from_secs(30))?;
        assert!(initialized.pointer("/capabilities/hoverProvider").is_some());
        client.notify("initialized",json!({}))?;
        client.notify("workspace/didChangeConfiguration",json!({"settings":{"python":settings}}))?;
        let document=reqwest::Url::from_file_path(workspace.join("solution.py")).map_err(|_|"document URI")?.to_string();
        client.notify("textDocument/didOpen",json!({"textDocument":{"uri":document,"languageId":"python","version":1,"text":"from collections import deque\nitems = deque([1, 2])\nitems.append(3)\nitems.\n"}}))?;
        let hover=client.request("textDocument/hover",json!({"textDocument":{"uri":document},"position":{"line":2,"character":8}}),Duration::from_secs(30))?;
        assert!(!hover.is_null(),"real Pyright hover was empty");
        let completion=client.request("textDocument/completion",json!({"textDocument":{"uri":document},"position":{"line":3,"character":6}}),Duration::from_secs(30))?;
        let items=completion.as_array().or_else(||completion.get("items").and_then(serde_json::Value::as_array)).ok_or("completion result")?;
        assert!(items.iter().any(|v|v.get("label").and_then(serde_json::Value::as_str)==Some("popleft")),"real deque completion missing");
        let definition=client.request("textDocument/definition",json!({"textDocument":{"uri":document},"position":{"line":0,"character":25}}),Duration::from_secs(30))?;
        assert!(!definition.is_null() && definition.as_array().is_none_or(|a|!a.is_empty()),"stdlib declaration missing");
        client.request("shutdown",json!(null),Duration::from_secs(5))?;
        let _=client.notify("exit",json!(null));client.stop();
        Ok(json!({"initialize":true,"hover":true,"completion":true,"stdlibDeclaration":true,"managedNode":true}))
    }).await.map_err(|_|"LSP probe task failed")??;
    println!("MANAGED_ENV_RESULT {}",serde_json::json!({"platform":platform(),"python":serde_json::from_slice::<serde_json::Value>(&result.stdout).map_err(|e|e.to_string())?,"pyrightPackage":true,"lsp":lsp,"systemPathUsed":false,"reinstallIdempotent":true}));
    Ok(())
}
