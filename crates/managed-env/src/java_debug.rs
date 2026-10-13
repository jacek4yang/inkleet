//! Stdio bootstrap over the pinned, unmodified Microsoft Java debug core.
use crate::{Manager,java_runtime::Runtime,process};
use std::{fs,io::{Read,Write},path::{Path,PathBuf},process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
pub fn prepare(manager:&Manager,root:&Path,cancel:Arc<AtomicBool>)->Result<(Command,PathBuf),String>{
    let runtime=Runtime::prepare(manager,cancel.clone())?;
    let plugin=manager.installed("java-debug")?.ok_or("请先安装 Java 调试器")?;
    let launcher=manager.installed("jdtls")?.ok_or("Java 调试器需要独立 JDT 依赖")?;
    let dependencies=launcher.parent().ok_or("Java 依赖目录无效")?;
    let adapter=root.join(".java-adapter");fs::create_dir(&adapter).map_err(|_|"无法创建 Java 调试工作区")?;
    let mut classpath=vec![adapter.clone()];
    let mut zip=zip::ZipArchive::new(fs::File::open(plugin).map_err(|_|"无法读取 Java 调试分发包")?).map_err(|_|"Java 调试包无效")?;
    for name in ["lib/com.microsoft.java.debug.core-0.53.2.jar","lib/rxjava-2.2.21.jar","lib/reactive-streams-1.0.4.jar","lib/commons-io-2.19.0.jar"]{
        let mut entry=zip.by_name(name).map_err(|_|"Java 调试依赖缺失")?;
        if entry.size()>32*1024*1024{return Err("Java 调试依赖超过限制".into());}
        let path=adapter.join(Path::new(name).file_name().ok_or("Java 调试依赖路径无效")?);
        let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|_|"无法准备 Java 调试依赖")?;
        let bytes=std::io::copy(&mut entry.by_ref().take(32*1024*1024+1),&mut file).map_err(|_|"Java 调试依赖解压失败")?;
        if bytes>32*1024*1024{return Err("Java 调试依赖超过限制".into());}file.flush().map_err(|_|"Java 调试依赖写入失败")?;classpath.push(path);
    }
    for prefix in ["com.google.gson_","org.apache.commons.lang3_"]{
        let matches=fs::read_dir(dependencies).map_err(|_|"Java 调试依赖目录不可读取")?.filter_map(Result::ok).filter(|entry|entry.file_name().to_string_lossy().starts_with(prefix)&&entry.file_name().to_string_lossy().ends_with(".jar")).map(|entry|entry.path()).collect::<Vec<_>>();
        if matches.len()!=1{return Err(format!("Java 调试依赖不唯一：{prefix}"));}
        crate::regular(&matches[0])?;classpath.push(matches[0].clone());
    }
    let classpath=std::env::join_paths(classpath).map_err(|_|"Java 调试类路径无效")?;
    fs::write(adapter.join("InkLeetJavaAdapter.java"),include_str!("java_debug_bootstrap.java")).map_err(|_|"无法准备 Java 调试入口")?;
    let mut compiler=runtime.command(root,&[],"com.sun.tools.javac.Main")?;
    compiler.args(["-encoding","UTF-8","-proc:none","-cp"]).arg(&classpath).arg("-d").arg(&adapter).arg(adapter.join("InkLeetJavaAdapter.java"));
    let result=process::compile(compiler,cancel,Duration::from_secs(120),64*1024)?;
    if result.exit_code!=Some(0)||result.truncated||result.timed_out||result.canceled{return Err(format!("Java 调试入口编译未完成：{}",result.stderr));}
    let mut class_option=std::ffi::OsString::from("-Djava.class.path=");class_option.push(classpath);
    let mut command=runtime.command(root,&[class_option,"-Xmx256m".into(),"-Djava.net.preferIPv4Stack=true".into()],"InkLeetJavaAdapter")?;
    command.arg(root);
    if let Some(launcher)=runtime.private_launcher(){command.env("INKLEET_PRIVATE_JAVA",launcher);}
    Ok((command,runtime.home))
}
