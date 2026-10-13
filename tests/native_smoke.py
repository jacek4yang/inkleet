"""Linux WebKitGTK smoke test against the built native application, not a browser mock."""
import base64, json, os, pathlib, subprocess, time, urllib.request, urllib.error
BASE = "http://127.0.0.1:4444"
EID = "element-6066-11e4-a52e-4f735466cecf"
session = None
evidence = pathlib.Path("evidence/native")
evidence.mkdir(parents=True, exist_ok=True)
data = pathlib.Path(os.environ["XDG_DATA_HOME"])
def request(method, path, payload=None):
    raw = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(BASE + path, data=raw, method=method, headers={"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode()) from error
    value = result.get("value")
    if isinstance(value, dict) and value.get("error"):
        raise RuntimeError(str(value))
    return value
def wait_for(fn, label, seconds=25):
    end = time.monotonic() + seconds
    last = None
    while time.monotonic() < end:
        try:
            value = fn()
            if value: return value
        except Exception as error: last = error
        time.sleep(.2)
    raise AssertionError(f"{label}: {last}")
def cmd(method, path, payload=None): return request(method, f"/session/{session}" + path, payload)
def element(css): return cmd("POST","/element",{"using":"css selector","value":css})[EID]
def text(css): return cmd("GET",f"/element/{element(css)}/text")
def click(css): return cmd("POST",f"/element/{element(css)}/click",{})
def fill(css, value):
    node = element(css)
    cmd("POST",f"/element/{node}/click",{})
    cmd("POST",f"/element/{node}/value",{"text":"\ue009a\ue000" + value})
def screenshot(name):
    (evidence / name).write_bytes(base64.b64decode(cmd("GET","/screenshot")))
def start():
    global session
    result = request("POST","/session",{"capabilities":{"alwaysMatch":{"browserName":"wry","tauri:options":{"application":str(pathlib.Path("src-tauri/target/debug/inkleet").resolve())}}}})
    session = result["sessionId"]
    wait_for(lambda: "已读取本机文件" in text('[role="status"]'), "native IPC initial load")
def stop():
    global session
    if session:
        cmd("DELETE","")
        session = None
driver = subprocess.Popen(["tauri-driver"], stdout=open(evidence/"driver.log","w"), stderr=subprocess.STDOUT)
try:
    wait_for(lambda: request("GET","/status"), "driver ready")
    start()
    code = '[aria-label="代码编辑器"]'
    marker = "// native restart persistence"
    fill(code, marker)
    source = data / "top.jacek.inkleet/notebook/sample-sum/solution.rs"
    wait_for(lambda: source.exists() and source.read_text() == marker, "plain source persisted")
    wait_for(lambda: "已保存到本机文件" in text('[role="status"]'), "save acknowledgement")
    screenshot("desktop-code-native.png")
    click('nav[aria-label="工作区"] button:last-child')
    note = '[aria-label="Markdown 笔记"]'
    fill(note, "# Native note")
    notes = source.with_name("notes.md")
    wait_for(lambda: notes.exists() and notes.read_text() == "# Native note", "notes persisted")
    screenshot("desktop-notes-native.png")
    stop()
    start()
    wait_for(lambda: text(code) == marker, "restart restored Rust source")
    click('nav[aria-label="工作区"] button:last-child')
    wait_for(lambda: text(note) == "# Native note", "restart restored Markdown")
    notes.write_text("# External editor")
    fill(note, "# Pending local edit")
    wait_for(lambda: "保存失败" in text('[role="status"]'), "external conflict visible")
    assert notes.read_text() == "# External editor", "external content overwritten"
    assert text(note) == "# Pending local edit", "pending draft lost"
    screenshot("conflict-native.png")
    (evidence/"RESULT.txt").write_text("PASS: real Linux Tauri/WebKitGTK launch, native IPC, plain source and notes save, process restart restore, external conflict preserving both texts. No LeetCode verification.\n")
except Exception:
    if session:
        try: screenshot("failure.png")
        except Exception: pass
    raise
finally:
    stop()
    driver.terminate()
    driver.wait(timeout=10)
