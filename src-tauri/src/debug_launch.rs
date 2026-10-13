//! Prepares private immutable debug snapshots; no shell or system toolchain.
use inkleet_managed_env::{Manager,harness,process};
use serde_json::{json,Value};
use std::{path::Path,process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
pub struct Launch{pub command:Command,pub arguments:Value,pub adapter:&'static str}
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
        Ok(Launch{command,adapter:"python",arguments:json!({"name":"InkLeet local snapshot","type":"python","request":"launch","python":python,"program":root.join("harness.py"),"cwd":root,"console":"internalConsole","justMyCode":false,"redirectOutput":true,"stopOnEntry":false})})
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
        Ok(Launch{command,adapter:"go",arguments:json!({"name":"InkLeet local snapshot","type":"go","request":"launch","mode":"exec","program":binary,"cwd":root,"outputMode":"remote","stopOnEntry":false})})
    }else{Err("此语言的调试尚未接入".into())}
}
