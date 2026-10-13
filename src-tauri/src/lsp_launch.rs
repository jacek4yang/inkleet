//! Launch only verified application-owned language tools in a fresh workspace.
use inkleet_managed_env::Manager;
use serde_json::{json,Value};
use std::{path::{Path,PathBuf},process::Command};
type Result<T>=std::result::Result<T,String>;
pub struct Launch{
    pub command:Command,pub settings:Value,pub initialization:Value,pub roots:Vec<PathBuf>,
    pub filename:&'static str,pub language_id:&'static str,pub server:&'static str,
}
fn clean(command:&mut Command,root:&Path,paths:&[PathBuf])->Result<()>{
    command.current_dir(root).env_clear().env("PATH",std::env::join_paths(paths).map_err(|_|"工具路径无效")?)
        .env("HOME",root).env("USERPROFILE",root).env("TEMP",root).env("TMP",root);
    if let Some(system)=std::env::var_os("SystemRoot"){command.env("SystemRoot",system);}
    #[cfg(target_os="linux")]{command.env("LANG","C.UTF-8").env("LC_ALL","C.UTF-8");}
    Ok(())
}
fn copy_config(from:&Path,to:&Path,budget:&mut u64)->Result<()>{
    std::fs::create_dir(to).map_err(|_|"无法创建 Java 配置目录")?;
    for entry in std::fs::read_dir(from).map_err(|_|"无法读取 Java 语言服务配置")?{
        let entry=entry.map_err(|_|"Java 配置条目不可用")?;let meta=entry.file_type().map_err(|_|"Java 配置类型不可用")?;
        if meta.is_symlink(){return Err("拒绝 Java 配置符号链接".into());}
        let target=to.join(entry.file_name());
        if meta.is_dir(){copy_config(&entry.path(),&target,budget)?;}
        else if meta.is_file(){
            let bytes=entry.metadata().map_err(|_|"Java 配置大小不可用")?.len();
            *budget=budget.checked_sub(bytes).ok_or("Java 配置超过大小限制")?;
            std::fs::copy(entry.path(),target).map_err(|_|"无法复制 Java 语言服务配置")?;
        }else{return Err("不支持的 Java 配置条目".into());}
    }
    Ok(())
}
pub fn prepare(manager:&Manager,root:&Path,language:&str)->Result<Launch>{
    match language{
        "python3"=>{
            let node=manager.installed("node")?.ok_or("请先在开发环境中安装 Python 工具")?;
            let python=manager.installed("python")?.ok_or("请先安装 Python 运行时")?;
            let pyright=manager.installed("pyright")?.ok_or("请先安装 Pyright 语言服务")?;
            let mut command=Command::new(&node);command.arg(&pyright).arg("--stdio");
            clean(&mut command,root,&[node.parent().ok_or("Node 路径无效")?.to_owned()])?;
            let settings=json!({"pythonPath":python,"analysis":{"typeCheckingMode":"basic","autoSearchPaths":false,"useLibraryCodeForTypes":true,"diagnosticMode":"openFilesOnly"}});
            let python_root=if cfg!(windows){python.parent()}else{python.parent().and_then(Path::parent)}.ok_or("Python 路径无效")?;
            let roots=vec![root.to_owned(),std::fs::canonicalize(python_root).map_err(|_|"标准库路径无效")?,std::fs::canonicalize(pyright.parent().ok_or("类型库路径无效")?).map_err(|_|"类型库路径无效")?];
            Ok(Launch{command,settings,initialization:Value::Null,roots,filename:"solution.py",language_id:"python",server:"Pyright"})
        },
        "java"=>{
            if cfg!(windows){return Err("Windows Java 中文路径兼容性仍在验证；当前尚未启用此语言服务".into());}
            let java=manager.installed("jdk")?.ok_or("请先在开发环境中安装 Java 运行时")?;
            let launcher=manager.installed("jdtls")?.ok_or("请先安装 Java 语言服务")?;
            let java_home=java.parent().and_then(Path::parent).ok_or("Java 目录无效")?;
            let jdt_home=launcher.parent().and_then(Path::parent).ok_or("Java 语言服务目录无效")?;
            let config=root.join(".inkleet-jdt-config");
            copy_config(&jdt_home.join(if cfg!(target_os="macos"){"config_mac"}else{"config_linux"}),&config,&mut(4*1024*1024))?;
            let mut command=Command::new(&java);
            command.args(["-Xms64m","-Xmx512m","-Djava.awt.headless=true","-Dfile.encoding=UTF-8","-Declipse.application=org.eclipse.jdt.ls.core.id1","-Dosgi.bundles.defaultStartLevel=4","-Declipse.product=org.eclipse.jdt.ls.core.product","--add-modules=ALL-SYSTEM","--add-opens","java.base/java.util=ALL-UNNAMED","--add-opens","java.base/java.lang=ALL-UNNAMED"])
                .arg("-jar").arg(launcher).arg("-configuration").arg(config).arg("-data").arg(root.join(".inkleet-jdt-data"));
            clean(&mut command,root,&[java.parent().ok_or("Java 路径无效")?.to_owned()])?;
            command.env("JAVA_HOME",java_home);
            let settings=json!({"java":{"home":java_home,"autobuild":{"enabled":false},"import":{"maven":{"enabled":false},"gradle":{"enabled":false}},"configuration":{"runtimes":[{"name":"JavaSE-25","path":java_home,"default":true}],"updateBuildConfiguration":"disabled"},"project":{"referencedLibraries":[]}}});
            let root_uri=reqwest::Url::from_directory_path(root).map_err(|_|"Java 工作区地址无效")?.to_string();
            let initialization=json!({"settings":settings,"workspaceFolders":[root_uri],"extendedClientCapabilities":{"classFileContentsSupport":true}});
            Ok(Launch{command,settings,initialization,roots:vec![root.to_owned(),std::fs::canonicalize(java_home).map_err(|_|"Java 标准库目录无效")?],filename:"Solution.java",language_id:"java",server:"Eclipse JDT LS"})
        },
        _=>Err("此语言服务尚未接入".into()),
    }
}
