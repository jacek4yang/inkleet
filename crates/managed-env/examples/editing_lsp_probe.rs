//! Real private adapters through the application's launch/configuration/normalizers.
//! Protocol timings are not GUI input latency or IME qualification.
#![allow(dead_code,unexpected_cfgs)]
#[path="../../../src-tauri/src/lsp_launch.rs"] mod lsp_launch;
#[path="../../../src-tauri/src/lsp_native.rs"] mod lsp_native;
#[path="../../../src-tauri/src/lsp_document.rs"] mod lsp_document;
#[path="../../../src-tauri/src/lsp_actions.rs"] mod lsp_actions;
#[path="../../../src-tauri/src/completion_cache.rs"] mod completion_cache;
use inkleet_managed_env::{Manager,Report,rpc::Client};
use serde_json::{json,Value};
use std::{path::Path,sync::{Arc,atomic::AtomicBool},time::{Duration,Instant}};
fn request(client:&Client,method:&str,params:Value)->Result<Value,String>{client.request(method,params,Duration::from_secs(20))}
fn items(value:&Value)->Option<&Vec<Value>>{value.as_array().or_else(||value.get("items").and_then(Value::as_array))}
fn completion(client:&Client,uri:&str,line:u32,col:u32,label:&str)->Result<Value,String>{
    let deadline=Instant::now()+Duration::from_secs(90);
    loop{
        let result=request(client,"textDocument/completion",json!({"textDocument":{"uri":uri},"position":{"line":line,"character":col},"context":{"triggerKind":1}}))?;
        if let Some(item)=items(&result).and_then(|items|items.iter().find(|item|item.get("filterText").or_else(||item.get("label")).and_then(Value::as_str).is_some_and(|s|s.trim()==label || s.trim().starts_with(&format!("{label}("))))){return Ok(item.clone());}
        if Instant::now()>deadline{return Err(format!("missing real {label} candidate: {result}"));}
        std::thread::sleep(Duration::from_millis(300));
    }
}
// Exercise the same initial-list mapping/cache order as Services::request for
// every selected real candidate, not just a raw wire item sent straight to resolve.
fn mapped_completion(client:&Client,original:&Value,language:&str,text:&str,prefix:u32,version:u32,can_resolve:bool)->Result<(Value,Value),String>{
    let mut cache=completion_cache::CompletionCache::default();
    let mut initial=json!([original.clone()]);
    if can_resolve{cache.remember(&mut initial,version,u64::from(version));}
    lsp_document::completion_response(language,&mut initial,prefix,text);
    if initial.as_array().is_none_or(|items|items.is_empty()){return Err(format!("{language} candidate removed from initial completion list: {original}"));}
    if !can_resolve{return Ok((original.clone(),initial));}
    let token=initial.pointer("/0/_inkleetCompletion").and_then(Value::as_u64).ok_or("initial completion lost resolve token")?;
    let retained=cache.get(token,version)?;
    if retained!=*original{return Err("initial mapping changed cached server item".into());}
    let resolved=request(client,"completionItem/resolve",retained)?;
    completion_cache::validate_resolved(original,&resolved)?;
    let mut mapped=json!([resolved.clone()]);
    lsp_document::completion_response(language,&mut mapped,prefix,text);
    if mapped.as_array().is_none_or(|items|items.is_empty()){return Err(format!("{language} resolved completion touches helper code: {resolved}"));}
    Ok((resolved,mapped))
}
fn apply(text:&str,edits:&Value)->Result<String,String>{inkleet_managed_env::format_edits::apply(text,0,edits)}
fn probe(manager:&Manager,root:&Path,language:&str)->Result<(),String>{
    let work=root.join(language);std::fs::create_dir(&work).map_err(|e|e.to_string())?;
    let launch=lsp_launch::prepare(manager,&work,language)?;
    let uri=reqwest::Url::from_file_path(work.join(launch.filename)).map_err(|_|"source uri")?.to_string();
    let root_uri=reqwest::Url::from_directory_path(&work).map_err(|_|"workspace uri")?.to_string();
    let client=Client::spawn(launch.command,launch.settings.clone(),Arc::new(|_|{}))?;
    let result=(||->Result<(),String>{
        let profile=lsp_launch::completion_capabilities(language);
        let initialized=request(&client,"initialize",json!({"processId":null,"rootUri":root_uri,"workspaceFolders":[{"uri":root_uri,"name":"InkLeet"}],"initializationOptions":launch.initialization,"capabilities":{"general":{"positionEncodings":["utf-16"]},"workspace":{"configuration":true,"workspaceFolders":true},"textDocument":{"completion":profile,"codeAction":lsp_actions::capabilities(),"publishDiagnostics":{"versionSupport":true}}}}))?;
        let can_resolve=initialized["capabilities"]["completionProvider"]["resolveProvider"]==true;
        if language!="golang"&&!can_resolve{return Err(format!("{language} does not advertise completion resolve"));}
        client.notify("initialized",json!({}))?;
        client.notify("workspace/didChangeConfiguration",json!({"settings":if language=="python3"{json!({"python":launch.settings})}else{launch.settings}}))?;
        let (text,line,col,label)=match language{
            "rust"=>("fn example() {\n    let _map = HashM\n}\n",1,20,"HashMap"),
            "golang"=>("func example() {\n    fmt.Prin\n}\n",1,12,"Println"),
            "python3"=>("from pathlib import Path\npath = Path('.')\npath.exi\n",2,8,"exists"),
            _=>return Err("unsupported probe".into())
        };
        let context=inkleet_managed_env::lsp_scaffold::Context::parse(Some(r#"{"params":[],"inkleetFunctionStyle":"free"}"#))?;
        let (wrapped,prefix)=lsp_document::contextual_source(language,text,&context);
        std::fs::write(work.join(launch.filename),&wrapped).map_err(|e|e.to_string())?;
        client.notify("textDocument/didOpen",json!({"textDocument":{"uri":uri,"languageId":launch.language_id,"version":1,"text":wrapped}}))?;
        let original=completion(&client,&uri,line+prefix,col,label)?;
        let (resolved,mapped)=mapped_completion(&client,&original,language,text,prefix,1,can_resolve)?;
        if language=="rust" || language=="golang" {
            let imports=mapped[0]["additionalTextEdits"].as_array().ok_or("expected actual autoimport edit")?;
            let needle=if language=="rust"{"std::collections::HashMap"}else{"\"fmt\""};
            if !imports.iter().any(|e|e["newText"].as_str().is_some_and(|s|s.contains(needle))){return Err(format!("missing actual {language} autoimport: {resolved}"));}
        }
        println!("EDITING_COMPLETION_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"language":language,"label":label,"actualAdapter":true,"resolve":can_resolve,"sourceMapping":true,"initialMappedCandidate":true,"originalWireItemRetained":can_resolve,"autoimport":language!="python3","parameterSnippet":original["insertTextFormat"]==2}));
        if language=="python3" {
            let text="path = PurePa\n";
            let (wrapped,prefix)=lsp_document::contextual_source(language,text,&context);
            client.notify("textDocument/didChange",json!({"textDocument":{"uri":uri,"version":2},"contentChanges":[{"text":wrapped}]}))?;
            let original=completion(&client,&uri,prefix,13,"PurePath")?;
            let (resolved,mapped)=mapped_completion(&client,&original,language,text,prefix,2,can_resolve)?;
            if !mapped[0]["additionalTextEdits"].as_array().is_some_and(|items|items.iter().any(|e|e["newText"].as_str().is_some_and(|s|s.contains("from pathlib import PurePath")))){return Err(format!("Python autoimport missing: {resolved}"));}
            println!("EDITING_PYTHON_AUTOIMPORT_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"resolve":true,"helperPrefix":prefix,"initialMappedCandidate":true,"originalWireItemRetained":true,"additionalTextEdits":mapped[0]["additionalTextEdits"]}));
        }
        if language=="rust" {
            let text="fn example() {\n    let value = (1 + 2) * 3;\n    let _ = value;\n}\n";
            let (wrapped,prefix)=lsp_document::contextual_source(language,text,&context);
            client.notify("textDocument/didChange",json!({"textDocument":{"uri":uri,"version":2},"contentChanges":[{"text":wrapped}]}))?;
            let deadline=Instant::now()+Duration::from_secs(30);let start=Instant::now();
            let (original,normalized)=loop{
                let response=request(&client,"textDocument/codeAction",json!({"textDocument":{"uri":uri},"range":{"start":{"line":prefix+1,"character":17},"end":{"line":prefix+1,"character":22}},"context":{"diagnostics":[],"only":["quickfix","refactor"],"triggerKind":1}}))?;
                let can_resolve=initialized["capabilities"]["codeActionProvider"]["resolveProvider"]==true;
                let mut cache=lsp_actions::Cache::default();
                let actions=cache.remember(&response,2,1,can_resolve,&uri,prefix,text)?;
                if let Some(item)=actions.as_array().and_then(|items|items.iter().find(|a|a["title"].as_str().is_some_and(|s|s.to_ascii_lowercase().contains("extract")&&s.to_ascii_lowercase().contains("variable")))){
                    let original=cache.get(item["token"].as_u64().unwrap(),2)?;
                    let resolved=if original.get("edit").is_some(){original.clone()}else{request(&client,"codeAction/resolve",original.clone())?};
                    lsp_actions::validate_resolved(&original,&resolved)?;
                    let normalized=lsp_actions::normalize(&resolved,&uri,prefix,text,2).map_err(|error|format!("{error}; owned fixture URI={uri}; resolved fixture action={resolved}"))?;
                    let targets=resolved.pointer("/edit/documentChanges").and_then(Value::as_array).map(|changes|changes.iter().filter_map(|change|change.pointer("/textDocument/uri").and_then(Value::as_str)).collect::<Vec<_>>()).unwrap_or_default();
                    println!("EDITING_RUST_ACTION_URI_EVIDENCE {}",json!({"platform":inkleet_managed_env::platform(),"ownedUri":uri,"returnedUris":targets,"ownershipPolicy":"exact-uri-or-same-canonical-regular-file"}));
                    break(original,normalized);
                }
                if Instant::now()>deadline{return Err(format!("missing safe Rust extract-variable action: {response}"));}
                std::thread::sleep(Duration::from_millis(300));
            };
            let changed=apply(text,&normalized)?;
            if changed==text||!changed.contains("1 + 2"){return Err(format!("invalid extraction: {changed}"));}
            println!("EDITING_RUST_ACTION_RESULT {}",json!({"platform":inkleet_managed_env::platform(),"title":original["title"],"sourceOnly":true,"resolved":true,"sourceBefore":text,"sourceAfter":changed,"protocolElapsedMs":start.elapsed().as_millis(),"guiLatencyQualified":false}));
        }
        Ok(())
    })();
    if let Err(error)=&result{eprintln!("EDITING_LSP_FAILURE {language}: {error}; stderr={}",client.stderr());}
    let _=request(&client,"shutdown",Value::Null);client.stop();result
}
#[tokio::main]async fn main()->Result<(),String>{
    let temp=tempfile::Builder::new().prefix("inkleet editing 语言 ").tempdir().map_err(|e|e.to_string())?;
    let root=inkleet_managed_env::process::tool_path(&std::fs::canonicalize(temp.path()).map_err(|e|e.to_string())?);
    let toolroot=std::env::var_os("INKLEET_PROBE_TOOLS").map(std::path::PathBuf::from).unwrap_or_else(||root.join("tools"));
    let manager=Manager::new(toolroot);let report:Report=Arc::new(|p|{if p.phase!="downloading"{println!("EDITING_INSTALL {}",p.phase);}});
    let chosen=std::env::var("INKLEET_PROBE_LANGUAGE").unwrap_or_else(|_|"all".into());
    for (language,tools) in [("rust",vec!["rustc","cargo","rust-std","rust-src","rust-analyzer-preview"]),("golang",vec!["go","gopls"]),("python3",vec!["python","node","pyright"])] {
        if chosen!="all"&&chosen!=language{continue;}
        for id in tools{manager.install(id,Arc::new(AtomicBool::new(false)),report.clone()).await?;}
        probe(&manager,&root,language)?;
    }
    Ok(())
}
