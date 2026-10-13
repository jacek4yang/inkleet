//! Verified private Java launcher. Windows uses an app-owned JNI bootstrap with
//! a per-executable UTF-8 manifest, never a patched JDK or system locale change.
use crate::{Manager,process};
use std::{ffi::OsString,fs,path::{Path,PathBuf},process::Command,sync::{Arc,atomic::{AtomicBool,Ordering}},time::{Duration,Instant}};
const SOURCE:&str=include_str!("java_launcher_windows.c");
const MANIFEST:&str=include_str!("java_launcher_windows.manifest");
pub struct Runtime{pub home:PathBuf,executable:PathBuf,embedded:bool}
fn clean(command:&mut Command,root:&Path,home:&Path)->Result<(),String>{
    let temporary=root.join(".java-temp");fs::create_dir_all(&temporary).map_err(|_|"无法创建 Java 临时目录")?;
    command.current_dir(root).env_clear().env("PATH",home.join("bin")).env("JAVA_HOME",home)
        .env("HOME",root).env("USERPROFILE",root).env("TMP",&temporary).env("TEMP",&temporary).env("TMPDIR",&temporary);
    #[cfg(target_os="linux")] command.env("LANG","C.UTF-8").env("LC_ALL","C.UTF-8");
    if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
    Ok(())
}
impl Runtime{
    pub fn prepare(manager:&Manager,cancel:Arc<AtomicBool>)->Result<Self,String>{
        let java=process::tool_path(&manager.installed("jdk")?.ok_or("请先安装独立 JDK")?);
        let home=java.parent().and_then(Path::parent).ok_or("JDK 路径无效")?.to_owned();
        if !cfg!(windows){return Ok(Self{home,executable:java,embedded:false});}
        let zig=process::tool_path(&manager.installed("zig")?.ok_or("Windows Java 首次使用需要私有 Zig 构建启动器，请安装完整 Java 环境")?);
        use sha2::{Digest,Sha256};
        let key=format!("{:x}",Sha256::digest(format!("{SOURCE}{MANIFEST}{}{}",crate::package("jdk")?.sha256,crate::package("zig")?.sha256)));
        let generated=manager.root().join("generated");crate::directory(&generated)?;
        let lock_path=generated.join("java-launcher.lock");
        if lock_path.exists(){crate::regular(&lock_path)?;}
        let lock=fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(lock_path).map_err(|_|"无法锁定 Java 启动器")?;
        let deadline=Instant::now()+Duration::from_secs(300);
        loop{if lock.try_lock().is_ok(){break;}if cancel.load(Ordering::Acquire){return Err("Java 启动器准备已取消".into());}if Instant::now()>deadline{return Err("另一个 Java 启动器准备任务尚未完成".into());}std::thread::sleep(Duration::from_millis(100));}
        let destination=generated.join(format!("java-{key}"));let executable=destination.join("private-java.exe");
        if destination.exists(){
            crate::directory(&destination)?;
            let receipt=destination.join("entry.sha256");
            if crate::regular(&executable).is_ok()&&crate::regular(&receipt).is_ok()&&fs::metadata(&receipt).map(|m|m.len()==64).unwrap_or(false){
                if fs::read_to_string(receipt).ok().as_deref()==Some(crate::hash_file(&executable,&cancel)?.as_str()){
                    return Ok(Self{home,executable:process::tool_path(&executable),embedded:true});
                }
            }
            fs::remove_dir_all(&destination).map_err(|_|"无法修复应用私有 Java 启动器")?;
        }
        let stage=tempfile::Builder::new().prefix(".java-").tempdir_in(&generated).map_err(|_|"无法创建 Java 启动器构建目录")?;
        let root=process::tool_path(&fs::canonicalize(stage.path()).map_err(|_|"Java 启动器目录无效")?);
        fs::write(root.join("launcher.c"),SOURCE).map_err(|_|"无法准备 Java 启动器源码")?;
        fs::write(root.join("utf8.manifest"),MANIFEST).map_err(|_|"无法准备 Java UTF-8 清单")?;
        fs::write(root.join("launcher.rc"),"1 24 \"utf8.manifest\"\n").map_err(|_|"无法准备 Java 启动器资源")?;
        for resource in [true,false]{
            let mut command=Command::new(&zig);clean(&mut command,&root,&home)?;
            command.env("PATH",zig.parent().ok_or("Zig 路径无效")?).env("ZIG_GLOBAL_CACHE_DIR",generated.join("zig-cache")).env("ZIG_LOCAL_CACHE_DIR",root.join("zig-local"));
            if resource{command.args(["rc","/fo","launcher.res","launcher.rc"]);}
            else{command.args(["cc","-std=c11","-target","x86_64-windows-gnu","-municode","-I"]).arg(home.join("include")).arg("-I").arg(home.join("include/win32")).args(["launcher.c","launcher.res","-o","private-java.exe"]);}
            let output=process::compile(command,cancel.clone(),Duration::from_secs(240),64*1024)?;
            if output.canceled{return Err("Java 启动器准备已停止".into());}
            if output.exit_code!=Some(0)||output.timed_out||output.truncated{return Err(format!("Java 启动器构建未完成：{}",output.stderr));}
        }
        let hash=crate::hash_file(&root.join("private-java.exe"),&cancel)?;
        fs::write(root.join("entry.sha256"),hash).map_err(|_|"无法保存 Java 启动器校验记录")?;
        if cancel.load(Ordering::Acquire){return Err("Java 启动器准备已取消".into());}
        fs::rename(stage.path(),&destination).map_err(|_|"无法完成 Java 启动器安装")?;
        Ok(Self{home,executable:process::tool_path(&executable),embedded:true})
    }
    pub fn command(&self,root:&Path,options:&[OsString],main_class:&str)->Result<Command,String>{
        let mut command=Command::new(&self.executable);clean(&mut command,root,&self.home)?;
        if self.embedded{command.arg(&self.home).arg("--vmopts").arg(options.len().to_string()).args(options).arg(main_class);}
        else{command.args(options).arg(main_class);}
        Ok(command)
    }
}
