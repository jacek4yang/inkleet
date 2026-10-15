//! Owned LSP requests. All state transitions are bounded and independent of pipe I/O.
//! Lock order is always owned -> pending. Only the writer touches the pipe.
use super::{Reply, Shared};
use crate::protocol::write_message;
use serde_json::{json, Value};
use std::{collections::HashMap, io::Write, sync::{Arc, atomic::Ordering, mpsc}, time::Duration};

pub(super) const MAX_OWNED: usize = 32;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Phase { Queued, Writing, Sent, CancelWriting }
pub(super) struct Entry { phase: Phase, cancelled: bool, completed: bool }
pub(super) type Entries = HashMap<u64, Entry>;
#[derive(Debug)]
pub(super) enum Outgoing { Plain(Value), Owned { id: u64, value: Value }, Wake }

/// A cloned cancellation capability never owns the request lifetime.
#[derive(Clone)]
pub struct RequestCanceller {
    id: u64,
    shared: Arc<Shared>,
    outgoing: mpsc::SyncSender<Outgoing>,
}
impl RequestCanceller {
    /// Local cancellation never waits for a server response or pipe capacity.
    pub fn cancel(&self) {
        let mut wake = false;
        if let Ok(mut owned) = self.shared.owned.lock() {
            if let Some(entry) = owned.get_mut(&self.id) {
                wake = !entry.cancelled && !entry.completed;
                if !entry.completed { entry.cancelled = true; }
                if let Ok(mut pending) = self.shared.pending.lock() {
                    if let Some(tx) = pending.remove(&self.id) {
                        let _ = tx.try_send(Err("补全请求已取消".into()));
                    }
                }
            }
        }
        // If full, the queued work already wakes the writer. Cancellation state
        // remains in the bounded map until that writer skips or drains it.
        if wake { let _ = self.outgoing.try_send(Outgoing::Wake); }
    }
}

/// Dropping the owner cancels unfinished work; dropping a canceller does not.
pub struct OwnedRequest { cancel: RequestCanceller, receiver: mpsc::Receiver<Reply> }
impl OwnedRequest {
    pub fn canceller(&self) -> RequestCanceller { self.cancel.clone() }
    pub fn wait(self, timeout: Duration) -> Reply {
        self.receiver.recv_timeout(timeout)
            .unwrap_or_else(|_| Err("语言服务请求超时或连接中断".into()))
        // Drop cancels a timed-out request. Successful responses have already
        // removed the record; error responses retain a bounded cancel record.
    }
}
impl Drop for OwnedRequest { fn drop(&mut self) { self.cancel.cancel(); } }

pub(super) fn begin(shared: &Arc<Shared>, outgoing: &mpsc::SyncSender<Outgoing>,
    id: u64, method: &str, params: Value) -> Result<OwnedRequest, String> {
    let (tx, receiver) = mpsc::sync_channel(1);
    let mut owned = shared.owned.lock().map_err(|_| "语言服务状态不可用")?;
    let mut pending = shared.pending.lock().map_err(|_| "语言服务状态不可用")?;
    if shared.dead.load(Ordering::Acquire) { return Err("语言服务已退出".into()); }
    if owned.len() >= MAX_OWNED || pending.len() >= 32 { return Err("语言服务请求过多".into()); }
    owned.insert(id, Entry { phase: Phase::Queued, cancelled: false, completed: false });
    pending.insert(id, tx);
    let value = json!({"jsonrpc":"2.0","id":id,"method":method,"params":params});
    if outgoing.try_send(Outgoing::Owned { id, value }).is_err() {
        pending.remove(&id); owned.remove(&id);
        return Err("语言服务队列已满".into());
    }
    Ok(OwnedRequest { cancel: RequestCanceller { id, shared: shared.clone(), outgoing: outgoing.clone() }, receiver })
}

