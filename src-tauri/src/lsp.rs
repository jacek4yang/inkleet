use inkleet_managed_env::rpc::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::{path::{Path,PathBuf}, sync::{Arc,Mutex,atomic::{AtomicBool,AtomicU64,Ordering}}, time::Duration};
use tauri::Manager as _;
mod source;
pub use source::Snapshot as SourceSnapshot;
type Result<T> = std::result::Result<T,String>;
pub struct Services { root:PathBuf, generation:AtomicU64, starting:AtomicBool, active:Mutex<Option<Arc<Session>>> }
struct Document { text:String, version:u32, prefix:u32 }
struct Session {
    id:u64, client:Client, uri:String, language:String, context:inkleet_managed_env::lsp_scaffold::Context, approved_sources:Mutex<std::collections::HashSet<String>>, document:Mutex<Document>,
    sources:Mutex<crate::source_navigation::Registry>, source_reads:std::sync::atomic::AtomicUsize, source_requests:Mutex<crate::completion_requests::CompletionRequests<inkleet_managed_env::rpc::RequestCanceller>>,
    diagnostics:Arc<Mutex<Value>>, roots:Vec<PathBuf>, range_formatting:bool, code_actions:bool, code_action_resolve:bool, action_requests:Mutex<crate::completion_requests::CompletionRequests<inkleet_managed_env::rpc::RequestCanceller>>, action_cache:Mutex<crate::lsp_actions::Cache>, implementation:bool, prepare_rename:bool, completion_resolve:bool, completion_insert_text_mode:u8, completion_trigger_characters:Vec<String>, completion_requests:Mutex<crate::completion_requests::CompletionRequests<inkleet_managed_env::rpc::RequestCanceller>>, completion_cache:Mutex<crate::completion_cache::CompletionCache>, semantic_legend:Option<Value>, semantic_revision:Arc<AtomicU64>, formatting:AtomicBool, _workspace:tempfile::TempDir,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Started { id:u64, version:u32, server:String, uri:String, semantic_tokens:bool, code_actions:bool, implementation:bool, prepare_rename:bool, completion_resolve:bool, completion_insert_text_mode:u8, completion_trigger_characters:Vec<String>, completion_snippets:bool }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Source { text:String, name:String, declaration:bool, language:String }
impl Services {
    pub fn new(root:PathBuf)->Self{Self{root,generation:AtomicU64::new(0),starting:AtomicBool::new(false),active:Mutex::new(None)}}
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
        let (wrapped,prefix)=crate::lsp_document::contextual_source(&session.language,&text,&session.context);
        session.client.notify("textDocument/didChange",json!({"textDocument":{"uri":session.uri,"version":version},"contentChanges":[{"text":wrapped}]}))?;
        document.text=text;document.version=version;document.prefix=prefix;
        if let Ok(mut cache)=session.completion_cache.lock(){cache.clear();}
        if let Ok(mut cache)=session.action_cache.lock(){cache.clear();}
        if let Ok(mut diagnostics)=session.diagnostics.lock(){*diagnostics=Value::Null;}
        Ok(())
    }
    pub fn request(&self,id:u64,version:u32,kind:&str,line:u32,character:u32,new_name:Option<String>,completion_context:Option<Value>,completion_sequence:Option<u64>)->Result<Value>{
        let method=match kind{"hover"=>"textDocument/hover","completion"=>"textDocument/completion","definition"=>"textDocument/definition","implementation"=>"textDocument/implementation","signatureHelp"=>"textDocument/signatureHelp","rename"=>"textDocument/rename","prepareRename"=>"textDocument/prepareRename","references"=>"textDocument/references",_=>return Err("不支持此语言服务请求".into())};
        let session=self.session(id)?;
        if kind=="implementation"{crate::source_navigation::NavigationKind::Implementation.method(session.implementation)?;}
        let prefix={
            let document=session.document.lock().map_err(|_|"文档状态不可用")?;
            if document.version!=version{return Err("文档已更新，请重试".into());}
            let current=document.text.split('\n').nth(line as usize).ok_or("行号越界")?;
            if character as usize>current.encode_utf16().count(){return Err("列号越界".into());}
            document.prefix
        };
        if kind=="prepareRename"&&!session.prepare_rename{return Ok(json!({"supported":false}));}
        let mut params=json!({"textDocument":{"uri":session.uri},"position":{"line":line+prefix,"character":character}});
        if kind=="completion"{params["context"]=crate::completion_context::context(completion_context.as_ref(),&session.completion_trigger_characters)?;}else if completion_context.is_some(){return Err("此请求不接受补全上下文".into());}
        if kind=="references"{params["context"]=json!({"includeDeclaration":true});}
        if kind=="rename"{
            let name=new_name.as_deref().ok_or("缺少新名称")?;
            if name.is_empty()||name.len()>128||!name.chars().all(|c|c.is_alphanumeric()||matches!(c,'_'|'$'))||name.chars().next().is_some_and(|c|c.is_numeric()){return Err("名称必须为不超过 128 字节的标识符".into());}
            params["newName"]=json!(name);
        }
        // Full validation above must precede supersession. Admission and handle
        // registration share the cancel-through mutex; no response wait holds it.
        if kind=="completion"{
            let (sequence,request)={
                let mut requests=session.completion_requests.lock().map_err(|_|"补全请求状态不可用")?;
                let document=session.document.lock().map_err(|_|"文档状态不可用")?;
                if document.version!=version{return Err("文档已更新，请重试".into());}
                requests.begin(completion_sequence,||{
                    let request=session.client.begin_cancellable_lsp_request(method,params)?;
                    let cancel=request.canceller();Ok((request,cancel))
                })?
            };
            let result=request.wait(Duration::from_secs(8));
            let mut requests=session.completion_requests.lock().map_err(|_|"补全请求状态不可用")?;
            requests.finish(sequence);
            let mut response=result?;
            if !requests.is_current(sequence){return Err("忽略过期的补全结果".into());}
            let document=session.document.lock().map_err(|_|"文档状态不可用")?;
            if document.version!=version{return Err("忽略旧版本的语言服务结果".into());}
            self.session(id)?;
            // Keep issuer validation and cache publication in the same critical
            // section, preventing a superseded response from publishing tokens.
            if session.completion_resolve{session.completion_cache.lock().map_err(|_|"补全缓存不可用")?.remember(&mut response,version,sequence);}
            crate::lsp_document::completion_response(&session.language,&mut response,prefix,&document.text);
            crate::snippet_validation::completion(&self.root,id,version,sequence,&session.language,session.completion_insert_text_mode,json!({"line":line,"character":character,"prefix":prefix}),&response);
            return Ok(response);
        }
        if completion_sequence.is_some(){return Err("此请求不接受补全序号".into());}
        let mut response=session.client.request(method,params,Duration::from_secs(8))?;
        if session.document.lock().map_err(|_|"文档状态不可用")?.version!=version{return Err("忽略旧版本的语言服务结果".into());}
        self.session(id)?;
        if kind=="prepareRename"{
            let document=session.document.lock().map_err(|_|"文档状态不可用")?;
            if document.version!=version{return Err("源码已改变，请重新准备重命名".into());}
            return crate::lsp_document::prepare_rename(&response,prefix,&document.text,line,character);
        }
        if kind=="rename"{
            let document=session.document.lock().map_err(|_|"文档状态不可用")?;
            if document.version!=version{return Err("源码已改变，请重新发起重命名".into());}
            return crate::lsp_document::rename_edits(&response,&session.uri,prefix,&document.text,version);
        }
        if kind=="references"{
            let document=session.document.lock().map_err(|_|"文档状态不可用")?;
            if document.version!=version{return Err("源码已改变，请重新查找引用".into());}
            return crate::lsp_document::references(&response,&session.uri,prefix,&document.text);
        }
        crate::lsp_document::response(kind,&mut response,prefix);
        if matches!(kind,"definition"|"implementation"){
            crate::lsp_document::definition(&mut response,&session.uri,prefix);
            let locations:Vec<&Value>=match response.as_array(){Some(items)=>items.iter().take(32).collect(),None=>vec![&response]};
            let mut allowed=session.approved_sources.lock().map_err(|_|"源码引用状态不可用")?;
            for location in locations{
                if let Some(uri)=location.get("uri").or_else(||location.get("targetUri")).and_then(Value::as_str){
                    if uri.len()<=8192&&uri.starts_with("jdt://contents/")&&allowed.len()<256{allowed.insert(uri.to_owned());}
                }
            }
        }
        Ok(response)
    }

