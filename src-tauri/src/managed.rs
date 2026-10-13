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
            for package in catalogue().into_iter().filter(|p|(p.platform==platform()||p.platform=="any")&&(matches!(p.id.as_str(),"python"|"node"|"pyright"|"debugpy"|"go"|"gopls"|"rustc"|"cargo"|"rust-std"|"rust-mingw"|"rust-src"|"rust-analyzer-preview"|"zig"|"clangd"|"delve"|"codelldb")||matches!(p.id.as_str(),"jdk"|"jdtls"))){
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
        Ok::<_,String>((state.manager.clone(),state.prepare(&prepare_id)?))
    }).await.map_err(|_|"安装准备任务中断")??;
    let report_app=app.clone();let report_id=id.clone();
    let report:Report=Arc::new(move|p|report_app.state::<Environments>().progress(&report_id,p));
    tauri::async_runtime::spawn(async move{
        let result=manager.install(&id,cancel,report).await;
        app.state::<Environments>().finish(&id,result);
    });
    Ok(())
}
