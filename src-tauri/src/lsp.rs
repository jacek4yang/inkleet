use inkleet_managed_env::rpc::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::{path::{Path,PathBuf}, process::Command, sync::{Arc,Mutex,atomic::{AtomicU64,Ordering}}, time::Duration};
use tauri::Manager as _;
type Result<T> = std::result::Result<T,String>;
pub struct Services { root:PathBuf, generation:AtomicU64, active:Mutex<Option<Arc<Session>>> }
struct Document { text:String, version:u32 }
struct Session {
    id:u64, client:Client, uri:String, document:Mutex<Document>,
    diagnostics:Arc<Mutex<Value>>, roots:Vec<PathBuf>, _workspace:tempfile::TempDir,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Started { id:u64, version:u32, server:String, uri:String }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Source { text:String, name:String, declaration:bool }
impl Services {
    pub fn new(root:PathBuf)->Self{Self{root,generation:AtomicU64::new(0),active:Mutex::new(None)}}
    fn session(&self,id:u64)->Result<Arc<Session>>{
        self.active.lock().map_err(|_|"语言服务状态不可用")?.as_ref().filter(|s|s.id==id).cloned().ok_or_else(||"语言服务会话已经切换".into())
    }
    pub fn stop(&self,id:u64)->Result<()>{
        let removed={
            let mut active=self.active.lock().map_err(|_|"语言服务状态不可用")?;
            if active.as_ref().is_some_and(|s|s.id==id){active.take()}else{None}
        };
        if let Some(session)=removed{session.client.stop();}
        Ok(())
    }
    pub fn update(&self,id:u64,version:u32,text:String)->Result<()>{
        if text.len()>2*1024*1024{return Err("源码超过语言服务的 2 MiB 限制".into());}
        let session=self.session(id)?;let mut document=session.document.lock().map_err(|_|"文档状态不可用")?;
        if version<=document.version{return Err("拒绝过期的语言服务文档更新".into());}
        session.client.notify("textDocument/didChange",json!({"textDocument":{"uri":session.uri,"version":version},"contentChanges":[{"text":text}]}))?;
        document.text=text;document.version=version;
        if let Ok(mut diagnostics)=session.diagnostics.lock(){*diagnostics=Value::Null;}
        Ok(())
    }
    pub fn request(&self,id:u64,version:u32,kind:&str,line:u32,character:u32)->Result<Value>{
        let method=match kind{"hover"=>"textDocument/hover","completion"=>"textDocument/completion","definition"=>"textDocument/definition",_=>return Err("不支持此语言服务请求".into())};
        let session=self.session(id)?;
        {
            let document=session.document.lock().map_err(|_|"文档状态不可用")?;
            if document.version!=version{return Err("文档已更新，请重试".into());}
            let current=document.text.split('\n').nth(line as usize).ok_or("行号越界")?;
            if character as usize>current.encode_utf16().count(){return Err("列号越界".into());}
        }
        let response=session.client.request(method,json!({"textDocument":{"uri":session.uri},"position":{"line":line,"character":character}}),Duration::from_secs(8))?;
        if session.document.lock().map_err(|_|"文档状态不可用")?.version!=version{return Err("忽略旧版本的语言服务结果".into());}
        self.session(id)?;
        Ok(response)
    }
    pub fn diagnostics(&self,id:u64)->Result<Value>{
        let session=self.session(id)?;if !session.client.is_alive(){return Err("语言服务已退出，可重连".into());}
        let document=session.document.lock().map_err(|_|"文档状态不可用")?;
        let diagnostics=session.diagnostics.lock().map_err(|_|"诊断状态不可用")?;
        // Only versioned diagnostics are displayed; stale/unknown versions cannot paint current text.
        if diagnostics.get("version").and_then(Value::as_u64)==Some(document.version as u64){Ok(diagnostics.clone())}
        else{Ok(json!({"version":document.version,"diagnostics":[]}))}
    }
    pub fn read_source(&self,id:u64,uri:&str)->Result<Source>{
        let session=self.session(id)?;
        let url=reqwest::Url::parse(uri).map_err(|_|"源码地址无效")?;
        if url.scheme()!="file" || url.host_str().is_some_and(|h|h!="localhost") || url.query().is_some() || url.fragment().is_some(){return Err("仅能查看本机工具链源码".into());}
        let path=url.to_file_path().map_err(|_|"源码路径无效")?;
        let canonical=std::fs::canonicalize(path).map_err(|_|"源码文件不存在")?;
        if !session.roots.iter().any(|root|canonical.starts_with(root)){return Err("拒绝读取工作区和工具链之外的文件".into());}
        if !matches!(canonical.extension().and_then(|s|s.to_str()),Some("py"|"pyi")){return Err("仅支持 Python 标准库源码或类型声明".into());}
        let meta=std::fs::metadata(&canonical).map_err(|_|"无法读取源码")?;
        if !meta.is_file() || meta.len()>2*1024*1024{return Err("源码文件类型或大小不受支持".into());}
        let text=std::fs::read_to_string(&canonical).map_err(|_|"源码不是有效 UTF-8 文本")?;
        Ok(Source{text,name:canonical.file_name().unwrap_or_default().to_string_lossy().into(),declaration:canonical.extension().is_some_and(|e|e=="pyi")})
    }
}
pub async fn start(app:tauri::AppHandle,text:String)->Result<Started>{
    if text.len()>2*1024*1024{return Err("源码超过语言服务的 2 MiB 限制".into());}
    let generation=app.state::<Services>().generation.fetch_add(1,Ordering::SeqCst)+1;
    tauri::async_runtime::spawn_blocking(move || -> Result<Started>{
        let state=app.state::<Services>();let tools=app.state::<crate::managed::Environments>();
        let node=tools.manager.installed("node")?.ok_or("请先在开发环境中安装 Python 工具")?;
        let python=tools.manager.installed("python")?.ok_or("请先安装 Python 运行时")?;
        let pyright=tools.manager.installed("pyright")?.ok_or("请先安装 Pyright 语言服务")?;
        if state.root.exists() && std::fs::symlink_metadata(&state.root).map_err(|_|"语言服务目录不可用")?.file_type().is_symlink(){return Err("语言服务目录不能是符号链接".into());}
        std::fs::create_dir_all(&state.root).map_err(|_|"无法创建语言服务目录")?;
        let workspace=tempfile::Builder::new().prefix("python-").tempdir_in(&state.root).map_err(|_|"无法创建语言服务工作区")?;
        let workspace_root=std::fs::canonicalize(workspace.path()).map_err(|_|"无法解析工作区")?;
        let uri=reqwest::Url::from_file_path(workspace_root.join("solution.py")).map_err(|_|"无法生成文档地址")?.to_string();
        let root_uri=reqwest::Url::from_directory_path(&workspace_root).map_err(|_|"无法生成工作区地址")?.to_string();
        let diagnostics=Arc::new(Mutex::new(Value::Null));let event_diagnostics=diagnostics.clone();let event_uri=uri.clone();
        let mut command=Command::new(&node);
        command.arg(&pyright).arg("--stdio").current_dir(&workspace_root).env_clear()
            .env("PATH",node.parent().ok_or("工具路径无效")?).env("HOME",&workspace_root)
            .env("USERPROFILE",&workspace_root).env("TEMP",&workspace_root).env("TMP",&workspace_root);
        if let Some(system_root)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system_root);}
        #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
        let settings=json!({"pythonPath":python,"analysis":{"typeCheckingMode":"basic","autoSearchPaths":false,"useLibraryCodeForTypes":true,"diagnosticMode":"openFilesOnly"}});
        let client=Client::spawn(command,settings.clone(),Arc::new(move|event|{
            if event.get("method").and_then(Value::as_str)==Some("textDocument/publishDiagnostics"){
                if let Some(params)=event.get("params"){
                    if params.get("uri").and_then(Value::as_str)==Some(event_uri.as_str()){
                        if let Ok(mut target)=event_diagnostics.lock(){*target=params.clone();}
                    }
                }
            }
        }))?;
        client.request("initialize",json!({
            "processId":null,"rootUri":root_uri,
            "capabilities":{
                "general":{"positionEncodings":["utf-16"]},
                "textDocument":{"hover":{"contentFormat":["plaintext"]},"completion":{"completionItem":{"snippetSupport":false}},"publishDiagnostics":{"versionSupport":true}},
                "workspace":{"configuration":true}
            },
            "workspaceFolders":[{"uri":root_uri,"name":"InkLeet"}]
        }),Duration::from_secs(30))?;
        client.notify("initialized",json!({}))?;
        client.notify("workspace/didChangeConfiguration",json!({"settings":{"python":settings}}))?;
        client.notify("textDocument/didOpen",json!({"textDocument":{"uri":uri,"languageId":"python","version":1,"text":text}}))?;
        let python_root=if cfg!(windows){python.parent()}else{python.parent().and_then(Path::parent)}.ok_or("Python 路径无效")?;
        let roots=vec![workspace_root,std::fs::canonicalize(python_root).map_err(|_|"标准库路径无效")?,std::fs::canonicalize(pyright.parent().ok_or("类型库路径无效")?).map_err(|_|"类型库路径无效")?];
        let started_uri=uri.clone();
        let session=Arc::new(Session{id:generation,client,uri,document:Mutex::new(Document{text,version:1}),diagnostics,roots,_workspace:workspace});
        let previous={
            let mut active=state.active.lock().map_err(|_|"语言服务状态不可用")?;
            if state.generation.load(Ordering::SeqCst)!=generation{return Err("忽略已经过期的语言服务启动".into());}
            active.replace(session)
        };
        if let Some(previous)=previous{previous.client.stop();}
        Ok(Started{id:generation,version:1,server:"Pyright · 应用独立环境".into(),uri:started_uri})
    }).await.map_err(|_|"语言服务启动任务中断".to_owned())?
}
