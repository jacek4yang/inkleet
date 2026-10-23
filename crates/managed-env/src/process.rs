//! Bounded local execution for the user's own code. This is NOT a security sandbox.
use process_wrap::std::{ChildWrapper,CommandWrap};
use serde::Serialize;
use std::{io::{Read,Write},process::{Command,Stdio},sync::{Arc,Mutex,OnceLock,Weak,atomic::{AtomicBool,AtomicUsize,Ordering},mpsc},time::{Duration,Instant}};
struct ChildState { child:Box<dyn ChildWrapper>, stopped:bool }
pub struct OwnedChild { state:Mutex<ChildState> }
#[derive(Default)]struct Registry { closing:bool, children:Vec<Weak<OwnedChild>> }
static REGISTRY:OnceLock<Mutex<Registry>>=OnceLock::new();
fn registry()->&'static Mutex<Registry>{REGISTRY.get_or_init(||Mutex::new(Registry::default()))}
impl OwnedChild{
    fn with<T>(&self,f:impl FnOnce(&mut dyn ChildWrapper)->T)->std::io::Result<T>{
        let mut state=self.state.lock().unwrap_or_else(|e|e.into_inner());
        if state.stopped{return Err(std::io::Error::new(std::io::ErrorKind::Interrupted,"owned process stopped"));}
        Ok(f(state.child.as_mut()))
    }
    pub fn take_stdin(&self)->std::io::Result<Option<std::process::ChildStdin>>{self.with(|child|child.stdin().take())}
    pub fn take_stdout(&self)->std::io::Result<Option<std::process::ChildStdout>>{self.with(|child|child.stdout().take())}
    pub fn take_stderr(&self)->std::io::Result<Option<std::process::ChildStderr>>{self.with(|child|child.stderr().take())}
    pub fn try_wait(&self)->std::io::Result<Option<std::process::ExitStatus>>{self.with(|child|child.try_wait())?}
    pub fn stop(&self){
        let mut state=self.state.lock().unwrap_or_else(|e|e.into_inner());
        if state.stopped{return;}
        state.stopped=true;terminate(state.child.as_mut());
    }
}
impl Drop for OwnedChild{fn drop(&mut self){self.stop();}}
/// Close the spawn gate atomically, then stop only owned groups/jobs.
/// Weak ownership and a stopped bit prevent stale-PID or duplicate kills.
pub fn shutdown_owned(){
    let children={
        let mut registry=registry().lock().unwrap_or_else(|e|e.into_inner());
        registry.closing=true;
        registry.children.drain(..).filter_map(|child|child.upgrade()).collect::<Vec<_>>()
    };
    std::thread::scope(|scope|{for child in children{scope.spawn(move||child.stop());}});
}
pub fn spawn(command:Command)->std::io::Result<Arc<OwnedChild>>{
    let mut registry=registry().lock().unwrap_or_else(|e|e.into_inner());
    if registry.closing{return Err(std::io::Error::new(std::io::ErrorKind::Interrupted,"application is closing"));}

    let mut command=CommandWrap::from(command);
    #[cfg(unix)] command.wrap(process_wrap::std::ProcessGroup::leader());
    #[cfg(windows)] {
        let mut flags=process_wrap::std::CreationFlags(Default::default());
        flags.0.0=0x08000000;
        command.wrap(flags);
        command.wrap(process_wrap::std::JobObject);
    }
    let child=Arc::new(OwnedChild{state:Mutex::new(ChildState{child:command.spawn()?,stopped:false})});
    registry.children.retain(|child|child.strong_count()>0);
    registry.children.push(Arc::downgrade(&child));Ok(child)
}
/// Never use the wrapper's blocking kill()/wait(): a Windows job completion
/// notification may already have been consumed by try_wait().
pub fn terminate(child:&mut dyn ChildWrapper){
    let _=child.start_kill();
    let deadline=Instant::now()+Duration::from_secs(2);
    while Instant::now()<deadline{
        match child.try_wait(){Ok(Some(_))|Err(_)=>break,Ok(None)=>std::thread::sleep(Duration::from_millis(10))}
    }
}
#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Output{
    pub exit_code:Option<i32>,pub stdout:String,pub stderr:String,
    pub timed_out:bool,pub canceled:bool,pub truncated:bool,pub elapsed_ms:u128,
}
fn drain(mut pipe:impl Read+Send+'static,used:Arc<AtomicUsize>,over:Arc<AtomicBool>,limit:usize)->mpsc::Receiver<Vec<u8>>{
    let(tx,rx)=mpsc::sync_channel(1);
    std::thread::spawn(move||{
        let mut result=Vec::new();let mut buffer=[0u8;16384];
        loop{
            let n=match pipe.read(&mut buffer){Ok(0)|Err(_)=>break,Ok(n)=>n};
            let before=used.fetch_add(n,Ordering::Relaxed);
            let take=limit.saturating_sub(before).min(n);
            result.extend_from_slice(&buffer[..take]);
            if take<n{over.store(true,Ordering::Release);}
        }
        let _=tx.send(result);
    });
    rx
}
pub fn run(command:Command,cancel:Arc<AtomicBool>,timeout:Duration,output_limit:usize)->Result<Output,String>{
    run_limited(command,cancel,timeout,output_limit,120,None)
}
/// Separate, cancelable compilation budget for a user's trusted source.
/// This does not extend the ordinary execution deadline or provide a sandbox.
pub fn compile(command:Command,cancel:Arc<AtomicBool>,timeout:Duration,output_limit:usize)->Result<Output,String>{
    run_limited(command,cancel,timeout,output_limit,300,None)
}
/// Only for hash-pinned tool provisioning and authored compiler readiness checks.
/// Ordinary user-code execution must keep using run() and its 120-second ceiling.
pub fn provision(command:Command,cancel:Arc<AtomicBool>,timeout:Duration,output_limit:usize)->Result<Output,String>{
    run_limited(command,cancel,timeout,output_limit,600,None)
}
/// Bounded stdin for formatters. Writer never blocks the timeout/cleanup owner.
pub fn run_with_input(command:Command,input:Vec<u8>,cancel:Arc<AtomicBool>,timeout:Duration,output_limit:usize)->Result<Output,String>{
    if input.len()>1024*1024{return Err("格式化源码超过 1 MiB 限制".into());}
    run_limited(command,cancel,timeout,output_limit,10,Some(input))
}
fn run_limited(mut command:Command,cancel:Arc<AtomicBool>,timeout:Duration,output_limit:usize,ceiling:u64,input:Option<Vec<u8>>)->Result<Output,String>{
    if timeout.is_zero()||timeout>Duration::from_secs(ceiling)||output_limit==0||output_limit>1024*1024{return Err("本地运行限制无效".into());}
    if cancel.load(Ordering::Relaxed){return Err("运行已取消".into());}
    command.stdin(if input.is_some(){Stdio::piped()}else{Stdio::null()}).stdout(Stdio::piped()).stderr(Stdio::piped());
    let child=spawn(command).map_err(|e|format!("无法启动本地进程：{e}"))?;
    let used=Arc::new(AtomicUsize::new(0));let over=Arc::new(AtomicBool::new(false));
    let out=drain(child.take_stdout().map_err(|_|"进程已停止")?.ok_or("没有输出管道")?,used.clone(),over.clone(),output_limit);
    let err=drain(child.take_stderr().map_err(|_|"进程已停止")?.ok_or("没有错误输出管道")?,used,over.clone(),output_limit);
    if let Some(input)=input{
        let mut stdin=child.take_stdin().map_err(|_|"进程已停止")?.ok_or("没有输入管道")?;
        std::thread::spawn(move||{let _=stdin.write_all(&input);});
    }
    let started=Instant::now();let mut timed_out=false;let mut canceled=false;let mut exit_code=None;
    loop{
        if let Some(status)=child.try_wait().map_err(|e|format!("检查本地进程失败：{e}"))?{exit_code=status.code();break;}
        if cancel.load(Ordering::Relaxed){canceled=true;break;}
        if over.load(Ordering::Acquire){break;}
        if started.elapsed()>=timeout{timed_out=true;break;}
        std::thread::sleep(Duration::from_millis(10));
    }
    // Also clean up descendants when the top-level program exits normally.
    child.stop();
    let stdout=out.recv_timeout(Duration::from_secs(2)).map_err(|_|"输出管道未关闭；子进程清理异常")?;
    let stderr=err.recv_timeout(Duration::from_secs(2)).map_err(|_|"错误输出管道未关闭；子进程清理异常")?;
    Ok(Output{exit_code,stdout:String::from_utf8_lossy(&stdout).into(),stderr:String::from_utf8_lossy(&stderr).into(),
        timed_out,canceled,truncated:over.load(Ordering::Acquire),elapsed_ms:started.elapsed().as_millis()})
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn validation_prevents_start(){
        let mut command=Command::new("this-program-must-not-start");command.arg("unused");
        assert!(run(command,Arc::new(AtomicBool::new(false)),Duration::ZERO,1).is_err());
    }
}

/// Preserve canonical paths for containment checks, but avoid verbatim prefixes
/// at tool boundaries: several upstream Python utilities concatenate "/" paths.
pub fn tool_path(path:&std::path::Path)->std::path::PathBuf{
    #[cfg(windows)]{
        use std::{path::{Component,Prefix},os::windows::ffi::{OsStrExt,OsStringExt}};
        if matches!(path.components().next(),Some(Component::Prefix(prefix)) if matches!(prefix.kind(),Prefix::VerbatimDisk(_))){
            let wide:Vec<u16>=path.as_os_str().encode_wide().skip(4).collect();
            return std::path::PathBuf::from(std::ffi::OsString::from_wide(&wide));
        }
    }
    path.to_owned()
}
