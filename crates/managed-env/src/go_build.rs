//! Build the reviewed gopls module with the private Go toolchain only.
//! No go generate, CGO, shell, system Go, telemetry, latest tags or direct VCS fallback.
use crate::{Manager,Package,Report,Progress,Result,directory,regular,io,canceled,process};
use std::{path::Path,process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
pub(crate) fn build(manager:&Manager,p:&Package,stage:&Path,cancel:Arc<AtomicBool>,report:&Report)->Result<()>{
    let go=manager.installed("go")?.ok_or("请先安装应用独立的 Go 工具链，再安装 gopls")?;
    let go_home=go.parent().and_then(Path::parent).ok_or("Go 工具链路径无效")?;
    regular(&stage.join("go.mod"))?;regular(&stage.join("go.sum"))?;
    let original_mod=io(std::fs::read(stage.join("go.mod")))?;let original_sum=io(std::fs::read(stage.join("go.sum")))?;
    let cache=manager.root.join("go-build-cache");let modules=manager.root.join("go-module-cache");
    let home=manager.root.join("go-build-home");let output=stage.join(&p.entry);
    for path in [&cache,&modules,&home,output.parent().ok_or("gopls 输出目录无效")?]{directory(path)?;}
    let command=||->Result<Command>{
        let mut cmd=Command::new(&go);
        cmd.current_dir(stage).env_clear().env("PATH",go.parent().ok_or("Go 路径无效")?)
            .env("GOROOT",go_home).env("GOTOOLCHAIN","local").env("GOENV","off").env("GOWORK","off")
            .env("CGO_ENABLED","0").env("GOTELEMETRY","off").env("GOMAXPROCS","2")
            .env("GOCACHE",&cache).env("GOMODCACHE",&modules).env("GOPATH",home.join("go"))
            .env("GOPROXY","https://proxy.golang.org").env("GOSUMDB","sum.golang.org")
            .env("HOME",&home).env("USERPROFILE",&home).env("TMP",&home).env("TEMP",&home);
        if let Some(system)=std::env::var_os("SystemRoot"){cmd.env("SystemRoot",system);}
        Ok(cmd)
    };
    report(Progress{phase:"building",downloaded:p.size,total:p.size});
    canceled(&cancel)?;
    let mut cmd=command()?;cmd.args(["build","-mod=readonly","-buildvcs=false","-trimpath","-p=2","-ldflags=-buildid=","-o"]).arg(&output).arg(".");
    let result=process::provision(cmd,cancel.clone(),Duration::from_secs(600),1024*1024)?;
    canceled(&cancel)?;
    if result.exit_code!=Some(0)||result.timed_out||result.truncated{return Err(format!("构建 gopls 未完成：{}",if result.timed_out{"达到 10 分钟配置时限".to_owned()}else{result.stderr.chars().take(2000).collect()}));}
    if io(std::fs::read(stage.join("go.mod")))?!=original_mod||io(std::fs::read(stage.join("go.sum")))?!=original_sum{return Err("gopls 构建试图修改固定依赖清单".into());}
    regular(&output)?;
    Ok(())
}
