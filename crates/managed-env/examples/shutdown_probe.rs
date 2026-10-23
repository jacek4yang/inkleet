//! Standalone process: shutdown is irreversible for this app lifetime.
use inkleet_managed_env::process;
use std::{process::{Command,Stdio},io::{BufRead,BufReader,Write},time::Duration};
fn main()->Result<(),String>{
    let args=std::env::args().collect::<Vec<_>>();
    if args.get(1).map(String::as_str)==Some("--grandchild"){
        std::thread::sleep(Duration::from_secs(3));
        std::fs::write(&args[2],"orphan survived").map_err(|e|e.to_string())?;return Ok(());
    }
    if args.get(1).map(String::as_str)==Some("--child"){
        let _grandchild=Command::new(std::env::current_exe().map_err(|e|e.to_string())?).args(["--grandchild",&args[2]])
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e|e.to_string())?;
        println!("READY");std::io::stdout().flush().map_err(|e|e.to_string())?;
        std::thread::sleep(Duration::from_secs(30));return Ok(());
    }
    let temp=tempfile::Builder::new().prefix("inkleet shutdown 中文 ").tempdir().map_err(|e|e.to_string())?;
    let marker=temp.path().join("orphan-marker");let exe=std::env::current_exe().map_err(|e|e.to_string())?;
    let mut command=Command::new(&exe);command.arg("--child").arg(&marker).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let child=process::spawn(command).map_err(|e|e.to_string())?;
    let stdout=child.take_stdout().map_err(|e|e.to_string())?.ok_or("stdout missing")?;
    let(tx,rx)=std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move||{let mut line=String::new();let result=BufReader::new(stdout).read_line(&mut line);let _=tx.send((result,line));});
    let(result,line)=rx.recv_timeout(Duration::from_secs(10)).map_err(|_|"fixture failed to start")?;
    result.map_err(|e|e.to_string())?;assert_eq!(line.trim(),"READY");
    let started=std::time::Instant::now();process::shutdown_owned();
    assert!(started.elapsed()<Duration::from_secs(5),"shutdown exceeded bound");
    child.stop();process::shutdown_owned();
    assert!(process::spawn(Command::new(&exe)).is_err(),"spawn gate reopened after shutdown");
    std::thread::sleep(Duration::from_millis(3500));
    assert!(!marker.exists(),"owned descendant survived shutdown");
    println!("OWNED_SHUTDOWN_RESULT {}",serde_json::json!({"platform":inkleet_managed_env::platform(),"descendantsTerminated":true,"spawnGateClosed":true,"idempotent":true,"bounded":true}));
    Ok(())
}
