mod storage;
mod drafts;
mod solutions;
mod recovery;
mod external;
mod managed;
mod download_settings;
mod editor_settings;
mod lsp;
mod semantic_tokens;
mod completion_cache;
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

struct Store { root: PathBuf, gate: Mutex<()>, draft_versions:Mutex<std::collections::HashMap<PathBuf,u64>> }
#[derive(Default)]struct Formatting(std::sync::atomic::AtomicBool);
#[derive(serde::Serialize)]
#[serde(rename_all="camelCase")]
struct Document { code: Option<String>, notes: Option<String>, code_draft:Option<drafts::Record>, notes_draft:Option<drafts::Record>,draft_warnings:Vec<String> }

fn check_origin(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "无法验证来源")?;
    let local = url.scheme() == "tauri" || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"));
    #[cfg(debug_assertions)]
    let local = local || (url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1")));
    if window.label() != "main" || !local { return Err("拒绝非本地工作台请求".into()); }
    Ok(())
}

#[tauri::command]
async fn load_document(window: tauri::WebviewWindow, state: tauri::State<'_, Store>, problem: String, language: String, solution: Option<String>) -> Result<Document, String> {
    check_origin(&window)?;
    let code = solutions::file_path(&state.root, &problem, &language, "code", solution.as_deref())?;
    let notes = storage::file_path(&state.root, &problem, &language, "notes")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut draft_warnings=Vec::new();
        let code_draft=match drafts::read(&code){Ok(value)=>value,Err(error)=>{draft_warnings.push(error);None}};
        let notes_draft=match drafts::read(&notes){Ok(value)=>value,Err(error)=>{draft_warnings.push(error);None}};
        Ok(Document{code:storage::read(&code)?,notes:storage::read(&notes)?,code_draft,notes_draft,draft_warnings})
    }).await.map_err(|_| "读取任务中断".to_string())?
}

#[tauri::command]
async fn checkpoint_draft(window:tauri::WebviewWindow,app:tauri::AppHandle,problem:String,language:String,solution:Option<String>,kind:String,text:String,baseline:Option<String>,revision:u64)->Result<(),String>{
    check_origin(&window)?;
    if revision==0{return Err("草稿版本无效".into());}
    tauri::async_runtime::spawn_blocking(move||{
        let store=app.state::<Store>();let _gate=store.gate.lock().map_err(|_|"草稿队列不可用")?;
        let path=solutions::file_path(&store.root,&problem,&language,&kind,solution.as_deref())?;
        let mut versions=store.draft_versions.lock().map_err(|_|"草稿版本不可用")?;
        if versions.get(&path).is_some_and(|v|*v>=revision){return Ok(());}
        drafts::write(&path,text,baseline)?;versions.insert(path,revision);Ok(())
    }).await.map_err(|_|"恢复草稿任务中断".to_owned())?
}

#[tauri::command]
async fn save_text(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, Store>, problem: String, language: String, kind: String, text: String, expected: Option<String>, solution: Option<String>) -> Result<(), String> {
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let _lock = state.gate.lock().map_err(|_| "保存队列不可用")?;
        let path = solutions::file_path(&state.root, &problem, &language, &kind, solution.as_deref())?;
        storage::save(&path, expected.as_deref(), &text)
    }).await.map_err(|_| "保存任务中断".to_string())?
}


#[tauri::command]
async fn resolve_file_conflict(window:tauri::WebviewWindow,app:tauri::AppHandle,problem:String,language:String,kind:String,expected:Option<String>,local:String,choice:String,solution:Option<String>)->Result<storage::ResolvedConflict,String>{
    check_origin(&window)?;
    let path=solutions::file_path(&app.state::<Store>().root,&problem,&language,&kind,solution.as_deref())?;
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<Store>();let _lock=state.gate.lock().map_err(|_|"保存队列不可用")?;
        let path=solutions::file_path(&state.root,&problem,&language,&kind,solution.as_deref())?;
        storage::resolve_conflict(&path,expected.as_deref(),&local,&choice)
    }).await.map_err(|_|"冲突处理任务中断".to_owned())?
}


#[tauri::command]
async fn list_recovery(window:tauri::WebviewWindow,app:tauri::AppHandle,problem:String,language:String,kind:String,solution:Option<String>)->Result<recovery::Listing,String>{
    check_origin(&window)?;
    let path=solutions::file_path(&app.state::<Store>().root,&problem,&language,&kind,solution.as_deref())?;
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<Store>();let _lock=state.gate.lock().map_err(|_|"文件队列不可用")?;
        recovery::list(&path)
    }).await.map_err(|_|"恢复列表任务中断".to_owned())?
}
#[tauri::command]
async fn read_recovery(window:tauri::WebviewWindow,app:tauri::AppHandle,problem:String,language:String,kind:String,id:String,solution:Option<String>)->Result<recovery::Record,String>{
    check_origin(&window)?;
    let path=solutions::file_path(&app.state::<Store>().root,&problem,&language,&kind,solution.as_deref())?;
    tauri::async_runtime::spawn_blocking(move||recovery::read(&path,&id)).await.map_err(|_|"恢复预览任务中断".to_owned())?
}
#[tauri::command]
async fn restore_recovery(window:tauri::WebviewWindow,app:tauri::AppHandle,problem:String,language:String,kind:String,id:String,side:String,reviewed:Option<String>,expected:Option<String>,local:String,solution:Option<String>)->Result<storage::ResolvedConflict,String>{
    check_origin(&window)?;
    let path=solutions::file_path(&app.state::<Store>().root,&problem,&language,&kind,solution.as_deref())?;
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<Store>();let _lock=state.gate.lock().map_err(|_|"文件队列不可用")?;
        let path=solutions::file_path(&state.root,&problem,&language,&kind,solution.as_deref())?;
        recovery::restore(&path,&id,&side,reviewed.as_deref(),expected.as_deref(),&local)
    }).await.map_err(|_|"恢复任务中断".to_owned())?
}

