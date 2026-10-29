//! Native QR login with explicit official-window fallback and secure persistence.
use std::sync::{Mutex, atomic::{AtomicU64, Ordering}};
use tauri::{Manager, AppHandle};
use crate::leetcode::{Leetcode, Identity};

#[derive(Default)]
pub struct Auth { inner: Mutex<Inner>, epoch: AtomicU64 }
#[derive(Default)]
struct Inner { generation: u64, session: Option<Session>, attempt: Option<QrAttempt>, remember: bool, restore_started: bool, storage_recovery_required: bool }
struct QrAttempt { client: reqwest::Client, cookies: crate::qr_login::Cookies, scan_id: String, in_flight: bool }
#[derive(serde::Serialize)]
pub struct QrReply { pub attempt: u64, pub state: String, pub svg: Option<String>, pub identity: Option<Identity> }
struct Session { _cookie: String, _csrf: String, identity: Identity }
// 不实现 Debug/Serialize，防止把凭据写进日志或 IPC 返回。
fn allowed(url: &tauri::Url) -> bool {
    url.scheme() == "https" && url.port_or_known_default() == Some(443)
        && url.username().is_empty() && url.password().is_none()
        && url.host_str().is_some_and(|host| host == "leetcode.cn" || host.ends_with(".leetcode.cn"))
}
pub fn open(app: &AppHandle, remember: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    { let _ = app; return Err("Android 安全登录隔离适配中；尚未开放，避免会话明文落盘".into()); }
    #[cfg(not(target_os = "android"))]
    {
        if let Some(window) = app.get_webview_window("leetcode-login") {
            return window.set_focus().map_err(|_| "无法激活登录窗口".into());
        }
        let state = app.state::<Auth>();
        let generation = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        let mut inner = state.inner.lock().map_err(|_| "登录状态不可用")?;
        if state.epoch.load(Ordering::SeqCst) != generation { return Err("Login operation superseded".into()); }
        inner.generation = generation;
        if inner.storage_recovery_required { return Err(crate::auth_commit::RECOVERY_REQUIRED.into()); }
        inner.attempt = None;
        inner.remember = remember;
        inner.restore_started = true;
        drop(inner);
        let profile = tempfile::tempdir().map_err(|_| "无法隔离登录环境")?;
        let profile_path = profile.path().to_owned();
        let window = tauri::WebviewWindowBuilder::new(app, "leetcode-login",
            tauri::WebviewUrl::External("https://leetcode.cn/accounts/login/".parse().unwrap()))
            .title("力扣官方登录 · InkLeet 备用方式").inner_size(520.0, 760.0)
            .incognito(true).data_directory(profile_path)
            .on_navigation(allowed)
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .build().map_err(|_| "无法打开官方登录窗口")?;
        // 持有临时目录到窗口销毁；不将隐私模式回退到普通持久化浏览器配置。
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) { let _ = profile.path(); }
        });
        Ok(())
    }
}
pub async fn finish(app: AppHandle) -> Result<Identity, String> {
    let state = app.state::<Auth>();
    let generation = state.inner.lock().map_err(|_| "登录状态不可用")?.generation;
    let login = app.get_webview_window("leetcode-login").ok_or("请先打开官方登录窗口")?;
    let url = login.url().map_err(|_| "无法检查登录来源")?;
    if !allowed(&url) { return Err("当前登录页面来源不受信任".into()); }
    let completion_window = login.clone();
    let cookies = tauri::async_runtime::spawn_blocking(move || login.cookies_for_url("https://leetcode.cn/".parse().unwrap()))
        .await.map_err(|_| "会话读取任务中断")?.map_err(|_| "无法从原生登录窗口读取会话")?;
    let session = cookies.iter().find(|c| c.name() == "LEETCODE_SESSION").map(|c| c.value()).ok_or("尚未发现已登录会话")?;
    let csrf = cookies.iter().find(|c| c.name() == "csrftoken").map(|c| c.value()).ok_or("登录校验数据尚未就绪")?;
    if session.len() > 32768 || csrf.len() > 4096 || [session, csrf].iter().any(|v| v.bytes().any(|b| b < 0x21 || b > 0x7e || b == b';')) {
        return Err("会话数据格式无效".into());
    }
    let cookie = format!("LEETCODE_SESSION={session}; csrftoken={csrf}");
    let csrf = csrf.to_owned();
    let identity = Leetcode::new()?.identity(&cookie, &csrf).await?;
    let identity = install_session(app.clone(), generation, cookie, csrf, identity).await?;
    let _ = completion_window.close();
    Ok(identity)
}
pub fn cancel(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<Auth>();
    let generation = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;
    let mut inner = state.inner.lock().map_err(|_| "登录状态不可用")?;
    if state.epoch.load(Ordering::SeqCst) != generation { return Err("Login operation superseded".into()); }
        inner.generation = generation;
    inner.attempt = None;
    inner.restore_started = true;
    let recovery_required = inner.storage_recovery_required;
    drop(inner);
    let close_result = if let Some(window) = app.get_webview_window("leetcode-login") {
        window.close().map_err(|_| "无法关闭登录窗口".to_owned())
    } else { Ok(()) };
    if recovery_required { return Err(crate::auth_commit::RECOVERY_REQUIRED.into()); }
    close_result?;
    Ok(())
}
pub fn status(app: &AppHandle) -> Result<Option<Identity>, String> {
    Ok(app.state::<Auth>().inner.lock().map_err(|_| "登录状态不可用")?.session.as_ref().map(|s| s.identity.clone()))
}
impl Auth {
    fn credentials(&self, account: &str) -> Result<(crate::judge_transport::Credentials, u64), String> {
        let inner = self.inner.lock().map_err(|_| "登录状态不可用")?;
        if self.epoch.load(Ordering::SeqCst) != inner.generation { return Err("Login state is changing".into()); }
        let session = inner.session.as_ref().ok_or("请先登录中国站")?;
        if session.identity.account != account { return Err("账号已切换，未发送旧账号的代码".into()); }
        Ok((crate::judge_transport::Credentials { cookie: session._cookie.clone(), csrf: session._csrf.clone() }, inner.generation))
    }
    fn current(&self, generation: u64) -> bool {
        self.inner.lock().is_ok_and(|inner| self.epoch.load(Ordering::SeqCst) == generation && inner.generation == generation && inner.session.is_some())
    }
    fn complete_restore(&self, generation: u64, result: Result<Option<(String, String, Identity)>, String>) -> Result<Option<Identity>, String> {
        let mut inner = self.inner.lock().map_err(|_| "Login state unavailable")?;
        // Even an absent record or a late network failure belongs to its old generation.
        // It must not reset the retry latch or replace the result of a newer login/logout.
        if inner.generation != generation || self.epoch.load(Ordering::SeqCst) != generation {
            return Err("Login restore canceled".into());
        }
        match result {
            Err(error) => { inner.restore_started = false; Err(error) }
            Ok(None) => Ok(None),
            Ok(Some((cookie, csrf, mut identity))) => {
                identity.persistence = "system-keychain".into();
                inner.session = Some(Session { _cookie: cookie, _csrf: csrf, identity: identity.clone() });
                Ok(Some(identity))
            }
        }
    }
}
pub fn credentials_for(app: &AppHandle, account: &str) -> Result<(crate::judge_transport::Credentials, u64), String> {
    app.state::<Auth>().credentials(account)
}
pub fn still_current(app: &AppHandle, generation: u64) -> bool {
    app.state::<Auth>().current(generation)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn login_navigation_is_strictly_scoped() {
        for good in ["https://leetcode.cn/accounts/login/", "https://leetcode.cn/", "https://accounts.leetcode.cn/"] {
            assert!(allowed(&good.parse().unwrap()));
        }
        for bad in ["http://leetcode.cn/", "https://leetcode.cn.evil.example/", "https://evil.example/leetcode.cn", "file:///etc/passwd", "https://leetcode.cn:8443/", "https://user@leetcode.cn/"] {
            assert!(!allowed(&bad.parse().unwrap()));
        }
    }
}

