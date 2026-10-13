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
    # WebKitGTK WebDriver strips literal LF from sendKeys. Use actual Escape/Enter keys between lines.
    for index, line in enumerate(value.split("\n")):
        if index:
            cmd("POST","/actions",{"actions":[{"type":"key","id":"multiline-keyboard","actions":[
                {"type":"keyDown","value":"\ue00c"},{"type":"keyUp","value":"\ue00c"},
                {"type":"keyDown","value":"\ue007"},{"type":"keyUp","value":"\ue007"}
            ]}]})
        if line: cmd("POST",f"/element/{node}/value",{"text":line,"value":list(line)})
    wait_for(lambda: text(css) == value, "GUI text matches typed text")
def screenshot(name):
    (evidence / name).write_bytes(base64.b64decode(cmd("GET","/screenshot")))
def start():
    global session
    result = request("POST","/session",{"capabilities":{"alwaysMatch":{"browserName":"wry","tauri:options":{"application":str(pathlib.Path(os.environ.get("INKLEET_TEST_BINARY", "src-tauri/target/debug/inkleet")).resolve())}}}})
    session = result["sessionId"]
    wait_for(lambda: "已读取本机文件" in text('.statusbar[role="status"]'), "native IPC initial load")
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
    wait_for(lambda: "已保存到本机文件" in text('.statusbar[role="status"]'), "save acknowledgement")
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
    wait_for(lambda: "保存失败" in text('.statusbar[role="status"]'), "external conflict visible")
    assert notes.read_text() == "# External editor", "external content overwritten"
    assert text(note) == "# Pending local edit", "pending draft lost"
    screenshot("conflict-native.png")
    (evidence/"RESULT.txt").write_text("PASS: real Linux Tauri/WebKitGTK launch, native IPC, plain source and notes save, process restart restore, external conflict preserving both texts. No LeetCode verification.\n")
    if os.environ.get("INKLEET_MANAGED_ENV") == "1":
        click('[data-action="open-environments"]')
        wait_for(lambda: element(".environment-summary button"), "environment manager opened")
        click(".environment-summary button")
        wait_for(lambda: all(text(f'.environment-tools [data-tool="{tool}"] [role="status"]') == "已安装" for tool in ["python","node","pyright"]), "three verified private tools installed", seconds=300)
        screenshot("managed-environment-native.png")
        click(".environments header button")
        click('select[aria-label="编程语言"] option[value="python3"]')
        wait_for(lambda: "Pyright 已连接" in text(".lsp-status"), "real private language server connected", seconds=45)
        fill(code, "from collections import deque\nitems = deque([1, 2])\nitems.")
        cmd("POST","/actions",{"actions":[{"type":"key","id":"lsp-keyboard","actions":[
            {"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":" "},{"type":"keyUp","value":" "},{"type":"keyUp","value":"\ue009"}
        ]}]})
        wait_for(lambda: "popleft" in text(".cm-tooltip-autocomplete"), "real stdlib member completion", seconds=30)
        screenshot("python-completion-native.png")
        option=cmd("POST","/element",{"using":"xpath","value":"//li[@role='option'][contains(.,'popleft')]"})[EID]
        cmd("POST",f"/element/{option}/click",{})
        wait_for(lambda: "items.popleft" in text(code), "completion applied to document")
        click(code)
        cmd("POST","/actions",{"actions":[{"type":"key","id":"lsp-keyboard","actions":[
            {"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue010"},{"type":"keyUp","value":"\ue010"},{"type":"keyUp","value":"\ue009"},
            {"type":"keyDown","value":"\ue03c"},{"type":"keyUp","value":"\ue03c"}
        ]}]})
        wait_for(lambda: element(".source-viewer"), "F12 opened a real stdlib declaration", seconds=30)
        wait_for(lambda: "只读" in text(".source-viewer header"), "source viewer is explicitly read-only")
        screenshot("python-stdlib-native.png")
        click(".source-viewer header button")
        fill(code, 'bad: int = "wrong"')
        wait_for(lambda: element(".cm-lintRange-error"), "real Pyright type diagnostic", seconds=30)
        screenshot("python-diagnostics-native.png")
        click('select[aria-label="编程语言"] option[value="rust"]')
        wait_for(lambda: text(code) == marker, "switching away preserves Rust draft and stops Python session")
        (evidence/"MANAGED_IDE_RESULT.txt").write_text("PASS: actual Linux native GUI tool installation, managed Python/Node/Pyright, member completion, F12 stdlib declaration viewer, type diagnostics and draft-preserving language switch. No debugger verification.\n")
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
        click('[data-action="open-link"]')
        link_input = '[aria-label="力扣题目链接"]'
        wait_for(lambda: element(link_input), "link input opened")
        linked = "https://leetcode.cn/problems/two-sum/solutions/123/?envType=study-plan-v2#example"
        cmd("POST", f"/element/{element(link_input)}/value", {"text": linked, "value": list(linked)})
        screenshot("question-link-native.png")
        click('dialog form button[type="submit"]')
        wait_for(lambda: len(cmd("POST", "/elements", {"using": "css selector", "value": "dialog.catalogue"})) == 0, "link dialog closed after success", seconds=30)
        wait_for(lambda: "两数之和" in text("article h1"), "real question opened from normalized link", seconds=30)
        wait_for(lambda: text(code) == "// live CN draft persistence", "duplicate link keeps current draft")
        assert live_source.read_text() == "// live CN draft persistence", "link opening overwrote local source"

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
        click('[data-action="open-link"]')
        wait_for(lambda: element(link_input), "offline link input opened")
        cmd("POST", f"/element/{element(link_input)}/value", {"text": linked, "value": list(linked)})
        click('dialog form button[type="submit"]')
        wait_for(lambda: len(cmd("POST", "/elements", {"using": "css selector", "value": "dialog.catalogue"})) == 0, "offline cached link opened", seconds=30)
        wait_for(lambda: "已缓存题面" in text("article"), "offline fallback explicitly marked as cached")
        wait_for(lambda: text(code) == "// live CN draft persistence", "offline link keeps restored draft")
        assert live_source.read_text() == "// live CN draft persistence", "offline link overwrote source"
        screenshot("question-link-offline-native.png")
        if old_proxy is None: os.environ.pop("HTTPS_PROXY", None)
        else: os.environ["HTTPS_PROXY"] = old_proxy
        if old_no_proxy is None: os.environ.pop("NO_PROXY", None)
        else: os.environ["NO_PROXY"] = old_no_proxy
        (evidence/"LIVE_CN_RESULT.txt").write_text("PASS: real public CN search and question through native GUI, official Rust template, local source save, normalized question-link opening, duplicate draft preservation and offline link/cache recovery. No authenticated login, run or submit.\\n")
except Exception:
    subprocess.run(["scrot", str(evidence / "desktop-failure.png")], check=False)
    if session:
        try: screenshot("failure.png")
        except Exception: pass
    raise
finally:
    stop()
    driver.terminate()
    driver.wait(timeout=10)
