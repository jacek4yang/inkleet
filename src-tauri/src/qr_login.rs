//! Fixed-origin CN QR protocol. Secrets never implement Debug or Serialize.
use reqwest::{Client, redirect::Policy};
use serde_json::{json, Value};
use std::time::Duration;

const ENDPOINT: &str = "https://leetcode.cn/graphql/";
const CREATE: &str = "mutation createSignInQRCode { authSignInCreateScanData { scanId ok data } }";
const CHECK: &str = "mutation checkQRCodeSignInStatus($scanId: ID!) { authSignInByScanWithPhone(scanId: $scanId) { error status } }";
const LIMIT: usize = 128 * 1024;

#[derive(Default, Clone)]
pub struct Cookies { pub session: String, pub csrf: String }
impl Cookies {
    pub fn header(&self) -> String {
        let mut parts = Vec::new();
        if !self.session.is_empty() { parts.push(format!("LEETCODE_SESSION={}", self.session)); }
        if !self.csrf.is_empty() { parts.push(format!("csrftoken={}", self.csrf)); }
        parts.join("; ")
    }
    fn absorb(&mut self, headers: &reqwest::header::HeaderMap) -> Result<(), String> {
        for header in headers.get_all(reqwest::header::SET_COOKIE) {
            let value = header.to_str().map_err(|_| "Invalid authentication response")?;
            let first = value.split(';').next().unwrap_or("");
            let Some((name, value)) = first.split_once('=') else { continue };
            if !matches!(name, "csrftoken" | "LEETCODE_SESSION") { continue; }
            if !valid_cookie(value) { return Err("Invalid authentication cookie".into()); }
            if name == "csrftoken" { self.csrf = value.into(); } else { self.session = value.into(); }
        }
        Ok(())
    }
}
pub fn valid_cookie(value: &str) -> bool {
    !value.is_empty() && value.len() <= 32768 && value.bytes().all(|b| (0x21..=0x7e).contains(&b) && b != b';' && b != b',')
}
pub fn client() -> Result<Client, String> {
    Client::builder().https_only(true).redirect(Policy::none())
        .connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(20))
        .user_agent(concat!("InkLeet/", env!("CARGO_PKG_VERSION"), " (+https://github.com/jacek4yang/inkleet)"))
        .build().map_err(|_| "Cannot initialize QR login transport".into())
}
async fn response(mut response: reqwest::Response, cookies: &mut Cookies) -> Result<Vec<u8>, String> {
    if response.status().as_u16() == 429 {
        let raw = response.headers().get("retry-after").and_then(|v| v.to_str().ok());
        let retry = match raw { None => 30, Some(value) => match value.parse::<u64>() {
            Ok(seconds) if seconds <= 600 => seconds.max(1),
            _ => return Err("RATE_LIMIT_PAUSE".into()),
        }};
        return Err(format!("RATE_LIMIT:{retry}"));
    }
    if !response.status().is_success() { return Err("QR login unavailable; use the official login fallback".into()); }
    cookies.absorb(response.headers())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "QR login network interrupted")? {
        if bytes.len() + chunk.len() > LIMIT { return Err("QR login response too large".into()); }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
fn sensitive(value: &str) -> Result<reqwest::header::HeaderValue, String> {
    let mut header = reqwest::header::HeaderValue::from_str(value).map_err(|_| "Invalid authentication header")?;
    header.set_sensitive(true);
    Ok(header)
}
async fn mutation(client: &Client, cookies: &mut Cookies, operation: &str, query: &str, variables: Value) -> Result<Value, String> {
    let mut request = client.post(ENDPOINT).header("origin", "https://leetcode.cn")
        .header("referer", "https://leetcode.cn/accounts/login/")
        .json(&json!({"operationName":operation,"query":query,"variables":variables}));
    if !cookies.csrf.is_empty() { request = request.header("x-csrftoken", sensitive(&cookies.csrf)?); }
    let cookie = cookies.header();
    if !cookie.is_empty() { request = request.header("cookie", sensitive(&cookie)?); }
    let reply = request.send().await.map_err(|_| "QR login network unavailable")?;
    let bytes = response(reply, cookies).await?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid QR login response")?;
    if value.get("errors").and_then(Value::as_array).is_some_and(|e| !e.is_empty()) {
        return Err("QR login protocol changed or additional verification is required".into());
    }
    value.get("data").cloned().ok_or("Missing QR login response data".into())
}
pub async fn create(client: &Client, cookies: &mut Cookies) -> Result<(String, String), String> {
    // Bootstrap only the exact official origin; redirects/challenges are not bypassed.
    let bootstrap = client.get("https://leetcode.cn/accounts/login/").send().await.map_err(|_| "QR login network unavailable")?;
    if !bootstrap.status().is_success() { return Err("Official login requires additional verification".into()); }
    cookies.absorb(bootstrap.headers())?;
    drop(bootstrap);
    let value = mutation(client, cookies, "createSignInQRCode", CREATE, json!({})).await?;
    parse_created(&value)
}
fn parse_created(value: &Value) -> Result<(String, String), String> {
    let data = &value["authSignInCreateScanData"];
    if data["ok"].as_bool() != Some(true) { return Err("Cannot create login QR code".into()); }
    let id = data["scanId"].as_str().filter(|s| !s.is_empty() && s.len() <= 2048).ok_or("Missing QR attempt")?;
    let encoded = data["data"].as_str().filter(|s| s.len() <= 8192).ok_or("Missing QR content")?;
    let payload: Value = serde_json::from_str(encoded).map_err(|_| "Invalid QR content")?;
    let link = payload["link"].as_str().ok_or("Missing QR link")?;
    let url = tauri::Url::parse(link).map_err(|_| "Invalid QR link")?;
    let params: Vec<_> = url.query_pairs().collect();
    if url.scheme() != "https" || url.host_str() != Some("leetcode-cn.com") || url.path() != "/app"
        || url.port_or_known_default() != Some(443) || !url.username().is_empty() || url.password().is_some()
        || url.fragment().is_some() || params.len() != 2
        || params.iter().filter(|(k,v)| k == "scan_id" && v == id).count() != 1
        || params.iter().filter(|(k,v)| k == "action" && v == "login").count() != 1 {
        return Err("Unexpected QR destination; use official login".into());
    }
    let code = qrcode::QrCode::new(link.as_bytes()).map_err(|_| "Cannot render QR code")?;
    let svg = code.render::<qrcode::render::svg::Color>().min_dimensions(240, 240).build();
    Ok((id.into(), svg))
}
pub async fn poll(client: &Client, cookies: &mut Cookies, id: &str) -> Result<String, String> {
    let value = mutation(client, cookies, "checkQRCodeSignInStatus", CHECK, json!({"scanId":id})).await?;
    parse_status(&value)
}
fn parse_status(value: &Value) -> Result<String, String> {
    let status = value["authSignInByScanWithPhone"]["status"].as_str().ok_or("Missing QR status")?;
    if !matches!(status, "WAITING" | "SUCCEED" | "EXPIRED" | "INVALID" | "FAILED") {
        return Err("QR login protocol changed; use official login".into());
    }
    Ok(status.into())
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn native_cookie_header_matches_secure_store_codec() {
        let cookies = Cookies { session: "synthetic-session".into(), csrf: "synthetic-csrf".into() };
        assert!(crate::session_store::validate(&cookies.header(), &cookies.csrf).is_ok());
    }
    #[test] fn cookie_validation_rejects_injection() {
        for value in ["", "x;y", "x\r\ny", "x y", "x,y"] { assert!(!valid_cookie(value)); }
        assert!(valid_cookie("signed-cookie_123.abc"));
    }
    #[test] fn qr_destination_is_exact_and_attempt_bound() {
        let make = |link: &str| json!({"authSignInCreateScanData":{"ok":true,"scanId":"fixture","data":json!({"link":link}).to_string()}});
        assert!(parse_created(&make("https://leetcode-cn.com/app?scan_id=fixture&action=login")).is_ok());
        for link in ["https://evil.example/app?scan_id=fixture&action=login", "https://leetcode-cn.com/app?scan_id=other&action=login", "https://leetcode-cn.com/app?scan_id=fixture&action=login&action=other", "http://leetcode-cn.com/app?scan_id=fixture&action=login"] { assert!(parse_created(&make(link)).is_err()); }
    }
}