async fn install_session(app: AppHandle, generation: u64, cookie: String, csrf: String, mut identity: Identity) -> Result<Identity, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Auth>();
        let mut inner = state.inner.lock().map_err(|_| "Login state unavailable")?;
        if inner.generation != generation || state.epoch.load(Ordering::SeqCst) != generation { return Err("Login attempt canceled".into()); }
        if inner.storage_recovery_required { return Err(crate::auth_commit::RECOVERY_REQUIRED.into()); }
        let saved = match crate::auth_commit::persist(&crate::auth_commit::NativeStore, &state.epoch, generation, &cookie, &csrf, inner.remember) {
            Ok(saved) => saved,
            Err(error) => { if error == crate::auth_commit::RECOVERY_REQUIRED { inner.storage_recovery_required = true; } return Err(error); }
        };
        if saved { identity.persistence = "system-keychain".into(); }
        inner.attempt = None;
        inner.restore_started = true;
        inner.session = Some(Session { _cookie: cookie, _csrf: csrf, identity: identity.clone() });
        Ok(identity)
    }).await.map_err(|_| "Login storage task interrupted".to_owned())?
}

pub async fn restore(app: AppHandle) -> Result<Option<Identity>, String> {
    let generation = {
        let state = app.state::<Auth>();
        let mut inner = state.inner.lock().map_err(|_| "Login state unavailable")?;
        if inner.storage_recovery_required { return Err(crate::auth_commit::RECOVERY_REQUIRED.into()); }
        if state.epoch.load(Ordering::SeqCst) != inner.generation { return Err("Login state is changing".into()); }
        if let Some(session) = &inner.session { return Ok(Some(session.identity.clone())); }
        if inner.restore_started { return Ok(None); }
        inner.restore_started = true;
        inner.generation
    };
    let restored = async {
        let stored = tauri::async_runtime::spawn_blocking(crate::session_store::load).await.map_err(|_| "Login restore interrupted")??;
        let Some(stored) = stored else { return Ok::<_, String>(None); };
        // Temporary failures preserve the stored credentials and permit an explicit retry.
        let identity = Leetcode::new()?.identity(&stored.cookie, &stored.csrf).await?;
        Ok(Some((stored.cookie, stored.csrf, identity)))
    }.await;
    app.state::<Auth>().complete_restore(generation, restored)
}