/// LSP response delivery and cancellation share a single terminal ordering.
pub(super) fn deliver(shared: &Shared, outgoing: &mpsc::SyncSender<Outgoing>, id: u64, result: Reply) {
    let mut wake = false;
    if let Ok(mut owned) = shared.owned.lock() {
        if let Ok(mut pending) = shared.pending.lock() {
            if let Some(entry) = owned.get_mut(&id) {
                if result.is_err() || entry.cancelled {
                    // Preserve error-response cancellation, and keep an already
                    // canceled transport record bounded until the writer drains it.
                    entry.cancelled = true; wake = true;
                } else if entry.phase == Phase::Sent {
                    owned.remove(&id);
                } else {
                    entry.completed = true;
                }
            }
            if let Some(tx) = pending.remove(&id) { let _ = tx.try_send(result); }
        }
    }
    if wake { let _ = outgoing.try_send(Outgoing::Wake); }
}

/// Retain the record while the cancel frame is blocked, keeping the strict
/// MAX_OWNED bound inclusive of cancellation frames currently being written.
pub(super) fn drain(shared: &Shared, output: &mut impl Write) -> std::io::Result<()> {
    let ids = {
        let mut owned = shared.owned.lock().map_err(|_| std::io::Error::other("RPC state poisoned"))?;
        let mut ids = Vec::new();
        for (&id, entry) in owned.iter_mut() {
            if entry.cancelled && entry.phase == Phase::Sent {
                entry.phase = Phase::CancelWriting; ids.push(id);
            }
        }
        ids
    };
    for id in ids {
        write_message(output, &json!({"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":id}}))?;
        if let Ok(mut owned) = shared.owned.lock() { owned.remove(&id); }
    }
    Ok(())
}

