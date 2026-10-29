//! Minimal China-site credentials in the OS credential store only.
//! Call these synchronous methods from a blocking worker. Never log their inputs.
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const SERVICE: &str = "top.jacek.inkleet.auth";
// A single active account per OS user; switching accounts replaces this slot.
// The international site must use a separate slot and is not supported here.
const SLOT: &str = "leetcode.cn:active-session:v1";
const MAX_RECORD_BYTES: usize = 40_000;
static ACCESS: Mutex<()> = Mutex::new(());

// Intentionally neither Debug nor IPC-serializable through a command return.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoredSession {
    version: u8,
    pub cookie: String,
    pub csrf: String,
}

fn valid_token(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max
        && value.bytes().all(|b| (0x21..=0x7e).contains(&b) && b != b';' && b != b',')
}

pub(crate) fn validate(cookie: &str, csrf: &str) -> Result<(), String> {
    if !valid_token(csrf, 4096) || cookie.len() > MAX_RECORD_BYTES {
        return Err("Saved login data is invalid".into());
    }
    let session = cookie.strip_prefix("LEETCODE_SESSION=")
        .and_then(|value| value.split_once("; csrftoken="));
    match session {
        Some((session, stored_csrf)) if valid_token(session, 32768) && stored_csrf == csrf => Ok(()),
        _ => Err("Saved login data is invalid".into()),
    }
}

fn encode(cookie: &str, csrf: &str) -> Result<String, String> {
    validate(cookie, csrf)?;
    let value = serde_json::to_string(&StoredSession { version: 1, cookie: cookie.into(), csrf: csrf.into() })
        .map_err(|_| "Unable to encode saved login")?;
    if value.len() > MAX_RECORD_BYTES { return Err("Saved login data exceeds the storage limit".into()); }
    Ok(value)
}

fn decode(value: &str) -> Result<StoredSession, String> {
    if value.len() > MAX_RECORD_BYTES { return Err("Saved login data exceeds the storage limit".into()); }
    let session: StoredSession = serde_json::from_str(value).map_err(|_| "Saved login data is invalid")?;
    if session.version != 1 { return Err("Saved login data has an unsupported version".into()); }
    validate(&session.cookie, &session.csrf)?;
    Ok(session)
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, SLOT).map_err(|_| "System credential storage is unavailable".into())
}

