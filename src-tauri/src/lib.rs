mod storage;
mod managed;
mod lsp;
mod lsp_document;
mod lsp_launch;
mod lsp_native;
mod local_run;
mod compiled_runtime;
mod debugger;
mod debug_launch;
mod leetcode;
mod auth;
mod cache;
mod judge_transport;
mod journal;
mod judge;
use std::{path::PathBuf, sync::Mutex};
use tauri::Manager;

struct Store { root: PathBuf, gate: Mutex<()> }
#[derive(serde::Serialize)]
struct Document { code: Option<String>, notes: Option<String> }

fn check_origin(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "无法验证来源")?;
    let local = url.scheme() == "tauri" || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"));
    #[cfg(debug_assertions)]
    let local = local || (url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1")));
    if window.label() != "main" || !local { return Err("拒绝非本地工作台请求".into()); }
    Ok(())
}

#[tauri::command]
async fn load_document(window: tauri::WebviewWindow, state: tauri::State<'_, Store>, problem: String, language: String) -> Result<Document, String> {
    check_origin(&window)?;
    let code = storage::file_path(&state.root, &problem, &language, "code")?;
    let notes = storage::file_path(&state.root, &problem, &language, "notes")?;
    tauri::async_runtime::spawn_blocking(move || Ok(Document {
        code: storage::read(&code)?, notes: storage::read(&notes)?,
    })).await.map_err(|_| "读取任务中断".to_string())?
}

#[tauri::command]
async fn save_text(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, Store>, problem: String, language: String, kind: String, text: String, expected: Option<String>) -> Result<(), String> {
    check_origin(&window)?;
    let path = storage::file_path(&state.root, &problem, &language, &kind)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _lock = state.gate.lock().map_err(|_| "保存队列不可用")?;
        storage::save(&path, expected.as_deref(), &text)
    }).await.map_err(|_| "保存任务中断".to_string())?
}

