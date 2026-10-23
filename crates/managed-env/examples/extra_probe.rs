use inkleet_managed_env::{Manager,Report,process};
use std::{path::{Path,PathBuf},process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
fn clean(program:&Path,root:&Path,paths:&[PathBuf])->Command{
    let mut cmd=Command::new(program);cmd.env_clear().current_dir(root).env("PATH",std::env::join_paths(paths).unwrap())
        .env("HOME",root).env("USERPROFILE",root).env("TMP",root).env("TEMP",root);
    if let Some(system)=std::env::var_os("SystemRoot"){cmd.env("SystemRoot",system);}
    #[cfg(target_os="linux")] {cmd.env("LANG","C.UTF-8").env("LC_ALL","C.UTF-8");}
    cmd
}
fn checked(cmd:Command)->Result<String,String>{
    println!("TOOL_COMMAND {:?} {:?}",cmd.get_program(),cmd.get_args().collect::<Vec<_>>());
    let result=process::run(cmd,Arc::new(AtomicBool::new(false)),Duration::from_secs(120),1024*1024)?;
    if result.exit_code!=Some(0)||result.timed_out||result.truncated{return Err(format!("tool probe failed: {result:?}"));}
    Ok(result.stdout+&result.stderr)
}

#[cfg(windows)]
fn legacy_java_path(path:&Path)->Result<PathBuf,String>{
    use std::os::windows::ffi::{OsStrExt,OsStringExt};
    #[link(name="kernel32")]
    unsafe extern "system" {fn GetShortPathNameW(long:*const u16,short:*mut u16,size:u32)->u32;}
    let original=std::fs::canonicalize(path).map_err(|e|e.to_string())?;
    let mut wide:Vec<u16>=original.as_os_str().encode_wide().collect();
    if wide.contains(&0){return Err("JDK path contains NUL".into());}wide.push(0);
    // Read an existing alias only. Do not enable 8.3 names or change filesystem settings.
    let size=unsafe{GetShortPathNameW(wide.as_ptr(),std::ptr::null_mut(),0)};
    if size==0||size>32768{return Err("Windows JDK path alias unavailable".into());}
    let mut buffer=vec![0u16;size as usize];
    let written=unsafe{GetShortPathNameW(wide.as_ptr(),buffer.as_mut_ptr(),size)};
    if written==0||written>=size{return Err("Windows JDK path alias changed".into());}
    let alias=std::ffi::OsString::from_wide(&buffer[..written as usize]);
    let value=alias.to_str().ok_or("JDK path is not Unicode")?;
    let value=value.strip_prefix(r"\\?\").unwrap_or(value);
    if !value.is_ascii(){return Err("The Windows JDK launcher needs an ASCII-compatible path; this volume supplies no short alias".into());}
    let alias=PathBuf::from(value);
    if std::fs::canonicalize(&alias).map_err(|e|e.to_string())?!=original{return Err("JDK path alias does not match installed package".into());}
    Ok(alias)
}

#[tokio::main]async fn main()->Result<(),String>{
    let temporary=tempfile::Builder::new().prefix("inkleet more 环境 ").tempdir().map_err(|e|e.to_string())?;
    let root=std::fs::canonicalize(temporary.path()).map_err(|e|e.to_string())?;let manager=Manager::new(root.join("tools"));
    let report:Report=Arc::new(|_|{});
    let go=manager.install("go",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    let jdk=manager.install("jdk",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    #[cfg(windows)] let jdk=legacy_java_path(&jdk)?;
    let work=root.join("work");std::fs::create_dir(&work).map_err(|e|e.to_string())?;
    let go_root=go.parent().and_then(Path::parent).ok_or("Go root")?;
    let java_root=jdk.parent().and_then(Path::parent).ok_or("Java root")?;
    let paths=vec![go.parent().unwrap().to_owned(),jdk.parent().unwrap().to_owned()];
    let extension=if cfg!(windows){".exe"}else{""};
    let source=work.join("main.go");
    std::fs::write(&source,"package main\nimport \"fmt\"\nfunc main(){ values:=[]int{1,2,3}; total:=0; for _,v:=range values{total+=v};fmt.Println(total) }\n").map_err(|e|e.to_string())?;
    let binary=work.join(format!("go-check{extension}"));
    let mut cmd=clean(&go,&work,&paths);
    cmd.args(["build","-o"]).arg(&binary).arg(&source).env("GOROOT",go_root).env("GOTOOLCHAIN","local").env("CGO_ENABLED","0")
        .env("GOCACHE",work.join("go-cache")).env("GOPATH",work.join("go-path")).env("GOMODCACHE",work.join("go-modules")).env("GOPROXY","off").env("GOSUMDB","off");
    checked(cmd)?;assert_eq!(checked(clean(&binary,&work,&paths))?.trim(),"6");
    assert!(go_root.join("src/fmt/print.go").is_file());
    std::fs::write(work.join("Main.java"),"import java.util.Arrays; class Main { public static void main(String[] args) {System.out.println(Arrays.stream(new int[]{1,2,3}).sum());} }\n").map_err(|e|e.to_string())?;
    let javac=jdk.with_file_name(format!("javac{extension}"));let mut cmd=clean(&javac,&work,&paths);cmd.arg("Main.java").env("JAVA_HOME",java_root);
    #[cfg(windows)] {cmd.arg("-J-Xshare:off").arg(format!("-J-Djava.home={}",java_root.display()));}
    checked(cmd)?;
    let mut cmd=clean(&jdk,&work,&paths);#[cfg(windows)] {cmd.arg("-Xshare:off").arg(format!("-Djava.home={}",java_root.display()));}
    cmd.args(["-cp",".","Main"]).env("JAVA_HOME",java_root);assert_eq!(checked(cmd)?.trim(),"6");
    assert!(java_root.join("lib/src.zip").is_file());
    println!("LANGUAGE_RUNTIME_RESULT {}",serde_json::json!({"platform":inkleet_managed_env::platform(),"goCompileRun":true,"javaCompileRun":true,"goSource":true,"javaSourceArchive":true,"systemPathUsed":false}));
    for id in ["clangd","delve","codelldb"]{
        println!("INSTALLING {id}");
        let entry=manager.install(id,Arc::new(AtomicBool::new(false)),report.clone()).await?;
        let mut cmd=clean(&entry,&work,&[entry.parent().unwrap().to_owned()]);
        cmd.arg(if id=="delve"{"version"}else if id=="codelldb"{"--help"}else{"--version"});
        let version=checked(cmd)?;
        println!("TOOL_START_RESULT {}",serde_json::json!({"id":id,"platform":inkleet_managed_env::platform(),"output":version.chars().take(500).collect::<String>(),"protocolVerified":false}));
    }
    Ok(())
}
