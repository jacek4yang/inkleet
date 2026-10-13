use inkleet_managed_env::{Manager,Report,process};
use std::{path::{Path,PathBuf},process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
fn clean(program:&Path,work:&Path,paths:&[PathBuf])->Command{
    let mut command=Command::new(program);
    command.current_dir(work).env_clear().env("HOME",work).env("USERPROFILE",work)
        .env("TMP",work).env("TEMP",work).env("PATH",std::env::join_paths(paths).unwrap())
        .env("ZIG_GLOBAL_CACHE_DIR",work.join("zig-cache")).env("ZIG_LOCAL_CACHE_DIR",work.join("zig-local"));
    if let Some(rust_lib)=paths.get(1){command.env("LD_LIBRARY_PATH",rust_lib).env("DYLD_LIBRARY_PATH",rust_lib);}
    if let Some(root)=std::env::var_os("SystemRoot"){command.env("SystemRoot",root);}
    command
}
fn checked(command:Command)->Result<String,String>{
    let result=process::run(command,Arc::new(AtomicBool::new(false)),Duration::from_secs(120),1024*1024)?;
    if result.exit_code!=Some(0)||result.timed_out||result.truncated{return Err(format!("compiler probe failed: {:?}",result));}
    Ok(result.stdout)
}
#[tokio::main]
async fn main()->Result<(),String>{
    if std::env::var("INKLEET_LINKER_MODE").as_deref()==Ok("1"){
        let status=Command::new(std::env::var_os("INKLEET_ZIG").ok_or("missing private linker")?)
            .arg("cc").args(std::env::args_os().skip(1)).status().map_err(|e|e.to_string())?;
        std::process::exit(status.code().unwrap_or(1));
    }
    let temp=tempfile::Builder::new().prefix("inkleet compiler 空格 ").tempdir().map_err(|e|e.to_string())?;
    let root=std::fs::canonicalize(temp.path()).map_err(|e|e.to_string())?;
    let manager=Manager::new(root.join("tools"));let report:Report=Arc::new(|_|{});
    let mut install=std::collections::HashMap::new();
    for id in ["rustc","cargo","rust-std","rust-analyzer-preview","rust-src","zig"]{
        println!("Installing verified {id}");
        install.insert(id,manager.install(id,Arc::new(AtomicBool::new(false)),report.clone()).await?);
    }
    let work=root.join("work");std::fs::create_dir(&work).map_err(|e|e.to_string())?;
    let rustc=install["rustc"].clone();let cargo=install["cargo"].clone();let zig=install["zig"].clone();
    let stdroot=install["rust-std"].parent().unwrap().to_path_buf();
    let rust_lib=rustc.parent().unwrap().parent().unwrap().join("lib");
    let paths=vec![rustc.parent().unwrap().to_owned(),rust_lib,cargo.parent().unwrap().to_owned(),zig.parent().unwrap().to_owned()];
    let version={let mut c=clean(&rustc,&work,&paths);c.arg("--version");checked(c)?};
    let cargo_version={let mut c=clean(&cargo,&work,&paths);c.arg("--version");checked(c)?};
    let ra_version={let mut c=clean(&install["rust-analyzer-preview"],&work,&paths);c.arg("--version");checked(c)?};
    let extension=if cfg!(windows){".exe"}else{""};
    for (filename,source,driver) in [
        ("check.c","#include <stdio.h>\nint main(void){printf(\"6\\n\");return 0;}\n","cc"),
        ("check.cpp","#include <vector>\n#include <iostream>\nint main(){std::vector<int> v{1,2,3};int sum=0;for(int x:v)sum+=x;std::cout<<sum<<'\\n';}\n","c++")
    ]{
        let source_path=work.join(filename);std::fs::write(&source_path,source).map_err(|e|e.to_string())?;
        let output=work.join(format!("{filename}{extension}"));
        let mut command=clean(&zig,&work,&paths);command.arg(driver).arg(&source_path).arg("-o").arg(&output);
        checked(command)?;
        assert_eq!(checked(clean(&output,&work,&paths))?.trim(),"6");
    }
    let rust_source=work.join("check.rs");std::fs::write(&rust_source,"fn main(){let v=vec![1,2,3];println!(\"{}\",v.iter().sum::<i32>());}\n").map_err(|e|e.to_string())?;
    let output=work.join(format!("check-rust{extension}"));
    let mut command=clean(&rustc,&work,&paths);
    command.arg(&rust_source).arg("--edition=2021").arg("--sysroot").arg(&stdroot)
        .arg("-C").arg(format!("linker={}",std::env::current_exe().map_err(|e|e.to_string())?.display()))
        .args(["-C","linker-flavor=gcc"]).arg("-o").arg(&output)
        .env("INKLEET_LINKER_MODE","1").env("INKLEET_ZIG",&zig);
    if cfg!(windows){command.args(["--target","x86_64-pc-windows-gnu"]);}
    checked(command)?;
    assert_eq!(checked(clean(&output,&work,&paths))?.trim(),"6");
    println!("COMPILER_RESULT {}",serde_json::json!({"platform":inkleet_managed_env::platform(),"rust":version.trim(),"cargo":cargo_version.trim(),"rustAnalyzer":ra_version.trim(),"rustCompileRun":true,"cCompileRun":true,"cppCompileRun":true,"systemPathUsed":false,"stdlibSource":install["rust-src"].is_file()}));
    Ok(())
}
