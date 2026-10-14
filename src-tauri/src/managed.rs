use inkleet_managed_env::{Manager, catalogue, platform, Progress, Report};
use serde::Serialize;
use std::{collections::BTreeMap, path::PathBuf, sync::{Arc, Mutex, atomic::{AtomicBool,Ordering}}};
use tauri::Manager as _;

pub struct Environments { pub manager: Manager, jobs: Mutex<Option<BTreeMap<String,Job>>> }
struct Job { view: Tool, cancel: Arc<AtomicBool> }
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Tool { id:String, version:String, size:u64, phase:String, downloaded:u64, message:String }
#[derive(Serialize)]
pub struct Overview { platform:String, supported:bool, tools:Vec<Tool> }
impl Environments {
    pub fn new(root:PathBuf)->Self{Self{manager:Manager::new(root),jobs:Mutex::new(None)}}
    fn initialize(&self, jobs:&mut Option<BTreeMap<String,Job>>){
        if jobs.is_some(){return;}
        let mut result=BTreeMap::new();
        if platform()!="unsupported" {
            for package in catalogue().into_iter().filter(|p|(p.platform==platform()||p.platform=="any")&&(matches!(p.id.as_str(),"python"|"node"|"pyright"|"debugpy"|"go"|"gopls"|"rustc"|"cargo"|"rust-std"|"rust-mingw"|"rust-src"|"rust-analyzer-preview"|"zig"|"clangd"|"delve"|"codelldb")||matches!(p.id.as_str(),"jdk"|"jdtls"|"java-debug"))){
                let (phase,message)=match self.manager.installed(&package.id){
                    Ok(Some(_))=>("ready","已通过入口文件校验".to_owned()),
                    Ok(None)=>("missing",String::new()),
                    Err(e)=>("broken",e),
                };
                result.insert(package.id.clone(),Job{view:Tool{id:package.id,version:package.version,size:package.size,phase:phase.into(),downloaded:0,message},cancel:Arc::new(AtomicBool::new(false))});
            }
        }
        *jobs=Some(result);
    }
    pub fn list(&self)->Result<Overview,String>{
        let mut jobs=self.jobs.lock().map_err(|_|"工具状态不可用")?;
        self.initialize(&mut jobs);
        Ok(Overview{platform:platform().into(),supported:platform()!="unsupported",tools:jobs.as_ref().unwrap().values().map(|j|j.view.clone()).collect()})
    }
    fn prepare(&self,id:&str)->Result<Arc<AtomicBool>,String>{
        let mut jobs=self.jobs.lock().map_err(|_|"工具状态不可用")?;self.initialize(&mut jobs);
        let job=jobs.as_mut().unwrap().get_mut(id).ok_or("当前平台不支持此工具")?;
        if matches!(job.view.phase.as_str(),"queued"|"downloading"|"verifying"|"extracting"|"building"|"canceling"){return Err("安装已经在进行中".into());}
        job.cancel=Arc::new(AtomicBool::new(false));job.view.phase="queued".into();job.view.message.clear();
        Ok(job.cancel.clone())
    }
    pub fn cancel(&self,id:&str)->Result<(),String>{
        let mut jobs=self.jobs.lock().map_err(|_|"工具状态不可用")?;
        let job=jobs.as_mut().and_then(|jobs|jobs.get_mut(id)).ok_or("没有此安装任务")?;
        if matches!(job.view.phase.as_str(),"queued"|"downloading"|"verifying"|"extracting"|"building"){
            job.cancel.store(true,Ordering::Relaxed);job.view.phase="canceling".into();
        }
        Ok(())
    }
    fn prepare_group(&self,group:&str)->Result<Vec<(String,Arc<AtomicBool>)>,String>{
        let ids=group_tools(group)?;
        let mut jobs=self.jobs.lock().map_err(|_|"工具状态不可用")?;self.initialize(&mut jobs);
        let mut selected=Vec::new();
        for id in ids{
            let Some(job)=jobs.as_mut().unwrap().get_mut(*id)else{continue};
            if job.view.phase=="ready"||matches!(job.view.phase.as_str(),"queued"|"downloading"|"verifying"|"extracting"|"building"|"canceling"){continue;}
            job.cancel=Arc::new(AtomicBool::new(false));job.view.phase="queued".into();job.view.message="已加入后台安装队列".into();
            selected.push(((*id).to_owned(),job.cancel.clone()));
        }
        Ok(selected)
    }
    fn phase(&self,id:&str)->Result<String,String>{
        self.jobs.lock().map_err(|_|"工具状态不可用")?.as_ref().and_then(|jobs|jobs.get(id)).map(|job|job.view.phase.clone()).ok_or("依赖工具缺失".into())
    }
    fn progress(&self,id:&str,progress:Progress){
        if let Ok(mut jobs)=self.jobs.lock(){
            if let Some(job)=jobs.as_mut().and_then(|j|j.get_mut(id)){
                if !job.cancel.load(Ordering::Relaxed){job.view.phase=progress.phase.into();}
                job.view.downloaded=progress.downloaded;
            }
        }
    }
    fn finish(&self,id:&str,result:Result<PathBuf,String>){
        if let Ok(mut jobs)=self.jobs.lock(){
            if let Some(job)=jobs.as_mut().and_then(|j|j.get_mut(id)){
                match result {
                    Ok(_)=>{job.view.phase="ready".into();job.view.downloaded=job.view.size;job.view.message="已安装到应用独立目录".into();},
                    Err(e)=>{job.view.phase=if job.cancel.load(Ordering::Relaxed){"canceled"}else{"error"}.into();job.view.message=e;},
                }
            }
        }
    }
}
pub async fn start(app:tauri::AppHandle,id:String)->Result<(),String>{
    let prepare_app=app.clone();let prepare_id=id.clone();
    let (manager,cancel)=tauri::async_runtime::spawn_blocking(move || {
        let state=prepare_app.state::<Environments>();
        Ok::<_,String>((state.manager.clone().with_download_proxy(prepare_app.state::<crate::download_settings::DownloadSettings>().get()?.settings.proxy)?,state.prepare(&prepare_id)?))
    }).await.map_err(|_|"安装准备任务中断")??;
    let report_app=app.clone();let report_id=id.clone();
    let report:Report=Arc::new(move|p|report_app.state::<Environments>().progress(&report_id,p));
    tauri::async_runtime::spawn(async move{
        let result=manager.install(&id,cancel,report).await;
        app.state::<Environments>().finish(&id,result);
    });
    Ok(())
}

