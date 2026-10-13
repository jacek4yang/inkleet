//! Bounded local execution for the user's own code. This is NOT a security sandbox.
use process_wrap::std::{ChildWrapper,CommandWrap};
use serde::Serialize;
use std::{io::Read,process::{Command,Stdio},sync::{Arc,atomic::{AtomicBool,AtomicUsize,Ordering},mpsc},time::{Duration,Instant}};
pub fn spawn(command:Command)->std::io::Result<Box<dyn ChildWrapper>>{
    let mut command=CommandWrap::from(command);
    #[cfg(unix)] command.wrap(process_wrap::std::ProcessGroup::leader());
    #[cfg(windows)] {
        command.wrap(process_wrap::std::CreationFlags(0x08000000));
        command.wrap(process_wrap::std::JobObject);
    }
    command.spawn()
}
struct Guard(Box<dyn ChildWrapper>,bool);
impl Drop for Guard{fn drop(&mut self){if !self.1{let _=self.0.kill();}}}
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
pub fn run(mut command:Command,cancel:Arc<AtomicBool>,timeout:Duration,output_limit:usize)->Result<Output,String>{
    if timeout.is_zero()||timeout>Duration::from_secs(120)||output_limit==0||output_limit>1024*1024{return Err("本地运行限制无效".into());}
    if cancel.load(Ordering::Relaxed){return Err("运行已取消".into());}
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child=Guard(spawn(command).map_err(|e|format!("无法启动本地进程：{e}"))?,false);
    let used=Arc::new(AtomicUsize::new(0));let over=Arc::new(AtomicBool::new(false));
    let out=drain(child.0.stdout().take().ok_or("没有输出管道")?,used.clone(),over.clone(),output_limit);
    let err=drain(child.0.stderr().take().ok_or("没有错误输出管道")?,used,over.clone(),output_limit);
    let started=Instant::now();let mut timed_out=false;let mut canceled=false;let mut exit_code=None;
    loop{
        if let Some(status)=child.0.try_wait().map_err(|e|format!("检查本地进程失败：{e}"))?{exit_code=status.code();break;}
        if cancel.load(Ordering::Relaxed){canceled=true;break;}
        if over.load(Ordering::Acquire){break;}
        if started.elapsed()>=timeout{timed_out=true;break;}
        std::thread::sleep(Duration::from_millis(10));
    }
    // Also clean up descendants when the top-level program exits normally.
    child.1=true;
    if child.0.kill().is_ok(){let _=child.0.wait();}
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
