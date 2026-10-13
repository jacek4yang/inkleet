//! Native compiled snapshots use only the application's verified toolchain.
use inkleet_managed_env::{Manager,cpp_harness,c_harness,process};
use std::{path::{Path,PathBuf},process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
pub fn cpp(manager:&Manager,root:&Path,cache_root:&Path,snapshot:&crate::local_run::Snapshot,cancel:Arc<AtomicBool>)->Result<(PathBuf,process::Output),String>{
    let zig=process::tool_path(&manager.installed("zig")?.ok_or("请先安装独立 C/C++ 工具链")?);
    let is_c=snapshot.language=="c";
    if is_c{c_harness::prepare(root,&snapshot.code,&snapshot.metadata,&snapshot.input)?;}else{cpp_harness::prepare(root,&snapshot.code,&snapshot.metadata,&snapshot.input)?;}
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
    let mut c_elapsed=0;
    if is_c{
        let mut source=Command::new(&zig);clean_runtime(&mut source,root)?;
        source.env("PATH",zig.parent().ok_or("C 编译器路径无效")?).env("ZIG_GLOBAL_CACHE_DIR",cache_root.join("zig-cache")).env("ZIG_LOCAL_CACHE_DIR",root.join("zig-local"))
            .args(["cc","-std=c11","-O0","-g","-include"]).arg(root.join("prototype.h"));
        if cfg!(windows){source.args(["-target","x86_64-windows-gnu"]);}
        #[cfg(target_os="linux")] source.args(["-target","x86_64-linux-gnu"]);
        source.arg("-c").arg(root.join("solution.c")).arg("-o").arg(root.join("solution.o"));
        let output=process::compile(source,cancel.clone(),Duration::from_secs(120),64*1024)?;
        if output.exit_code!=Some(0)||output.canceled||output.timed_out||output.truncated{return Ok((binary,output));}
        c_elapsed=output.elapsed_ms;command.arg(root.join("solution.o"));
    }
    command.arg(root.join("harness.cpp")).arg("-o").arg(&binary);
    let mut output=process::compile(command,cancel,Duration::from_secs(240),64*1024)?;
    output.elapsed_ms+=c_elapsed;
    Ok((binary,output))
}
pub fn clean_runtime(command:&mut Command,root:&Path)->Result<(),String>{
    let temporary=root.join("temp");std::fs::create_dir_all(&temporary).map_err(|_|"无法创建运行临时目录")?;
    command.current_dir(root).env_clear().env("PATH","").env("HOME",root).env("USERPROFILE",root)
        .env("TMP",&temporary).env("TEMP",&temporary).env("TMPDIR",&temporary);
    if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
    Ok(())
}

pub fn rust(manager:&Manager,root:&Path,cache_root:&Path,snapshot:&crate::local_run::Snapshot,cancel:Arc<AtomicBool>)->Result<(PathBuf,process::Output),String>{
    let rustc=process::tool_path(&manager.installed("rustc")?.ok_or("请先安装 Rust 编译器")?);
    let stdentry=manager.installed("rust-std")?.ok_or("请先安装 Rust 标准库")?;
    let stdroot=process::tool_path(stdentry.parent().ok_or("Rust 标准库目录无效")?);
    let zig=process::tool_path(&manager.installed("zig")?.ok_or("请先安装私有 Zig 链接器")?);
    inkleet_managed_env::rust_harness::prepare(root,&snapshot.code,&snapshot.metadata,&snapshot.input)?;
    let binary=root.join(if cfg!(windows){"solution.exe"}else{"solution"});
    let rustlib=rustc.parent().and_then(Path::parent).ok_or("Rust 编译器路径无效")?.join("lib");
    let mut command=Command::new(&rustc);clean_runtime(&mut command,root)?;
    command.env("PATH",std::env::join_paths([rustc.parent().ok_or("Rust 路径无效")?,zig.parent().ok_or("Zig 路径无效")?]).map_err(|_|"编译路径无效")?)
        .env("LD_LIBRARY_PATH",&rustlib).env("DYLD_LIBRARY_PATH",&rustlib)
        .env("ZIG_GLOBAL_CACHE_DIR",cache_root.join("zig-cache")).env("ZIG_LOCAL_CACHE_DIR",root.join("zig-local"))
        .arg(root.join("harness.rs")).args(["--edition=2021","-g","-C","opt-level=0"]).arg("--sysroot").arg(&stdroot).arg("-o").arg(&binary);
    // Keep per-object DWARF in the private workspace; no system dsymutil.
    #[cfg(target_os="macos")] command.args(["-C","split-debuginfo=unpacked"]);
    if cfg!(windows){
        let lld=rustlib.join("rustlib/x86_64-pc-windows-msvc/bin/rust-lld.exe");
        if !lld.is_file(){return Err("Rust 私有 LLD 缺失，请修复工具链".into());}
        let mingw=manager.installed("rust-mingw")?.ok_or("请先安装 Rust Windows 链接库")?;
        let target=process::tool_path(mingw.parent().and_then(Path::parent).and_then(Path::parent).ok_or("Rust 链接库路径无效")?);
        command.arg("-C").arg(format!("linker={}",lld.display())).args(["-C","link-self-contained=yes","-C","linker-flavor=ld.lld","--target","x86_64-pc-windows-gnu"])
            .arg("-L").arg(format!("native={}",target.join("lib/self-contained").display()));
    }else{
        command.arg("-C").arg(format!("linker={}",std::env::current_exe().map_err(|_|"无法定位应用链接入口")?.display()))
            .args(["-C","linker-flavor=gcc"]).env("INKLEET_MANAGED_LINKER_ROOT",manager.root());
    }
    let output=process::compile(command,cancel,Duration::from_secs(240),64*1024)?;
    Ok((binary,output))
}
/// An internal rustc linker entry, before initializing GUI state. Only a verified
/// built-in Zig package can be launched; no shell, URL, or arbitrary executable.
pub fn linker_entry()->Option<Result<(),String>>{
    let root=std::env::var_os("INKLEET_MANAGED_LINKER_ROOT")?;
    Some((||{
        let manager=Manager::new(PathBuf::from(root));
        let zig=manager.installed("zig")?.ok_or("应用私有链接器缺失")?;
        let mut command=Command::new(zig);
        command.arg("cc").args(std::env::args_os().skip(1)).env_remove("INKLEET_MANAGED_LINKER_ROOT");
        #[cfg(unix)]{
            use std::os::unix::process::CommandExt;
            Err(format!("无法启动私有链接器：{}",command.exec()))
        }
        #[cfg(not(unix))]{
            let status=command.status().map_err(|e|e.to_string())?;
            if status.success(){Ok(())}else{Err(format!("私有链接器退出：{status}"))}
        }
    })())
}

