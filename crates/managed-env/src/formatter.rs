//! Format immutable source through verified private tools; never run project hooks.
use crate::{Manager,process};
use std::{path::{Path,PathBuf},process::Command,sync::{Arc,atomic::AtomicBool},time::Duration};
type Result<T>=std::result::Result<T,String>;
pub fn format(manager:&Manager,language:&str,text:&str)->Result<String>{
    if text.len()>1024*1024{return Err("格式化源码超过 1 MiB 限制".into());}
    if !matches!(language,"python3"|"rust"|"golang"){return Err("此语言由语言服务格式化".into());}
    let temp=tempfile::Builder::new().prefix("inkleet-format-").tempdir().map_err(|_|"无法创建格式化工作区")?;
    let root=process::tool_path(&std::fs::canonicalize(temp.path()).map_err(|_|"格式化目录无效")?);
    let mut paths:Vec<PathBuf>=Vec::new();
    let entry=match language{
        "golang"=>manager.gofmt()?,
        _=>manager.installed(if language=="python3"{"ruff"}else{"rustfmt-preview"})?.ok_or("请先在开发环境安装格式化工具")?,
    };
    let entry=process::tool_path(&entry);
    let mut command=Command::new(&entry);
    command.current_dir(&root).env_clear().env("HOME",&root).env("USERPROFILE",&root).env("TMP",&root).env("TEMP",&root).env("TMPDIR",&root);
    if let Some(value)=std::env::var_os("SystemRoot"){command.env("SystemRoot",value);}
    #[cfg(target_os="linux")]command.env("LANG","C.UTF-8").env("LC_ALL","C.UTF-8");
    match language{
        "python3"=>{command.args(["format","--isolated","--no-cache","--stdin-filename","solution.py","-"]);},
        "rust"=>{
            let rustc=process::tool_path(&manager.installed("rustc")?.ok_or("请先安装 Rust 编译器运行库")?);
            let bin=rustc.parent().ok_or("Rust 路径无效")?;
            let lib=bin.parent().ok_or("Rust 路径无效")?.join("lib");
            paths.extend([bin.to_owned(),lib.clone()]);
            command.env("LD_LIBRARY_PATH",&lib).env("DYLD_LIBRARY_PATH",&lib);
            let config=root.join("rustfmt.toml");
            std::fs::write(&config,"edition = '2021'\nstyle_edition = '2021'\n").map_err(|_|"无法准备格式化配置")?;
            command.args(["--edition","2021","--style-edition","2021","--config-path"]).arg(config);
        },
        "golang"=>{},
        _=>unreachable!(),
    }
    command.env("PATH",std::env::join_paths(paths).map_err(|_|"格式化工具路径无效")?);
    let result=process::run_with_input(command,text.as_bytes().to_vec(),Arc::new(AtomicBool::new(false)),Duration::from_secs(5),1024*1024)?;
    if result.timed_out||result.truncated||result.canceled{return Err("格式化超时或输出超过限制，原代码已保留".into());}
    if result.exit_code!=Some(0){return Err(format!("格式化未完成：{}",result.stderr.chars().take(400).collect::<String>()));}
    if !text.trim().is_empty()&&result.stdout.trim().is_empty(){return Err("格式化器返回空正文，原代码已保留".into());}
    Ok(preserve_newlines(text,&result.stdout))
}
pub fn preserve_newlines(original:&str,formatted:&str)->String{
    let crlf=original.contains("\r\n")&&!original.replace("\r\n","").contains('\n');
    let normalized=formatted.replace("\r\n","\n");
    if crlf{normalized.replace('\n',"\r\n")}else{normalized}
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn newline_style_is_explicit(){
        assert_eq!(preserve_newlines("a\r\nb\r\n","a\nb\n"),"a\r\nb\r\n");
        assert_eq!(preserve_newlines("a\nb","a\r\nb\r\n"),"a\nb\n");
    }
    #[test]fn unsupported_language_never_spawns(){
        let root=tempfile::tempdir().unwrap();
        assert!(format(&Manager::new(root.path().into()),"shell","echo unsafe").is_err());
    }
}
