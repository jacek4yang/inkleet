mod storage;
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
    let question = leetcode::Leetcode::new()?.question(&slug).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let cache_warning = app.state::<cache::Cache>().save(&question).err();
        FetchedQuestion { question, cache_warning }
    }).await.map_err(|_| "题目缓存任务中断".into())
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FetchedQuestion { question: leetcode::Question, cache_warning: Option<String> }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let root = app.path().app_data_dir()?.join("notebook");
            std::fs::create_dir_all(&root)?;
            app.manage(Store { root, gate: Mutex::new(()) });
            app.manage(auth::Auth::default());
            app.manage(journal::Journal::new(app.path().app_data_dir()?));
            app.manage(judge::Active::default());
            app.manage(cache::Cache::new(app.path().app_cache_dir()?));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load_document, save_text, open_login, verify_login, cancel_login, login_status, search_questions, get_question, load_recent_questions, start_judge, check_judge, list_judgements, acknowledge_unknown_judge])
        .run(tauri::generate_context!())
        .expect("InkLeet failed to start");
}