#[tauri::command]
async fn open_login(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    check_origin(&window)?; auth::open(&app)
}
#[tauri::command]
async fn verify_login(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<leetcode::Identity, String> {
    check_origin(&window)?; auth::finish(app).await
}
#[tauri::command]
async fn cancel_login(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    check_origin(&window)?; auth::cancel(&app)
}
#[tauri::command]
async fn login_status(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Option<leetcode::Identity>, String> {
    check_origin(&window)?; auth::status(&app)
}

#[tauri::command]
async fn search_questions(window: tauri::WebviewWindow, keyword: String, offset: u32) -> Result<leetcode::QuestionList, String> {
    check_origin(&window)?;
    leetcode::Leetcode::new()?.search(&keyword, offset).await
}
#[tauri::command]
async fn get_question(window: tauri::WebviewWindow, app: tauri::AppHandle, slug: String) -> Result<FetchedQuestion, String> {
    check_origin(&window)?;
    match leetcode::Leetcode::new()?.question(&slug).await {
        Ok(question) => tauri::async_runtime::spawn_blocking(move || {
            let cache_warning = app.state::<cache::Cache>().save(&question).err();
            FetchedQuestion { question, cache_warning, from_cache: false }
        }).await.map_err(|_| "题目缓存任务中断".into()),
        Err(network_error) => tauri::async_runtime::spawn_blocking(move || {
            let items = app.state::<cache::Cache>().load().map_err(|_| format!("{network_error}；本机题面缓存也不可用，未改动草稿"))?;
            if let Some(question) = items.into_iter().find(|q| q.title_slug == slug) {
                Ok(FetchedQuestion { question, cache_warning: Some(format!("无法更新题面，已打开本机公开缓存：{network_error}")), from_cache: true })
            } else {
                Err(network_error)
            }
        }).await.map_err(|_| "题目缓存读取任务中断".to_string())?,
    }
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FetchedQuestion { question: leetcode::Question, cache_warning: Option<String>, from_cache: bool }
#[tauri::command]
async fn load_recent_questions(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Vec<leetcode::Question>, String> {
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<cache::Cache>().load())
        .await.map_err(|_| "题目缓存读取中断".to_string())?
}

#[tauri::command]
async fn start_judge(window: tauri::WebviewWindow, app: tauri::AppHandle, snapshot: judge_transport::Snapshot) -> Result<journal::Record, String> {
    check_origin(&window)?; judge::start(app, snapshot).await
}
#[tauri::command]
async fn check_judge(window: tauri::WebviewWindow, app: tauri::AppHandle, account: String, id: String) -> Result<journal::Record, String> {
    check_origin(&window)?; judge::check(app, account, id).await
}
#[tauri::command]
async fn list_judgements(window: tauri::WebviewWindow, app: tauri::AppHandle, account: String) -> Result<Vec<journal::Record>, String> {
    check_origin(&window)?; judge::list(app, account).await
}
#[tauri::command]
async fn acknowledge_unknown_judge(window: tauri::WebviewWindow, app: tauri::AppHandle, account: String, id: String, confirmed: bool) -> Result<journal::Record, String> {
    check_origin(&window)?; judge::acknowledge_unknown(app, account, id, confirmed).await
}


#[tauri::command]
async fn environment_status(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<managed::Overview, String> {
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<managed::Environments>().list()).await.map_err(|_| "环境检查任务中断".to_string())?
}
#[tauri::command]
async fn install_environment(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<(), String> {
    check_origin(&window)?; managed::start(app, id).await
}
#[tauri::command]
async fn install_environment_group(window:tauri::WebviewWindow,app:tauri::AppHandle,group:String)->Result<(),String>{
    check_origin(&window)?;managed::start_group(app,group).await
}
#[tauri::command]
async fn cancel_environment_install(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<(), String> {
    check_origin(&window)?; app.state::<managed::Environments>().cancel(&id)
}


#[tauri::command]
async fn start_language_service(window:tauri::WebviewWindow,app:tauri::AppHandle,text:String,language:Option<String>,metadata:Option<String>)->Result<lsp::Started,String>{
    check_origin(&window)?;lsp::start(app,text,language.unwrap_or_else(||"python3".into()),metadata).await
}
#[tauri::command]
async fn stop_language_service(window:tauri::WebviewWindow,app:tauri::AppHandle,id:u64)->Result<(),String>{
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move||app.state::<lsp::Services>().stop(id)).await.map_err(|_|"语言服务停止任务中断".to_owned())?
}
#[tauri::command]
async fn update_language_document(window:tauri::WebviewWindow,app:tauri::AppHandle,id:u64,version:u32,text:String)->Result<(),String>{
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move||app.state::<lsp::Services>().update(id,version,text)).await.map_err(|_|"语言服务同步任务中断".to_owned())?
}
#[tauri::command]
async fn language_request(window:tauri::WebviewWindow,app:tauri::AppHandle,id:u64,version:u32,kind:String,line:u32,character:u32,new_name:Option<String>)->Result<serde_json::Value,String>{
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move||app.state::<lsp::Services>().request(id,version,&kind,line,character,new_name)).await.map_err(|_|"语言服务请求任务中断".to_owned())?
}
#[tauri::command]
async fn language_diagnostics(window:tauri::WebviewWindow,app:tauri::AppHandle,id:u64)->Result<serde_json::Value,String>{
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move||app.state::<lsp::Services>().diagnostics(id)).await.map_err(|_|"语言服务诊断任务中断".to_owned())?
}
#[tauri::command]
async fn read_language_source(window:tauri::WebviewWindow,app:tauri::AppHandle,id:u64,uri:String)->Result<lsp::Source,String>{
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move||app.state::<lsp::Services>().read_source(id,&uri)).await.map_err(|_|"源码读取任务中断".to_owned())?
}

