//! External editors are user-selected desktop applications, not managed tools.
//! Never put them in the owned compiler/debugger job: they must survive app exit.
use std::{path::Path,ffi::OsString};
pub fn supported()->bool{cfg!(any(target_os="linux",target_os="windows",target_os="macos"))}
pub fn open_note(path:&Path,editor:&str)->Result<(),String>{
    if !matches!(editor,"default"|"typora"){return Err("未知的外部编辑器".into());}
    if !path.is_absolute()||!path.is_file()||path.is_symlink()||path.file_name().and_then(|s|s.to_str())!=Some("notes.md"){return Err("只能打开本题已保存的 notes.md".into());}
    #[cfg(windows)]{return windows_open(path,editor);}
    #[cfg(any(target_os="linux",target_os="macos"))]{
        use std::process::{Command,Stdio};
        use std::os::unix::process::CommandExt;
        let (program,args)=arguments(std::env::consts::OS,editor,path)?;
        if !std::path::Path::new(&program).is_file(){return Err(if editor=="typora"{"未找到 Typora，请先从其官方来源安装，或使用系统默认应用"}else{"系统没有可用的文件打开程序"}.into());}
        let mut command=Command::new(program);
        command.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).process_group(0);
        let mut child=command.spawn().map_err(|_|"无法启动外部编辑器，请检查是否已经安装")?;
        // A file opener may stay alive while the independent editor is open.
        // Reap when it exits; never terminate the owner's editor on our exit.
        std::thread::spawn(move||{let _=child.wait();});
        return Ok(());
    }
    #[cfg(not(any(target_os="linux",target_os="windows",target_os="macos")))]
    Err("此平台暂不支持桌面外部编辑器".into())
}
#[cfg(any(target_os="linux",target_os="macos",test))]
fn arguments(platform:&str,editor:&str,path:&Path)->Result<(OsString,Vec<OsString>),String>{
    match (platform,editor){
        ("macos","typora")=>Ok(("/usr/bin/open".into(),vec!["-a".into(),"Typora".into(),path.into()])),
        ("macos","default")=>Ok(("/usr/bin/open".into(),vec![path.into()])),
        ("linux","default")=>Ok(("/usr/bin/xdg-open".into(),vec![path.into()])),
        ("linux","typora")=>{
            let program=["/usr/bin/typora","/usr/local/bin/typora","/opt/Typora/Typora"].into_iter().find(|p|Path::new(p).is_file()).ok_or("未找到 Typora，请安装后重试或选择系统默认应用")?;
            Ok((program.into(),vec![path.into()]))
        },
        _=>Err("不支持的外部编辑器或平台".into()),
    }
}
#[cfg(windows)]
fn windows_open(path:&Path,editor:&str)->Result<(),String>{
    use std::os::windows::ffi::OsStrExt;
    use std::ffi::OsStr;
    #[link(name="shell32")]unsafe extern "system"{
        fn ShellExecuteW(window:*mut std::ffi::c_void,operation:*const u16,file:*const u16,parameters:*const u16,directory:*const u16,show:i32)->isize;
    }
    fn wide(value:&OsStr)->Result<Vec<u16>,String>{
        let mut result=value.encode_wide().collect::<Vec<_>>();
        if result.contains(&0){return Err("路径含无效字符".into());}result.push(0);Ok(result)
    }
    let operation=wide(OsStr::new("open"))?;
    let target=wide(if editor=="typora"{OsStr::new("typora.exe")}else{path.as_os_str()})?;
    let parameters=if editor=="typora"{
        // Windows filesystem paths cannot contain a double quote.
        let value=path.to_str().ok_or("笔记路径不是有效 Unicode")?;
        if value.contains('"'){return Err("笔记路径无效".into());}
        Some(wide(OsStr::new(&format!("\"{value}\"")))?)
    }else{None};
    let result=unsafe{ShellExecuteW(std::ptr::null_mut(),operation.as_ptr(),target.as_ptr(),parameters.as_ref().map_or(std::ptr::null(),|v|v.as_ptr()),std::ptr::null(),1)};
    if result<=32{return Err("系统未能打开笔记，请确认默认 Markdown 应用或 Typora 已安装".into());}
    Ok(())
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn external_paths_are_single_arguments_not_shell_programs(){
        let path=Path::new("/home/中文 空格/$(not-a-command)/notes.md");
        let (program,args)=arguments("linux","default",path).unwrap();
        assert_eq!(program,OsString::from("/usr/bin/xdg-open"));assert_eq!(args,vec![path.as_os_str().to_owned()]);
        let (_,args)=arguments("macos","typora",path).unwrap();
        assert_eq!(args,vec![OsString::from("-a"),OsString::from("Typora"),path.into()]);
        assert!(arguments("linux","sh -c",path).is_err());
    }
}
