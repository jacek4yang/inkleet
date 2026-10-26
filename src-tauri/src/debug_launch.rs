//! Prepares private immutable debug snapshots; no shell or system toolchain.
use inkleet_managed_env::{Manager,harness,process};
use serde_json::{json,Value};
use std::{path::Path,process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
pub struct Launch{pub command:Command,pub arguments:Value,pub adapter:&'static str,pub warning:Option<String>}
pub fn prepare(manager:&Manager,root:&Path,snapshot:&crate::local_run::Snapshot,cancel:Arc<AtomicBool>)->Result<Launch,String>{
    if snapshot.language=="python3"{
        let python=process::tool_path(&manager.installed("python")?.ok_or("请先安装 Python")?);
        let adapter=manager.installed("debugpy")?.ok_or("请先安装 Python 调试器")?;
        let adapter_root=process::tool_path(adapter.parent().and_then(Path::parent).and_then(Path::parent).ok_or("调试器目录无效")?);
        harness::prepare(root,&snapshot.code,&snapshot.metadata,&snapshot.input)?;
        let mut command=Command::new(&python);
        command.args(["-I","-c","import sys,runpy;sys.path.insert(0,sys.argv[1]);sys.argv=['debugpy.adapter'];runpy.run_module('debugpy.adapter',run_name='__main__')"]).arg(adapter_root)
            .current_dir(root).env_clear().env("PATH",python.parent().ok_or("Python 路径无效")?).env("HOME",root).env("USERPROFILE",root).env("TMP",root).env("TEMP",root);
        if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
        Ok(Launch{command,warning:None,adapter:"python",arguments:json!({"name":"InkLeet local snapshot","type":"python","request":"launch","python":python,"program":root.join("harness.py"),"cwd":root,"console":"internalConsole","justMyCode":false,"redirectOutput":true,"stopOnEntry":false})})
    }else if snapshot.language=="golang"{
        let go=process::tool_path(&manager.installed("go")?.ok_or("请先安装 Go")?);
        let delve=process::tool_path(&manager.installed("delve")?.ok_or("请先安装 Go 调试器 Delve")?);
        harness::prepare_go(root,&snapshot.code,&snapshot.metadata,&snapshot.input)?;
        let temporary=root.join("temp");std::fs::create_dir_all(&temporary).map_err(|_|"无法创建 Go 调试临时目录")?;
        let clean=|command:&mut Command|->Result<(),String>{
            command.current_dir(root).env_clear().env("PATH",go.parent().ok_or("Go 路径无效")?)
                .env("GOROOT",go.parent().and_then(Path::parent).ok_or("Go 根目录无效")?)
                .env("HOME",root).env("USERPROFILE",root).env("TMP",&temporary).env("TEMP",&temporary).env("TMPDIR",&temporary)
                .env("APPDATA",&temporary).env("LOCALAPPDATA",&temporary).env("GOENV","off").env("GOWORK","off").env("GOTOOLCHAIN","local")
                .env("CGO_ENABLED","0").env("GOPROXY","off").env("GOSUMDB","off").env("GOTELEMETRY","off")
                .env("GOCACHE",root.parent().ok_or("调试缓存路径无效")?.join("go-cache")).env("GOPATH",root.join("go-path"));
            if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
            Ok(())
        };
        let binary=root.join(if cfg!(windows){"solution.exe"}else{"solution"});
        let mut compile=Command::new(&go);clean(&mut compile)?;
        compile.args(["build","-gcflags=all=-N -l","-buildvcs=false","-o"]).arg(&binary).args(["solution.go","nodes.go","harness.go"]);
        let output=process::run(compile,cancel,Duration::from_secs(120),64*1024)?;
        if output.canceled{return Err("调试编译已停止".into());}
        if output.timed_out{return Err("Go 调试编译超过 120 秒，已终止".into());}
        if output.exit_code!=Some(0)||output.truncated{return Err(format!("Go 调试编译未完成：\n{}",output.stderr));}
        let mut command=Command::new(delve);clean(&mut command)?;
        Ok(Launch{command,warning:None,adapter:"go",arguments:json!({"name":"InkLeet local snapshot","type":"go","request":"launch","mode":"exec","program":binary,"cwd":root,"outputMode":"remote","stopOnEntry":false})})
    }else if matches!(snapshot.language.as_str(),"cpp"|"c"|"rust"){
        let adapter=process::tool_path(&manager.installed("codelldb")?.ok_or("请先安装 原生调试器 CodeLLDB")?);
        let cache=root.parent().ok_or("调试缓存路径无效")?;
        let (binary,output)=if snapshot.language=="rust"{crate::compiled_runtime::rust(manager,root,cache,snapshot,cancel)?}else{crate::compiled_runtime::cpp(manager,root,cache,snapshot,cancel)?};
        if output.canceled{return Err("调试编译已停止".into());}
        if output.timed_out{return Err("调试编译超过阶段时限，已终止".into());}
        if output.exit_code!=Some(0)||output.truncated{return Err(format!("调试编译未完成：\n{}",output.stderr));}
        let mut command=Command::new(&adapter);crate::compiled_runtime::clean_runtime(&mut command,root)?;
        command.env("PATH",adapter.parent().ok_or("调试器路径无效")?);
        let mut arguments=json!({"name":"InkLeet local snapshot","type":"lldb","request":"launch","program":binary,"cwd":root,"terminal":"console","stopOnEntry":false});
        let mut warning=None;
        if snapshot.language=="rust"{
            let rustc=process::tool_path(&manager.installed("rustc")?.ok_or("请先安装 Rust 编译器")?);
            if let Err(error)=configure_rust_visualizers(&mut arguments,&rustc){warning=Some(format!("{}；当前使用原始变量视图。",error));}
        }
        Ok(Launch{command,adapter:"lldb",arguments,warning})
    }else if snapshot.language=="java"{
        let (_,output)=crate::compiled_runtime::java(manager,root,snapshot,cancel.clone())?;
        if output.canceled{return Err("调试编译已停止".into());}
        if output.exit_code!=Some(0)||output.timed_out||output.truncated{return Err(format!("Java 调试编译未完成：{}",output.stderr));}
        let (command,home)=inkleet_managed_env::java_debug::prepare(manager,root,cancel)?;
        Ok(Launch{command,warning:None,adapter:"java",arguments:json!({"name":"InkLeet local snapshot","type":"java","request":"launch","mainClass":"InkLeetHarness","javaExec":home.join(if cfg!(windows){"bin/java.exe"}else{"bin/java"}),"classPaths":[root],"sourcePaths":[root],"cwd":root,"console":"internalConsole","encoding":"UTF-8","vmArgs":"-Xmx256m","stopOnEntry":false})})
    }else{Err("此语言的调试尚未接入".into())}
}

/** Use the matching managed compiler's visualizers, never a PATH toolchain or user script. */
fn configure_rust_visualizers(arguments:&mut Value,rustc:&Path)->Result<(),String>{
    let formatters=rustc.parent().and_then(Path::parent).ok_or("Rust 编译器路径无效")?.join("lib/rustlib/etc");
    let text=formatters.to_str().ok_or("Rust 调试可视化路径不是有效 UTF-8")?;
    // CodeLLDB 1.12.3 embeds this path in a single-quoted LLDB command internally.
    // Refuse command delimiters rather than allowing an unsafe path interpolation.
    if text.chars().any(|c|c=='\''||c=='\n'||c=='\r'||c=='\0'){
        return Err("Rust 调试可视化路径含不支持的引号或控制字符，请使用不含这些字符的开发环境目录".into());
    }
    for name in ["lldb_lookup.py","lldb_providers.py","rust_types.py"]{
        if !formatters.join(name).is_file(){return Err("Rust 调试可视化文件缺失，请重新安装应用内 Rust 编译器".into());}
    }
    // CodeLLDB 1.12.3 passes scriptConfig JSON through a Python string literal.
    // Windows backslashes lose an escaping layer there (Invalid \\escape),
    // silently discarding the managed formatter configuration. Windows accepts
    // forward slashes; normalize only this adapter-facing path, not file checks.
    let text=if cfg!(windows){text.replace('\\',"/")}else{text.to_owned()};
    arguments["sourceLanguages"]=json!(["rust"]);
    arguments["_adapterSettings"]=json!({"scriptConfig":{"lang.rust.formatters":text}});
    Ok(())
}
#[cfg(test)]
mod visualizer_tests{
    use super::*;
    #[test] fn managed_formatter_config_is_explicit_and_path_independent(){
        let temp=tempfile::tempdir().unwrap();let root=temp.path().join("compiler with spaces");
        let dir=root.join("lib/rustlib/etc");std::fs::create_dir_all(&dir).unwrap();
        for name in ["lldb_lookup.py","lldb_providers.py","rust_types.py"]{std::fs::write(dir.join(name),"").unwrap();}
        let mut args=json!({});configure_rust_visualizers(&mut args,&root.join("bin/rustc")).unwrap();
        assert_eq!(args["sourceLanguages"],json!(["rust"]));
        assert_eq!(args["_adapterSettings"]["scriptConfig"]["lang.rust.formatters"],json!(if cfg!(windows){dir.to_str().unwrap().replace('\\',"/")}else{dir.to_str().unwrap().to_owned()}));
        if cfg!(windows){assert!(!args["_adapterSettings"]["scriptConfig"]["lang.rust.formatters"].as_str().unwrap().contains('\\'));}
        assert!(args.get("initCommands").is_none());
        std::fs::remove_file(dir.join("lldb_lookup.py")).unwrap();
        assert!(configure_rust_visualizers(&mut json!({}),&root.join("bin/rustc")).is_err());
    }
    #[test] fn unsafe_upstream_command_paths_are_rejected(){
        for path in ["compiler'quoted/bin/rustc","compiler\ncommand/bin/rustc","compiler\rcommand/bin/rustc"]{
            let error=configure_rust_visualizers(&mut json!({}),Path::new(path)).unwrap_err();
            assert!(error.contains("控制字符"));
        }
    }
}
