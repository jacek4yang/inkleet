use inkleet_managed_env::{Manager, Report, platform};
use std::{sync::{Arc, atomic::AtomicBool}, time::Duration};
#[tokio::main]
async fn main() -> Result<(), String> {
    let temp = tempfile::Builder::new().prefix("inkleet managed 环境 ").tempdir().map_err(|e|e.to_string())?;
    let base=std::fs::canonicalize(temp.path()).map_err(|e|e.to_string())?;
    let manager=Manager::new(base.join("tools"));
    let report: Report=Arc::new(|p| { if p.phase!="downloading" { println!("PHASE {}",p.phase); } });
    let python=manager.install("python",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    let again=manager.install("python",Arc::new(AtomicBool::new(false)),report.clone()).await?;
    assert_eq!(python,again);
    let work=base.join("work");std::fs::create_dir(&work).map_err(|e|e.to_string())?;
    let script="import sys, json, pathlib, inspect, collections, ssl, sqlite3; assert sys.flags.isolated; assert sys.version_info[:2] == (3,14); assert pathlib.Path(inspect.getsourcefile(collections)).is_file(); print(json.dumps({'version':sys.version.split()[0],'stdlibSource':True,'ssl':ssl.OPENSSL_VERSION,'sqlite':sqlite3.sqlite_version}))";
    let mut command=tokio::process::Command::new(&python);
    command.args(["-I","-c",script]).current_dir(&work).env_clear().env("HOME",&work).env("USERPROFILE",&work).env("TEMP",&work).env("TMP",&work).env("PATH",python.parent().unwrap()).kill_on_drop(true);
    if let Some(root)=std::env::var_os("SystemRoot"){command.env("SystemRoot",root);}
    let result=tokio::time::timeout(Duration::from_secs(30),command.output()).await.map_err(|_|"private python timed out")?.map_err(|e|e.to_string())?;
    if !result.status.success(){return Err(format!("private python failed: {}",String::from_utf8_lossy(&result.stderr)));}
    let pyright=manager.install("pyright",Arc::new(AtomicBool::new(false)),report).await?;
    assert!(pyright.is_file());
    let node=manager.install("node",Arc::new(AtomicBool::new(false)),Arc::new(|_|{})).await?;
    let workspace=work.clone();let python_path=python.clone();
    let lsp=tokio::task::spawn_blocking(move || -> Result<serde_json::Value,String> {
        use inkleet_managed_env::rpc::Client;
        use serde_json::json;
        let mut command=std::process::Command::new(&node);
        command.arg(&pyright).arg("--stdio").current_dir(&workspace).env_clear()
            .env("PATH",node.parent().unwrap()).env("HOME",&workspace).env("USERPROFILE",&workspace)
            .env("TEMP",&workspace).env("TMP",&workspace);
        if let Some(root)=std::env::var_os("SystemRoot"){command.env("SystemRoot",root);}
        let settings=json!({"pythonPath":python_path,"analysis":{"typeCheckingMode":"basic","autoSearchPaths":false,"useLibraryCodeForTypes":true}});
        let client=Client::spawn(command,settings.clone(),Arc::new(|_|{}))?;
        let uri=reqwest::Url::from_directory_path(&workspace).map_err(|_|"workspace URI")?.to_string();
        let initialized=client.request("initialize",json!({"processId":null,"rootUri":uri,"capabilities":{"general":{"positionEncodings":["utf-16"]},"textDocument":{"hover":{"contentFormat":["plaintext"]},"completion":{"completionItem":{"snippetSupport":false}}}},"workspaceFolders":[{"uri":uri,"name":"InkLeet"}]}),Duration::from_secs(30))?;
        assert!(initialized.pointer("/capabilities/hoverProvider").is_some());
        client.notify("initialized",json!({}))?;
        client.notify("workspace/didChangeConfiguration",json!({"settings":{"python":settings}}))?;
        let document=reqwest::Url::from_file_path(workspace.join("solution.py")).map_err(|_|"document URI")?.to_string();
        client.notify("textDocument/didOpen",json!({"textDocument":{"uri":document,"languageId":"python","version":1,"text":"from collections import deque\nitems = deque([1, 2])\nitems.append(3)\nitems.\n"}}))?;
        let hover=client.request("textDocument/hover",json!({"textDocument":{"uri":document},"position":{"line":2,"character":8}}),Duration::from_secs(30))?;
        assert!(!hover.is_null(),"real Pyright hover was empty");
        let completion=client.request("textDocument/completion",json!({"textDocument":{"uri":document},"position":{"line":3,"character":6}}),Duration::from_secs(30))?;
        let items=completion.as_array().or_else(||completion.get("items").and_then(serde_json::Value::as_array)).ok_or("completion result")?;
        assert!(items.iter().any(|v|v.get("label").and_then(serde_json::Value::as_str)==Some("popleft")),"real deque completion missing");
        let definition=client.request("textDocument/definition",json!({"textDocument":{"uri":document},"position":{"line":0,"character":25}}),Duration::from_secs(30))?;
        assert!(!definition.is_null() && definition.as_array().is_none_or(|a|!a.is_empty()),"stdlib declaration missing");
        client.request("shutdown",json!(null),Duration::from_secs(5))?;
        let _=client.notify("exit",json!(null));client.stop();
        Ok(json!({"initialize":true,"hover":true,"completion":true,"stdlibDeclaration":true,"managedNode":true}))
    }).await.map_err(|_|"LSP probe task failed")??;

    let debugpy=manager.install("debugpy",Arc::new(AtomicBool::new(false)),Arc::new(|_|{})).await?;
    let debug_root=debugpy.parent().and_then(std::path::Path::parent).and_then(std::path::Path::parent).ok_or("debugpy package root")?.to_path_buf();
    let runtime_python=python.clone();let runtime_work=work.clone();
    let runtime=tokio::task::spawn_blocking(move || -> Result<serde_json::Value,String> {
        use inkleet_managed_env::{process,rpc::Client};
        use std::{process::Command,sync::{mpsc,atomic::Ordering}};
        use serde_json::json;
        fn command(python:&std::path::Path,work:&std::path::Path,script:&str)->Command{
            let mut command=Command::new(python);command.args(["-I","-c",script]).env_clear().current_dir(work)
                .env("HOME",work).env("USERPROFILE",work).env("TEMP",work).env("TMP",work).env("PATH",python.parent().unwrap());
            if let Some(root)=std::env::var_os("SystemRoot"){command.env("SystemRoot",root);}
            command
        }
        
        {
            use inkleet_managed_env::harness;
            fn check(python:&std::path::Path,root:&std::path::Path,source:&str,metadata:&str,input:&str,expected:serde_json::Value)->Result<(),String>{
                let work=tempfile::Builder::new().prefix("harness-").tempdir_in(root).map_err(|e|e.to_string())?;
                harness::prepare(work.path(),source,metadata,input)?;
                let mut cmd=Command::new(python);cmd.arg("-I").arg(work.path().join("harness.py")).current_dir(work.path()).env_clear()
                    .env("PATH",python.parent().unwrap()).env("HOME",work.path()).env("USERPROFILE",work.path()).env("TMP",work.path()).env("TEMP",work.path());
                if let Some(system)=std::env::var_os("SystemRoot"){cmd.env("SystemRoot",system);}
                let output=process::run(cmd,Arc::new(AtomicBool::new(false)),Duration::from_secs(10),65536)?;
                assert_eq!(output.exit_code,Some(0),"{:?}",output);
                let text=std::fs::read_to_string(work.path().join("results.jsonl")).map_err(|e|e.to_string())?;
                let result:serde_json::Value=serde_json::from_str(text.trim()).map_err(|e|e.to_string())?;
                assert_eq!(result["ok"],true,"{result}");assert_eq!(result["value"],expected,"{result}");
                Ok(())
            }
            check(&runtime_python,&runtime_work,"class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        seen = {}\n        for i, n in enumerate(nums):\n            if target-n in seen: return [seen[target-n],i]\n            seen[n]=i\n",r#"{"name":"twoSum","params":[{"name":"nums","type":"integer[]"},{"name":"target","type":"integer"}],"return":{"type":"integer[]"}}"#,"[2,7,11,15]\n9",json!([0,1]))?;
            check(&runtime_python,&runtime_work,"class Solution:\n    def identity(self, head: Optional[ListNode]) -> Optional[ListNode]:\n        return head\n",r#"{"name":"identity","params":[{"name":"head","type":"ListNode"}]}"#,"[1,2,3]",json!([1,2,3]))?;
            check(&runtime_python,&runtime_work,"class Solution:\n    def identity(self, root: Optional[TreeNode]) -> Optional[TreeNode]:\n        return root\n",r#"{"name":"identity","params":[{"name":"root","type":"TreeNode"}]}"#,"[1,null,2,3]",json!([1,null,2,3]))?;
        }

        let normal=process::run(command(&runtime_python,&runtime_work,"print(42)"),Arc::new(AtomicBool::new(false)),Duration::from_secs(5),4096)?;
        assert_eq!(normal.exit_code,Some(0));assert_eq!(normal.stdout.trim(),"42");
        let timeout=process::run(command(&runtime_python,&runtime_work,"while True: pass"),Arc::new(AtomicBool::new(false)),Duration::from_millis(200),4096)?;
        assert!(timeout.timed_out);
        let flood=process::run(command(&runtime_python,&runtime_work,"print('x'*200000)"),Arc::new(AtomicBool::new(false)),Duration::from_secs(5),4096)?;
        assert!(flood.truncated);assert!(flood.stdout.len()+flood.stderr.len()<=4096);
        let cancel=Arc::new(AtomicBool::new(false));let cancel_copy=cancel.clone();
        std::thread::spawn(move||{std::thread::sleep(Duration::from_millis(200));cancel_copy.store(true,Ordering::Relaxed);});
        let canceled=process::run(command(&runtime_python,&runtime_work,"import time;time.sleep(30)"),cancel,Duration::from_secs(5),4096)?;
        assert!(canceled.canceled);
        let child_script="import time,pathlib;time.sleep(2);pathlib.Path('orphan-marker').write_text('bad')";
        let parent_script=format!("import sys,subprocess;subprocess.Popen([sys.executable,'-I','-c',{}]);print('parent finished')",serde_json::to_string(child_script).unwrap());
        let _=process::run(command(&runtime_python,&runtime_work,&parent_script),Arc::new(AtomicBool::new(false)),Duration::from_millis(500),4096)?;
        std::thread::sleep(Duration::from_millis(2200));
        assert!(!runtime_work.join("orphan-marker").exists(),"descendant survived process cleanup");
        let script_path=runtime_work.join("debug_subject.py");
        std::fs::write(&script_path,"total = 1\ntotal += 2\nresult = total * 2\nprint(result)\n").map_err(|e|e.to_string())?;
        let mut adapter=command(&runtime_python,&runtime_work,"import sys,runpy;sys.path.insert(0,sys.argv[1]);sys.argv=['debugpy.adapter'];runpy.run_module('debugpy.adapter',run_name='__main__')");
        adapter.arg(&debug_root);
        let (events_tx,events_rx)=mpsc::sync_channel(128);
        let client=Arc::new(Client::spawn_dap(adapter,Arc::new(move|event|{if event.get("event").and_then(serde_json::Value::as_str)!=Some("output"){let _=events_tx.try_send(event);}}))?);
        client.request("initialize",json!({"clientID":"inkleet","adapterID":"python","pathFormat":"path","linesStartAt1":true,"columnsStartAt1":true,"supportsVariableType":true,"supportsRunInTerminalRequest":false}),Duration::from_secs(15))?;
        let launch_client=client.clone();let launch_python=runtime_python.clone();let launch_work=runtime_work.clone();let launch_script=script_path.clone();
        let launching=std::thread::spawn(move||launch_client.request("launch",json!({"name":"InkLeet fixture","type":"python","request":"launch","python":launch_python,"program":launch_script,"cwd":launch_work,"console":"internalConsole","justMyCode":false}),Duration::from_secs(30)));
        fn event(rx:&mpsc::Receiver<serde_json::Value>,name:&str)->Result<serde_json::Value,String>{
            let deadline=std::time::Instant::now()+Duration::from_secs(30);
            loop{let remaining=deadline.saturating_duration_since(std::time::Instant::now());let value=rx.recv_timeout(remaining).map_err(|_|format!("missing DAP event {name}"))?;
                if value.get("event").and_then(serde_json::Value::as_str)==Some(name){return Ok(value);}
            }
        }
        event(&events_rx,"initialized")?;
        let breakpoint=client.request("setBreakpoints",json!({"source":{"path":script_path},"breakpoints":[{"line":2}]}),Duration::from_secs(10))?;
        assert!(breakpoint.pointer("/breakpoints/0/verified").and_then(serde_json::Value::as_bool)==Some(true));
        client.request("configurationDone",json!({}),Duration::from_secs(10))?;
        launching.join().map_err(|_|"launch thread failed")??;
        let stopped=event(&events_rx,"stopped")?;
        let thread_id=stopped.pointer("/body/threadId").and_then(serde_json::Value::as_i64).ok_or("stopped thread ID")?;
        let stack=client.request("stackTrace",json!({"threadId":thread_id,"startFrame":0,"levels":10}),Duration::from_secs(10))?;
        let frame_id=stack.pointer("/stackFrames/0/id").and_then(serde_json::Value::as_i64).ok_or("stack frame ID")?;
        let scopes=client.request("scopes",json!({"frameId":frame_id}),Duration::from_secs(10))?;
        let variables_ref=scopes.pointer("/scopes/0/variablesReference").and_then(serde_json::Value::as_i64).ok_or("locals reference")?;
        let variables=client.request("variables",json!({"variablesReference":variables_ref}),Duration::from_secs(10))?;
        assert!(variables.get("variables").and_then(serde_json::Value::as_array).is_some_and(|v|v.iter().any(|v|v.get("name").and_then(serde_json::Value::as_str)==Some("total"))));
        client.request("next",json!({"threadId":thread_id}),Duration::from_secs(10))?;
        event(&events_rx,"stopped")?;
        client.request("setBreakpoints",json!({"source":{"path":script_path},"breakpoints":[]}),Duration::from_secs(10))?;
        client.request("continue",json!({"threadId":thread_id}),Duration::from_secs(10))?;
        event(&events_rx,"terminated")?;
        let _=client.request("disconnect",json!({"terminateDebuggee":true}),Duration::from_secs(5));client.stop();
        Ok(json!({"normalRun":true,"typedHarness":true,"timeout":true,"outputLimit":true,"cancel":true,"processTreeCleanup":true,"dap":{"breakpoint":true,"stack":true,"variables":true,"stepOver":true,"continue":true,"termination":true}}))
    }).await.map_err(|_|"runtime probe failed")??;
    println!("MANAGED_ENV_RESULT {}",serde_json::json!({"platform":platform(),"python":serde_json::from_slice::<serde_json::Value>(&result.stdout).map_err(|e|e.to_string())?,"pyrightPackage":true,"lsp":lsp,"runtime":runtime,"systemPathUsed":false,"reinstallIdempotent":true}));
    Ok(())
}