fn group_tools(group:&str)->Result<&'static [&'static str],String>{
    Ok(match group{
        "python"=>&["python","node","pyright","debugpy"],
        "golang"=>&["go","gopls","delve"],
        "rust"=>&["rustc","cargo","rust-std","rust-src","rust-analyzer-preview","rust-mingw","zig","codelldb"],
        "cpp"=>&["zig","clangd","codelldb"],
        "java"=>if cfg!(windows){&["jdk","zig","jdtls","java-debug"]}else{&["jdk","jdtls","java-debug"]},
        _=>return Err("未知语言环境".into()),
    })
}
pub async fn start_group(app:tauri::AppHandle,group:String)->Result<(),String>{
    let prepare_app=app.clone();
    let (manager,selected)=tauri::async_runtime::spawn_blocking(move||{
        let state=prepare_app.state::<Environments>();
        Ok::<_,String>((state.manager.clone().with_download_proxy(prepare_app.state::<crate::download_settings::DownloadSettings>().get()?.settings.proxy)?,state.prepare_group(&group)?))
    }).await.map_err(|_|"语言环境准备任务中断")??;
    // Queue ownership belongs to the backend. Closing or reopening the dialog
    // cannot lose a pending gopls build or launch a duplicate dependency task.
    tauri::async_runtime::spawn(async move{
        for (id,cancel) in selected{
            let result=async{
                if cancel.load(Ordering::Acquire){return Err("安装已取消".into());}
                if id=="gopls"{
                    let waiting_app=app.clone();let waiting_cancel=cancel.clone();
                    tauri::async_runtime::spawn_blocking(move||->Result<(),String>{
                        let deadline=std::time::Instant::now()+std::time::Duration::from_secs(1800);
                        loop{
                            if waiting_cancel.load(Ordering::Acquire){return Err("安装已取消".into());}
                            let phase=waiting_app.state::<Environments>().phase("go")?;
                            if phase=="ready"{return Ok(());}
                            if !matches!(phase.as_str(),"queued"|"downloading"|"verifying"|"extracting"|"building"|"canceling"){return Err("Go 工具链未安装成功，请重试语言环境安装".into());}
                            if std::time::Instant::now()>deadline{return Err("等待 Go 工具链超时，请重试".into());}
                            std::thread::sleep(std::time::Duration::from_millis(200));
                        }
                    }).await.map_err(|_|"等待 Go 工具链的任务中断")??;
                }
                let report_app=app.clone();let report_id=id.clone();
                let report:Report=Arc::new(move|progress|report_app.state::<Environments>().progress(&report_id,progress));
                manager.install(&id,cancel,report).await
            }.await;
            app.state::<Environments>().finish(&id,result);
        }
    });
    Ok(())
}
#[cfg(test)]mod group_tests{
    use super::*;
    #[test]fn go_group_queues_compiler_before_language_service(){
        assert_eq!(group_tools("golang").unwrap(),&["go","gopls","delve"]);
        assert!(group_tools("../custom").is_err());
    }
    #[test]fn group_queue_is_idempotent_and_cancellable_without_a_dialog(){
        let temp=tempfile::tempdir().unwrap();let environments=Environments::new(temp.path().join("tools"));
        let first=environments.prepare_group("golang").unwrap();
        assert_eq!(first.iter().map(|(id,_)|id.as_str()).collect::<Vec<_>>(),vec!["go","gopls","delve"]);
        assert!(environments.prepare_group("golang").unwrap().is_empty());
        environments.cancel("gopls").unwrap();
        assert!(first[1].1.load(Ordering::Acquire));
        assert_eq!(environments.phase("gopls").unwrap(),"canceling");
    }
}
