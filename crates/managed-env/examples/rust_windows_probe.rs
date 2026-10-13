use inkleet_managed_env::{Manager,Report,process};
use std::{path::Path,process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
#[tokio::main]async fn main()->Result<(),String>{
    if !cfg!(windows){return Err("This focused probe requires Windows".into());}
    let temp=tempfile::Builder::new().prefix("inkleet 链接 Unicode ").tempdir().map_err(|e|e.to_string())?;
    let root=process::tool_path(&std::fs::canonicalize(temp.path()).map_err(|e|e.to_string())?);
    let manager=Manager::new(root.join("tools"));let report:Report=Arc::new(|_|{});
    let rustc=manager.install("rustc",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    let std_entry=manager.install("rust-std",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    let mingw=manager.install("rust-mingw",Arc::new(AtomicBool::new(false)),report).await?;
    let stdroot=std_entry.parent().ok_or("std root")?;
    let rustroot=rustc.parent().and_then(Path::parent).ok_or("Rust root")?;
    let lld=rustroot.join("lib/rustlib/x86_64-pc-windows-gnu/bin/rust-lld.exe");
    if !lld.is_file(){return Err(format!("Missing official LLD: {}",lld.display()));}
    let libraries=mingw.parent().and_then(Path::parent).and_then(Path::parent).ok_or("MinGW root")?.join("lib/self-contained");
    let source=root.join("solution.rs");let binary=root.join("solution.exe");
    std::fs::write(&source,"fn main(){let n=std::thread::spawn(||vec![1,2,3].iter().sum::<i32>()).join().unwrap();assert!(std::panic::catch_unwind(||panic!(\"fixture\")).is_err());println!(\"{}\",n);}\n").map_err(|e|e.to_string())?;
    let path=std::env::join_paths([rustc.parent().unwrap().to_owned(),rustroot.join("lib"),mingw.parent().unwrap().to_owned()]).map_err(|e|e.to_string())?;
    let clean=|command:&mut Command|{
        command.env_clear().current_dir(&root).env("PATH",&path).env("HOME",&root).env("USERPROFILE",&root).env("TMP",&root).env("TEMP",&root);
        if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
    };
    let mut compile=Command::new(&rustc);clean(&mut compile);
    compile.arg(&source).args(["--edition=2021","--target","x86_64-pc-windows-gnu","--sysroot"]).arg(stdroot)
        .arg("-C").arg(format!("linker={}",lld.display())).args(["-C","linker-flavor=ld.lld","-C","link-self-contained=yes"])
        .arg("-L").arg(format!("native={}",libraries.display())).arg("-o").arg(&binary);
    let result=process::run(compile,Arc::new(AtomicBool::new(false)),Duration::from_secs(120),64*1024)?;
    if result.exit_code!=Some(0){return Err(format!("Rust Unicode compile: {result:?}"));}
    let mut run=Command::new(&binary);clean(&mut run);
    let result=process::run(run,Arc::new(AtomicBool::new(false)),Duration::from_secs(10),64*1024)?;
    if result.exit_code!=Some(0)||result.stdout.trim()!="6"{return Err(format!("Rust Unicode run: {result:?}"));}
    println!("RUST_WINDOWS_UNICODE_RESULT threads=true unwind=true result=6 systemPath=false linker=official-rust-lld");
    Ok(())
}
