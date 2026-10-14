//! 中国站评测传输。只发送一次写请求；网络不确定时绝不自动重试。
//! 调用者必须先持久化操作快照，再调用 start；此模块不向前端暴露凭据。
use reqwest::{Client, redirect::Policy, header::{HeaderValue, COOKIE}};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub solution: Option<String>,
    pub id: String, pub account: String, pub question_id: String, pub slug: String,
    pub language: String, pub code: String, pub test_case: String, pub kind: Kind,
}
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Kind { OnlineRun, Submission }
pub struct Credentials { pub cookie: String, pub csrf: String }
// 不实现 Debug 或 Serialize，避免凭据进入错误、日志或 IPC。
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum StartResult {
    Waiting { server_id: String },
    Rejected { message: String },
    Unknown { message: String },
}
#[derive(Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum CheckResult {
    Pending,
    Finished { result: Value },
}
fn identifier(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max
        && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
pub fn validate(snapshot: &Snapshot) -> Result<(), String> {
    if snapshot.solution.as_deref().is_some_and(|id|id!="default" && (id.len()!=32 || !id.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))) { return Err("无效解答标识".into()); }
    if !identifier(&snapshot.id, 80) || snapshot.account.is_empty() || snapshot.account.len() > 200 {
        return Err("评测操作标识或账号无效".into());
    }
    if !identifier(&snapshot.slug, 160) || snapshot.slug.contains('_')
        || snapshot.question_id.is_empty() || snapshot.question_id.len() > 20
        || !snapshot.question_id.bytes().all(|b| b.is_ascii_digit()) {
        return Err("评测题目标识无效".into());
    }
    if !["python3", "rust", "golang", "c", "cpp", "java"].contains(&snapshot.language.as_str()) {
        return Err("评测语言不支持".into());
    }
    if snapshot.code.trim().is_empty() || snapshot.code.len() > 256 * 1024 || snapshot.test_case.len() > 64 * 1024 {
        return Err("代码为空或评测内容超过大小限制".into());
    }
    if snapshot.kind == Kind::OnlineRun && snapshot.test_case.trim().is_empty() {
        return Err("请先填写测试用例".into());
    }
    Ok(())
}
fn payload(snapshot: &Snapshot) -> Value {
    let mut value = json!({
        "lang": snapshot.language, "question_id": snapshot.question_id, "typed_code": snapshot.code
    });
    if snapshot.kind == Kind::OnlineRun { value["data_input"] = json!(snapshot.test_case); }
    value
}
fn server_identifier(value:&str)->bool{
    !value.is_empty() && value.len()<=120 && !matches!(value,"."|"..")
        && value.bytes().all(|b|b.is_ascii_alphanumeric()||matches!(b,b'-'|b'_'|b'.'))
}
fn check_endpoint(server_id:&str,slug:&str)->Result<String,String>{
    if !server_identifier(server_id)||!identifier(slug,160){return Err("评测编号无效".into());}
    Ok(format!("https://leetcode.cn/submissions/detail/{server_id}/check/"))
}
fn parse_start(kind: Kind, value: &Value) -> StartResult {
    let key = if kind == Kind::OnlineRun { "interpret_id" } else { "submission_id" };
    let id = value.get(key).and_then(|v| match v {
        Value::String(s) => Some(s.clone()), Value::Number(n) if n.is_u64() => Some(n.to_string()), _ => None,
    });
    match id.filter(|id| server_identifier(id)) {
        Some(server_id) => StartResult::Waiting { server_id },
        None => StartResult::Unknown { message: "未收到有效评测编号，发送状态未知；请核查后再决定是否重发".into() },
    }
}
fn parse_check(value: Value) -> Result<CheckResult, String> {
    match value.get("state").and_then(Value::as_str) {
        Some("PENDING" | "STARTED") => Ok(CheckResult::Pending),
        Some("SUCCESS") if value.get("status_code").is_some() || value.get("status_msg").is_some() => {
            // 只把明确的判题字段返回界面，页面按文本呈现；不执行返回内容。
            let mut filtered = serde_json::Map::new();
            let mut remaining = 256 * 1024usize;
            let mut truncated = false;
            for key in ["status_code", "status_msg", "run_success", "compare_result", "total_correct",
                "total_testcases", "status_runtime", "status_memory", "display_runtime", "memory",
                "full_compile_error", "compile_error", "full_runtime_error", "runtime_error",
                "code_answer", "expected_code_answer", "expected_code_output", "expected_output", "display_memory", "last_testcase", "code_output", "std_output_list", "std_output", "task_finish_time"] {
                if let Some(field) = value.get(key) {
                    let encoded = serde_json::to_string(field).map_err(|_| "判题字段编码失败")?;
                    if encoded.len() <= remaining {
                        remaining -= encoded.len(); filtered.insert(key.into(), field.clone());
                    } else {
                        truncated = true;
                        let preview: String = encoded.chars().take(remaining / 4).collect();
                        filtered.insert(key.into(), Value::String(format!("{preview}\\n[输出过长，已截断展示]")));
                        remaining = 0;
                    }
                }
            }
            if truncated { filtered.insert("output_truncated".into(), Value::Bool(true)); }
            Ok(CheckResult::Finished { result: Value::Object(filtered) })
        }
        _ => Err("判题响应格式变化，不能判断是否完成；保留评测编号供再次查询".into()),
    }
}
pub struct Transport { client: Client }
impl Transport {
    pub fn new() -> Result<Self, String> {
        Ok(Self { client: Client::builder().https_only(true).redirect(Policy::none()).retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(20))
            .user_agent("InkLeet/0.0.1 (+https://github.com/jacek4yang/inkleet)")
            .build().map_err(|_| "无法初始化评测连接")? })
    }
    fn headers(&self, request: reqwest::RequestBuilder, credentials: &Credentials, slug: &str) -> Result<reqwest::RequestBuilder, String> {
        let mut cookie = HeaderValue::from_str(&credentials.cookie).map_err(|_| "会话格式无效")?;
        let mut csrf = HeaderValue::from_str(&credentials.csrf).map_err(|_| "会话格式无效")?;
        cookie.set_sensitive(true); csrf.set_sensitive(true);
        Ok(request.header(COOKIE, cookie).header("x-csrftoken", csrf)
            .header("Origin", "https://leetcode.cn")
            .header("Referer", format!("https://leetcode.cn/problems/{slug}/"))
            .header("Accept", "application/json"))
    }
    pub async fn start(&self, snapshot: &Snapshot, credentials: &Credentials) -> StartResult {
        if let Err(message) = validate(snapshot) { return StartResult::Rejected { message }; }
        let action = if snapshot.kind == Kind::OnlineRun { "interpret_solution" } else { "submit" };
        let url = format!("https://leetcode.cn/problems/{}/{action}/", snapshot.slug);
        let request = match self.headers(self.client.post(url), credentials, &snapshot.slug) {
            Ok(request) => request.json(&payload(snapshot)),
            Err(message) => return StartResult::Rejected { message },
        };
        let response = match request.send().await {
            Ok(response) => response,
            Err(_) => return StartResult::Unknown { message: "请求中断，发送状态未知；没有自动重发".into() },
        };
        if matches!(response.status().as_u16(), 401 | 403 | 429) {
            let message = match response.status().as_u16() {
                401 => "登录已过期，请重新登录",
                403 => "中国站拒绝本次请求，请在官方登录流程检查验证要求",
                _ => "中国站限制请求频率，请稍后手动操作",
            };
            return StartResult::Rejected { message: message.into() };
        }
        if !response.status().is_success() {
            return StartResult::Unknown { message: format!("评测响应异常（HTTP {}），发送状态未知；未重发", response.status().as_u16()) };
        }
        match bounded_json(response).await {
            Ok(value) => parse_start(snapshot.kind, &value),
            Err(_) => StartResult::Unknown { message: "评测响应无法识别，发送状态未知；未重发".into() },
        }
    }
    pub async fn check(&self, server_id: &str, slug: &str, credentials: &Credentials) -> Result<CheckResult, String> {
        let url = check_endpoint(server_id,slug)?;
        let response = self.headers(self.client.get(url), credentials, slug)?.send().await
            .map_err(|_| "查询中断，已保留评测编号；可稍后继续查询")?;
        if !response.status().is_success() {
            return Err(format!("评测查询失败（HTTP {}），未重复提交代码", response.status().as_u16()));
        }
        parse_check(bounded_json(response).await?)
    }
}
async fn bounded_json(mut response: reqwest::Response) -> Result<Value, String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "判题响应中断")? {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 { return Err("判题响应超过限制".into()); }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "判题响应不是有效 JSON".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot() -> Snapshot {
        Snapshot { solution:None, id: "test-1".into(), account: "test-user".into(), question_id: "1".into(),
            slug: "fixture".into(), language: "rust".into(), code: "// authored fixture".into(),
            test_case: "[1,2]".into(), kind: Kind::OnlineRun }
    }
    #[test]
    fn interpretation_ids_with_decimal_timestamps_are_safe_and_queryable(){
        let id="runcode_1627219627.5662382_EI7iasnhLm";
        let StartResult::Waiting{server_id}=parse_start(Kind::OnlineRun,&json!({"interpret_id":id})).clone() else {panic!("valid run id rejected");};
        assert_eq!(server_id,id);
        assert_eq!(check_endpoint(&server_id,"two-sum").unwrap(),format!("https://leetcode.cn/submissions/detail/{id}/check/"));
        for bad in ["","..",".","../x","a/b","%2e%2e","id?x=1","id#fragment","id\\x","id\n"]{
            assert!(!server_identifier(bad));
            assert!(check_endpoint(bad,"two-sum").is_err());
            assert!(matches!(parse_start(Kind::OnlineRun,&json!({"interpret_id":bad})),StartResult::Unknown{..}));
        }
        assert!(!identifier(id,120),"snapshot validator is not loosened");
    }
    #[test]
    fn debug_stdout_cannot_displace_actual_answers(){
        let CheckResult::Finished{result}=parse_check(json!({"state":"SUCCESS","status_msg":"Accepted","code_output":"x".repeat(300000),"code_answer":["[0,1]"],"expected_code_answer":["[0,1]"]})).unwrap() else {panic!("expected finished")};
        assert_eq!(result["code_answer"],json!(["[0,1]"]));
        assert_eq!(result["expected_code_answer"],json!(["[0,1]"]));
        assert_eq!(result["output_truncated"],true);
    }
    #[test]
    fn preserves_run_answers_separately_from_stdout() {
        let CheckResult::Finished { result } = parse_check(json!({
            "state":"SUCCESS","status_msg":"Accepted","code_answer":["[7,0]"],
            "expected_code_answer":["[0,1]"],"code_output":["debug output"],
            "display_runtime":0,"unrelated":"discard"
        })).unwrap() else { panic!("expected result"); };
        assert_eq!(result["code_answer"],json!(["[7,0]"]));
        assert_eq!(result["expected_code_answer"],json!(["[0,1]"]));
        assert_eq!(result["code_output"],json!(["debug output"]));
        assert_eq!(result["display_runtime"],0);
        assert!(result.get("unrelated").is_none());
    }
    #[test]
    fn six_language_payloads_keep_submission_separate_from_test_input() {
        for lang in ["python3", "rust", "golang", "c", "cpp", "java"] {
            let mut s = snapshot(); s.language = lang.into(); validate(&s).unwrap();
            assert_eq!(payload(&s)["lang"], lang); assert!(payload(&s).get("data_input").is_some());
            s.kind = Kind::Submission; assert!(payload(&s).get("data_input").is_none());
        }
    }
    #[test]
    fn missing_or_malicious_operation_ids_remain_unknown() {
        for value in [json!({}), json!({"submission_id":"../../escape"}), json!({"submission_id":-1})] {
            assert!(matches!(parse_start(Kind::Submission, &value), StartResult::Unknown { .. }));
        }
        assert!(matches!(parse_start(Kind::Submission, &json!({"submission_id":123})), StartResult::Waiting { .. }));
        assert!(matches!(parse_start(Kind::OnlineRun, &json!({"interpret_id":"runcode_fixture-1"})), StartResult::Waiting { .. }));
    }
    #[test]
    fn finished_is_not_inferred_from_http_success_or_field_count() {
        assert!(parse_check(json!({"status_msg":"Accepted"})).is_err());
        assert!(matches!(parse_check(json!({"state":"STARTED","extra":1})).unwrap(), CheckResult::Pending));
        let CheckResult::Finished { result } = parse_check(json!({"state":"SUCCESS","status_code":11,"status_msg":"Wrong Answer","unrelated":"discard"})).unwrap() else { panic!("expected finished"); };
        assert_eq!(result["status_msg"], "Wrong Answer"); assert!(result.get("unrelated").is_none());
    }
    #[test]
    fn oversized_outputs_are_bounded_without_changing_verdict() {
        let CheckResult::Finished { result } = parse_check(json!({
            "state": "SUCCESS", "status_code": 11, "status_msg": "Wrong Answer",
            "code_output": "中".repeat(200_000),
        })).unwrap() else { panic!("expected result"); };
        assert_eq!(result["status_msg"], "Wrong Answer");
        assert_eq!(result["output_truncated"], true);
        assert!(serde_json::to_vec(&result).unwrap().len() < 300 * 1024);
    }
    #[test]
    fn invalid_destination_and_empty_code_are_rejected_before_send() {
        let mut s = snapshot(); s.slug = "../evil".into(); assert!(validate(&s).is_err());
        s.slug = "fixture".into(); s.code.clear(); assert!(validate(&s).is_err());
    }
}

