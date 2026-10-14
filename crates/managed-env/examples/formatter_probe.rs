use inkleet_managed_env::{Manager,Report,formatter};
use std::sync::{Arc,atomic::AtomicBool};
#[tokio::main]
async fn main()->Result<(),String>{
    let root=tempfile::tempdir().map_err(|e|e.to_string())?;
    let manager=Manager::new(root.path().join("tools"));
    let report:Report=Arc::new(|_|{});
    for id in ["ruff","rustc","rustfmt-preview","go"]{manager.install(id,Arc::new(AtomicBool::new(false)),report.clone()).await?;}
    let fixtures=[
        ("python3","from collections import Counter\ndef solve( values:list[int] )->int:\n return sum( values )\n","def solve("),
        ("python3","def solve(values):\r\n return \"中文😀\"\r\n","中文😀"),
        ("rust","use std::collections::HashMap;\nimpl Solution{pub fn solve(values:Vec<i32>)->i32{let mut m=HashMap::new();m.insert(1,2);values.iter().sum()}}","HashMap"),
        ("rust","fn solve()->&'static str{\"中文😀\"}","中文😀"),
        ("golang","func solve(values []int) int {total:=0;for _,v:=range values{total+=v};return total}","func solve"),
        ("golang","import s \"strings\"\nfunc solve(v string)string{return s.TrimSpace(v)}","s \"strings\""),
    ];
    for (index,(language,source,expected)) in fixtures.into_iter().enumerate(){
        let formatted=formatter::format(&manager,language,source)?;
        assert_ne!(formatted,source,"fixture needs actual formatting");
        assert!(formatted.contains(expected),"{language} semantic text retained");
        assert_eq!(formatter::format(&manager,language,&formatted)?,formatted,"formatter is idempotent");
        if source.contains("\r\n"){assert!(!formatted.replace("\r\n","").contains('\n'));}
        println!("FORMATTER_CASE_PASS {index} {language}");
    }
    for (language,source) in [("python3","def solve(:\n"),("rust","fn solve( {"),("golang","func solve( {")]{
        assert!(formatter::format(&manager,language,source).is_err(),"invalid syntax is not replaced");
    }
    println!("FORMATTER_PROBE_PASS real managed executables, no system PATH, imports/Unicode/CRLF/idempotence/syntax errors");
    Ok(())
}
