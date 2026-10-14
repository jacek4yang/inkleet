//! 仅缓存公开题面和官方模板；不保存会话、私人解答或笔记。
use std::{path::PathBuf, sync::Mutex};
use crate::{leetcode::Question, storage};

pub struct Cache { path: PathBuf, gate: Mutex<()> }
impl Cache {
    pub fn new(root: PathBuf) -> Self { Self { path: root.join("public-questions.json"), gate: Mutex::new(()) } }
    fn check_path(&self) -> Result<(), String> {
        if self.path.is_symlink() || self.path.parent().is_some_and(|p| p.is_symlink()) {
            return Err("拒绝符号链接题目缓存".into());
        }
        Ok(())
    }
    fn decode(text: Option<&str>) -> Result<Vec<Question>, String> {
        let items: Vec<Question> = match text {
            Some(text) => serde_json::from_str(text).map_err(|_| "题目缓存损坏，未覆盖原文件")?,
            None => Vec::new(),
        };
        if items.len() > 50 || items.iter().any(|q| !valid(q)) { return Err("题目缓存格式无效".into()); }
        Ok(items)
    }
    pub fn load(&self) -> Result<Vec<Question>, String> {
        let _guard = self.gate.lock().map_err(|_| "题目缓存锁不可用")?;
        self.check_path()?;
        Self::decode(storage::read(&self.path)?.as_deref())
    }
    pub fn save(&self, question: &Question) -> Result<(), String> {
        if !valid(question) { return Err("题目不可离线缓存".into()); }
        let serialized = serde_json::to_string(question).map_err(|_| "题目缓存编码失败")?;
        if serialized.len() > 256 * 1024 { return Err("此题超过单题缓存限制，未缓存题面".into()); }
        let _guard = self.gate.lock().map_err(|_| "题目缓存锁不可用")?;
        self.check_path()?;
        let previous = storage::read(&self.path)?;
        let mut items = Self::decode(previous.as_deref())?;
        items.retain(|q| q.question_id != question.question_id);
        items.insert(0, serde_json::from_str(&serialized).map_err(|_| "题目缓存编码失败")?);
        items.truncate(50);
        loop {
            let text = serde_json::to_string(&items).map_err(|_| "题目缓存编码失败")?;
            if text.len() <= 2 * 1024 * 1024 { return storage::save(&self.path, previous.as_deref(), &text); }
            if items.len() <= 1 { return Err("题目缓存超过大小限制".into()); }
            items.pop();
        }
    }
}
fn valid(q: &Question) -> bool {
    !q.is_paid_only && !q.question_id.is_empty() && q.question_id.len() <= 20
        && q.question_id.bytes().all(|b| b.is_ascii_digit())
        && !q.title_slug.is_empty() && q.title_slug.len() <= 160
        && q.title_slug.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
#[cfg(test)]
mod tests {
    use super::*;
    fn question(id: &str) -> Question {
        serde_json::from_value(serde_json::json!({
            "questionId": id, "questionFrontendId": id, "title": "Authored cache fixture",
            "titleSlug": format!("fixture-{id}"), "isPaidOnly": false, "difficulty": "Easy",
            "translatedContent": "<p>自编测试题面</p>",
            "codeSnippets": [{"langSlug":"rust","code":"// fixture"}]
        })).unwrap()
    }
    #[test]
    fn restart_recovers_public_metadata_and_deduplicates() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path().into());
        assert!(cache.load().unwrap().is_empty());
        cache.save(&question("1")).unwrap();
        cache.save(&question("2")).unwrap();
        cache.save(&question("1")).unwrap();
        let reopened = Cache::new(dir.path().into()).load().unwrap();
        assert_eq!(reopened.len(), 2);
        assert_eq!(reopened[0].question_id, "1");
        assert_eq!(reopened[0].code_snippets.as_ref().unwrap()[0].code, "// fixture");
    }
    #[test]
    fn corrupted_cache_is_not_silently_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path().into());
        std::fs::write(&cache.path, "broken").unwrap();
        assert!(cache.save(&question("1")).is_err());
        assert_eq!(std::fs::read_to_string(&cache.path).unwrap(), "broken");
        assert!(!valid(&question("../escape")));
    }
    #[test]
    fn cache_keeps_at_most_fifty_recent_questions() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path().into());
        for id in 1..=55 { cache.save(&question(&id.to_string())).unwrap(); }
        let loaded = cache.load().unwrap();
        assert_eq!(loaded.len(), 50);
        assert_eq!(loaded[0].question_id, "55");
        assert_eq!(loaded[49].question_id, "6");
    }
}
