//! Launch only verified application-owned language tools in a fresh workspace.
use inkleet_managed_env::Manager;
use serde_json::{json,Value};
use std::{path::{Path,PathBuf},process::Command};
type Result<T>=std::result::Result<T,String>;

pub(crate) fn snippet_validation_enabled()->bool{
    cfg!(all(feature="native-snippet-validation",debug_assertions,target_os="linux"))
}
pub(crate) fn completion_capabilities(language:&str)->Value{
    let mut item=json!({"snippetSupport":snippet_validation_enabled(),"insertTextModeSupport":{"valueSet":[1]}});
    if language=="rust"{item["resolveSupport"]=json!({"properties":["documentation","additionalTextEdits"]});}
    json!({"contextSupport":true,"insertTextMode":1,"completionItem":item})
}

pub struct Launch{
    pub command:Command,pub settings:Value,pub initialization:Value,pub roots:Vec<PathBuf>,
    pub filename:&'static str,pub language_id:&'static str,pub server:&'static str,
}
pub(crate) fn clean(command:&mut Command,root:&Path,paths:&[PathBuf])->Result<()>{
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
            let runtime=inkleet_managed_env::java_runtime::Runtime::prepare(manager,std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)))?;
            let launcher=manager.installed("jdtls")?.ok_or("请先安装 Java 语言服务")?;
            let java_home=&runtime.home;
            let jdt_home=launcher.parent().and_then(Path::parent).ok_or("Java 语言服务目录无效")?;
            let config=root.join(".inkleet-jdt-config");
            copy_config(&jdt_home.join(if cfg!(target_os="macos"){"config_mac"}else if cfg!(windows){"config_win"}else{"config_linux"}),&config,&mut(4*1024*1024))?;
            let mut options=vec!["-Xms64m","-Xmx512m","-Djava.awt.headless=true","-Dfile.encoding=UTF-8","-Declipse.application=org.eclipse.jdt.ls.core.id1","-Dosgi.bundles.defaultStartLevel=4","-Declipse.product=org.eclipse.jdt.ls.core.product","--add-modules=ALL-SYSTEM","--add-opens=java.base/java.util=ALL-UNNAMED","--add-opens=java.base/java.lang=ALL-UNNAMED"].into_iter().map(std::ffi::OsString::from).collect::<Vec<_>>();
            options.push(format!("-Djava.class.path={}",launcher.display()).into());
            let mut command=runtime.command(root,&options,"org.eclipse.equinox.launcher.Main")?;
            command.arg("-configuration").arg(config).arg("-data").arg(root.join(".inkleet-jdt-data"));
            let settings=json!({"java":{"home":java_home,"autobuild":{"enabled":false},"import":{"maven":{"enabled":false},"gradle":{"enabled":false}},"configuration":{"runtimes":[{"name":"JavaSE-25","path":java_home,"default":true}],"updateBuildConfiguration":"disabled"},"project":{"referencedLibraries":[]}}});
            let root_uri=reqwest::Url::from_directory_path(root).map_err(|_|"Java 工作区地址无效")?.to_string();
            let initialization=json!({"settings":settings,"workspaceFolders":[root_uri],"extendedClientCapabilities":{"classFileContentsSupport":true}});
            Ok(Launch{command,settings,initialization,roots:vec![root.to_owned(),std::fs::canonicalize(java_home).map_err(|_|"Java 标准库目录无效")?],filename:"Solution.java",language_id:"java",server:"Eclipse JDT LS"})
        },
        "golang"=>{
            let go=inkleet_managed_env::process::tool_path(&manager.installed("go")?.ok_or("请先安装 Go 工具链")?);
            let gopls=inkleet_managed_env::process::tool_path(&manager.installed("gopls")?.ok_or("请先安装 gopls 语言服务")?);
            let go_home=go.parent().and_then(Path::parent).ok_or("Go 工具链目录无效")?;
            std::fs::write(root.join("go.mod"),"module inkleet.local\n\ngo 1.27.0\n").map_err(|_|"无法准备 Go 模块")?;
            let mut command=Command::new(gopls);
            clean(&mut command,root,&[go.parent().ok_or("Go 目录无效")?.to_owned()])?;
            let tool_temp=root.join(".tool-temp");std::fs::create_dir(&tool_temp).map_err(|_|"无法创建 Go 临时目录")?;
            command.env("TMP",&tool_temp).env("TEMP",&tool_temp).env("TMPDIR",&tool_temp).env("APPDATA",&tool_temp).env("LOCALAPPDATA",&tool_temp);
            command.env("GOROOT",go_home).env("GOTOOLCHAIN","local").env("GOENV","off").env("GOWORK","off")
                .env("CGO_ENABLED","0").env("GOPROXY","off").env("GOSUMDB","off").env("GOTELEMETRY","off")
                .env("GOCACHE",root.join(".go-cache")).env("GOPATH",root.join(".go-path")).env("GOPLSCACHE",root.join(".gopls-cache"));
            let initialization=json!({"staticcheck":false,"semanticTokens":true,"usePlaceholders":snippet_validation_enabled(),"completeUnimported":true,"buildFlags":["-mod=readonly"]});
            let settings=json!({"gopls":initialization});
            Ok(Launch{command,settings,initialization,roots:vec![std::fs::canonicalize(root).map_err(|_|"工作区无效")?,std::fs::canonicalize(go_home.join("src")).map_err(|_|"Go 标准库源码无效")?],filename:"solution.go",language_id:"go",server:"gopls"})
        },
        "rust"=>{
            let installed=|id:&str|->Result<PathBuf>{Ok(inkleet_managed_env::process::tool_path(&manager.installed(id)?.ok_or_else(||format!("请先安装 Rust 工具：{id}"))?))};
            let rustc=installed("rustc")?;let cargo=installed("cargo")?;let analyzer=installed("rust-analyzer-preview")?;
            let standard=installed("rust-std")?;let sources=installed("rust-src")?;
            let sysroot=standard.parent().ok_or("Rust 标准库目录无效")?;
            let source_root=sources.parent().and_then(Path::parent).and_then(Path::parent).ok_or("Rust 标准库源码目录无效")?;
            let rust_bin=rustc.parent().ok_or("Rust 编译器目录无效")?;
            let rust_lib=rust_bin.parent().ok_or("Rust 工具链目录无效")?.join("lib");
            std::fs::write(root.join("Cargo.toml"),"[package]\nname=\"inkleet_local\"\nversion=\"0.0.0\"\nedition=\"2021\"\n[lib]\npath=\"solution.rs\"\n").map_err(|_|"无法准备 Rust 工程")?;
            let mut command=Command::new(analyzer);
            clean(&mut command,root,&[rust_bin.to_owned(),rust_lib.clone(),cargo.parent().ok_or("Cargo 目录无效")?.to_owned()])?;
            command.env("RUSTC",&rustc).env("CARGO",&cargo).env("CARGO_HOME",root.join(".cargo-home")).env("CARGO_NET_OFFLINE","true")
                .env("CARGO_ENCODED_RUSTFLAGS",format!("--sysroot\u{1f}{}",sysroot.display())).env("RUST_SRC_PATH",source_root)
                .env("LD_LIBRARY_PATH",&rust_lib).env("DYLD_LIBRARY_PATH",&rust_lib);
            let mut initialization=json!({"linkedProjects":[root.join("Cargo.toml")],"cargo":{"sysroot":sysroot,"sysrootSrc":source_root,"noDeps":false,"buildScripts":{"enable":false}},"procMacro":{"enable":false},"checkOnSave":false,"cachePriming":{"enable":false},"numThreads":2});
            if cfg!(windows){initialization["cargo"]["target"]=json!("x86_64-pc-windows-gnu");}
            let settings=json!({"rust-analyzer":initialization});
            Ok(Launch{command,settings,initialization,roots:vec![std::fs::canonicalize(root).map_err(|_|"工作区无效")?,std::fs::canonicalize(source_root).map_err(|_|"Rust 标准库源码无效")?],filename:"solution.rs",language_id:"rust",server:"rust-analyzer"})
        },
        "c"|"cpp"=>crate::lsp_native::prepare(manager,root,language),
        _=>Err("此语言服务尚未接入".into()),
    }
}

#[cfg(test)]
mod snippet_validation_tests{
    use super::*;
    #[test]
    fn opt_in_gate_is_debug_linux_only(){
        assert_eq!(snippet_validation_enabled(),cfg!(all(feature="native-snippet-validation",debug_assertions,target_os="linux")));
        if !cfg!(feature="native-snippet-validation"){assert!(!snippet_validation_enabled());}
    }
    #[test]
    fn completion_profile_preserves_resolve_and_indentation_scope(){
        let rust=completion_capabilities("rust");
        assert_eq!(rust["completionItem"]["snippetSupport"],json!(snippet_validation_enabled()));
        assert_eq!(rust["completionItem"]["resolveSupport"]["properties"],json!(["documentation","additionalTextEdits"]));
        assert_eq!(rust["insertTextMode"],json!(1));
        assert_eq!(rust["completionItem"]["insertTextModeSupport"]["valueSet"],json!([1]));
        for language in ["python3","golang","java","c","cpp"]{
            let profile=completion_capabilities(language);
            assert!(profile["completionItem"].get("resolveSupport").is_none());
            assert!(profile["completionItem"].get("insertReplaceSupport").is_none());
        }
    }
}