pub async fn sign_out(app: AppHandle) -> Result<(), String> {
    let generation = {
        let state = app.state::<Auth>();
        let generation = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        let mut inner = state.inner.lock().map_err(|_| "Login state unavailable")?;
        if state.epoch.load(Ordering::SeqCst) != generation { return Err("Login operation superseded".into()); }
        inner.generation = generation;
        begin_forget(&mut inner);
        inner.generation
    };
    // A window-close failure must never prevent logical logout and keychain deletion.
    if let Some(window) = app.get_webview_window("leetcode-login") { let _ = window.close(); }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Auth>();
        let mut inner = state.inner.lock().map_err(|_| "Login state unavailable")?;
        if inner.generation != generation || state.epoch.load(Ordering::SeqCst) != generation { return Err("Logout superseded by a newer login".into()); }
        finish_forget(&mut inner, crate::session_store::delete())
    }).await.map_err(|_| "Logout storage task interrupted".to_owned())?
}

pub async fn qr_start(app: AppHandle, remember: bool) -> Result<QrReply, String> {
    let generation = {
        let state = app.state::<Auth>();
        let generation = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        let mut inner = state.inner.lock().map_err(|_| "Login state unavailable")?;
        if state.epoch.load(Ordering::SeqCst) != generation { return Err("Login operation superseded".into()); }
        inner.generation = generation;
        inner.attempt = None;
        inner.restore_started = true;
        if inner.storage_recovery_required { return Err(crate::auth_commit::RECOVERY_REQUIRED.into()); }
        inner.remember = remember;
        inner.generation
    };
    if let Some(window) = app.get_webview_window("leetcode-login") { let _ = window.close(); }
    let client = crate::qr_login::client()?;
    let mut cookies = crate::qr_login::Cookies::default();
    let (scan_id, svg) = crate::qr_login::create(&client, &mut cookies).await?;
    let state = app.state::<Auth>();
    let mut inner = state.inner.lock().map_err(|_| "Login state unavailable")?;
    if inner.generation != generation || state.epoch.load(Ordering::SeqCst) != generation { return Err("Login attempt canceled".into()); }
    inner.attempt = Some(QrAttempt { client, cookies, scan_id, in_flight: false });
    Ok(QrReply { attempt: generation, state: "WAITING".into(), svg: Some(svg), identity: None })
}

