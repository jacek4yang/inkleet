//! 中国站只读接口。固定目的站、无重定向、有限响应、无后台重试。
//! 未公开保证稳定的 GraphQL 接口可能变化；失败必须显式展示。
use reqwest::{Client, redirect::Policy};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

const ENDPOINT: &str = "https://leetcode.cn/graphql/";
const LIST_QUERY: &str = r#"query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    hasMore total questions { frontendQuestionId title titleCn titleSlug difficulty paidOnly status }
  }
}"#;
const QUESTION_QUERY: &str = r#"query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId questionFrontendId title titleSlug translatedTitle content translatedContent
    isPaidOnly difficulty sampleTestCase exampleTestcases metaData
    codeSnippets { langSlug code }
  }
}"#;

pub struct Leetcode { client: Client }
#[derive(Clone, Serialize)]
pub struct Identity { pub username: String, pub account: String, pub persistence: String }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionSummary {
    pub frontend_question_id: String, pub title: String, pub title_cn: Option<String>,
    pub title_slug: String, pub difficulty: String, pub paid_only: bool,
    #[serde(default, deserialize_with="read_completion_status")] pub status: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionList {
    pub has_more: bool, pub total: u64, pub questions: Vec<QuestionSummary>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet { pub lang_slug: String, pub code: String }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub question_id: String, pub question_frontend_id: String,
    pub title: String, pub title_slug: String, pub translated_title: Option<String>,
    pub content: Option<String>, pub translated_content: Option<String>,
    pub is_paid_only: bool, pub difficulty: String, pub sample_test_case: Option<String>,
    pub example_testcases: Option<String>, pub meta_data: Option<String>,
    pub code_snippets: Option<Vec<Snippet>>,
}
fn validate_slug(slug: &str) -> Result<(), String> {
    if slug.is_empty() || slug.len() > 160 || !slug.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("题目标识无效".into());
    }
    Ok(())
}
fn decode_data(bytes: &[u8]) -> Result<Value, String> {
    let response: Value = serde_json::from_slice(bytes).map_err(|_| "中国站返回了无法识别的数据")?;
    if response.get("errors").and_then(Value::as_array).is_some_and(|errors| !errors.is_empty()) {
        return Err("中国站接口返回错误；接口可能变化或需要登录".into());
    }
    response.get("data").filter(|d| d.is_object()).cloned().ok_or("中国站响应缺少数据".into())
}
fn search_filters(keyword: &str, offset: u32, difficulty: Option<&str>, status: Option<&str>, authenticated: bool) -> Result<Value,String> {
    if keyword.chars().count() > 100 || offset > 100_000 || offset % 25 != 0 { return Err("搜索参数超出限制".into()); }
    let mut filters = serde_json::Map::new();
    if !keyword.trim().is_empty() { filters.insert("searchKeywords".into(), json!(keyword.trim())); }
    if let Some(value) = difficulty.filter(|s| !s.is_empty()) {
        if !matches!(value, "EASY" | "MEDIUM" | "HARD") { return Err("题目难度无效".into()); }
        filters.insert("difficulty".into(),json!(value));
    }
    if let Some(value) = status.filter(|s| !s.is_empty()) {
        if !authenticated { return Err("登录后才能筛选完成状态".into()); }
        if !matches!(value, "AC" | "TRIED" | "NOT_STARTED") { return Err("完成状态筛选无效".into()); }
        filters.insert("status".into(),json!(value));
    }
    Ok(Value::Object(filters))
}
fn read_completion_status<'de,D:serde::Deserializer<'de>>(deserializer:D)->Result<Option<String>,D::Error>{
    let value=Value::deserialize(deserializer)?;
    Ok(match value{
        Value::Null=>None,
        Value::String(value)=>match value.trim().to_ascii_uppercase().as_str(){
            "AC"|"SOLVED"=>Some("AC".into()),
            "TRIED"|"NOTAC"|"ATTEMPTED"=>Some("TRIED".into()),
            ""|"NOT_STARTED"|"TO_DO"=>None,
            _=>Some("UNKNOWN".into()),
        },
        _=>Some("UNKNOWN".into()),
    })
}
impl Leetcode {
    pub fn new() -> Result<Self, String> {
        let client = Client::builder().https_only(true).redirect(Policy::none())
            .connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(20))
            .user_agent(concat!("InkLeet/", env!("CARGO_PKG_VERSION"), " (+https://github.com/jacek4yang/inkleet)"))
            .build().map_err(|_| "无法初始化网络客户端")?;
        Ok(Self { client })
    }
    async fn query(&self, query: &str, variables: Value) -> Result<Value, String> {
        self.query_with_session(query, variables, None).await
    }
    async fn query_with_session(&self, query: &str, variables: Value, session: Option<(&str, &str)>) -> Result<Value, String> {
        let mut request = self.client.post(ENDPOINT)
            .header("Referer", "https://leetcode.cn/problemset/")
            .header("Accept", "application/json")
            .json(&json!({ "query": query, "variables": variables }));
        if let Some((cookie, csrf)) = session {
            let mut cookie_header = reqwest::header::HeaderValue::from_str(cookie).map_err(|_| "会话格式无效")?;
            cookie_header.set_sensitive(true);
            let mut csrf_header = reqwest::header::HeaderValue::from_str(csrf).map_err(|_| "会话格式无效")?;
            csrf_header.set_sensitive(true);
            request = request.header(reqwest::header::COOKIE, cookie_header).header("x-csrftoken", csrf_header);
        }
        let mut response = request.send().await.map_err(|_| "无法连接中国站，请检查网络后手动重试")?;
        match response.status().as_u16() {
            401 => return Err("会话已过期，请重新登录".into()),
            403 => return Err("中国站拒绝访问，请在官方登录窗口检查是否需要验证".into()),
            429 => return Err("请求过于频繁，请稍后手动重试".into()),
            _ => {},
        }
        if !response.status().is_success() {
            return Err(format!("中国站暂时不可访问（HTTP {}）；未自动重试", response.status().as_u16()));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "中国站响应读取中断")? {
            if bytes.len() + chunk.len() > 4 * 1024 * 1024 { return Err("中国站响应超出大小限制".into()); }
            bytes.extend_from_slice(&chunk);
        }
        decode_data(&bytes)
    }
    pub async fn identity(&self, cookie: &str, csrf: &str) -> Result<Identity, String> {
        let data = self.query_with_session("query globalData { userStatus { isSignedIn username userSlug } }", json!({}), Some((cookie, csrf))).await?;
        decode_identity(&data)
    }

    pub async fn search(&self, keyword: &str, offset: u32) -> Result<QuestionList, String> {
        self.search_filtered(keyword, offset, None, None, None).await
    }
    pub async fn search_filtered(&self, keyword: &str, offset: u32, difficulty: Option<&str>, status: Option<&str>, session: Option<(&str,&str)>) -> Result<QuestionList, String> {
        let filters = search_filters(keyword, offset, difficulty, status, session.is_some())?;
        let data = self.query_with_session(LIST_QUERY, json!({
            "categorySlug": "", "limit": 25, "skip": offset, "filters": filters
        }), session).await?;
        let mut list: QuestionList = serde_json::from_value(data.get("problemsetQuestionList").cloned().unwrap_or(Value::Null))
            .map_err(|_| "题目列表格式变化，请更新应用".to_owned())?;
        if list.questions.len() > 25 || list.total > 1_000_000 {
            return Err(format!("题目列表数量超出支持范围（{} / {}）",list.questions.len(),list.total));
        }
        for q in &mut list.questions {
            validate_slug(&q.title_slug).map_err(|_|"题目列表含无效题目标识")?;
            if q.frontend_question_id.len()>40 || q.title.len()>1024 || q.title_cn.as_ref().is_some_and(|s|s.len()>1024) {return Err("题目列表文本超出长度限制".into());}
            q.difficulty=normalize_difficulty(&q.difficulty)?.into();
            if session.is_none() { q.status = None; }
            // Unknown per-question status is preserved as UNKNOWN, never a page-wide failure.
        }
        Ok(list)
    }
    pub async fn question(&self, slug: &str) -> Result<Question, String> {
        validate_slug(slug)?;
        let data = self.query(QUESTION_QUERY, json!({"titleSlug":slug})).await?;
        let mut question: Question = serde_json::from_value(data.get("question").cloned().unwrap_or(Value::Null))
            .map_err(|_| "题目不存在、需要权限或接口格式已变化".to_string())?;
        if question.title_slug != slug || question.question_id.is_empty() || question.question_id.len() > 20
            || !question.question_id.bytes().all(|b| b.is_ascii_digit()) {
            return Err("返回题目标识与请求不一致或格式已变化，未创建本机文件".into());
        }
        question.difficulty=normalize_difficulty(&question.difficulty)?.into();
        Ok(question)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn completion_status_variants_do_not_destroy_catalogue(){
        for (raw,expected) in [(json!("ac"),Some("AC")),(json!("SOLVED"),Some("AC")),(json!("notac"),Some("TRIED")),(json!("ATTEMPTED"),Some("TRIED")),(json!("NOT_STARTED"),None),(Value::Null,None),(json!("future-value"),Some("UNKNOWN")),(json!({"changed":true}),Some("UNKNOWN"))]{
            let question:QuestionSummary=serde_json::from_value(json!({"frontendQuestionId":"1","title":"Two Sum","titleCn":"两数之和","titleSlug":"two-sum","difficulty":"Easy","paidOnly":false,"status":raw})).unwrap();
            assert_eq!(question.status.as_deref(),expected);
        }
    }
    #[test]
    fn list_filters_are_bounded_and_account_scoped() {
        assert_eq!(search_filters(" two sum ", 25, Some("EASY"), Some("AC"), true).unwrap(), json!({"searchKeywords":"two sum","difficulty":"EASY","status":"AC"}));
        assert!(search_filters("",0,None,Some("AC"),false).is_err());
        assert!(search_filters("",1,None,None,false).is_err());
        assert!(search_filters("",0,Some("easy"),None,false).is_err());
        assert!(search_filters("",0,None,Some("anything"),true).is_err());
        assert!(search_filters(&"字".repeat(101),0,None,None,false).is_err());
        assert_eq!(search_filters("",0,Some(""),Some(""),false).unwrap(),json!({}));
    }
    #[test]
    fn slug_cannot_change_destination() {
        for bad in ["", "../x", "https://example.com", "a?x=1", "x/y"] { assert!(validate_slug(bad).is_err()); }
        assert!(validate_slug("two-sum").is_ok());
    }
    #[test]
    fn errors_are_not_treated_as_success() {
        assert!(decode_data(br#"{"data":null,"errors":[{"message":"secret should not leak"}]}"#).is_err());
        assert!(decode_data(b"<html>verification</html>").is_err());
        assert!(decode_data(br#"{"data":{"question":null}}"#).is_ok());
    }
    #[test]
    #[ignore = "requires a live request to the public Chinese site; never uses private credentials"]
    fn public_cn_probe() {
        tauri::async_runtime::block_on(async {
            let api = Leetcode::new().unwrap();
            let question = api.question("two-sum").await.expect("public Chinese question protocol");
            assert_eq!(question.title_slug, "two-sum");
            assert!(!question.question_id.is_empty());
            assert!(question.translated_content.as_ref().is_some_and(|s| !s.is_empty()));
            let snippets = question.code_snippets.expect("official language templates");
            for lang in ["python3", "rust", "golang", "c", "cpp", "java"] {
                assert!(snippets.iter().any(|s| s.lang_slug == lang && !s.code.is_empty()), "missing template: {lang}");
            }
            let list = api.search("two sum", 0).await.expect("public Chinese search protocol");
            assert!(list.total > 0 && !list.questions.is_empty());
            assert!(list.questions.iter().all(|q| q.status.is_none()));
            let easy = api.search_filtered("",0,Some("EASY"),None,None).await.expect("live public difficulty filter");
            assert!(!easy.questions.is_empty() && easy.questions.iter().all(|q| q.difficulty == "Easy"));
        });
    }

}

fn normalize_difficulty(value:&str)->Result<&'static str,String>{
    match value {
        "EASY"|"Easy"=>Ok("Easy"), "MEDIUM"|"Medium"=>Ok("Medium"), "HARD"|"Hard"=>Ok("Hard"),
        _=>Err(format!("题目难度格式变化（{}）",value.chars().take(30).collect::<String>()))
    }
}
#[cfg(test)]mod difficulty_tests {
    use super::*;
    #[test]fn list_and_detail_difficulty_casing_normalizes_without_loosening_unknown_values(){
        for (input,expected) in [("EASY","Easy"),("Easy","Easy"),("MEDIUM","Medium"),("Medium","Medium"),("HARD","Hard"),("Hard","Hard")] {
            assert_eq!(normalize_difficulty(input).unwrap(),expected);
        }
        for input in ["", "unknown", "0", " easy ", "Easy<script>"] { assert!(normalize_difficulty(input).is_err()); }
    }
}

fn decode_identity(data: &Value) -> Result<Identity, String> {
    let user = data.get("userStatus").ok_or("登录状态响应缺少字段")?;
    match user.get("isSignedIn").and_then(Value::as_bool) {
        Some(true) => {},
        Some(false) => return Err("SESSION_EXPIRED: 会话已过期或尚未完成登录".into()),
        None => return Err("登录状态响应格式变化；未确认会话过期".into()),
    }
    let username = user.get("username").and_then(Value::as_str).filter(|v| !v.is_empty()).ok_or("账号名称缺失")?;
    let slug = user.get("userSlug").and_then(Value::as_str).filter(|v| !v.is_empty()).ok_or("账号标识缺失")?;
    Ok(Identity { username: username.into(), account: slug.into(), persistence: "memory-only".into() })
}

#[cfg(test)]
mod identity_tests {
    use super::*;
    #[test]
    fn identity_requires_explicit_signed_in_status_and_account_identifier() {
        let valid = json!({"userStatus":{"isSignedIn":true,"username":"fixture","userSlug":"fixture-cn"}});
        assert_eq!(decode_identity(&valid).unwrap().account, "fixture-cn");
        for value in [json!({}), json!({"userStatus":null}), json!({"userStatus":{"isSignedIn":"true"}}), json!({"userStatus":{"isSignedIn":true,"username":"fixture"}})] {
            let error = decode_identity(&value).err().unwrap();
            assert!(!error.contains("SESSION_EXPIRED"), "unknown protocol data is not evidence of expiry");
        }
        assert!(decode_identity(&json!({"userStatus":{"isSignedIn":false}})).err().unwrap().starts_with("SESSION_EXPIRED:"));
    }
}
