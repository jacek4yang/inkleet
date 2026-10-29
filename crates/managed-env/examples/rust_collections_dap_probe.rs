//! Actual pinned-toolchain DAP qualification, not a UI mock or host rustup test.
//! Reuse the production snapshot compiler and launch configuration verbatim.
#[allow(dead_code)]
mod local_run {
    pub struct Snapshot {
        pub code: String,
        pub input: String,
        pub metadata: String,
        pub title: String,
        pub language: String,
    }
}
#[allow(dead_code)]
#[path = "../../../src-tauri/src/compiled_runtime.rs"]
mod compiled_runtime;
#[allow(dead_code)]
#[path = "../../../src-tauri/src/debug_launch.rs"]
mod debug_launch;

use inkleet_managed_env::{process, rpc::Client, Manager, Report};
use serde_json::{json, Value};
use std::{collections::BTreeSet, fs, path::Path, sync::{atomic::AtomicBool, mpsc, Arc, Mutex}, time::{Duration, Instant}};

const SOURCE: &str = r#"fn solve(values: Vec<i32>) -> i32 {
    let map = std::collections::HashMap::<i32, usize>::from([(3, 30), (8, 80)]);
    let string_map = std::collections::HashMap::<String, i32>::from([(String::from("alpha"), 11), (String::from("beta"), 22)]);
    let empty = std::collections::HashMap::<i32, usize>::new();
    let set = std::collections::HashSet::<i32>::from([3, 8]);
    let vector = vec![10_i32, 20, 30];
    let option_some = Some(41_i32);
    let option_none = None::<i32>;
    let option_nested_some = Some(Some(7_i32));
    let option_nested_none = Some(None::<i32>);
    std::hint::black_box((&map, &string_map, &empty, &set, &vector, &option_some, &option_none, &option_nested_some, &option_nested_none)); // BREAKPOINT
    values.iter().sum()
}
"#;

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    fs::write(path, serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn event(rx: &mpsc::Receiver<Value>, name: &str) -> Result<Value, String> {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let value = rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|_| format!("DAP {name} event timeout"))?;
        if value["event"].as_str() == Some(name) { return Ok(value); }
    }
}

fn request(client: &Client, records: &mut Vec<Value>, command: &str, arguments: Value) -> Result<Value, String> {
    if records.len() >= 80 { return Err("Probe request budget exhausted".into()); }
    let result = client.request(command, arguments.clone(), Duration::from_secs(15));
    records.push(json!({"command": command, "arguments": arguments,
        "response": result.as_ref().ok(), "error": result.as_ref().err()}));
    result
}

fn all_children(client: &Client, records: &mut Vec<Value>, item: &Value) -> Result<Vec<Value>, String> {
    let reference = item["variablesReference"].as_i64().filter(|v| *v > 0)
        .ok_or_else(|| format!("Missing expandable reference for {}", item["name"]))?;
    let result = request(client, records, "variables", json!({"variablesReference": reference, "start": 0, "count": 100}))?;
    let variables = result["variables"].as_array().ok_or("Missing DAP variables array")?;
    if variables.len() > 100 { return Err("Adapter ignored bounded variable count".into()); }
    Ok(variables.clone())
}
fn children(client: &Client, records: &mut Vec<Value>, item: &Value) -> Result<Vec<Value>, String> {
    Ok(all_children(client, records, item)?.into_iter().filter(|v| !is_raw(v)).collect())
}

fn is_raw(value: &Value) -> bool {
    value["name"] == "[raw]" && value.pointer("/presentationHint/attributes").and_then(Value::as_array)
        .is_some_and(|items| items.iter().any(|item| item == "readOnly") && items.iter().any(|item| item == "virtual"))
}

fn scalar(item: &Value) -> Result<String, String> {
    let value = item["value"].as_str().ok_or("Missing scalar display value")?;
    if value.is_empty() || matches!(value.trim(), "{...}" | "{ ... }" | "..." | "<unavailable>") {
        return Err(format!("Unreadable scalar value: {value}"));
    }
    Ok(value.to_owned())
}

