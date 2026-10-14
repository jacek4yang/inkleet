//! Discover private compiler headers without consulting a system SDK/compiler.
use crate::lsp_launch::{Launch,clean};
use inkleet_managed_env::{Manager,process};
use serde_json::{json,Value};
use std::{path::Path,process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
pub fn prepare(manager:&Manager,root:&Path,language:&str)->Result<Launch,String>{
    let zig=process::tool_path(&manager.installed("zig")?.ok_or("请先安装独立 C/C++ 工具链")?);
    let clangd=process::tool_path(&manager.installed("clangd")?.ok_or("请先安装 clangd 语言服务")?);
    let is_cpp=language=="cpp";let filename=if is_cpp{"solution.cpp"}else{"solution.c"};
    let zig_home=zig.parent().ok_or("C/C++ 工具链路径无效")?;
    let query_source=root.join(if is_cpp{".inkleet-headers.cpp"}else{".inkleet-headers.c"});
    std::fs::write(&query_source,"").map_err(|_|"无法准备头文件查询")?;
    let mut query=Command::new(&zig);clean(&mut query,root,&[zig_home.to_owned()])?;
    query.env("ZIG_GLOBAL_CACHE_DIR",root.join(".zig-cache")).env("ZIG_LOCAL_CACHE_DIR",root.join(".zig-local"));
    query.args([if is_cpp{"c++"}else{"cc"},"-E","-v","-x",if is_cpp{"c++"}else{"c"}]);
    if cfg!(windows){query.args(["-target","x86_64-windows-gnu"]);}
    #[cfg(target_os="linux")] query.args(["-target","x86_64-linux-gnu"]);
    query.arg(query_source);
    let output=process::provision(query,Arc::new(AtomicBool::new(false)),Duration::from_secs(90),1024*1024)?;
    if output.exit_code!=Some(0)||output.timed_out||output.truncated{return Err("独立 C/C++ 头文件检查未完成，请重连语言服务".into());}
    let allowed=std::fs::canonicalize(zig_home.join("lib")).map_err(|_|"C/C++ 标准库无效")?;
    let mut includes=Vec::new();let mut inside=false;let mut target=None;
    for line in output.stderr.lines(){
        let line=line.trim();
        if let Some(triple)=line.strip_prefix("Target: "){target=Some(triple.to_owned());}
        if line=="#include <...> search starts here:"{inside=true;continue;}
        if line=="End of search list."{inside=false;}
        if inside{
            let path=std::fs::canonicalize(line).map_err(|_|"C/C++ 头文件目录无效")?;
            if !path.starts_with(&allowed){return Err("拒绝使用应用独立环境之外的头文件".into());}
            includes.push(process::tool_path(&path));
        }
    }
    if includes.is_empty(){return Err("没有找到独立标准库头文件".into());}
    let source=root.join(filename);
    let mut args=vec![if is_cpp{"clang++".to_owned()}else{"clang".to_owned()},if is_cpp{"-std=c++20".into()}else{"-std=c11".into()},"-nostdinc".into()];
    if is_cpp{args.push("-nostdinc++".into());}
    if let Some(target)=target{args.push(format!("--target={target}"));}
    for path in includes{args.push("-isystem".into());args.push(path.to_string_lossy().into());}
    args.push("-c".into());args.push(source.to_string_lossy().into());
    std::fs::write(root.join("compile_commands.json"),json!([{"directory":root,"file":source,"arguments":args}]).to_string()).map_err(|_|"无法保存独立编译配置")?;
    std::fs::write(root.join(".clang-format"),"BasedOnStyle: LLVM\nIndentWidth: 4\nColumnLimit: 100\nSortIncludes: Never\n").map_err(|_|"无法准备 C/C++ 格式化配置")?;
    let mut command=Command::new(clangd);clean(&mut command,root,&[zig_home.to_owned()])?;
    command.args(["--background-index=false","--clang-tidy=false","--header-insertion=never","--enable-config=false","--log=error"]);
    Ok(Launch{command,settings:json!({}),initialization:Value::Null,roots:vec![std::fs::canonicalize(root).map_err(|_|"工作区无效")?,allowed],filename,language_id:if is_cpp{"cpp"}else{"c"},server:"clangd"})
}
