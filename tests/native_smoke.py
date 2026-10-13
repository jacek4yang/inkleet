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
        with urllib.request.urlopen(req, timeout=90) as response:
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
    cmd("POST","/actions",{"actions":[{"type":"key","id":"keyboard","actions":[
        {"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"a"},
        {"type":"keyUp","value":"a"},{"type":"keyUp","value":"\ue009"}
    ]}]})
    cmd("POST",f"/element/{node}/value",{"text":value,"value":list(value)})
    wait_for(lambda: text(css) == value, "GUI text matches typed text")
def screenshot(name):
    (evidence / name).write_bytes(base64.b64decode(cmd("GET","/screenshot")))
def start():
    global session
    result = request("POST","/session",{"capabilities":{"alwaysMatch":{"browserName":"wry","tauri:options":{"application":str(pathlib.Path(os.environ.get("INKLEET_TEST_BINARY", "src-tauri/target/debug/inkleet")).resolve())}}}})
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
    click(".notes-heading button:first-child")
    wait_for(lambda: text(".notes-rendered h1") == "Native note", "bundled native Worker Markdown preview")
    screenshot("notes-preview-native.png")
    click(".notes-heading button:first-child")
    wait_for(lambda: text(note) == "# Native note", "return from preview preserves original Markdown")

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
    if os.environ.get("INKLEET_LIVE_CN") == "1":
        click('[data-action="open-catalogue"]')
        search = '[aria-label="搜索中国站题目"]'
        wait_for(lambda: element(search), "catalogue opened")
        cmd("POST", f"/element/{element(search)}/value", {"text": "two sum", "value": list("two sum")})
        click('dialog form button[type="submit"]')
        wait_for(lambda: element('dialog button[data-slug="two-sum"]'), "live Chinese search result", seconds=30)
        click('dialog button[data-slug="two-sum"]')
        wait_for(lambda: "两数之和" in text("article h1"), "real Chinese question rendered", seconds=30)
        wait_for(lambda: "impl Solution" in text(code), "official Rust template loaded")
        screenshot("real-cn-question-native.png")
        fill(code, "// live CN draft persistence")
        live_source = data / "top.jacek.inkleet/notebook/lc-1/solution.rs"
        wait_for(lambda: live_source.exists() and live_source.read_text() == "// live CN draft persistence", "real question local source saved")
        # 只验证匿名官方登录页面的原生窗口，不输入账号、不解验证码、不读取凭据。
        main_handle = cmd("GET", "/window")
        try:
            click(".login-area > button")
            handles = wait_for(lambda: (h if len(h := cmd("GET", "/window/handles")) > 1 else None), "isolated login window exposed to WebDriver")
            login_handle = next(h for h in handles if h != main_handle)
            cmd("POST", "/window", {"handle": login_handle})
            wait_for(lambda: "leetcode.cn/accounts/login" in cmd("GET", "/url"), "official login origin", seconds=25)
            wait_for(lambda: "登录" in text("body") and len(cmd("POST", "/elements", {"using": "css selector", "value": "input"})) > 0, "official login controls", seconds=25)
            screenshot("official-login-window-native.png")
            (evidence/"LOGIN_UI_RESULT.txt").write_text("PASS: separate native official anonymous login page and controls loaded. No account login, credentials, CAPTCHA, or session validation performed.\\n")
        except Exception as error:
            (evidence/"LOGIN_UI_RESULT.txt").write_text("UNVERIFIED: anonymous native login UI automation could not complete: " + type(error).__name__ + ". Not an authentication verdict.\\n")
            subprocess.run(["scrot", str(evidence / "login-ui-unverified.png")], check=False)
        finally:
            cmd("POST", "/window", {"handle": main_handle})
            if cmd("POST", "/elements", {"using": "css selector", "value": ".login-panel button:last-child"}):
                click(".login-panel button:last-child")
        stop()
        # 重启后的题库恢复只读本机缓存；代理指向未监听端口，避免成功来自网络。
        old_proxy = os.environ.get("HTTPS_PROXY")
        old_no_proxy = os.environ.get("NO_PROXY")
        os.environ["HTTPS_PROXY"] = "http://127.0.0.1:9"
        os.environ["NO_PROXY"] = "127.0.0.1,localhost"
        driver.terminate()
        driver.wait(timeout=10)
        driver = subprocess.Popen(["tauri-driver"], stdout=open(evidence/"driver-offline.log","w"), stderr=subprocess.STDOUT)
        wait_for(lambda: request("GET","/status"), "offline driver ready")
        start()
        wait_for(lambda: element('[data-problem="lc-1"]'), "cached question restored without live search")
        click('[data-problem="lc-1"]')
        wait_for(lambda: "两数之和" in text("article h1"), "cached Chinese statement restored")
        wait_for(lambda: text(code) == "// live CN draft persistence", "real question source restored offline")
        screenshot("real-cn-offline-native.png")
        click('[data-action="open-catalogue"]')
        wait_for(lambda: element(search), "offline catalogue opened")
        cmd("POST", f"/element/{element(search)}/value", {"text": "two sum", "value": list("two sum")})
        click('dialog form button[type="submit"]')
        wait_for(lambda: "无法连接中国站" in text('dialog [role="alert"]'), "network unavailable is explicit", seconds=30)
        click(".catalogue-heading button")
        if old_proxy is None: os.environ.pop("HTTPS_PROXY", None)
        else: os.environ["HTTPS_PROXY"] = old_proxy
        if old_no_proxy is None: os.environ.pop("NO_PROXY", None)
        else: os.environ["NO_PROXY"] = old_no_proxy
        (evidence/"LIVE_CN_RESULT.txt").write_text("PASS: real public CN search and question through native GUI, official Rust template, local source save and offline restart/cache recovery. No authenticated login, run or submit.\\n")
except Exception:
    subprocess.run(["scrot", str(evidence / "desktop-failure.png")], check=False)
    (evidence / "test-files.json").write_text(json.dumps({str(p.relative_to(data)): p.read_text() for p in data.rglob("*") if p.is_file() and p.suffix in [".rs", ".md"]}, ensure_ascii=False))
    if session:
        try: screenshot("failure.png")
        except Exception: pass
    raise
finally:
    stop()
    driver.terminate()
    driver.wait(timeout=10)
