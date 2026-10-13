//! Native compiled snapshots use only the application's verified toolchain.
use inkleet_managed_env::{Manager,cpp_harness,process};
use std::{path::{Path,PathBuf},process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
pub fn cpp(manager:&Manager,root:&Path,cache_root:&Path,snapshot:&crate::local_run::Snapshot,cancel:Arc<AtomicBool>)->Result<(PathBuf,process::Output),String>{
    let zig=process::tool_path(&manager.installed("zig")?.ok_or("请先安装独立 C/C++ 工具链")?);
    cpp_harness::prepare(root,&snapshot.code,&snapshot.metadata,&snapshot.input)?;
    let binary=root.join(if cfg!(windows){"solution.exe"}else{"solution"});
    let temporary=root.join("temp");std::fs::create_dir_all(&temporary).map_err(|_|"无法创建编译临时目录")?;
    let mut command=Command::new(&zig);
    command.current_dir(root).env_clear().env("PATH",zig.parent().ok_or("C++ 编译器路径无效")?)
        .env("HOME",root).env("USERPROFILE",root).env("TMP",&temporary).env("TEMP",&temporary).env("TMPDIR",&temporary)
        .env("ZIG_GLOBAL_CACHE_DIR",cache_root.join("zig-cache")).env("ZIG_LOCAL_CACHE_DIR",root.join("zig-local"))
        .args(["c++","-std=c++20","-O0","-g"]);
    if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
    if cfg!(windows){command.args(["-target","x86_64-windows-gnu"]);}
    #[cfg(target_os="linux")] command.args(["-target","x86_64-linux-gnu"]);
    command.arg(root.join("harness.cpp")).arg("-o").arg(&binary);
    let output=process::compile(command,cancel,Duration::from_secs(240),64*1024)?;
    Ok((binary,output))
}
pub fn clean_runtime(command:&mut Command,root:&Path)->Result<(),String>{
    let temporary=root.join("temp");std::fs::create_dir_all(&temporary).map_err(|_|"无法创建运行临时目录")?;
    command.current_dir(root).env_clear().env("PATH","").env("HOME",root).env("USERPROFILE",root)
        .env("TMP",&temporary).env("TEMP",&temporary).env("TMPDIR",&temporary);
    if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
    Ok(())
}