pub(super) fn dispatch(shared: &Shared, output: &mut impl Write, message: Outgoing) -> std::io::Result<()> {
    drain(shared, output)?;
    match message {
        Outgoing::Plain(value) => write_message(output, &value),
        Outgoing::Wake => Ok(()),
        Outgoing::Owned { id, value } => {
            let send = {
                let mut owned = shared.owned.lock().map_err(|_| std::io::Error::other("RPC state poisoned"))?;
                match owned.get_mut(&id) {
                    Some(entry) if !entry.cancelled && !entry.completed => { entry.phase = Phase::Writing; true }
                    _ => { owned.remove(&id); false }
                }
            };
            if !send { return Ok(()); }
            write_message(output, &value)?;
            if let Ok(mut owned) = shared.owned.lock() {
                if let Some(entry) = owned.get_mut(&id) {
                    if entry.completed { owned.remove(&id); } else { entry.phase = Phase::Sent; }
                }
            }
            drain(shared, output)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::{Mutex, atomic::AtomicBool};
    fn setup() -> (Arc<Shared>, mpsc::SyncSender<Outgoing>, mpsc::Receiver<Outgoing>) {
        let shared=Arc::new(Shared{owned:Mutex::new(HashMap::new()),pending:Mutex::new(HashMap::new()),dead:AtomicBool::new(false)});
        let (tx,rx)=mpsc::sync_channel(64); (shared,tx,rx)
    }
    fn request(s:&Arc<Shared>,tx:&mpsc::SyncSender<Outgoing>,id:u64)->OwnedRequest {
        begin(s,tx,id,"textDocument/completion",json!({})).unwrap()
    }
    fn messages(bytes:Vec<u8>)->Vec<Value>{
        let mut input=Cursor::new(bytes);let mut values=Vec::new();
        while (input.position() as usize)<input.get_ref().len(){values.push(crate::protocol::read_message(&mut input).unwrap());}
        values
    }
    #[test] fn queued_cancel_skips_both_frames_and_releases_waiter(){
        let (s,tx,rx)=setup();let r=request(&s,&tx,1);let c=r.canceller();c.cancel();c.cancel();
        assert_eq!(r.wait(Duration::ZERO).unwrap_err(),"补全请求已取消");
        assert!(s.pending.lock().unwrap().is_empty());
        assert_eq!(s.owned.lock().unwrap().len(),1);
        let mut wire=Vec::new();for item in rx.try_iter(){dispatch(&s,&mut wire,item).unwrap();}
        assert!(wire.is_empty());assert!(s.owned.lock().unwrap().is_empty());
    }
    #[test] fn sent_silent_request_cancels_once_without_waiting_for_server(){
        let (s,tx,rx)=setup();let r=request(&s,&tx,1);let c=r.canceller();let mut wire=Vec::new();
        dispatch(&s,&mut wire,rx.recv().unwrap()).unwrap();
        assert_eq!(messages(wire.clone())[0]["id"],1);
        c.cancel();c.cancel();assert_eq!(r.wait(Duration::ZERO).unwrap_err(),"补全请求已取消");
        assert!(s.pending.lock().unwrap().is_empty());
        for item in rx.try_iter(){dispatch(&s,&mut wire,item).unwrap();}
        let frames=messages(wire);assert_eq!(frames.len(),2);assert_eq!(frames[1]["params"]["id"],1);
        assert_eq!(frames[1]["method"],"$/cancelRequest");assert!(s.owned.lock().unwrap().is_empty());
    }
    struct GateWriter { bytes:Vec<u8>, entered:mpsc::SyncSender<()>, release:mpsc::Receiver<()>, first:bool }
    impl Write for GateWriter {
        fn write(&mut self,buf:&[u8])->std::io::Result<usize>{
            if self.first{self.first=false;self.entered.send(()).unwrap();self.release.recv_timeout(Duration::from_secs(5)).unwrap();}
            self.bytes.extend_from_slice(buf);Ok(buf.len())
        }
        fn flush(&mut self)->std::io::Result<()>{Ok(())}
    }
    #[test] fn writing_cancel_is_local_then_wire_ordered_after_full_request(){
        let (s,tx,rx)=setup();let r=request(&s,&tx,7);let c=r.canceller();
        let (entered,ready)=mpsc::sync_channel(1);let (release,gate)=mpsc::sync_channel(1);let state=s.clone();
        let thread=std::thread::spawn(move||{
            let mut writer=GateWriter{bytes:Vec::new(),entered,release:gate,first:true};
            dispatch(&state,&mut writer,rx.recv().unwrap()).unwrap();writer.bytes
        });
        ready.recv_timeout(Duration::from_secs(5)).unwrap();
        c.cancel();assert_eq!(r.wait(Duration::ZERO).unwrap_err(),"补全请求已取消");
        assert!(s.pending.lock().unwrap().is_empty());
        assert_eq!(s.owned.lock().unwrap().get(&7).unwrap().phase,Phase::Writing);
        release.send(()).unwrap();let frames=messages(thread.join().unwrap());
        assert_eq!(frames.len(),2);assert_eq!(frames[0]["id"],7);assert_eq!(frames[1]["params"]["id"],7);
        assert!(s.owned.lock().unwrap().is_empty());
    }
    #[test] fn cancelled_transport_records_stay_bounded_even_after_pending_is_empty(){
        let (s,tx,rx)=setup();
        for id in 1..=MAX_OWNED as u64{let r=request(&s,&tx,id);r.canceller().cancel();drop(r);}
        assert!(s.pending.lock().unwrap().is_empty());assert_eq!(s.owned.lock().unwrap().len(),MAX_OWNED);
        assert!(begin(&s,&tx,100,"textDocument/completion",json!({})).is_err());
        let mut wire=Vec::new();for item in rx.try_iter(){dispatch(&s,&mut wire,item).unwrap();}
        assert!(wire.is_empty());assert!(s.owned.lock().unwrap().is_empty());
        let next=request(&s,&tx,101);drop(next);
    }
    #[test] fn full_normal_queue_cannot_lose_sent_cancellation(){
        let (s,tx,rx)=setup();let r=request(&s,&tx,1);let mut wire=Vec::new();
        dispatch(&s,&mut wire,rx.recv().unwrap()).unwrap();
        for _ in 0..64{tx.try_send(Outgoing::Plain(json!({"jsonrpc":"2.0","method":"notification"}))).unwrap();}
        r.canceller().cancel();assert_eq!(r.wait(Duration::ZERO).unwrap_err(),"补全请求已取消");
        for item in rx.try_iter(){dispatch(&s,&mut wire,item).unwrap();}
        let frames=messages(wire);assert_eq!(frames.len(),66);assert_eq!(frames[1]["method"],"$/cancelRequest");
        assert!(s.owned.lock().unwrap().is_empty());
    }
    #[test] fn failed_admission_leaves_no_records(){
        let (s,tx,_rx)=setup();
        for _ in 0..64{tx.try_send(Outgoing::Wake).unwrap();}
        assert!(begin(&s,&tx,1,"x",json!({})).is_err());
        assert!(s.pending.lock().unwrap().is_empty());assert!(s.owned.lock().unwrap().is_empty());
        super::super::fail_all(&s);
        assert!(matches!(begin(&s,&tx,2,"x",json!({})),Err(error) if error.contains("已退出")));
    }
    #[test] fn success_and_canceller_drop_do_not_cancel_completed_work(){
        let (s,tx,rx)=setup();let r=request(&s,&tx,1);drop(r.canceller());let mut wire=Vec::new();
        dispatch(&s,&mut wire,rx.recv().unwrap()).unwrap();
        deliver(&s,&tx,1,Ok(json!({"items":[]})));
        assert_eq!(r.wait(Duration::ZERO).unwrap(),json!({"items":[]}));
        assert!(rx.try_recv().is_err());assert_eq!(messages(wire).len(),1);
        assert!(s.pending.lock().unwrap().is_empty());assert!(s.owned.lock().unwrap().is_empty());
    }
    #[test] fn error_response_preserves_cancel_and_timeout_releases_waiter(){
        let (s,tx,rx)=setup();let r=request(&s,&tx,1);let mut wire=Vec::new();
        dispatch(&s,&mut wire,rx.recv().unwrap()).unwrap();
        deliver(&s,&tx,1,Err("server error".into()));
        assert_eq!(r.wait(Duration::ZERO).unwrap_err(),"server error");
        for item in rx.try_iter(){dispatch(&s,&mut wire,item).unwrap();}
        assert_eq!(messages(wire).len(),2);assert!(s.owned.lock().unwrap().is_empty());
        let r=request(&s,&tx,2);assert!(r.wait(Duration::ZERO).is_err());
        let mut skipped=Vec::new();for item in rx.try_iter(){dispatch(&s,&mut skipped,item).unwrap();}
        assert!(skipped.is_empty());assert!(s.pending.lock().unwrap().is_empty());
    }
    #[test] fn transport_failure_wakes_owned_and_legacy_and_rejects_late_admission(){
        let (s,tx,_rx)=setup();let r=request(&s,&tx,1);
        let (legacy,reply)=mpsc::sync_channel(1);s.pending.lock().unwrap().insert(2,legacy);
        super::super::fail_all(&s);
        assert_eq!(r.wait(Duration::ZERO).unwrap_err(),"语言服务连接已关闭");
        assert!(reply.recv_timeout(Duration::ZERO).unwrap().is_err());
        assert!(s.pending.lock().unwrap().is_empty());assert!(s.owned.lock().unwrap().is_empty());
        assert!(begin(&s,&tx,3,"x",json!({})).is_err());
    }
    #[test] fn response_cancel_race_has_one_terminal_result_and_no_leak(){
        for _ in 0..32{
            let (s,tx,rx)=setup();let r=request(&s,&tx,1);let c=r.canceller();let mut wire=Vec::new();
            dispatch(&s,&mut wire,rx.recv().unwrap()).unwrap();
            let barrier=Arc::new(std::sync::Barrier::new(3));
            std::thread::scope(|scope|{
                let a=barrier.clone();scope.spawn(move||{a.wait();c.cancel();});
                let b=barrier.clone();let state=&s;let sender=&tx;
                scope.spawn(move||{b.wait();deliver(state,sender,1,Ok(json!(7)));});
                barrier.wait();
            });
            let reply=r.wait(Duration::ZERO);
            assert!(reply==Ok(json!(7))||reply==Err("补全请求已取消".into()));
            for item in rx.try_iter(){dispatch(&s,&mut wire,item).unwrap();}
            assert!(s.pending.lock().unwrap().is_empty());assert!(s.owned.lock().unwrap().is_empty());
            assert!(messages(wire).len()<=2);
        }
    }
    #[test] fn plain_dap_and_legacy_lsp_frames_are_unchanged(){
        let (s,_tx,_rx)=setup();let mut wire=Vec::new();
        let values=[json!({"seq":4,"type":"request","command":"next","arguments":{"threadId":1}}),
            json!({"jsonrpc":"2.0","id":8,"method":"textDocument/hover","params":{}})];
        for value in &values{dispatch(&s,&mut wire,Outgoing::Plain(value.clone())).unwrap();}
        assert_eq!(messages(wire),values);assert!(s.owned.lock().unwrap().is_empty());
    }
}