pub async fn qr_poll(app: AppHandle, attempt: u64) -> Result<QrReply, String> {
    let (client, mut cookies, scan_id) = {
        let state = app.state::<Auth>();
        let mut inner = state.inner.lock().map_err(|_| "Login state unavailable")?;
        if inner.generation != attempt || state.epoch.load(Ordering::SeqCst) != attempt { return Err("Login attempt canceled".into()); }
        let qr = inner.attempt.as_mut().ok_or("No active QR login")?;
        if qr.in_flight { return Err("QR request already in progress".into()); }
        qr.in_flight = true;
        (qr.client.clone(), qr.cookies.clone(), qr.scan_id.clone())
    };
    let outcome = crate::qr_login::poll(&client, &mut cookies, &scan_id).await;
    let status = {
        let state = app.state::<Auth>();
        let mut inner = state.inner.lock().map_err(|_| "Login state unavailable")?;
        if inner.generation != attempt || state.epoch.load(Ordering::SeqCst) != attempt { return Err("Login attempt canceled".into()); }
        let qr = inner.attempt.as_mut().ok_or("No active QR login")?;
        qr.in_flight = false;
        qr.cookies = cookies.clone();
        // A server FAILED result is not proof of expiry. Never disguise it as
        // WAITING or automatically request a replacement QR based on that guess.
        let status = outcome?;
        if matches!(status.as_str(), "EXPIRED" | "INVALID" | "FAILED") { inner.attempt = None; }
        status
    };
    if status == "SUCCEED" {
        if cookies.session.is_empty() || cookies.csrf.is_empty() {
            return Err("QR was confirmed but the session was not received; use official login".into());
        }
        let cookie = cookies.header();
        let identity = Leetcode::new()?.identity(&cookie, &cookies.csrf).await?;
        let identity = install_session(app, attempt, cookie, cookies.csrf, identity).await?;
        return Ok(QrReply { attempt, state: status, svg: None, identity: Some(identity) });
    }
    Ok(QrReply { attempt, state: status, svg: None, identity: None })
}