pub fn java(manager:&Manager,root:&Path,snapshot:&crate::local_run::Snapshot,cancel:Arc<AtomicBool>)->Result<(Command,process::Output),String>{
    if cfg!(windows){return Err("Windows Java 中文路径兼容性验证中，尚未启用本地执行".into());}
    let java=process::tool_path(&manager.installed("jdk")?.ok_or("请先安装独立 JDK")?);
    let home=java.parent().and_then(Path::parent).ok_or("JDK 路径无效")?;
    inkleet_managed_env::java_harness::prepare(root,&snapshot.code,&snapshot.metadata,&snapshot.input)?;
    let mut compile=Command::new(home.join("bin/javac"));clean_runtime(&mut compile,root)?;
    #[cfg(target_os="linux")] compile.env("LANG","C.UTF-8").env("LC_ALL","C.UTF-8");
    compile.env("PATH",home.join("bin")).env("JAVA_HOME",home)
        .args(["-encoding","UTF-8","-g","-proc:none","Solution.java","InkLeetNodes.java","InkLeetJson.java","InkLeetHarness.java"]);
    let output=process::compile(compile,cancel,Duration::from_secs(120),64*1024)?;
    let mut command=Command::new(&java);clean_runtime(&mut command,root)?;
    #[cfg(target_os="linux")] command.env("LANG","C.UTF-8").env("LC_ALL","C.UTF-8");
    command.env("JAVA_HOME",home).args(["-Xmx256m","-Dstdout.encoding=UTF-8","-Dstderr.encoding=UTF-8","-cp",".","InkLeetHarness"]);
    Ok((command,output))
}