    pub fn cancel_completion_through(&self,id:u64,sequence:u64)->Result<()>{
        let session=self.session(id)?;
        let result=session.completion_requests.lock().map_err(|_|"补全请求状态不可用")?.cancel_through(sequence);
        result
    }
    pub fn resolve_completion(&self,id:u64,version:u32,token:u64)->Result<Value>{
        let session=self.session(id)?;
        if !session.completion_resolve{return Err("语言服务不支持补全解析".into());}
        if session.document.lock().map_err(|_|"文档状态不可用")?.version!=version{return Err("补全快照已经过期".into());}
        let original=session.completion_cache.lock().map_err(|_|"补全缓存不可用")?.get(token,version)?;
        let resolved=session.client.request("completionItem/resolve",original.clone(),Duration::from_secs(8))?;
        crate::completion_cache::validate_resolved(&original,&resolved)?;
        self.session(id)?;
        let document=session.document.lock().map_err(|_|"文档状态不可用")?;
        if document.version!=version{return Err("忽略过期的补全解析".into());}
        let mut response=Value::Array(vec![resolved]);
        crate::lsp_document::completion_response(&session.language,&mut response,document.prefix,&document.text);
        let result=response.as_array_mut().and_then(|items|items.pop()).ok_or_else(||"补全导入涉及语言环境辅助代码，未应用任何修改".to_owned())?;
        crate::lsp_document::validate_completion_import(&session.language,&original,&result,&document.text)?;
        crate::snippet_validation::resolved(&self.root,id,version,token,session.completion_insert_text_mode,&result);
        Ok(result)
    }
    pub fn code_actions(&self,id:u64,version:u32,sequence:u64,start_line:u32,start_character:u32,end_line:u32,end_character:u32)->Result<Value>{
        let session=self.session(id)?;
        if !session.code_actions{return Err("当前语言服务不支持代码操作".into());}
        let prefix={
            let document=session.document.lock().map_err(|_|"文档状态不可用")?;
            if document.version!=version{return Err("代码操作快照已经过期".into());}
            crate::lsp_actions::position(&document.text,start_line,start_character)?;
            crate::lsp_actions::position(&document.text,end_line,end_character)?;
            if (start_line,start_character)>(end_line,end_character){return Err("代码操作范围顺序无效".into());}
            document.prefix
        };
        let diagnostics=session.diagnostics.lock().map_err(|_|"诊断状态不可用")?;
        let items=if diagnostics.get("version").and_then(Value::as_u64)==Some(version as u64){diagnostics.get("diagnostics").and_then(Value::as_array).map(|items|items.iter().take(200).cloned().collect::<Vec<_>>()).unwrap_or_default()}else{Vec::new()};
        drop(diagnostics);
        let params=json!({"textDocument":{"uri":session.uri},"range":{"start":{"line":start_line+prefix,"character":start_character},"end":{"line":end_line+prefix,"character":end_character}},"context":{"diagnostics":items,"only":["quickfix","refactor"],"triggerKind":1}});
        let (sequence,request)={
            let mut requests=session.action_requests.lock().map_err(|_|"代码操作请求状态不可用")?;
            let document=session.document.lock().map_err(|_|"文档状态不可用")?;
            if document.version!=version{return Err("代码操作快照已经过期".into());}
            let admitted=requests.begin(Some(sequence),||{
                let request=session.client.begin_cancellable_lsp_request("textDocument/codeAction",params)?;
                let cancel=request.canceller();Ok((request,cancel))
            })?;
            session.action_cache.lock().map_err(|_|"代码操作缓存不可用")?.clear();
            admitted
        };
        let response=request.wait(Duration::from_secs(8));
        let mut requests=session.action_requests.lock().map_err(|_|"代码操作请求状态不可用")?;
        requests.finish(sequence);
        let response=response?;
        if !requests.is_current(sequence){return Err("忽略过期的代码操作结果".into());}
        let document=session.document.lock().map_err(|_|"文档状态不可用")?;
        if document.version!=version{return Err("忽略旧版本代码操作".into());}
        self.session(id)?;
        let result=session.action_cache.lock().map_err(|_|"代码操作缓存不可用")?.remember(&response,version,sequence,session.code_action_resolve,&session.uri,prefix,&document.text);
        result
    }
    pub fn resolve_code_action(&self,id:u64,version:u32,token:u64)->Result<Value>{
        let session=self.session(id)?;
        if session.document.lock().map_err(|_|"文档状态不可用")?.version!=version{return Err("代码操作快照已经过期".into());}
        let original=session.action_cache.lock().map_err(|_|"代码操作缓存不可用")?.get(token,version)?;
        let action=if original.get("edit").is_some(){original.clone()}else{
            if !session.code_action_resolve{return Err("当前语言服务不支持代码操作解析".into());}
            session.client.request("codeAction/resolve",original.clone(),Duration::from_secs(8))?
        };
        crate::lsp_actions::validate_resolved(&original,&action)?;
        self.session(id)?;
        let document=session.document.lock().map_err(|_|"文档状态不可用")?;
        if document.version!=version{return Err("忽略过期的代码操作解析".into());}
        session.action_cache.lock().map_err(|_|"代码操作缓存不可用")?.get(token,version)?;
        crate::lsp_actions::normalize(&action,&session.uri,document.prefix,&document.text,version)
    }
    pub fn semantic_tokens(&self,id:u64,version:u32)->Result<Value>{
        let session=self.session(id)?;
        let Some(legend)=&session.semantic_legend else{return Ok(json!({"version":version,"tokens":[]}))};
        let (text,prefix)={
            let document=session.document.lock().map_err(|_|"文档状态不可用")?;
            if document.version!=version{return Err("语义分析快照已过期".into())}
            (document.text.clone(),document.prefix)
        };
        let response=session.client.request("textDocument/semanticTokens/full",json!({"textDocument":{"uri":session.uri}}),Duration::from_secs(5))?;
        if session.document.lock().map_err(|_|"文档状态不可用")?.version!=version{return Err("忽略旧版本语义分析".into())}
        self.session(id)?;
        let tokens=crate::semantic_tokens::normalize(&text,prefix,legend,&response)?;
        Ok(json!({"version":version,"tokens":tokens}))
    }
    pub fn format(&self,id:u64,version:u32,language:&str,text:&str)->Result<String>{
        let session=self.session(id)?;
        if !matches!(language,"c"|"cpp"|"java")||session.language!=language{return Err("格式化语言会话不匹配".into());}
        if !session.range_formatting{return Err("当前语言服务不支持范围格式化".into());}
        if session.formatting.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return Err("格式化正在进行".into());}
        struct Guard<'a>(&'a AtomicBool);impl Drop for Guard<'_>{fn drop(&mut self){self.0.store(false,Ordering::Release);}}
        let _guard=Guard(&session.formatting);
        let prefix={
            let document=session.document.lock().map_err(|_|"文档状态不可用")?;
            if document.version!=version||document.text!=text{return Err("格式化快照已过期".into());}
            document.prefix
        };
        let lines=text.split('\n').collect::<Vec<_>>();
        let last=lines.last().copied().unwrap_or("");
        let result=session.client.request("textDocument/rangeFormatting",json!({
            "textDocument":{"uri":session.uri},
            "range":{"start":{"line":prefix,"character":0},"end":{"line":prefix+lines.len() as u32-1,"character":last.encode_utf16().count()}},
            "options":{"tabSize":4,"insertSpaces":true}
        }),Duration::from_secs(5))?;
        let document=session.document.lock().map_err(|_|"文档状态不可用")?;
        if document.version!=version||document.text!=text{return Err("忽略旧版本格式化结果".into());}
        self.session(id)?;
        inkleet_managed_env::format_edits::apply(text,prefix,&result)
    }
    pub fn diagnostics(&self,id:u64)->Result<Value>{
        let session=self.session(id)?;if !session.client.is_alive(){return Err("语言服务已退出，可重连".into());}
        let document=session.document.lock().map_err(|_|"文档状态不可用")?;
        let diagnostics=session.diagnostics.lock().map_err(|_|"诊断状态不可用")?;
        // Only versioned diagnostics are displayed; stale/unknown versions cannot paint current text.
        if diagnostics.get("version").and_then(Value::as_u64)==Some(document.version as u64){let mut current=diagnostics.clone();crate::lsp_document::diagnostics(&mut current,document.prefix);current["semanticRevision"]=json!(session.semantic_revision.load(Ordering::Relaxed));Ok(current)}
        else{Ok(json!({"version":document.version,"diagnostics":[],"semanticRevision":session.semantic_revision.load(Ordering::Relaxed)}))}
    }
    pub fn read_source(&self,id:u64,uri:&str)->Result<Source>{
        let session=self.session(id)?;
        if session.language=="java"&&uri.starts_with("jdt://"){
            if !session.approved_sources.lock().map_err(|_|"源码引用状态不可用")?.contains(uri){return Err("只能查看本次语言服务返回的源码引用".into());}
            let response=session.client.request("java/classFileContents",json!({"uri":uri}),Duration::from_secs(15))?;
            let text=response.as_str().ok_or("Java 语言服务未返回源码")?;
            if text.len()>2*1024*1024{return Err("Java 源码超过显示限制".into());}
            let url=reqwest::Url::parse(uri).map_err(|_|"Java 源码地址无效")?;
            let name=url.path_segments().and_then(|mut segments|segments.next_back()).unwrap_or("Java source").to_owned();
            self.session(id)?;
            return Ok(Source{text:text.to_owned(),name,declaration:false,language:"java".into()});
        }
        let source=read_allowed_source(&session.roots,uri)?;
        self.session(id)?;Ok(source)
    }
}
pub async fn start(app:tauri::AppHandle,text:String,language:String,metadata:Option<String>)->Result<Started>{
    let context=inkleet_managed_env::lsp_scaffold::Context::parse(metadata.as_deref())?;
    if !matches!(language.as_str(),"python3"|"java"|"golang"|"rust"|"c"|"cpp"){return Err("此语言服务尚未接入".into());}
    if text.len()>2*1024*1024{return Err("源码超过语言服务的 2 MiB 限制".into());}
    let state=app.state::<Services>();
    if state.starting.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return Err("语言服务正在启动，请稍后重连".into());}
    let generation=state.generation.fetch_add(1,Ordering::SeqCst)+1;
    drop(state);
    tauri::async_runtime::spawn_blocking(move || -> Result<Started>{
        let state=app.state::<Services>();
        struct Starting<'a>(&'a AtomicBool);
        impl Drop for Starting<'_>{fn drop(&mut self){self.0.store(false,Ordering::Release);}}
        let _starting=Starting(&state.starting);
        let tools=app.state::<crate::managed::Environments>();
        if state.root.exists() && std::fs::symlink_metadata(&state.root).map_err(|_|"语言服务目录不可用")?.file_type().is_symlink(){return Err("语言服务目录不能是符号链接".into());}
        std::fs::create_dir_all(&state.root).map_err(|_|"无法创建语言服务目录")?;
        let workspace=tempfile::Builder::new().prefix("language-").tempdir_in(&state.root).map_err(|_|"无法创建语言服务工作区")?;
        let workspace_root=inkleet_managed_env::process::tool_path(&std::fs::canonicalize(workspace.path()).map_err(|_|"无法解析工作区")?);
        let launch=crate::lsp_launch::prepare(&tools.manager,&workspace_root,&language)?;
        let (wrapped,prefix)=crate::lsp_document::contextual_source(&language,&text,&context);
        std::fs::write(workspace_root.join(launch.filename),&wrapped).map_err(|_|"无法准备语言服务源码")?;
        let uri=reqwest::Url::from_file_path(workspace_root.join(launch.filename)).map_err(|_|"无法生成文档地址")?.to_string();
        let root_uri=reqwest::Url::from_directory_path(&workspace_root).map_err(|_|"无法生成工作区地址")?.to_string();
        let diagnostics=Arc::new(Mutex::new(Value::Null));let event_diagnostics=diagnostics.clone();let event_uri=uri.clone();
        let semantic_revision=Arc::new(AtomicU64::new(0));let event_semantic=semantic_revision.clone();
        let completion_profile=crate::lsp_launch::completion_capabilities(&language);
        let completion_insert_text_mode=crate::lsp_launch::completion_default_mode(&completion_profile)?;
        let client=Client::spawn(launch.command,launch.settings.clone(),Arc::new(move|event|{
            if event.get("method").and_then(Value::as_str)==Some("workspace/semanticTokens/refresh"){event_semantic.fetch_add(1,Ordering::Relaxed);}
            if event.get("method").and_then(Value::as_str)==Some("textDocument/publishDiagnostics"){
                if let Some(params)=event.get("params"){
                    if params.get("uri").and_then(Value::as_str)==Some(event_uri.as_str()){
                        if let Ok(mut target)=event_diagnostics.lock(){*target=params.clone();}
                    }
                }
            }
        }))?;
        let initialized=client.request("initialize",json!({
            "processId":null,"rootUri":root_uri,"initializationOptions":launch.initialization,
            "capabilities":{
                "general":{"positionEncodings":["utf-16"]},
                "textDocument":{"codeAction":crate::lsp_actions::capabilities(),"implementation":{"dynamicRegistration":false,"linkSupport":true},"rename":{"dynamicRegistration":false,"prepareSupport":true},"semanticTokens":{"dynamicRegistration":false,"requests":{"full":true},"tokenTypes":crate::semantic_tokens::TYPES,"tokenModifiers":crate::semantic_tokens::MODIFIERS,"formats":["relative"],"overlappingTokenSupport":false,"multilineTokenSupport":false,"serverCancelSupport":false,"augmentsSyntaxTokens":true},"hover":{"contentFormat":hover_content_formats()},"completion":completion_profile,"publishDiagnostics":{"versionSupport":true}},
                "workspace":{"configuration":true,"workspaceFolders":true,"semanticTokens":{"refreshSupport":true}}
            },
            "workspaceFolders":[{"uri":root_uri,"name":"InkLeet"}]
        }),Duration::from_secs(if language=="java"{90}else{30}))?;
        if initialized["capabilities"].get("positionEncoding").is_some_and(|v|v.as_str()!=Some("utf-16")){return Err("语言服务返回不支持的位置编码".into())}
        let semantic_legend=crate::semantic_tokens::provider(&initialized["capabilities"]);
        let semantic_tokens=semantic_legend.is_some();
        let implementation=crate::source_navigation::implementation_provider(&initialized["capabilities"]["implementationProvider"]);
        let code_actions=crate::lsp_actions::provider(&initialized["capabilities"]["codeActionProvider"]);
        let code_action_resolve=initialized["capabilities"]["codeActionProvider"]["resolveProvider"]==Value::Bool(true);
        let prepare_rename=initialized["capabilities"]["renameProvider"]["prepareProvider"]==Value::Bool(true);
        let completion_trigger_characters=crate::completion_context::triggers(&initialized["capabilities"]["completionProvider"]);
        let completion_resolve=crate::lsp_launch::completion_resolve_enabled(&language)&&initialized["capabilities"]["completionProvider"]["resolveProvider"]==Value::Bool(true);
        let range_provider=&initialized["capabilities"]["documentRangeFormattingProvider"];
        let range_formatting=range_provider==&Value::Bool(true)||range_provider.is_object();
        client.notify("initialized",json!({}))?;
        client.notify("workspace/didChangeConfiguration",json!({"settings":if language=="python3"{json!({"python":launch.settings})}else{launch.settings}}))?;
        client.notify("textDocument/didOpen",json!({"textDocument":{"uri":uri,"languageId":launch.language_id,"version":1,"text":wrapped}}))?;
        let roots=launch.roots;
        let started_uri=uri.clone();
        crate::snippet_validation::started(&state.root,generation,&language,completion_insert_text_mode);
        let completion_snippets=crate::lsp_launch::snippet_support_enabled(&language);
        let session=Arc::new(Session{id:generation,client,uri,language,context,approved_sources:Mutex::new(std::collections::HashSet::new()),document:Mutex::new(Document{text,version:1,prefix}),sources:Mutex::new(crate::source_navigation::Registry::default()),source_reads:std::sync::atomic::AtomicUsize::new(0),source_requests:Mutex::new(crate::completion_requests::CompletionRequests::default()),diagnostics,roots,range_formatting,code_actions,code_action_resolve,action_requests:Mutex::new(crate::completion_requests::CompletionRequests::default()),action_cache:Mutex::new(crate::lsp_actions::Cache::default()),implementation,prepare_rename,completion_resolve,completion_insert_text_mode,completion_trigger_characters:completion_trigger_characters.clone(),completion_requests:Mutex::new(crate::completion_requests::CompletionRequests::default()),completion_cache:Mutex::new(crate::completion_cache::CompletionCache::default()),semantic_legend,semantic_revision,formatting:AtomicBool::new(false),_workspace:workspace});
        let previous={
            let mut active=state.active.lock().map_err(|_|"语言服务状态不可用")?;
            if state.generation.load(Ordering::SeqCst)!=generation{return Err("忽略已经过期的语言服务启动".into());}
            active.replace(session)
        };
        if let Some(previous)=previous{previous.client.stop();}
        Ok(Started{id:generation,version:1,server:format!("{} · 应用独立环境",launch.server),uri:started_uri,semantic_tokens,code_actions,implementation,prepare_rename,completion_resolve,completion_insert_text_mode,completion_trigger_characters,completion_snippets})
    }).await.map_err(|_|"语言服务启动任务中断".to_owned())?
}