fn begin_forget(inner: &mut Inner) {
    inner.session = None;
    inner.attempt = None;
    inner.restore_started = true;
    // Latch before releasing the state mutex, not after the blocking delete.
    // A cancel/new generation can supersede that worker before it runs; the
    // still-saved account must remain disclosed and block another login.
    inner.storage_recovery_required = true;
}
fn finish_forget(inner: &mut Inner, result: Result<(), String>) -> Result<(), String> {
    inner.storage_recovery_required = result.is_err();
    result
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    fn identity(account: &str) -> Identity {
        Identity { username: format!("Fixture {account}"), account: account.into(), persistence: "memory-only".into() }
    }
    fn restored(account: &str) -> Result<Option<(String, String, Identity)>, String> {
        Ok(Some((format!("synthetic-{account}"), "synthetic-csrf".into(), identity(account))))
    }
    fn advance(state: &Auth, generation: u64) {
        state.epoch.store(generation, Ordering::SeqCst);
        let mut inner = state.inner.lock().unwrap();
        inner.generation = generation;
        inner.restore_started = true;
    }
    #[test]
    fn restore_installs_only_verified_fixture_identity_and_account_bound_credentials() {
        let state = Auth::default();
        advance(&state, 1);
        let value = state.complete_restore(1, restored("account-a")).unwrap().unwrap();
        assert_eq!(value.account, "account-a");
        assert_eq!(value.persistence, "system-keychain");
        assert_eq!(state.credentials("account-a").unwrap().1, 1);
        assert!(state.credentials("account-b").is_err());
        assert!(state.current(1));
        assert!(!state.current(0));
        // Epoch invalidation takes effect even before logout obtains the state mutex.
        state.epoch.store(2, Ordering::SeqCst);
        assert!(state.credentials("account-a").is_err());
        assert!(!state.current(1));
    }
    #[test]
    fn late_restore_success_empty_and_failure_cannot_replace_new_account_or_retry_latch() {
        for old in [restored("old-account"), Ok(None), Err("synthetic offline".into())] {
            let state = Auth::default();
            advance(&state, 2);
            state.complete_restore(2, restored("new-account")).unwrap();
            assert!(state.complete_restore(1, old).is_err());
            let inner = state.inner.lock().unwrap();
            assert_eq!(inner.session.as_ref().unwrap().identity.account, "new-account");
            assert!(inner.restore_started);
        }
    }
    #[test]
    fn offline_and_expired_restore_leave_anonymous_and_allow_only_explicit_retry() {
        for message in ["synthetic network unavailable", "SESSION_EXPIRED: fixture expired", "synthetic store locked"] {
            let state = Auth::default();
            advance(&state, 1);
            assert!(state.complete_restore(1, Err(message.into())).is_err());
            {
                let inner = state.inner.lock().unwrap();
                assert!(inner.session.is_none());
                assert!(!inner.restore_started);
            }
            assert!(state.credentials("account-a").is_err());
            // Fixture supplies a verified result only after an explicit retry.
            state.complete_restore(1, restored("account-a")).unwrap();
            assert!(state.current(1));
        }
    }
    #[test]
    fn logout_superseded_before_delete_keeps_pending_forget_latched() {
        let state = Auth::default();
        advance(&state, 1);
        state.complete_restore(1, restored("account-a")).unwrap();
        advance(&state, 2);
        begin_forget(&mut state.inner.lock().unwrap());
        // The delete worker has not acquired the mutex. Cancellation or a new
        // attempted login wins generation 3, so that stale worker cannot delete.
        advance(&state, 3);
        assert_ne!(state.inner.lock().unwrap().generation, 2);
        {
            let inner = state.inner.lock().unwrap();
            assert!(inner.storage_recovery_required);
            assert!(inner.session.is_none());
            assert!(inner.restore_started);
        }
        assert!(state.credentials("account-a").is_err());
        // Only an explicit retry-forget with a confirmed deletion clears it.
        advance(&state, 4);
        let mut inner = state.inner.lock().unwrap();
        begin_forget(&mut inner);
        assert!(inner.storage_recovery_required);
        finish_forget(&mut inner, Ok(())).unwrap();
        assert!(!inner.storage_recovery_required);
    }
    #[test]
    fn logout_blocks_late_restore_and_failed_forget_latches_recovery_until_success() {
        let state = Auth::default();
        advance(&state, 1);
        state.complete_restore(1, restored("account-a")).unwrap();
        advance(&state, 2);
        {
            let mut inner = state.inner.lock().unwrap();
            inner.session = None;
            assert!(finish_forget(&mut inner, Err("synthetic locked store".into())).is_err());
            assert!(inner.storage_recovery_required);
        }
        assert!(state.complete_restore(1, restored("account-a")).is_err());
        assert!(!state.current(1));
        assert!(state.credentials("account-a").is_err());
        let mut inner = state.inner.lock().unwrap();
        finish_forget(&mut inner, Ok(())).unwrap();
        assert!(!inner.storage_recovery_required);
        assert!(inner.session.is_none());
    }
}