fn map_pairs(client: &Client, records: &mut Vec<Value>, map: &Value) -> Result<BTreeSet<(String, String)>, String> {
    let entries = children(client, records, map)?;
    let mut pairs = BTreeSet::new();
    for entry in entries {
        let fields = children(client, records, &entry)?;
        let key = fields.iter().find(|v| matches!(v["name"].as_str(), Some("0" | ".0" | "key")));
        let value = fields.iter().find(|v| matches!(v["name"].as_str(), Some("1" | ".1" | "value")));
        let (key, value) = key.zip(value).ok_or_else(|| format!("Unknown map pair field shape: {fields:?}"))?;
        if fields.len() != 2 { return Err(format!("Unexpected logical map pair fields: {fields:?}")); }
        if !pairs.insert((scalar(key)?, scalar(value)?)) { return Err("Duplicate map pair".into()); }
    }
    Ok(pairs)
}

// Capture only structural variables. Never evaluate a debuggee expression or
// derive a variant from a summary/empty child list. This bounded tree is evidence
// for a separate shape review and renderer replay, not a pretty-printer guess.
fn capture_tree(client: &Client, records: &mut Vec<Value>, variable: &Value, depth: usize,
    ancestors: &mut Vec<i64>, budget: &mut usize) -> Result<Value, String> {
    if *budget == 0 { return Err("Option capture node budget exhausted".into()); }
    *budget -= 1;
    let reference = variable["variablesReference"].as_i64().unwrap_or(0);
    if reference <= 0 { return Ok(json!({"variable":variable,"children":[]})); }
    if depth >= 8 { return Err("Option capture depth limit reached".into()); }
    if ancestors.contains(&reference) { return Ok(json!({"variable":variable,"children":[],"repeatedReference":true})); }
    ancestors.push(reference);
    let mut captured = Vec::new();
    for child in all_children(client, records, variable)? {
        captured.push(capture_tree(client, records, &child, depth + 1, ancestors, budget)?);
    }
    ancestors.pop();
    Ok(json!({"variable":variable,"children":captured}))
}

// Payload identity comes only from actual scalar children. A summary such as
// `Some(41)` is not parsed, and a missing payload never establishes `None`.
fn scalar_payloads(tree: &Value, expected: &str, found: &mut Vec<Value>) {
    if tree["variable"]["variablesReference"].as_i64().unwrap_or(0) == 0
        && tree["variable"]["value"].as_str() == Some(expected) {
        found.push(tree["variable"].clone());
    }
    if let Some(children) = tree["children"].as_array() {
        for child in children.iter().filter(|child| !is_raw(&child["variable"])) {
            scalar_payloads(child, expected, found);
        }
    }
}

