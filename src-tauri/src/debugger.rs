use inkleet_managed_env::{harness,rpc::Client};
use serde::Serialize;
use serde_json::{json,Value};
use std::{path::PathBuf,process::Command,sync::{Arc,Mutex,atomic::{AtomicBool,AtomicU64,Ordering},mpsc},time::{Duration,Instant}};
use tauri::Manager as _;
type Result<T>=std::result::Result<T,String>;
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct View{pub id:u64,pub phase:String,pub title:String,pub thread_id:Option<i64>,pub epoch:u64,pub output:String,pub truncated:bool,pub reason:String,pub error:String,pub breakpoints:Vec<Value>}
struct Session{client:Client,view:Arc<Mutex<View>>,source:PathBuf,_work:tempfile::TempDir,closed:AtomicBool}
impl Session{
    fn stop(&self,reason:&str){
        if self.closed.swap(true,Ordering::AcqRel){return;}
        self.client.stop();
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
        let response=session.client.request(kind,args,Duration::from_secs(10))?;
        if matches!(kind,"stackTrace"|"scopes"|"variables"){
            if session.view.lock().map_err(|_|"调试状态不可用")?.epoch!=epoch{return Err("忽略上一次暂停的结果".into());}
        }
        Ok(response)
    }
}
pub async fn start(app:tauri::AppHandle,snapshot:crate::local_run::Snapshot,lines:Vec<u32>)->Result<u64>{
    if snapshot.language!="python3"||snapshot.code.len()>2*1024*1024||snapshot.title.len()>512{return Err("当前调试仅支持有限大小的 Python 源码".into());}
    harness::configuration(&snapshot.metadata,&snapshot.input)?;
    if lines.len()>200||lines.iter().any(|&line|line==0||line as usize>snapshot.code.lines().count().max(1)){return Err("断点行号超出源码范围".into());}
    let state=app.state::<Debugger>();
    if state.starting.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return Err("调试器正在启动".into());}
    drop(state);
    tauri::async_runtime::spawn_blocking(move||->Result<u64>{
        let state=app.state::<Debugger>();
        struct Starting<'a>(&'a AtomicBool);impl Drop for Starting<'_>{fn drop(&mut self){self.0.store(false,Ordering::Release);}}
        let _starting=Starting(&state.starting);
        if state.active.lock().map_err(|_|"调试状态不可用")?.as_ref().is_some_and(|s|s.view.lock().map(|v|v.phase!="finished").unwrap_or(true)){return Err("请先停止现有调试会话".into());}
        let tools=app.state::<crate::managed::Environments>();
        let python=tools.manager.installed("python")?.ok_or("请先安装 Python")?;
        let adapter=tools.manager.installed("debugpy")?.ok_or("请先在开发环境安装 Python 调试器")?;
        let adapter_root=adapter.parent().and_then(std::path::Path::parent).and_then(std::path::Path::parent).ok_or("调试器目录无效")?;
        if state.root.exists()&&std::fs::symlink_metadata(&state.root).map_err(|_|"调试目录不可用")?.file_type().is_symlink(){return Err("调试目录不能是符号链接".into());}
        std::fs::create_dir_all(&state.root).map_err(|_|"无法创建调试目录")?;
        let work=tempfile::Builder::new().prefix("python-").tempdir_in(&state.root).map_err(|_|"无法创建调试工作区")?;
        let root=std::fs::canonicalize(work.path()).map_err(|_|"无法解析调试目录")?;
        harness::prepare(&root,&snapshot.code,&snapshot.metadata,&snapshot.input)?;
        let source=root.join("solution.py");let id=state.next.fetch_add(1,Ordering::Relaxed);
        let view=Arc::new(Mutex::new(View{id,phase:"starting".into(),title:snapshot.title,thread_id:None,epoch:0,output:String::new(),truncated:false,reason:String::new(),error:String::new(),breakpoints:Vec::new()}));
        let events=view.clone();let(initialized_tx,initialized_rx)=mpsc::sync_channel(1);
        let mut command=Command::new(&python);
        command.args(["-I","-c","import sys,runpy;sys.path.insert(0,sys.argv[1]);sys.argv=['debugpy.adapter'];runpy.run_module('debugpy.adapter',run_name='__main__')"]).arg(adapter_root)
            .current_dir(&root).env_clear().env("PATH",python.parent().ok_or("Python 路径无效")?).env("HOME",&root).env("USERPROFILE",&root).env("TMP",&root).env("TEMP",&root);
        if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
        let client=Client::spawn_dap(command,Arc::new(move|event|{
            let name=event.get("event").and_then(Value::as_str).unwrap_or("");
            if name=="initialized"{let _=initialized_tx.try_send(());}
            if let Ok(mut view)=events.lock(){
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
            }
        }))?;
        client.request("initialize",json!({"clientID":"inkleet","adapterID":"python","pathFormat":"path","linesStartAt1":true,"columnsStartAt1":true,"supportsVariableType":true,"supportsVariablePaging":true,"supportsRunInTerminalRequest":false}),Duration::from_secs(15))?;
        let session=Arc::new(Session{client,view,source:source.clone(),_work:work,closed:AtomicBool::new(false)});
        let launching=session.clone();let program=root.join("harness.py");
        let launch=std::thread::spawn(move||launching.client.request("launch",json!({"name":"InkLeet local snapshot","type":"python","request":"launch","python":python,"program":program,"cwd":root,"console":"internalConsole","justMyCode":false,"redirectOutput":true,"stopOnEntry":false}),Duration::from_secs(30)));
        initialized_rx.recv_timeout(Duration::from_secs(20)).map_err(|_|"调试器初始化超时")?;
        let mut unique=lines;unique.sort_unstable();unique.dedup();
        let requested:Vec<Value>=unique.into_iter().map(|line|json!({"line":line})).collect();
        let verified=session.client.request("setBreakpoints",json!({"source":{"path":source},"breakpoints":requested}),Duration::from_secs(10))?;
        if let Ok(mut view)=session.view.lock(){view.breakpoints=verified.get("breakpoints").and_then(Value::as_array).cloned().unwrap_or_default();view.phase="running".into();}
        session.client.request("configurationDone",json!({}),Duration::from_secs(10))?;
        launch.join().map_err(|_|"调试启动任务中断")??;
        let previous=state.active.lock().map_err(|_|"调试状态不可用")?.replace(session.clone());
        if let Some(previous)=previous{previous.stop("新调试会话");}
        let weak=Arc::downgrade(&session);
        // Pause-friendly wall limit; running phases have a 30-second limit. Not a security sandbox.
        std::thread::spawn(move||{
            let started=Instant::now();let mut running_since=Instant::now();let mut last_epoch=0;
            loop{
                std::thread::sleep(Duration::from_millis(100));
                let Some(session)=weak.upgrade()else{break};
                if session.closed.load(Ordering::Acquire){break;}
                let (phase,epoch,truncated)=match session.view.lock(){Ok(v)=>(v.phase.clone(),v.epoch,v.truncated),Err(_)=>break};
                if phase=="finished"{session.stop("调试完成");break;}
                if epoch!=last_epoch{last_epoch=epoch;running_since=Instant::now();}
                if truncated{session.stop("输出超限，调试已终止");break;}
                if !session.client.is_alive(){if let Ok(mut v)=session.view.lock(){v.error="调试器连接中断".into();}session.stop("连接中断");break;}
                if started.elapsed()>Duration::from_secs(1800)||(phase=="running"&&running_since.elapsed()>Duration::from_secs(30)){session.stop("调试运行超时");break;}
            }
        });
        Ok(id)
    }).await.map_err(|_|"调试启动任务中断".to_owned())?
}