#[cfg(test)]
mod protocol_fixture_tests {
    use super::*;
    #[test]
    fn preserves_all_terminal_statuses_without_guessing_expiry_or_success() {
        for status in ["WAITING", "SUCCEED", "EXPIRED", "INVALID", "FAILED"] {
            assert_eq!(parse_status(&json!({"authSignInByScanWithPhone":{"status":status}})).unwrap(), status);
        }
        for value in [json!({}), json!({"authSignInByScanWithPhone":{"status":"SCANNED"}}), json!({"authSignInByScanWithPhone":{"status":true}})] {
            assert!(parse_status(&value).is_err());
        }
    }
    #[test]
    fn cookie_rotation_accepts_only_the_expected_pair_and_hides_header_values() {
        let mut cookies = Cookies { session: "synthetic-old".into(), csrf: "synthetic-old-csrf".into() };
        let mut headers = reqwest::header::HeaderMap::new();
        headers.append(reqwest::header::SET_COOKIE, "unrelated=ignored; Secure".parse().unwrap());
        headers.append(reqwest::header::SET_COOKIE, "csrftoken=synthetic-new-csrf; Secure".parse().unwrap());
        headers.append(reqwest::header::SET_COOKIE, "LEETCODE_SESSION=synthetic-new; Secure".parse().unwrap());
        cookies.absorb(&headers).unwrap();
        assert_eq!(cookies.header(), "LEETCODE_SESSION=synthetic-new; csrftoken=synthetic-new-csrf");
        assert!(crate::session_store::validate(&cookies.header(), &cookies.csrf).is_ok());
        assert!(sensitive(&cookies.header()).unwrap().is_sensitive());
        headers.clear();
        headers.append(reqwest::header::SET_COOKIE, "LEETCODE_SESSION=bad,value; Secure".parse().unwrap());
        let error = cookies.absorb(&headers).unwrap_err();
        assert!(!error.contains("bad,value"));
    }
    #[test]
    fn international_and_confused_destinations_never_become_a_qr() {
        let make = |link: &str| json!({"authSignInCreateScanData":{"ok":true,"scanId":"fixture","data":json!({"link":link}).to_string()}});
        for link in ["https://leetcode.com/app?scan_id=fixture&action=login", "https://leetcode-cn.com.evil.example/app?scan_id=fixture&action=login", "https://user@leetcode-cn.com/app?scan_id=fixture&action=login", "https://leetcode-cn.com:8443/app?scan_id=fixture&action=login", "https://leetcode-cn.com/app?scan_id=fixture&action=login#extra"] {
            assert!(parse_created(&make(link)).is_err());
        }
    }
}