#[tauri::command]
fn external_editor_supported(window:tauri::WebviewWindow)->Result<bool,String>{check_origin(&window)?;Ok(external::supported())}
#[tauri::command]
async fn open_note_external(window:tauri::WebviewWindow,app:tauri::AppHandle,problem:String,editor:String)->Result<(),String>{
    check_origin(&window)?;
    if !external::supported()||!matches!(editor.as_str(),"default"|"typora"){return Err("此平台或编辑器不支持外部笔记编辑".into());}
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<Store>();let path=storage::file_path(&state.root,&problem,"rust","notes")?;
        {
            let _lock=state.gate.lock().map_err(|_|"保存队列不可用")?;
            if storage::read(&path)?.is_none(){storage::save(&path,None,"")?;}
        }
        let path=std::fs::canonicalize(path).map_err(|_|"无法定位已保存笔记")?;
        if !path.starts_with(std::fs::canonicalize(&state.root).map_err(|_|"工作区目录不可用")?){return Err("笔记不在本机工作区".into());}
        external::open_note(&path,&editor)
    }).await.map_err(|_|"外部编辑器任务中断".to_owned())?
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
async fn search_questions(window: tauri::WebviewWindow, app: tauri::AppHandle, keyword: String, offset: u32, difficulty: Option<String>, status: Option<String>, account: Option<String>) -> Result<leetcode::QuestionList, String> {
    check_origin(&window)?;
    let api = leetcode::Leetcode::new()?;
    if let Some(account) = account {
        let (credentials, generation) = auth::credentials_for(&app, &account)?;
        let list = api.search_filtered(&keyword,offset,difficulty.as_deref(),status.as_deref(),Some((&credentials.cookie,&credentials.csrf))).await?;
        if !auth::still_current(&app,generation) { return Err("账号已切换，已丢弃旧题目状态".into()); }
        Ok(list)
    } else {
        api.search_filtered(&keyword,offset,difficulty.as_deref(),status.as_deref(),None).await
    }
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
async fn language_completion_resolve(window:tauri::WebviewWindow,app:tauri::AppHandle,id:u64,version:u32,token:u64)->Result<serde_json::Value,String>{
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move||app.state::<lsp::Services>().resolve_completion(id,version,token)).await.map_err(|_|"补全解析任务中断".to_owned())?
}
#[tauri::command]
async fn language_semantic_tokens(window:tauri::WebviewWindow,app:tauri::AppHandle,id:u64,version:u32)->Result<serde_json::Value,String>{
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move||app.state::<lsp::Services>().semantic_tokens(id,version)).await.map_err(|_|"语义分析任务中断".to_owned())?
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


#[tauri::command]
async fn evaluate_debug(window:tauri::WebviewWindow,app:tauri::AppHandle,id:u64,epoch:u64,frame:i64,expression:String)->Result<serde_json::Value,String>{
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move||app.state::<debugger::Debugger>().evaluate(id,epoch,frame,&expression)).await.map_err(|_|"表达式求值任务中断".to_owned())?
}

#[tauri::command]
async fn get_download_settings(window:tauri::WebviewWindow,app:tauri::AppHandle)->Result<download_settings::Snapshot,String>{
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move||app.state::<download_settings::DownloadSettings>().get()).await.map_err(|_|"下载配置读取任务中断".to_owned())?
}
#[tauri::command]
async fn save_download_settings(window:tauri::WebviewWindow,app:tauri::AppHandle,proxy:inkleet_managed_env::DownloadProxy,expected:Option<String>)->Result<download_settings::Snapshot,String>{
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move||app.state::<download_settings::DownloadSettings>().save(proxy,expected)).await.map_err(|_|"下载配置保存任务中断".to_owned())?
}