pub fn load() -> Result<Option<StoredSession>, String> {
    let _guard = ACCESS.lock().map_err(|_| "System credential storage is busy")?;
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        match entry()?.get_password() {
            Ok(value) => decode(&value).map(Some),
            Err(keyring::Error::NoEntry) => Ok(None),
            // Never format the backend error: some variants contain raw secret bytes.
            Err(_) => Err("Unable to read saved login; unlock or allow access to system credential storage".into()),
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    { Err("Secure login persistence is not supported on this platform".into()) }
}

pub fn save(cookie: &str, csrf: &str) -> Result<(), String> {
    let value = encode(cookie, csrf)?;
    let _guard = ACCESS.lock().map_err(|_| "System credential storage is busy")?;
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        entry()?.set_password(&value)
            .map_err(|_| "Unable to save login in system credential storage; this session is temporary".into())
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    { let _ = value; Err("Secure login persistence is not supported on this platform".into()) }
}

pub fn delete() -> Result<(), String> {
    let _guard = ACCESS.lock().map_err(|_| "System credential storage is busy")?;
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Unable to forget saved login; system credential storage still needs attention".into()),
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    { Err("Secure login persistence is not supported on this platform".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Pure codec tests only: these never access an OS account or credential store.
    const COOKIE: &str = "LEETCODE_SESSION=synthetic-session; csrftoken=synthetic-csrf";
    #[test]
    fn record_roundtrips_minimal_session() {
        let value = encode(COOKIE, "synthetic-csrf").unwrap();
        let restored = decode(&value).unwrap();
        assert_eq!(restored.cookie, COOKIE);
        assert_eq!(restored.csrf, "synthetic-csrf");
    }
    #[test]
    fn rejects_header_injection_extra_cookies_and_mismatched_csrf() {
        for cookie in ["", "LEETCODE_SESSION=; csrftoken=synthetic-csrf", "LEETCODE_SESSION=abc\r\nCookie:x; csrftoken=synthetic-csrf", "LEETCODE_SESSION=abc; csrftoken=synthetic-csrf; other=1", "LEETCODE_SESSION=abc; csrftoken=other"] {
            assert!(encode(cookie, "synthetic-csrf").is_err());
        }
        assert!(encode(COOKIE, "").is_err());
    }
    #[test]
    fn rejects_oversized_unknown_or_versioned_records() {
        assert!(decode(&"x".repeat(MAX_RECORD_BYTES + 1)).is_err());
        assert!(decode("{\"version\":2,\"cookie\":\"x\",\"csrf\":\"x\"}").is_err());
        assert!(decode("{\"version\":1,\"cookie\":\"x\",\"csrf\":\"x\",\"password\":\"x\"}").is_err());
    }
}

// Explicit opt-in integration probe: never uses the production service or slot.
// The child process validates retrieval after a process boundary, not a mocked store.
#[cfg(all(test, any(target_os = "linux", target_os = "macos", target_os = "windows")))]
mod native_tests {
    use super::*;
    const TEST_SERVICE: &str = "top.jacek.inkleet.credential-test";
    const CHILD_TEST: &str = "session_store::native_tests::native_store_child";
    const FIXTURE_COOKIE: &str = "LEETCODE_SESSION=synthetic-native-probe; csrftoken=synthetic-native-csrf";
    const FIXTURE_CSRF: &str = "synthetic-native-csrf";
    struct Cleanup(keyring::Entry);
    impl Drop for Cleanup { fn drop(&mut self) { let _ = self.0.delete_credential(); } }
    fn check<T>(result: Result<T, keyring::Error>, action: &str) -> T {
        result.unwrap_or_else(|_| panic!("Synthetic native credential-store {action} failed (backend details redacted)"))
    }
    #[test]
    #[ignore = "opt-in real OS store probe; uses only an isolated synthetic test slot"]
    fn native_store_restart_roundtrip() {
        assert_eq!(std::env::var("INKLEET_TEST_NATIVE_CREDENTIAL_STORE").as_deref(), Ok("1"), "Explicit native credential-store test opt-in is required");
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let slot = format!("synthetic-probe-{}-{unique}", std::process::id());
        let entry = check(keyring::Entry::new(TEST_SERVICE, &slot), "entry creation");
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)), "Unique synthetic test slot must be absent before the probe");
        let cleanup = Cleanup(entry);
        let value = encode(FIXTURE_COOKIE, FIXTURE_CSRF).unwrap();
        check(cleanup.0.set_password(&value), "write");
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", CHILD_TEST, "--ignored", "--nocapture"])
            .env("INKLEET_TEST_CREDENTIAL_SLOT", &slot)
            .status().expect("Synthetic credential probe child must start");
        assert!(status.success(), "Synthetic credential process-restart probe failed");
        let replacement = encode("LEETCODE_SESSION=synthetic-replacement; csrftoken=synthetic-native-csrf", FIXTURE_CSRF).unwrap();
        check(cleanup.0.set_password(&replacement), "replacement");
        assert!(decode(&check(cleanup.0.get_password(), "replacement read")).unwrap().cookie.contains("synthetic-replacement"));
        check(cleanup.0.delete_credential(), "delete");
        assert!(matches!(cleanup.0.get_password(), Err(keyring::Error::NoEntry)), "Synthetic credential must be absent after deletion");
        println!("PASS: real native credential store write, separate-process read, replacement and deletion; synthetic slot only, not real-account or GUI acceptance");
    }
    #[test]
    #[ignore = "invoked only by the isolated native credential-store probe"]
    fn native_store_child() {
        assert_eq!(std::env::var("INKLEET_TEST_NATIVE_CREDENTIAL_STORE").as_deref(), Ok("1"));
        let slot = std::env::var("INKLEET_TEST_CREDENTIAL_SLOT").expect("Only the parent probe provides a slot");
        assert!(slot.starts_with("synthetic-probe-") && slot.len() < 128 && slot.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-'));
        let entry = check(keyring::Entry::new(TEST_SERVICE, &slot), "child entry creation");
        let restored = decode(&check(entry.get_password(), "child read")).unwrap();
        assert_eq!(restored.cookie, FIXTURE_COOKIE);
        assert_eq!(restored.csrf, FIXTURE_CSRF);
    }
}