fn run_probe(client: &Arc<Client>, rx: &mpsc::Receiver<Value>, arguments: Value, work: &Path, records: &mut Vec<Value>) -> Result<Value, String> {
    request(client, records, "initialize", json!({"clientID":"inkleet", "adapterID":"lldb", "pathFormat":"path",
        "linesStartAt1":true,"columnsStartAt1":true,"supportsVariableType":true,
        "supportsVariablePaging":true,"supportsRunInTerminalRequest":false}))?;
    let launching = client.clone();
    let launch_args = arguments.clone();
    let worker = std::thread::spawn(move || launching.request("launch", launch_args, Duration::from_secs(45)));
    event(rx, "initialized")?;
    let line = SOURCE.lines().position(|line| line.contains("// BREAKPOINT")).unwrap() + 1;
    let points = request(client, records, "setBreakpoints", json!({"source":{"path":work.join("solution.rs")},"breakpoints":[{"line":line}]}))?;
    if points.pointer("/breakpoints/0/verified").and_then(Value::as_bool) != Some(true) { return Err(format!("Breakpoint not verified: {points}")); }
    request(client, records, "configurationDone", json!({}))?;
    let launched = worker.join().map_err(|_| "Launch worker panicked")?;
    records.push(json!({"command":"launch","arguments":arguments,"response":launched.as_ref().ok(),"error":launched.as_ref().err()}));
    launched?;
    let stop = event(rx, "stopped")?;
    let thread = stop.pointer("/body/threadId").and_then(Value::as_i64).ok_or("Stopped thread missing")?;
    let stack = request(client, records, "stackTrace", json!({"threadId":thread,"startFrame":0,"levels":5}))?;
    let frame = stack.pointer("/stackFrames/0/id").and_then(Value::as_i64).ok_or("Frame missing")?;
    if stack.pointer("/stackFrames/0/line").and_then(Value::as_u64) != Some(line as u64) { return Err(format!("Wrong stopped source line: {stack}")); }
    let scopes = request(client, records, "scopes", json!({"frameId":frame}))?;
    let mut locals = Vec::new();
    for scope in scopes["scopes"].as_array().ok_or("Scopes missing")?.iter().filter(|s| s["expensive"] != true).take(4) {
        locals.extend(children(client, records, scope)?);
    }
    let find = |name: &str| locals.iter().find(|v| v["name"] == name).ok_or_else(|| format!("Local {name} missing"));
    let numeric = map_pairs(client, records, find("map")?)?;
    if numeric != BTreeSet::from([("3".into(),"30".into()),("8".into(),"80".into())]) { return Err(format!("Incorrect numeric pairs: {numeric:?}")); }
    let strings = map_pairs(client, records, find("string_map")?)?;
    if strings != BTreeSet::from([("\"alpha\"".into(),"11".into()),("\"beta\"".into(),"22".into())]) { return Err(format!("Incorrect string pairs: {strings:?}")); }
    let empty = find("empty")?;
    if empty["variablesReference"].as_i64().unwrap_or(0) > 0 && !children(client, records, empty)?.is_empty() { return Err("Empty map contains logical elements".into()); }
    let set: BTreeSet<_> = children(client, records, find("set")?)?.iter().map(scalar).collect::<Result<_,_>>()?;
    if set != BTreeSet::from(["3".into(),"8".into()]) { return Err(format!("Incorrect set members: {set:?}")); }
    let vector: Vec<_> = children(client, records, find("vector")?)?.iter().map(scalar).collect::<Result<_,_>>()?;
    if vector != ["10","20","30"] { return Err(format!("Incorrect vector order: {vector:?}")); }
    let mut options = serde_json::Map::new();
    let mut option_budget = 64;
    for name in ["option_some", "option_none", "option_nested_some", "option_nested_none"] {
        options.insert(name.into(), capture_tree(client, records, find(name)?, 0, &mut Vec::new(), &mut option_budget)?);
    }
    let mut payloads = serde_json::Map::new();
    for (name, expected) in [("option_some", "41"), ("option_nested_some", "7")] {
        let mut found = Vec::new();
        scalar_payloads(&options[name], expected, &mut found);
        if found.len() != 1 { return Err(format!("Expected one structural scalar payload {expected} for {name}; adapter shape is not qualified")); }
        payloads.insert(name.into(), json!(found[0]));
    }
    request(client, records, "disconnect", json!({"terminateDebuggee":true}))?;
    Ok(json!({"status":"PASS","numericPairs":numeric,"stringPairs":strings,"setMembers":set,"vectorElements":vector,
        "emptyMap":true,"stoppedLine":line,"locals":locals,"optionCapture":options,
        "optionQualification":{"status":"CAPTURED_NOT_CLASSIFIED","scalarPayloads":payloads,
            "expectedFixture":{"option_some":"Some(41)","option_none":"None::<i32>","option_nested_some":"Some(Some(7))","option_nested_none":"Some(None::<i32>)"},
            "scope":"Actual bounded structural capture and scalar identity only; no Option classifier, no None inference from missing children or summary"},"scope":"Real pinned adapter and production snapshot launch; not GUI acceptance"}))
}