#[cfg(test)]mod source_identity_tests{
 use super::*;
 #[test]fn six_language_imports_are_sent_without_any_rewrite(){
  for (language,source) in [
   ("rust","use std::collections::HashMap;\r\nimpl Solution {}\r\n"),
   ("python3","from __future__ import annotations\nfrom collections import Counter\n# 中文\n"),
   ("java","import java.util.HashMap;\nclass Solution {}\n"),
   ("c","#include <stdlib.h>\nint solve(int n){return n;}\n"),
   ("cpp","#include <unordered_map>\nclass Solution {};\n"),
   ("golang","import \"fmt\"\nfunc solve(n int) int { return n }\n")
  ]{
   let snapshot=Snapshot{solution:Some("a".repeat(32)),id:"identity-test".into(),account:"fixture".into(),question_id:"1".into(),slug:"two-sum".into(),language:language.into(),code:source.into(),test_case:String::new(),kind:Kind::Submission};
   validate(&snapshot).unwrap();let body=payload(&snapshot);
   assert_eq!(body["typed_code"].as_str().unwrap().as_bytes(),source.as_bytes());
   assert!(body.get("solution").is_none());assert!(body.get("data_input").is_none());
  }
 }
 #[test]fn legacy_journal_without_solution_deserializes_to_default(){
  let old=json!({"id":"old","account":"fixture","questionId":"1","slug":"two-sum","language":"rust","code":"impl Solution {}","testCase":"","kind":"submission"});
  let snapshot:Snapshot=serde_json::from_value(old).unwrap();assert!(snapshot.solution.is_none());validate(&snapshot).unwrap();
 }
}
