//! A bounded JSON-RPC stdio client for trusted language servers.
//! Reader/writer threads keep pipe I/O off the GUI and async executor threads.
use crate::protocol::{read_message, write_message};
use serde_json::{json, Value};
use std::{collections::HashMap, io::{BufReader, Read}, process::{Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}, mpsc}, time::Duration};
type Reply = std::result::Result<Value, String>;
struct Shared {
    pending: Mutex<HashMap<u64,mpsc::SyncSender<Reply>>>,
    dead: AtomicBool,
}
pub struct Client {
    child: Mutex<Box<dyn process_wrap::std::ChildWrapper>>, shared: Arc<Shared>, outgoing: mpsc::SyncSender<Value>, next: Arc<AtomicU64>, dap: bool, stopped: AtomicBool, stderr: Arc<Mutex<String>>,
}
impl Client {
    pub fn spawn(command: Command, settings: Value, event: Arc<dyn Fn(Value)+Send+Sync>) -> Result<Self,String> {
        Self::spawn_inner(command,settings,event,false)
    }
    pub fn spawn_dap(command: Command, event: Arc<dyn Fn(Value)+Send+Sync>) -> Result<Self,String> {
        Self::spawn_inner(command,Value::Null,event,true)
    }
    fn spawn_inner(mut command: Command, settings: Value, event: Arc<dyn Fn(Value)+Send+Sync>, dap:bool) -> Result<Self,String> {
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child=crate::process::spawn(command).map_err(|e|format!("无法启动语言服务：{e}"))?;
        let stdin=child.stdin().take().ok_or("语言服务缺少输入管道")?;
        let stdout=child.stdout().take().ok_or("语言服务缺少输出管道")?;
        let stderr=child.stderr().take().ok_or("语言服务缺少错误管道")?;
        let shared=Arc::new(Shared{pending:Mutex::new(HashMap::new()),dead:AtomicBool::new(false)});
        let (outgoing,rx)=mpsc::sync_channel::<Value>(64);
        let writer_shared=shared.clone();
        std::thread::spawn(move || {
            let mut stdin=stdin;
            for value in rx {
                if write_message(&mut stdin,&value).is_err(){break;}
            }
            fail_all(&writer_shared);
        });
        let reader_shared=shared.clone();let writer=outgoing.clone();
        let next=Arc::new(AtomicU64::new(1));let reply_sequence=next.clone();
        std::thread::spawn(move || {
            let mut reader=BufReader::new(stdout);
            while let Ok(value)=read_message(&mut reader) {
                if dap {
                    match value.get("type").and_then(Value::as_str) {
                        Some("response")=>{
                            if let Some(id)=value.get("request_seq").and_then(Value::as_u64){
                                if let Ok(mut pending)=reader_shared.pending.lock(){
                                    if let Some(tx)=pending.remove(&id){
                                        let result=if value.get("success").and_then(Value::as_bool)==Some(true){Ok(value.get("body").cloned().unwrap_or(Value::Null))}
                                            else{Err(value.get("message").and_then(Value::as_str).unwrap_or("调试器拒绝了请求").chars().take(1000).collect())};
                                        let _=tx.try_send(result);
                                    }
                                }
                            }
                        },
                        Some("event")=>event(value),
                        Some("request")=>{
                            // No terminal, arbitrary process or command execution requested by an adapter.
                            let response=json!({"seq":reply_sequence.fetch_add(1,Ordering::Relaxed),"type":"response","request_seq":value.get("seq"),"command":value.get("command"),"success":false,"message":"Unsupported reverse request"});
                            if writer.try_send(response).is_err(){break;}
                        },
                        _=>break,
                    }
                    continue;
                }

                if value.get("method").is_none() {
                    if let Some(id)=value.get("id").and_then(Value::as_u64) {
                        if let Ok(mut pending)=reader_shared.pending.lock() {
                            if let Some(tx)=pending.remove(&id) {
                                let result=if let Some(error)=value.get("error"){
                                    let code=error.get("code").and_then(Value::as_i64).unwrap_or(0);
                                    let message=error.get("message").and_then(Value::as_str).unwrap_or("请求失败").chars().take(1000).collect::<String>();
                                    Err(format!("语言服务请求错误（{code}）：{message}"))
                                }
                                    else {Ok(value.get("result").cloned().unwrap_or(Value::Null))};
                                let _=tx.try_send(result);
                            }
                        }
                    }
                } else if let Some(id)=value.get("id") {
                    let method=value.get("method").and_then(Value::as_str).unwrap_or("");
                    let response=match method {
                        "workspace/configuration"=>{
                            let items=value.pointer("/params/items").and_then(Value::as_array).cloned().unwrap_or_default();
                            let result:Vec<Value>=items.iter().take(64).map(|item|match item.get("section").and_then(Value::as_str) {
                                Some("python")=>settings.clone(),Some("python.analysis")=>settings.get("analysis").cloned().unwrap_or(json!({})),
                                Some(section)=>settings.get(section).cloned().unwrap_or(json!({})),None=>settings.clone(),
                            }).collect();
                            json!({"jsonrpc":"2.0","id":id,"result":result})
                        },
                        "workspace/applyEdit"=>json!({"jsonrpc":"2.0","id":id,"result":{"applied":false,"failureReason":"Server-initiated edits require explicit client support"}}),
                        "client/registerCapability"|"client/unregisterCapability"|"window/workDoneProgress/create"=>json!({"jsonrpc":"2.0","id":id,"result":null}),
                        _=>json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Unsupported client method"}}),
                    };
                    if writer.try_send(response).is_err(){break;}
                } else { event(value); }
            }
            fail_all(&reader_shared);
        });
        // Drain without retaining or printing paths/source text from diagnostics logs.
        let stderr_text=Arc::new(Mutex::new(String::new()));let captured=stderr_text.clone();
        std::thread::spawn(move || {
            let mut reader=stderr;let mut buffer=[0u8;4096];
            while let Ok(n)=reader.read(&mut buffer){if n==0{break;}if let Ok(mut text)=captured.lock(){if text.len()<8192{
                let chunk=String::from_utf8_lossy(&buffer[..n]);let mut end=(8192-text.len()).min(chunk.len());while !chunk.is_char_boundary(end){end-=1;}text.push_str(&chunk[..end]);
            }}}
        });
        Ok(Self{child:Mutex::new(child),shared,outgoing,next,dap,stopped:AtomicBool::new(false),stderr:stderr_text})
    }
    pub fn notify(&self,method:&str,params:Value)->Result<(),String>{
        if self.shared.dead.load(Ordering::Acquire){return Err("语言服务已退出；请重新连接".into());}
        self.outgoing.try_send(json!({"jsonrpc":"2.0","method":method,"params":params})).map_err(|_|"语言服务队列繁忙，请稍后重试".into())
    }
    pub fn request(&self,method:&str,params:Value,timeout:Duration)->Reply{
        if self.shared.dead.load(Ordering::Acquire){return Err("语言服务已退出".into());}
        let id=self.next.fetch_add(1,Ordering::Relaxed);
        let (tx,rx)=mpsc::sync_channel(1);
        {
            let mut pending=self.shared.pending.lock().map_err(|_|"语言服务状态不可用")?;
            if pending.len()>=32{return Err("语言服务请求过多".into());}
            pending.insert(id,tx);
        }
        let message=if self.dap{json!({"seq":id,"type":"request","command":method,"arguments":params})}else{json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})};
        let sent=self.outgoing.try_send(message);
        let result=if sent.is_err(){Err("语言服务队列已满".into())}
            else{rx.recv_timeout(timeout).unwrap_or_else(|_|Err("语言服务请求超时或连接中断".into()))};
        if let Ok(mut pending)=self.shared.pending.lock(){pending.remove(&id);}
        if result.is_err()&&!self.dap{let _=self.notify("$/cancelRequest",json!({"id":id}));}
        result
    }
    pub fn stderr(&self)->String{self.stderr.lock().map(|s|s.clone()).unwrap_or_default()}
    pub fn is_alive(&self)->bool{!self.shared.dead.load(Ordering::Acquire)}
    pub fn stop(&self){
        if self.stopped.swap(true,Ordering::AcqRel){return;}
        fail_all(&self.shared);
        if let Ok(mut child)=self.child.lock(){crate::process::terminate(child.as_mut());}
    }
}
fn fail_all(shared:&Shared){
    shared.dead.store(true,Ordering::Release);
    if let Ok(mut pending)=shared.pending.lock(){for (_,tx) in pending.drain(){let _=tx.try_send(Err("语言服务连接已关闭".into()));}}
}
impl Drop for Client { fn drop(&mut self){self.stop();} }