#[tauri::command]
async fn list_solutions(window:tauri::WebviewWindow,app:tauri::AppHandle,problem:String,language:String)->Result<solutions::Listing,String>{
 check_origin(&window)?;tauri::async_runtime::spawn_blocking(move||{let state=app.state::<Store>();let _lock=state.gate.lock().map_err(|_|"文件队列不可用")?;solutions::list(&state.root,&problem,&language)}).await.map_err(|_|"解答列表任务中断".to_owned())?
}
#[tauri::command]
async fn create_solution(window:tauri::WebviewWindow,app:tauri::AppHandle,problem:String,language:String,id:String,name:String,code:String)->Result<solutions::Entry,String>{
 check_origin(&window)?;tauri::async_runtime::spawn_blocking(move||{let state=app.state::<Store>();let _lock=state.gate.lock().map_err(|_|"文件队列不可用")?;solutions::create(&state.root,&problem,&language,&id,&name,&code)}).await.map_err(|_|"创建解答任务中断".to_owned())?
}
#[tauri::command]
async fn rename_solution(window:tauri::WebviewWindow,app:tauri::AppHandle,problem:String,language:String,id:String,name:String,expected:String)->Result<solutions::Entry,String>{
 check_origin(&window)?;tauri::async_runtime::spawn_blocking(move||{let state=app.state::<Store>();let _lock=state.gate.lock().map_err(|_|"文件队列不可用")?;solutions::rename(&state.root,&problem,&language,&id,&expected,&name)}).await.map_err(|_|"重命名解答任务中断".to_owned())?
}


#[tauri::command]
async fn format_source(window:tauri::WebviewWindow,app:tauri::AppHandle,language:String,text:String,id:Option<u64>,version:Option<u32>)->Result<String,String>{
    check_origin(&window)?;
    if text.len()>1024*1024{return Err("格式化源码超过 1 MiB 限制".into());}
    tauri::async_runtime::spawn_blocking(move||{
        use std::sync::atomic::Ordering;
        let formatting=app.state::<Formatting>();
        if formatting.0.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return Err("格式化正在进行，请稍后保存".into());}
        struct Guard<'a>(&'a std::sync::atomic::AtomicBool);impl Drop for Guard<'_>{fn drop(&mut self){self.0.store(false,Ordering::Release);}}
        let _guard=Guard(&formatting.0);
        if matches!(language.as_str(),"c"|"cpp"|"java"){
            app.state::<lsp::Services>().format(id.ok_or("语言服务尚未连接")?,version.ok_or("缺少文档版本")?,&language,&text)
        }else{
            inkleet_managed_env::formatter::format(&app.state::<managed::Environments>().manager,&language,&text)
        }
    }).await.map_err(|_|"格式化任务中断".to_owned())?
}


#[tauri::command]
async fn get_editor_settings(window:tauri::WebviewWindow,app:tauri::AppHandle)->Result<editor_settings::Snapshot,String>{
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move||app.state::<editor_settings::EditorSettings>().get()).await.map_err(|_|"编辑器配置读取任务中断".to_owned())?
}
#[tauri::command]
async fn save_editor_settings(window:tauri::WebviewWindow,app:tauri::AppHandle,settings:editor_settings::Document,expected:Option<String>)->Result<editor_settings::Snapshot,String>{
    check_origin(&window)?;
    tauri::async_runtime::spawn_blocking(move||app.state::<editor_settings::EditorSettings>().save(settings,expected)).await.map_err(|_|"编辑器配置保存任务中断".to_owned())?
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
            app.manage(Store { root, gate: Mutex::new(()), draft_versions:Mutex::new(std::collections::HashMap::new()) });
            app.manage(auth::Auth::default());
            app.manage(Formatting::default());
            app.manage(download_settings::DownloadSettings::new(app.path().app_config_dir()?));
            app.manage(editor_settings::EditorSettings::new(app.path().app_config_dir()?));
            app.manage(debugger::Debugger::new(std::fs::canonicalize(app.path().app_data_dir()?)?.join("debug-sessions")));
            app.manage(local_run::Runner::new(std::fs::canonicalize(app.path().app_data_dir()?)?.join("local-runs")));
            app.manage(lsp::Services::new(std::fs::canonicalize(app.path().app_data_dir()?)?.join("language-workspaces")));
            app.manage(managed::Environments::new(std::fs::canonicalize(app.path().app_data_dir()?)?.join("tools")));
            app.manage(journal::Journal::new(app.path().app_data_dir()?));
            app.manage(judge::Active::default());
            app.manage(cache::Cache::new(app.path().app_cache_dir()?));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_editor_settings,save_editor_settings,format_source,list_solutions,create_solution,rename_solution,get_download_settings,save_download_settings,evaluate_debug,list_recovery,read_recovery,restore_recovery,start_debug, debug_status, stop_debug, debug_request, set_debug_breakpoints, start_local_run, local_run_status, cancel_local_run, start_language_service, stop_language_service, update_language_document, language_request, language_completion_resolve, language_semantic_tokens, language_diagnostics, read_language_source, environment_status, install_environment, install_environment_group, cancel_environment_install, load_document, checkpoint_draft, save_text, resolve_file_conflict, external_editor_supported, open_note_external, open_login, verify_login, cancel_login, login_status, search_questions, get_question, load_recent_questions, start_judge, check_judge, list_judgements, acknowledge_unknown_judge])
        .build(tauri::generate_context!())
        .expect("InkLeet failed to start")
        .run(|_app,event| {
            if matches!(event,tauri::RunEvent::Exit){inkleet_managed_env::process::shutdown_owned();}
        });
}
