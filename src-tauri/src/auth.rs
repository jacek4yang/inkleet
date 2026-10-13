//! 首轮桌面登录原型：独立隐私 WebView + 原生内存会话。
//! 未接入系统安全存储时明确不持久化，绝不退回明文或前端存储。
use std::sync::Mutex;
use tauri::{Manager, AppHandle};
use crate::leetcode::{Leetcode, Identity};

#[derive(Default)]
pub struct Auth { inner: Mutex<Inner> }
#[derive(Default)]
struct Inner { generation: u64, session: Option<Session> }
struct Session { _cookie: String, _csrf: String, identity: Identity }
// 不实现 Debug/Serialize，防止把凭据写进日志或 IPC 返回。
fn allowed(url: &tauri::Url) -> bool {
    url.scheme() == "https" && url.port_or_known_default() == Some(443)
        && url.username().is_empty() && url.password().is_none()
        && url.host_str().is_some_and(|host| host == "leetcode.cn" || host.ends_with(".leetcode.cn"))
}
pub fn open(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    { let _ = app; return Err("Android 安全登录隔离适配中；尚未开放，避免会话明文落盘".into()); }
    #[cfg(not(target_os = "android"))]
    {
        if let Some(window) = app.get_webview_window("leetcode-login") {
            return window.set_focus().map_err(|_| "无法激活登录窗口".into());
        }
        let state = app.state::<Auth>();
        let mut inner = state.inner.lock().map_err(|_| "登录状态不可用")?;
        inner.generation += 1;
        inner.session = None;
        drop(inner);
        let profile = tempfile::tempdir().map_err(|_| "无法隔离登录环境")?;
        let profile_path = profile.path().to_owned();
        let window = tauri::WebviewWindowBuilder::new(app, "leetcode-login",
            tauri::WebviewUrl::External("https://leetcode.cn/accounts/login/".parse().unwrap()))
            .title("力扣官方登录 · InkLeet 临时会话").inner_size(520.0, 760.0)
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
    {
        let mut inner = state.inner.lock().map_err(|_| "登录状态不可用")?;
        if inner.generation != generation { return Err("此登录操作已取消，请重新开始".into()); }
        inner.session = Some(Session { _cookie: cookie, _csrf: csrf, identity: identity.clone() });
    }
    let _ = completion_window.close();
    Ok(identity)
}
pub fn cancel(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<Auth>();
    let mut inner = state.inner.lock().map_err(|_| "登录状态不可用")?;
    inner.generation += 1;
    inner.session = None;
    drop(inner);
    if let Some(window) = app.get_webview_window("leetcode-login") {
        window.close().map_err(|_| "无法关闭登录窗口")?;
    }
    Ok(())
}
pub fn status(app: &AppHandle) -> Result<Option<Identity>, String> {
    Ok(app.state::<Auth>().inner.lock().map_err(|_| "登录状态不可用")?.session.as_ref().map(|s| s.identity.clone()))
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
