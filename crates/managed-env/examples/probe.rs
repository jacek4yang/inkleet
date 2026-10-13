use inkleet_managed_env::{Manager, Report, platform};
use std::{sync::{Arc, atomic::AtomicBool}, time::Duration};
#[tokio::main]
async fn main() -> Result<(), String> {
    let temp = tempfile::Builder::new().prefix("inkleet managed 环境 ").tempdir().map_err(|e|e.to_string())?;
    let manager=Manager::new(temp.path().join("tools"));
    let report: Report=Arc::new(|p| { if p.phase!="downloading" { println!("PHASE {}",p.phase); } });
    let python=manager.install("python",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    let again=manager.install("python",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    assert_eq!(python,again);
    let work=temp.path().join("work");std::fs::create_dir(&work).map_err(|e|e.to_string())?;
    let script="import sys, json, pathlib, inspect, collections, ssl, sqlite3; assert sys.flags.isolated; assert sys.version_info[:2] == (3,14); assert pathlib.Path(inspect.getsourcefile(collections)).is_file(); print(json.dumps({'version':sys.version.split()[0],'stdlibSource':True,'ssl':ssl.OPENSSL_VERSION,'sqlite':sqlite3.sqlite_version}))";
    let mut command=tokio::process::Command::new(&python);
    command.args(["-I","-c",script]).current_dir(&work).env_clear().env("HOME",&work).env("USERPROFILE",&work).env("TEMP",&work).env("TMP",&work).env("PATH",python.parent().unwrap()).kill_on_drop(true);
    if let Some(root)=std::env::var_os("SystemRoot"){command.env("SystemRoot",root);}
    let result=tokio::time::timeout(Duration::from_secs(30),command.output()).await.map_err(|_|"private python timed out")?.map_err(|e|e.to_string())?;
    if !result.status.success(){return Err(format!("private python failed: {}",String::from_utf8_lossy(&result.stderr)));}
    let pyright=manager.install("pyright",Arc::new(AtomicBool::new(false)),report).await?;
    assert!(pyright.is_file());
    println!("MANAGED_ENV_RESULT {}",serde_json::json!({"platform":platform(),"python":serde_json::from_slice::<serde_json::Value>(&result.stdout).map_err(|e|e.to_string())?,"pyrightPackage":true,"systemPathUsed":false,"reinstallIdempotent":true}));
    Ok(())
}
