use inkleet_managed_env::{harness,process};
use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::{fs,io::Read,path::PathBuf,process::Command,sync::{Arc,Mutex,atomic::{AtomicBool,AtomicU64,Ordering}},time::Duration};
use tauri::Manager as _;
#[derive(Clone,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Snapshot{pub code:String,pub input:String,pub metadata:String,pub title:String,pub language:String}
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct View{pub id:u64,pub phase:String,pub title:String,pub stdout:String,pub stderr:String,pub results:Vec<String>,pub exit_code:Option<i32>,pub timed_out:bool,pub canceled:bool,pub truncated:bool,pub elapsed_ms:u128,pub error:String}
struct Job{view:Mutex<View>,cancel:Arc<AtomicBool>}
pub struct Runner{root:PathBuf,next:AtomicU64,active:Mutex<Option<Arc<Job>>>}
impl Runner{
    pub fn new(root:PathBuf)->Self{Self{root,next:AtomicU64::new(1),active:Mutex::new(None)}}
    pub fn status(&self)->Result<Option<View>,String>{
        let job=self.active.lock().map_err(|_|"运行状态不可用")?.clone();
        job.map(|job|job.view.lock().map(|v|v.clone()).map_err(|_|"运行状态不可用".into())).transpose()
    }
    pub fn cancel(&self,id:u64)->Result<(),String>{
        if let Some(job)=self.active.lock().map_err(|_|"运行状态不可用")?.as_ref(){
            let mut view=job.view.lock().map_err(|_|"运行状态不可用")?;
            if view.id==id&&matches!(view.phase.as_str(),"queued"|"compiling"|"running"){
                job.cancel.store(true,Ordering::Release);view.phase="canceling".into();
            }
        }Ok(())
    }
}
pub async fn start(app:tauri::AppHandle,snapshot:Snapshot)->Result<u64,String>{
    if !matches!(snapshot.language.as_str(),"python3"|"golang"|"cpp"|"c"|"rust"|"java"){return Err("此版本本地运行支持 Python、Go、C、C++、Rust 和 Java；其他语言可使用力扣运行".into());}
    if snapshot.code.len()>2*1024*1024||snapshot.title.len()>512{return Err("运行快照超过大小限制".into());}
    harness::configuration(&snapshot.metadata,&snapshot.input)?;
    let state=app.state::<Runner>();
    let job={
        let mut active=state.active.lock().map_err(|_|"运行状态不可用")?;
        if let Some(previous)=active.as_ref(){
            if matches!(previous.view.lock().map_err(|_|"运行状态不可用")?.phase.as_str(),"queued"|"compiling"|"running"|"canceling"){return Err("已有本地运行任务，请停止后再试".into());}
        }
        let id=state.next.fetch_add(1,Ordering::Relaxed);
        let job=Arc::new(Job{cancel:Arc::new(AtomicBool::new(false)),view:Mutex::new(View{id,phase:"queued".into(),title:snapshot.title.clone(),stdout:String::new(),stderr:String::new(),results:Vec::new(),exit_code:None,timed_out:false,canceled:false,truncated:false,elapsed_ms:0,error:String::new()})});
        *active=Some(job.clone());job
    };
    let id=job.view.lock().map_err(|_|"运行状态不可用")?.id;
    drop(state);
    tauri::async_runtime::spawn_blocking(move||{
        let execute=||->Result<(process::Output,Vec<String>),String>{
            let state=app.state::<Runner>();let tools=app.state::<crate::managed::Environments>();
            let tool_id=match snapshot.language.as_str(){"java"=>"jdk","rust"=>"rustc","golang"=>"go","cpp"|"c"=>"zig",_=>"python"};
            let tool=process::tool_path(&tools.manager.installed(tool_id)?.ok_or("请先在开发环境中安装当前语言工具链")?);
            if state.root.exists()&&fs::symlink_metadata(&state.root).map_err(|_|"运行目录不可用")?.file_type().is_symlink(){return Err("运行目录不能是符号链接".into());}
            fs::create_dir_all(&state.root).map_err(|_|"无法创建运行目录")?;
            let work=tempfile::Builder::new().prefix("run-").tempdir_in(&state.root).map_err(|_|"无法创建独立运行目录")?;
            let root=process::tool_path(&fs::canonicalize(work.path()).map_err(|_|"无法解析运行目录")?);
            let mut command;
            if matches!(snapshot.language.as_str(),"cpp"|"c"|"rust"){
                if job.cancel.load(Ordering::Acquire){return Err("运行已取消".into());}
                if let Ok(mut view)=job.view.lock(){view.phase="compiling".into();}
                let (binary,output)=if snapshot.language=="rust"{crate::compiled_runtime::rust(&tools.manager,&root,&process::tool_path(&state.root),&snapshot,job.cancel.clone())?}else{crate::compiled_runtime::cpp(&tools.manager,&root,&process::tool_path(&state.root),&snapshot,job.cancel.clone())?};
                if output.exit_code!=Some(0)||output.canceled||output.timed_out||output.truncated{
                    if let Ok(mut view)=job.view.lock(){view.error=if output.timed_out{"编译超过阶段时限，已终止"}else if output.canceled{"编译已停止"}else{"编译未完成，请查看错误输出"}.into();}
                    return Ok((output,Vec::new()));
                }
                command=Command::new(binary);crate::compiled_runtime::clean_runtime(&mut command,&root)?;
            }else if snapshot.language=="java"{
                if job.cancel.load(Ordering::Acquire){return Err("运行已取消".into());}
                if let Ok(mut view)=job.view.lock(){view.phase="compiling".into();}
                let (java,output)=crate::compiled_runtime::java(&tools.manager,&root,&snapshot,job.cancel.clone())?;
                if output.exit_code!=Some(0)||output.canceled||output.timed_out||output.truncated{
                    if let Ok(mut view)=job.view.lock(){view.error=if output.timed_out{"Java 编译超过 120 秒，已终止"}else if output.canceled{"编译已停止"}else{"Java 编译未完成，请查看错误输出"}.into();}
                    return Ok((output,Vec::new()));
                }
                command=java;
            }else if snapshot.language=="golang"{
                harness::prepare_go(&root,&snapshot.code,&snapshot.metadata,&snapshot.input)?;
                if job.cancel.load(Ordering::Acquire){return Err("运行已取消".into());}
                if let Ok(mut view)=job.view.lock(){view.phase="compiling".into();}
                let temporary=root.join("temp");fs::create_dir(&temporary).map_err(|_|"无法创建 Go 临时目录")?;
                let binary=root.join(if cfg!(windows){"solution.exe"}else{"solution"});
                let mut compile=Command::new(&tool);
                compile.current_dir(&root).env_clear().env("PATH",tool.parent().ok_or("Go 路径无效")?)
                    .env("GOROOT",tool.parent().and_then(std::path::Path::parent).ok_or("Go 根目录无效")?)
                    .env("HOME",&root).env("USERPROFILE",&root).env("TMP",&temporary).env("TEMP",&temporary).env("TMPDIR",&temporary)
                    .env("APPDATA",&temporary).env("LOCALAPPDATA",&temporary).env("GOENV","off").env("GOWORK","off").env("GOTOOLCHAIN","local")
                    .env("CGO_ENABLED","0").env("GOPROXY","off").env("GOSUMDB","off").env("GOTELEMETRY","off")
                    .env("GOCACHE",process::tool_path(&state.root.join("go-cache"))).env("GOPATH",root.join("go-path"))
                    .args(["build","-trimpath","-buildvcs=false","-o"]).arg(&binary).args(["solution.go","nodes.go","harness.go"]);
                if let Some(system)=std::env::var_os("SystemRoot"){compile.env("SystemRoot",system);}
                let output=process::run(compile,job.cancel.clone(),Duration::from_secs(120),64*1024)?;
                if output.exit_code!=Some(0)||output.canceled||output.timed_out||output.truncated{
                    if let Ok(mut view)=job.view.lock(){view.error=if output.timed_out{"编译超过 120 秒，已终止"}else if output.canceled{"编译已停止"}else{"编译未完成，请查看错误输出"}.into();}
                    return Ok((output,Vec::new()));
                }
                command=Command::new(binary);
                command.current_dir(&root).env_clear().env("PATH",tool.parent().ok_or("Go 路径无效")?)
                    .env("HOME",&root).env("USERPROFILE",&root).env("TMP",&temporary).env("TEMP",&temporary).env("TMPDIR",&temporary);
            }else{
                harness::prepare(&root,&snapshot.code,&snapshot.metadata,&snapshot.input)?;
                command=Command::new(&tool);
                command.arg("-I").arg(root.join("harness.py")).current_dir(&root).env_clear()
                    .env("PATH",tool.parent().ok_or("Python 路径无效")?).env("HOME",&root).env("USERPROFILE",&root).env("TMP",&root).env("TEMP",&root)
                    .env("PYTHONIOENCODING","utf-8");
            }
            if job.cancel.load(Ordering::Acquire){return Err("运行已取消".into());}
            if let Ok(mut view)=job.view.lock(){view.phase="running".into();}
            if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
            let output=process::run(command,job.cancel.clone(),Duration::from_secs(10),64*1024)?;
            let path=root.join("results.jsonl");let mut results=Vec::new();
            if path.exists(){
                let meta=fs::symlink_metadata(&path).map_err(|_|"无法检查运行结果")?;
                if meta.file_type().is_symlink()||!meta.is_file()||meta.len()>1024*1024{return Err("运行结果文件不安全或超过大小限制".into());}
                let mut text=String::new();
                fs::File::open(&path).map_err(|_|"无法读取运行结果")?.take(1024*1024+1).read_to_string(&mut text).map_err(|_|"运行结果不是 UTF-8")?;
                if text.len()>1024*1024{return Err("运行结果超限".into());}
                for line in text.lines().take(100){
                    match serde_json::from_str::<Value>(line){Ok(_)=>results.push(line.to_owned()),Err(_)=>return Err("运行结果被截断或不是有效 JSON".into())}
                }
            }
            Ok((output,results))
        };
        let result=execute();
        if let Ok(mut view)=job.view.lock(){
            match result{
                Ok((output,results))=>{
                    view.phase="finished".into();view.stdout=output.stdout;view.stderr=output.stderr;view.results=results;
                    view.exit_code=output.exit_code;view.timed_out=output.timed_out;view.canceled=output.canceled;view.truncated=output.truncated;view.elapsed_ms=output.elapsed_ms;
                },
                Err(error)=>{view.phase=if job.cancel.load(Ordering::Acquire){"finished"}else{"error"}.into();view.canceled=job.cancel.load(Ordering::Acquire);view.error=error;}
            }
        };
    });
    Ok(id)
}