#[tokio::main]
async fn main() -> Result<(), String> {
    if let Some(result) = compiled_runtime::linker_entry() { return result; }
    let evidence = std::env::args_os().nth(1).ok_or("Usage: rust_collections_dap_probe EVIDENCE_DIRECTORY")?;
    let evidence = std::path::PathBuf::from(evidence);
    fs::create_dir_all(&evidence).map_err(|e| e.to_string())?;
    let temp = tempfile::Builder::new().prefix("inkleet Rust collections space ").tempdir().map_err(|e| e.to_string())?;
    let root = process::tool_path(&fs::canonicalize(temp.path()).map_err(|e| e.to_string())?);
    // An explicit app-owned cache may be reused, but Manager::install still
    // validates pinned package receipts and executable hashes. No host tool paths.
    let tool_root = std::env::var_os("INKLEET_PROBE_TOOL_ROOT").map(std::path::PathBuf::from).unwrap_or_else(|| root.join("tools"));
    let manager = Manager::new(tool_root);
    let report: Report = Arc::new(|_| {});
    for id in ["rustc", "rust-std", "zig", "codelldb"] {
        println!("Installing pinned package {id}");
        manager.install(id, Arc::new(AtomicBool::new(false)), report.clone()).await?;
    }
    if cfg!(windows) { manager.install("rust-mingw", Arc::new(AtomicBool::new(false)), report).await?; }
    let work = root.join("workspace with spaces");
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let snapshot = local_run::Snapshot { code: SOURCE.into(), input: "[1,2]".into(),
        metadata: json!({"name":"solve","params":[{"name":"values","type":"integer[]"}],"return":{"type":"integer"},"inkleetFunctionStyle":"free"}).to_string(),
        title:"Collection fixture".into(), language:"rust".into() };
    fs::write(evidence.join("fixture.rs"), SOURCE).map_err(|e| e.to_string())?;
    let launch = debug_launch::prepare(&manager, &work, &snapshot, Arc::new(AtomicBool::new(false)))?;
    if let Some(warning) = launch.warning { return Err(format!("Production formatter configuration warning: {warning}")); }
    write_json(&evidence.join("launch.json"), &launch.arguments)?;
    let (tx, rx) = mpsc::sync_channel(256);
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    let client = Arc::new(Client::spawn_dap(launch.command, Arc::new(move |event| {
        if let Ok(mut items) = captured.lock() { if items.len() < 256 { items.push(event.clone()); } }
        let _ = tx.try_send(event);
    }))?);
    let mut records = Vec::new();
    let result = run_probe(&client, &rx, launch.arguments, &work, &mut records);
    client.stop();
    write_json(&evidence.join("dap-transcript.json"), &json!({"platform":inkleet_managed_env::platform(),
        "requests":records,"events":events.lock().map_err(|_|"Events lock")?.clone(),"stderr":client.stderr()}))?;
    let report = match &result { Ok(value) => value.clone(), Err(error) => json!({"status":"FAIL","error":error}) };
    write_json(&evidence.join("result.json"), &report)?;
    result.map(|_| ())
}

#[cfg(test)]
mod option_evidence_tests {
    use super::*;
    #[test]
    fn payload_evidence_uses_scalar_children_not_summaries_or_raw_duplicates() {
        let mut found = Vec::new();
        scalar_payloads(&json!({"variable":{"value":"Some(41)","variablesReference":1},"children":[]}), "41", &mut found);
        assert!(found.is_empty());
        let tree = json!({"variable":{"value":"Some(41)","variablesReference":1},"children":[
            {"variable":{"name":"0","value":"41","variablesReference":0},"children":[]},
            {"variable":{"name":"[raw]","value":"{...}","variablesReference":2,"presentationHint":{"attributes":["readOnly","virtual"]}},"children":[
                {"variable":{"name":"0","value":"41","variablesReference":0},"children":[]}
            ]}
        ]});
        scalar_payloads(&tree, "41", &mut found);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0]["name"], "0");
        let mut none = Vec::new();
        scalar_payloads(&json!({"variable":{"value":"None","variablesReference":1},"children":[]}), "41", &mut none);
        assert!(none.is_empty()); // No variant conclusion follows from this absence.
    }
}
