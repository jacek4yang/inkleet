//! 评测命令协调；磁盘操作走阻塞线程池，网络任务不持有存储锁。
use std::{collections::HashSet, sync::Mutex};
use tauri::{AppHandle, Manager};
use crate::{auth, journal::{Journal, Record, State}, judge_transport::{Snapshot, Transport, StartResult, CheckResult}};
#[derive(Default)]
pub struct Active(pub Mutex<HashSet<String>>);

pub async fn start(app: AppHandle, snapshot: Snapshot) -> Result<Record, String> {
    crate::judge_transport::validate(&snapshot)?;
    let (credentials, generation) = auth::credentials_for(&app, &snapshot.account)?;
    let transport = Transport::new()?;
    let copy = app.clone();
    let frozen = snapshot.clone();
    let (record, is_new) = tauri::async_runtime::spawn_blocking(move || {
        let active_state = copy.state::<Active>();
        let mut active = active_state.0.lock().map_err(|_| "评测任务锁不可用")?;
        let reserved = copy.state::<Journal>().reserve(frozen)?;
        if reserved.1 { active.insert(reserved.0.snapshot.id.clone()); }
        Ok::<_, String>(reserved)
    }).await.map_err(|_| "评测记录任务中断")??;
    if !is_new { return Ok(record); }
    let result = if auth::still_current(&app, generation) {
        transport.start(&snapshot, &credentials).await
    } else { StartResult::Rejected { message: "账号已切换，此操作未发送".into() } };
    let next = match result {
        StartResult::Waiting { server_id } => State::Waiting { server_id },
        StartResult::Rejected { message } => State::Rejected { message },
        StartResult::Unknown { message } => State::Unknown { message },
    };
    tauri::async_runtime::spawn_blocking(move || {
        let active_state = app.state::<Active>();
        let mut active = active_state.0.lock().map_err(|_| "评测任务锁不可用")?;
        let saved = app.state::<Journal>().update(&snapshot.account, &snapshot.id, next);
        active.remove(&snapshot.id);
        saved
    }).await.map_err(|_| "评测状态写入任务中断".to_string())?
}
pub async fn check(app: AppHandle, account: String, id: String) -> Result<Record, String> {
    let (credentials, generation) = auth::credentials_for(&app, &account)?;
    let copy = app.clone(); let key = id.clone(); let owner = account.clone();
    let record = tauri::async_runtime::spawn_blocking(move || copy.state::<Journal>().get(&owner, &key))
        .await.map_err(|_| "评测记录读取中断")??;
    let State::Waiting { server_id } = &record.state else { return Ok(record); };
    if !auth::still_current(&app, generation) { return Err("账号已切换，已停止旧会话查询".into()); }
    let result = Transport::new()?.check(server_id, &record.snapshot.slug, &credentials).await?;
    match result {
        CheckResult::Pending => Ok(record),
        CheckResult::Finished { result } => {
            let server_id = server_id.clone();
            tauri::async_runtime::spawn_blocking(move || app.state::<Journal>().update(&account, &id, State::Finished { server_id, result }))
                .await.map_err(|_| "评测结果保存中断".to_string())?
        }
    }
}
pub async fn list(app: AppHandle, account: String) -> Result<Vec<Record>, String> {
    let _ = auth::credentials_for(&app, &account)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<Journal>().list(&account))
        .await.map_err(|_| "评测记录读取中断".to_string())?
}
pub async fn acknowledge_unknown(app: AppHandle, account: String, id: String, confirmed: bool) -> Result<Record, String> {
    let _ = auth::credentials_for(&app, &account)?;
    if !confirmed { return Err("需要先核查官方记录并明确确认".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let active_state = app.state::<Active>();
        let active = active_state.0.lock().map_err(|_| "评测任务锁不可用")?;
        if active.contains(&id) { return Err("发送请求尚未结束，不能解除保护".into()); }
        app.state::<Journal>().update(&account, &id, State::Acknowledged {
            message: "用户已核查并解除未知操作保护；不会自动重新发送".into(),
        })
    }).await.map_err(|_| "评测记录更新中断".to_string())?
}
