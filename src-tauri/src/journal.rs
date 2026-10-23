//! 评测快照日志：写请求之前先原子落盘，崩溃后宁可标为未知，也不偷偷重发。
//! 只保存在用户应用数据目录；不包含 Cookie、CSRF、密码或其他凭据。
use std::{path::PathBuf, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use serde::{Serialize, Deserialize};
use serde_json::Value;
use crate::{storage, judge_transport::{Snapshot, validate}};

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum State {
    Waiting { server_id: String },
    Finished { server_id: String, result: Value },
    Rejected { message: String },
    Unknown { message: String },
    Acknowledged { message: String },
}
impl State {
    fn blocks(&self) -> bool { matches!(self, Self::Waiting { .. } | Self::Unknown { .. }) }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Record { pub snapshot: Snapshot, pub state: State, pub created: u64 }
pub struct Journal { path: PathBuf, gate: Mutex<()> }
impl Journal {
    pub fn new(root: PathBuf) -> Self { Self { path: root.join("judge-operations.json"), gate: Mutex::new(()) } }
    fn read(&self) -> Result<(Option<String>, Vec<Record>), String> {
        if self.path.is_symlink() { return Err("拒绝符号链接评测日志".into()); }
        let previous = storage::read(&self.path)?;
        let records: Vec<Record> = match previous.as_deref() {
            Some(text) => serde_json::from_str(text).map_err(|_| "评测日志损坏，未覆盖；请先核查官方提交记录")?,
            None => Vec::new(),
        };
        if records.len() > 20 || records.iter().any(|r| validate(&r.snapshot).is_err()) {
            return Err("评测日志格式异常，已禁止自动发送".into());
        }
        Ok((previous, records))
    }
    fn write(&self, previous: Option<&str>, records: &[Record]) -> Result<(), String> {
        let text = serde_json::to_string(records).map_err(|_| "评测日志编码失败")?;
        storage::save(&self.path, previous, &text)
    }
    // false 表示同一操作已经存在，调用方必须直接返回，不能重发请求。
    pub fn reserve(&self, snapshot: Snapshot) -> Result<(Record, bool), String> {
        validate(&snapshot)?;
        let _lock = self.gate.lock().map_err(|_| "评测日志锁不可用")?;
        let (previous, mut records) = self.read()?;
        if let Some(existing) = records.iter().find(|r| r.snapshot.id == snapshot.id) {
            if existing.snapshot != snapshot { return Err("操作 ID 被复用，拒绝发送".into()); }
            return Ok((existing.clone(), false));
        }
        if records.iter().any(|r| r.snapshot.account == snapshot.account
            && r.snapshot.question_id == snapshot.question_id && r.state.blocks()) {
            return Err("这道题仍有待查询或待核查的评测，未重复发送".into());
        }
        // 仅回收已结束的旧评测快照；不修改普通源码/笔记，也不丢弃未知操作。
        if records.len() >= 20 {
            if let Some(index) = records.iter().position(|r| !r.state.blocks()) { records.remove(index); }
            else { return Err("待核查评测过多，请先处理已有操作".into()); }
        }
        let record = Record { snapshot, state: State::Unknown {
            message: "操作已记录；若请求过程被中断，发送状态未知，必须先核查".into(),
        }, created: SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "系统时间无效")?.as_secs() };
        records.push(record.clone());
        while serde_json::to_vec(&records).map_err(|_| "评测日志编码失败")?.len() > 2 * 1024 * 1024 {
            if let Some(index) = records.iter().position(|r| !r.state.blocks()) { records.remove(index); }
            else { return Err("待确认快照超过容量限制；本次请求未发送".into()); }
        }
        self.write(previous.as_deref(), &records)?;
        Ok((record, true))
    }
    pub fn get(&self, account: &str, id: &str) -> Result<Record, String> {
        let _lock = self.gate.lock().map_err(|_| "评测日志锁不可用")?;
        self.read()?.1.into_iter().find(|r| r.snapshot.account == account && r.snapshot.id == id)
            .ok_or("评测记录不存在或账号不匹配".into())
    }
    pub fn list(&self, account: &str) -> Result<Vec<Record>, String> {
        let _lock = self.gate.lock().map_err(|_| "评测日志锁不可用")?;
        Ok(self.read()?.1.into_iter().filter(|r| r.snapshot.account == account).collect())
    }
    pub fn update(&self, account: &str, id: &str, next: State) -> Result<Record, String> {
        let _lock = self.gate.lock().map_err(|_| "评测日志锁不可用")?;
        let (previous, mut records) = self.read()?;
        let record = records.iter_mut().find(|r| r.snapshot.account == account && r.snapshot.id == id)
            .ok_or("评测记录不存在或账号不匹配")?;
        let allowed = match (&record.state, &next) {
            (State::Unknown { .. }, State::Waiting { .. } | State::Rejected { .. } | State::Unknown { .. } | State::Acknowledged { .. }) => true,
            (State::Waiting { server_id: a }, State::Finished { server_id: b, .. }) => a == b,
            _ => false,
        };
        if !allowed { return Err("评测状态已经变化，忽略过期更新".into()); }
        record.state = next;
        let result = record.clone();
        while serde_json::to_vec(&records).map_err(|_| "评测日志编码失败")?.len() > 2 * 1024 * 1024 {
            if let Some(index) = records.iter().position(|r| r.snapshot.id != id && !r.state.blocks()) { records.remove(index); }
            else { return Err("结果存储容量不足；保留原评测编号，可稍后查询".into()); }
        }
        self.write(previous.as_deref(), &records)?;
        Ok(result)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::judge_transport::Kind;
    fn snapshot(id: &str) -> Snapshot {
        Snapshot { solution:None, id: id.into(), account: "fixture-account".into(), question_id: "1".into(),
            slug: "fixture".into(), language: "rust".into(), code: "// authored journal fixture".into(),
            test_case: "[1]".into(), kind: Kind::Submission }
    }
    #[test]
    fn reserve_survives_restart_and_blocks_duplicate_submission() {
        let root = tempfile::tempdir().unwrap();
        let journal = Journal::new(root.path().into());
        assert!(journal.reserve(snapshot("one")).unwrap().1);
        assert!(!journal.reserve(snapshot("one")).unwrap().1);
        let restarted = Journal::new(root.path().into());
        assert!(matches!(restarted.get("fixture-account", "one").unwrap().state, State::Unknown { .. }));
        assert!(restarted.reserve(snapshot("two")).is_err());
        restarted.update("fixture-account", "one", State::Acknowledged { message: "user verified".into() }).unwrap();
        assert!(restarted.reserve(snapshot("two")).unwrap().1);
    }
    #[test]
    fn account_and_operation_snapshots_cannot_be_mixed() {
        let root = tempfile::tempdir().unwrap();
        let journal = Journal::new(root.path().into());
        journal.reserve(snapshot("one")).unwrap();
        let mut changed = snapshot("one"); changed.code = "// different".into();
        assert!(journal.reserve(changed).is_err());
        assert!(journal.get("other-account", "one").is_err());
        journal.update("fixture-account", "one", State::Waiting { server_id: "123".into() }).unwrap();
        assert!(journal.update("fixture-account", "one", State::Finished { server_id: "999".into(), result: Value::Null }).is_err());
        journal.update("fixture-account", "one", State::Finished { server_id: "123".into(), result: serde_json::json!({"status_msg":"Wrong Answer"}) }).unwrap();
        assert!(journal.reserve(snapshot("two")).unwrap().1);
    }
    #[test]
    fn broken_journal_never_authorizes_a_new_send() {
        let root = tempfile::tempdir().unwrap();
        let journal = Journal::new(root.path().into());
        std::fs::write(&journal.path, "broken").unwrap();
        assert!(journal.reserve(snapshot("one")).is_err());
        assert_eq!(std::fs::read_to_string(&journal.path).unwrap(), "broken");
    }
}