#[tauri::command]
async fn start_local_run(window:tauri::WebviewWindow,app:tauri::AppHandle,snapshot:local_run::Snapshot)->Result<u64,String>{
    check_origin(&window)?;local_run::start(app,snapshot).await
}
#[tauri::command]
async fn local_run_status(window:tauri::WebviewWindow,app:tauri::AppHandle)->Result<Option<local_run::View>,String>{
    check_origin(&window)?;app.state::<local_run::Runner>().status()
}
#[tauri::command]
async fn cancel_local_run(window:tauri::WebviewWindow,app:tauri::AppHandle,id:u64)->Result<(),String>{
    check_origin(&window)?;app.state::<local_run::Runner>().cancel(id)
}

#[tauri::command]
async fn start_debug(window:tauri::WebviewWindow,app:tauri::AppHandle,snapshot:local_run::Snapshot,lines:Vec<u32>)->Result<u64,String>{
    check_origin(&window)?;debugger::start(app,snapshot,lines).await
}
#[tauri::command]
async fn debug_status(window:tauri::WebviewWindow,app:tauri::AppHandle)->Result<Option<debugger::View>,String>{
    check_origin(&window)?;app.state::<debugger::Debugger>().status()
}
#[tauri::command]
async fn stop_debug(window:tauri::WebviewWindow,app:tauri::AppHandle,id:u64)->Result<(),String>{
    check_origin(&window)?;tauri::async_runtime::spawn_blocking(move||app.state::<debugger::Debugger>().stop(id)).await.map_err(|_|"停止调试任务中断".to_owned())?
}
#[tauri::command]
async fn set_debug_breakpoints(window:tauri::WebviewWindow,app:tauri::AppHandle,id:u64,code:String,lines:Vec<u32>)->Result<(),String>{
    check_origin(&window)?;tauri::async_runtime::spawn_blocking(move||app.state::<debugger::Debugger>().breakpoints(id,&code,lines)).await.map_err(|_|"更新断点任务中断".to_owned())?
}
#[tauri::command]
async fn debug_request(window:tauri::WebviewWindow,app:tauri::AppHandle,id:u64,epoch:u64,kind:String,reference:i64)->Result<serde_json::Value,String>{
    check_origin(&window)?;tauri::async_runtime::spawn_blocking(move||app.state::<debugger::Debugger>().request(id,epoch,&kind,reference)).await.map_err(|_|"调试请求任务中断".to_owned())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Some(result)=compiled_runtime::linker_entry(){
        if let Err(error)=result{eprintln!("{error}");std::process::exit(1);}return;
    }
    tauri::Builder::default()
        .setup(|app| {
            let root = app.path().app_data_dir()?.join("notebook");
            std::fs::create_dir_all(&root)?;
            app.manage(Store { root, gate: Mutex::new(()) });
            app.manage(auth::Auth::default());
            app.manage(debugger::Debugger::new(std::fs::canonicalize(app.path().app_data_dir()?)?.join("debug-sessions")));
            app.manage(local_run::Runner::new(std::fs::canonicalize(app.path().app_data_dir()?)?.join("local-runs")));
            app.manage(lsp::Services::new(std::fs::canonicalize(app.path().app_data_dir()?)?.join("language-workspaces")));
            app.manage(managed::Environments::new(std::fs::canonicalize(app.path().app_data_dir()?)?.join("tools")));
            app.manage(journal::Journal::new(app.path().app_data_dir()?));
            app.manage(judge::Active::default());
            app.manage(cache::Cache::new(app.path().app_cache_dir()?));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![start_debug, debug_status, stop_debug, debug_request, set_debug_breakpoints, start_local_run, local_run_status, cancel_local_run, start_language_service, stop_language_service, update_language_document, language_request, language_diagnostics, read_language_source, environment_status, install_environment, install_environment_group, cancel_environment_install, load_document, save_text, open_login, verify_login, cancel_login, login_status, search_questions, get_question, load_recent_questions, start_judge, check_judge, list_judgements, acknowledge_unknown_judge])
        .build(tauri::generate_context!())
        .expect("InkLeet failed to start")
        .run(|_app,event| {
            if matches!(event,tauri::RunEvent::Exit){inkleet_managed_env::process::shutdown_owned();}
        });
}