fn read_allowed_source(roots:&[PathBuf],uri:&str)->Result<Source>{
    use std::io::Read;
    if uri.len()>8192{return Err("源码地址过长".into());}
    let url=reqwest::Url::parse(uri).map_err(|_|"源码地址无效")?;
    if url.scheme()!="file" || url.host_str().is_some_and(|h|h!="localhost") || url.query().is_some() || url.fragment().is_some(){return Err("仅能查看本机工具链源码".into());}
    let path=url.to_file_path().map_err(|_|"源码路径无效")?;
    let canonical=std::fs::canonicalize(path).map_err(|_|"源码文件不存在")?;
    if !roots.iter().any(|root|canonical.starts_with(root)){return Err("拒绝读取工作区和工具链之外的文件".into());}
    if !matches!(canonical.extension().and_then(|s|s.to_str()),Some("py"|"pyi"|"java"|"rs"|"go"|"c"|"cpp"|"h"|"hpp")|None){return Err("仅支持已接入语言的源码或类型声明".into());}
    let file=std::fs::File::open(&canonical).map_err(|_|"无法读取源码")?;
    let meta=file.metadata().map_err(|_|"无法读取源码信息")?;
    if !meta.is_file() || meta.len()>2*1024*1024{return Err("源码文件类型或大小不受支持".into());}
    let mut text=String::new();
    file.take(2*1024*1024+1).read_to_string(&mut text).map_err(|_|"源码不是有效 UTF-8 文本")?;
    if text.len()>2*1024*1024{return Err("源码文件增长超过大小限制".into());}
    Ok(Source{text,name:canonical.file_name().unwrap_or_default().to_string_lossy().into(),declaration:canonical.extension().is_some_and(|e|e=="pyi"),language:match canonical.extension().and_then(|e|e.to_str()){Some("java")=>"java",Some("rs")=>"rust",Some("go")=>"golang",Some("c")=>"c",Some("cpp"|"h"|"hpp")|None=>"cpp",_=>"python3"}.into()})
}
fn hover_content_formats()->[&'static str;2]{["markdown","plaintext"]}
#[cfg(test)]mod tests{
    #[test]fn hover_prefers_markdown_with_plaintext_fallback(){assert_eq!(super::hover_content_formats(),["markdown","plaintext"]);}
    use super::*;
    fn uri(path:&Path)->String{reqwest::Url::from_file_path(path).unwrap().to_string()}
    #[test]fn source_viewer_only_reads_bounded_tool_sources(){
        let temp=tempfile::tempdir().unwrap();let base=std::fs::canonicalize(temp.path()).unwrap();
        let approved=base.join("stdlib");std::fs::create_dir(&approved).unwrap();
        let source=approved.join("collections.pyi");std::fs::write(&source,"class deque: ...").unwrap();
        let roots=vec![approved.clone()];
        let result=read_allowed_source(&roots,&uri(&source)).unwrap();assert!(result.declaration);
        let outside=base.join("private.py");std::fs::write(&outside,"private").unwrap();
        assert!(read_allowed_source(&roots,&uri(&outside)).is_err());
        let binary=approved.join("library.dll");std::fs::write(&binary,"binary").unwrap();
        assert!(read_allowed_source(&roots,&uri(&binary)).is_err());
        assert!(read_allowed_source(&roots,"https://example.invalid/source.py").is_err());
        let huge=approved.join("large.py");std::fs::write(&huge,vec![b'a';2*1024*1024+1]).unwrap();
        assert!(read_allowed_source(&roots,&uri(&huge)).is_err());
        #[cfg(unix)]{
            let link=approved.join("escape.py");std::os::unix::fs::symlink(&outside,&link).unwrap();
            assert!(read_allowed_source(&roots,&uri(&link)).is_err());
        }
    }
}
