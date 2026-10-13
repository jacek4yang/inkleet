use inkleet_managed_env::{harness,rpc::Client};
use serde::Serialize;
use serde_json::{json,Value};
use std::{path::PathBuf,sync::{Arc,Mutex,atomic::{AtomicBool,AtomicU64,Ordering},mpsc},time::{Duration,Instant}};
use tauri::Manager as _;
type Result<T>=std::result::Result<T,String>;
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct View{pub id:u64,pub phase:String,pub title:String,pub thread_id:Option<i64>,pub epoch:u64,pub output:String,pub truncated:bool,pub reason:String,pub error:String,pub breakpoints:Vec<Value>}
struct Session{client:Mutex<Option<Arc<Client>>>,view:Arc<Mutex<View>>,source:PathBuf,source_code:String,points_gate:Mutex<()>,_work:tempfile::TempDir,closed:Arc<AtomicBool>}
impl Session{
    fn client(&self)->Result<Arc<Client>>{self.client.lock().map_err(|_|"调试连接不可用")?.clone().ok_or("调试器尚未连接".into())}
    fn stop(&self,reason:&str){
        if self.closed.swap(true,Ordering::AcqRel){return;}
        if let Ok(mut slot)=self.client.lock(){if let Some(client)=slot.take(){client.stop();}}
        if let Ok(mut view)=self.view.lock(){if view.phase!="finished"{view.phase="finished".into();view.reason=reason.into();view.epoch+=1;}}
    }
}
impl Drop for Session{fn drop(&mut self){self.stop("调试会话已关闭");}}
pub struct Debugger{root:PathBuf,next:AtomicU64,starting:AtomicBool,active:Mutex<Option<Arc<Session>>>}
impl Debugger{
    pub fn new(root:PathBuf)->Self{Self{root,next:AtomicU64::new(1),starting:AtomicBool::new(false),active:Mutex::new(None)}}
    fn session(&self,id:u64)->Result<Arc<Session>>{
        let session=self.active.lock().map_err(|_|"调试状态不可用")?.clone().ok_or("没有调试会话")?;
        if session.view.lock().map_err(|_|"调试状态不可用")?.id!=id{return Err("调试会话已改变".into());}
        Ok(session)
    }
    pub fn status(&self)->Result<Option<View>>{
        self.active.lock().map_err(|_|"调试状态不可用")?.as_ref().map(|s|s.view.lock().map(|v|v.clone()).map_err(|_|"调试状态不可用".into())).transpose()
    }
    pub fn stop(&self,id:u64)->Result<()>{self.session(id)?.stop("用户停止");Ok(())}
    pub fn breakpoints(&self,id:u64,code:&str,lines:Vec<u32>)->Result<()>{
        let session=self.session(id)?;
        if code!=session.source_code{return Err("源码已改变；请重新启动调试后应用断点".into());}
        validate_breakpoints(code,&lines)?;
        let _gate=session.points_gate.lock().map_err(|_|"断点状态不可用")?;
        if session.closed.load(Ordering::Acquire)||session.view.lock().map_err(|_|"调试状态不可用")?.phase=="finished"{return Err("调试会话已结束".into());}
        let mut lines=lines;lines.sort_unstable();lines.dedup();
        let requested:Vec<Value>=lines.into_iter().map(|line|json!({"line":line})).collect();
        let response=session.client()?.request("setBreakpoints",json!({"source":{"path":session.source},"breakpoints":requested}),Duration::from_secs(10))?;
        if let Ok(mut view)=session.view.lock(){view.breakpoints=response.get("breakpoints").and_then(Value::as_array).cloned().unwrap_or_default();}
        Ok(())
    }
    pub fn request(&self,id:u64,epoch:u64,kind:&str,reference:i64)->Result<Value>{
        let session=self.session(id)?;
        let (thread,paused)={
            let view=session.view.lock().map_err(|_|"调试状态不可用")?;
            if view.epoch!=epoch{return Err("调试状态已经改变，请重试".into());}
            (view.thread_id,view.phase=="paused")
        };
        let args=match kind{
            "stackTrace" if paused=>json!({"threadId":thread.ok_or("暂停线程缺失")?,"startFrame":0,"levels":64}),
            "scopes" if paused&&reference>0=>json!({"frameId":reference}),
            "variables" if paused&&reference>0=>json!({"variablesReference":reference,"start":0,"count":100}),
            "next"|"stepIn"|"stepOut"|"continue" if paused=>json!({"threadId":thread.ok_or("暂停线程缺失")?}),
            "pause" if !paused=>json!({"threadId":thread.unwrap_or(1)}),
            _=>return Err("当前调试状态不支持该操作".into())
        };
        let response=session.client()?.request(kind,args,Duration::from_secs(10))?;
        if matches!(kind,"stackTrace"|"scopes"|"variables"){
            if session.view.lock().map_err(|_|"调试状态不可用")?.epoch!=epoch{return Err("忽略上一次暂停的结果".into());}
        }
        Ok(response)
    }
}
pub async fn start(app:tauri::AppHandle,snapshot:crate::local_run::Snapshot,lines:Vec<u32>)->Result<u64>{
    if !matches!(snapshot.language.as_str(),"python3"|"golang"|"cpp"|"c")||snapshot.code.len()>2*1024*1024||snapshot.title.len()>512{return Err("当前调试支持有限大小的 Python / Go / C / C++ 源码".into());}
    harness::configuration(&snapshot.metadata,&snapshot.input)?;
    validate_breakpoints(&snapshot.code,&lines)?;
    let state=app.state::<Debugger>();
    if state.starting.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return Err("调试器正在启动".into());}
    drop(state);
    tauri::async_runtime::spawn_blocking(move||->Result<u64>{
        let state=app.state::<Debugger>();
        struct Starting<'a>(&'a AtomicBool);impl Drop for Starting<'_>{fn drop(&mut self){self.0.store(false,Ordering::Release);}}
        let _starting=Starting(&state.starting);
        if state.active.lock().map_err(|_|"调试状态不可用")?.as_ref().is_some_and(|s|s.view.lock().map(|v|v.phase!="finished").unwrap_or(true)){return Err("请先停止现有调试会话".into());}
        if state.root.exists()&&std::fs::symlink_metadata(&state.root).map_err(|_|"调试目录不可用")?.file_type().is_symlink(){return Err("调试目录不能是符号链接".into());}
        std::fs::create_dir_all(&state.root).map_err(|_|"无法创建调试目录")?;
        let work=tempfile::Builder::new().prefix("debug-").tempdir_in(&state.root).map_err(|_|"无法创建调试工作区")?;
        let root=inkleet_managed_env::process::tool_path(&std::fs::canonicalize(work.path()).map_err(|_|"无法解析调试目录")?);
        let source=root.join(match snapshot.language.as_str(){"golang"=>"solution.go","cpp"=>"solution.cpp","c"=>"solution.c",_=>"solution.py"});
        let id=state.next.fetch_add(1,Ordering::Relaxed);
        let session=Arc::new(Session{
            client:Mutex::new(None),view:Arc::new(Mutex::new(View{id,phase:if snapshot.language!="python3"{"compiling"}else{"starting"}.into(),title:snapshot.title.clone(),thread_id:None,epoch:0,output:String::new(),truncated:false,reason:String::new(),error:String::new(),breakpoints:Vec::new()})),
            source,source_code:snapshot.code.clone(),points_gate:Mutex::new(()),_work:work,closed:Arc::new(AtomicBool::new(false))
        });
        let previous=state.active.lock().map_err(|_|"调试状态不可用")?.replace(session.clone());
        if let Some(previous)=previous{previous.stop("新调试会话");}
        let manager=app.state::<crate::managed::Environments>().manager.clone();
        let launch_session=session.clone();
        std::thread::spawn(move||{
            let result=launch(&launch_session,&manager,&root,&snapshot,lines);
            if let Err(error)=result{
                if !launch_session.closed.load(Ordering::Acquire){if let Ok(mut view)=launch_session.view.lock(){view.error=error;}}
                launch_session.stop("启动未完成");
            }
        });
        monitor(&session);
        Ok(id)
    }).await.map_err(|_|"调试启动任务中断".to_owned())?
}
fn launch(session:&Arc<Session>,manager:&inkleet_managed_env::Manager,root:&std::path::Path,snapshot:&crate::local_run::Snapshot,mut lines:Vec<u32>)->Result<()>{
    let launch=crate::debug_launch::prepare(manager,root,snapshot,session.closed.clone())?;
    if session.closed.load(Ordering::Acquire){return Err("调试已停止".into());}
    if let Ok(mut view)=session.view.lock(){view.phase="starting".into();}
    let (initialized_tx,initialized_rx)=mpsc::sync_channel(1);let weak=Arc::downgrade(session);
    let events:Arc<dyn Fn(Value)+Send+Sync>=Arc::new(move|event|{
        let Some(session)=weak.upgrade()else{return};
        if session.closed.load(Ordering::Acquire){return;}
        let name=event.get("event").and_then(Value::as_str).unwrap_or("");
        if name=="initialized"{let _=initialized_tx.try_send(());}
        if let Ok(mut view)=session.view.lock(){
            match name{
                "stopped"=>{view.phase="paused".into();view.thread_id=event.pointer("/body/threadId").and_then(Value::as_i64);view.reason=event.pointer("/body/reason").and_then(Value::as_str).unwrap_or("暂停").chars().take(100).collect();view.epoch+=1;},
                "continued"=>{view.phase="running".into();view.epoch+=1;},
                "terminated"=>{view.phase="finished".into();view.epoch+=1;},
                "output"=>if let Some(text)=event.pointer("/body/output").and_then(Value::as_str){
                    let remaining=(64*1024usize).saturating_sub(view.output.len());let mut end=remaining.min(text.len());
                    while !text.is_char_boundary(end){end-=1;}view.output.push_str(&text[..end]);if end<text.len(){view.truncated=true;}
                },
                _=>{}
            }
        };
    });
    let client=Arc::new(if launch.adapter=="go"{Client::spawn_delve(launch.command,events)?}else{Client::spawn_dap(launch.command,events)?});
    {
        let mut slot=session.client.lock().map_err(|_|"调试连接不可用")?;
        if session.closed.load(Ordering::Acquire){client.stop();return Err("调试已停止".into());}
        *slot=Some(client.clone());
    }
    client.request("initialize",json!({"clientID":"inkleet","adapterID":launch.adapter,"pathFormat":"path","linesStartAt1":true,"columnsStartAt1":true,"supportsVariableType":true,"supportsVariablePaging":true,"supportsRunInTerminalRequest":false}),Duration::from_secs(20))?;
    let launching=client.clone();
    let launch_thread=std::thread::spawn(move||launching.request("launch",launch.arguments,Duration::from_secs(45)));
    initialized_rx.recv_timeout(Duration::from_secs(20)).map_err(|_|"调试器初始化超时")?;
    if session.closed.load(Ordering::Acquire){return Err("调试已停止".into());}
    lines.sort_unstable();lines.dedup();
    let requested:Vec<Value>=lines.into_iter().map(|line|json!({"line":line})).collect();
    let verified=client.request("setBreakpoints",json!({"source":{"path":session.source},"breakpoints":requested}),Duration::from_secs(10))?;
    if let Ok(mut view)=session.view.lock(){if !session.closed.load(Ordering::Acquire){view.breakpoints=verified.get("breakpoints").and_then(Value::as_array).cloned().unwrap_or_default();view.phase="running".into();}}
    client.request("configurationDone",json!({}),Duration::from_secs(10))?;
    launch_thread.join().map_err(|_|"调试启动任务中断")??;
    Ok(())
}
fn monitor(session:&Arc<Session>){
    let weak=Arc::downgrade(session);
    std::thread::spawn(move||{
        let started=Instant::now();let mut running_since=Instant::now();let mut last_epoch=0;let mut was_running=false;
        loop{
            std::thread::sleep(Duration::from_millis(100));
            let Some(session)=weak.upgrade()else{break};
            if session.closed.load(Ordering::Acquire){break;}
            let (phase,epoch,truncated)=match session.view.lock(){Ok(v)=>(v.phase.clone(),v.epoch,v.truncated),Err(_)=>break};
            if phase=="finished"{session.stop("调试完成");break;}
            if phase=="running"&&(!was_running||epoch!=last_epoch){running_since=Instant::now();}
            last_epoch=epoch;was_running=phase=="running";
            if truncated{session.stop("输出超限，调试已终止");break;}
            if session.client().is_ok_and(|client|!client.is_alive()){if let Ok(mut v)=session.view.lock(){v.error="调试器连接中断".into();}session.stop("连接中断");break;}
            if started.elapsed()>Duration::from_secs(1800)||(phase=="running"&&running_since.elapsed()>Duration::from_secs(30)){session.stop("调试运行超时");break;}
        }
    });
}

fn validate_breakpoints(code:&str,lines:&[u32])->Result<()>{
    if code.len()>2*1024*1024||lines.len()>200||lines.iter().any(|&line|line==0||line as usize>code.lines().count().max(1)){return Err("断点行号超出源码范围".into());}
    Ok(())
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn breakpoint_updates_are_bounded(){
        assert!(validate_breakpoints("a\nb",&[1,2,2]).is_ok());
        assert!(validate_breakpoints("a",&[]).is_ok());
        assert!(validate_breakpoints("a",&[0]).is_err());
        assert!(validate_breakpoints("a",&[2]).is_err());
        assert!(validate_breakpoints("a",&vec![1;201]).is_err());
    }
}
