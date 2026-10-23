use inkleet_managed_env::{Manager,Report,process};
use std::{fs,path::{Path,PathBuf},process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
fn clean(program:&Path,work:&Path,zig:&Path)->Command{
    let mut c=Command::new(program);c.current_dir(work).env_clear().env("PATH",zig.parent().unwrap()).env("HOME",work).env("USERPROFILE",work)
        .env("TMP",work).env("TEMP",work).env("ZIG_GLOBAL_CACHE_DIR",work.join("zig-cache")).env("ZIG_LOCAL_CACHE_DIR",work.join("zig-local"));
    if let Some(root)=std::env::var_os("SystemRoot"){c.env("SystemRoot",root);}c
}
fn check(command:Command)->Result<String,String>{
    let output=process::provision(command,Arc::new(AtomicBool::new(false)),Duration::from_secs(300),64*1024)?;
    if output.exit_code!=Some(0)||output.truncated||output.timed_out{return Err(format!("private Java launcher probe: {output:?}"));}
    Ok(output.stdout)
}
#[tokio::main]async fn main()->Result<(),String>{
    if !cfg!(windows){return Err("Windows-only probe".into());}
    let temp=tempfile::Builder::new().prefix("inkleet Java 中文 空格 ").tempdir().map_err(|e|e.to_string())?;
    let root=process::tool_path(&fs::canonicalize(temp.path()).map_err(|e|e.to_string())?);
    let manager=Manager::new(root.join("tools"));let report:Report=Arc::new(|_|{});
    let java=process::tool_path(&manager.install("jdk",Arc::new(AtomicBool::new(false)),report.clone()).await?);
    let zig=process::tool_path(&manager.install("zig",Arc::new(AtomicBool::new(false)),report).await?);
    let jdk=java.parent().and_then(Path::parent).ok_or("JDK layout")?;
    let work=root.join("工作目录");fs::create_dir(&work).map_err(|e|e.to_string())?;
    fs::write(work.join("launcher.c"),include_str!("../src/java_launcher_windows.c")).map_err(|e|e.to_string())?;
    fs::write(work.join("utf8.manifest"),include_str!("../src/java_launcher_windows.manifest")).map_err(|e|e.to_string())?;
    fs::write(work.join("launcher.rc"),"1 24 \"utf8.manifest\"\n").map_err(|e|e.to_string())?;
    let mut resource=clean(&zig,&work,&zig);resource.args(["rc","/fo","launcher.res","launcher.rc"]);check(resource)?;
    let exe=work.join("private-java.exe");
    let mut compile=clean(&zig,&work,&zig);
    compile.args(["cc","-std=c11","-target","x86_64-windows-gnu","-municode","-I"]).arg(jdk.join("include")).arg("-I").arg(jdk.join("include/win32"))
        .arg("launcher.c").arg("launcher.res").arg("-o").arg(&exe);check(compile)?;
    fs::write(work.join("Probe.java"),r#"import java.util.*; public class Probe { public static void main(String[] args) { var values=List.of(1,2,3); if(!args[0].equals("中文🦀"))throw new AssertionError("Unicode argument"); System.out.println("JNI_JAVA_RESULT sum="+values.stream().mapToInt(Integer::intValue).sum()+" unicode="+args[0]+" compiler="+javax.tools.ToolProvider.getSystemJavaCompiler().getClass().getName()); } }"#).map_err(|e|e.to_string())?;
    let mut javac=clean(&exe,&work,&zig);javac.arg(jdk).arg("com/sun/tools/javac/Main").args(["-encoding","UTF-8","-g","Probe.java"]);check(javac)?;
    if !work.join("Probe.class").is_file(){return Err("Compiler did not produce class".into());}
    let mut run=clean(&exe,&work,&zig);run.arg(jdk).arg("Probe").arg("中文🦀");
    let result=check(run)?;if !result.contains("sum=6 unicode=中文🦀"){return Err(result);}println!("{result}");
    println!("JAVA_WINDOWS_UNICODE_RESULT privateJNI=true processUTF8=true systemLocaleChanged=false vendorBinaryPatched=false");
    Ok(())
}
