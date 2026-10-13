"""Linux WebKitGTK smoke test against the built native application, not a browser mock."""
import base64, json, os, pathlib, subprocess, time, urllib.request, urllib.error, http.client
BASE = "http://127.0.0.1:4444"
EID = "element-6066-11e4-a52e-4f735466cecf"
session = None
evidence = pathlib.Path("evidence/native")
evidence.mkdir(parents=True, exist_ok=True)
data = pathlib.Path(os.environ["XDG_DATA_HOME"])
class PublicServiceUnavailable(Exception): pass
(evidence/"LIVE_CN_RESULT.txt").write_text("NOT RUN: live public CN validation has not completed.\n")
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
def cmd(method, path, payload=None):
    replayable = method=="POST" and path=="/actions" and payload and all(
        action.get("type")=="key" and action.get("id","").endswith(("-completion","-source"))
        for action in payload.get("actions",[])
    )
    try: return request(method, f"/session/{session}" + path, payload)
    except http.client.RemoteDisconnected:
        if not replayable: raise
        # These sequences begin at Home/End and only request read-only language
        # information. Never replay debugger steps, text entry or online actions.
        with (evidence/"webdriver-transport-recovery.txt").open("a") as log:
            log.write("Recovered one WebKit transport reset in absolute-position language shortcut\n")
        request("DELETE",f"/session/{session}/actions")
        time.sleep(.3)
        return request(method, f"/session/{session}" + path, payload)
def element(css): return cmd("POST","/element",{"using":"css selector","value":css})[EID]
def text(css): return cmd("GET",f"/element/{element(css)}/text")
def click(css):
    try: return cmd("POST",f"/element/{element(css)}/click",{})
    except http.client.RemoteDisconnected:
        closing=css in (".source-viewer header button",".environments header button","dialog.environments header button",".local-runner header > button:last-child")
        selection=css.startswith("select[") and " option[value=" in css
        if not (closing or selection): raise
        with (evidence/"webdriver-transport-recovery.txt").open("a") as log:
            log.write(f"Checking idempotent test UI operation after WebKit connection reset: {css}\n")
        time.sleep(.3)
        if closing and not cmd("POST","/elements",{"using":"css selector","value":css}): return
        return cmd("POST",f"/element/{element(css)}/click",{})

def fill(css, value):
    # Only authored test-field replacement is replayable. Never replay a judge,
    # login, submission, or arbitrary click after an uncertain transport result.
    for attempt in range(2):
        try: return fill_once(css, value)
        except http.client.RemoteDisconnected:
            with (evidence/"webdriver-transport-recovery.txt").open("a") as log:
                log.write(f"sendKeys connection reset while replacing authored fixture: {css}; attempt={attempt+1}\n")
            if attempt: raise
            cmd("DELETE","/actions")  # release any modifier whose key-up was uncertain
            time.sleep(.3)
def fill_once(css, value):
    node=element(css)
    cmd("POST",f"/element/{node}/click",{})
    # Paste exercises the real OS clipboard path. Sending each line through
    # Enter would intentionally trigger editor indentation and bracket pairing.
    if value: subprocess.run(["xclip","-selection","clipboard"],input=value.encode("utf-8"),check=True)
    actions=[
        {"type":"keyDown","value":"\ue00c"},{"type":"keyUp","value":"\ue00c"},
        {"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"a"},{"type":"keyUp","value":"a"},{"type":"keyUp","value":"\ue009"}
    ]
    if value:
        actions += [{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"v"},{"type":"keyUp","value":"v"},{"type":"keyUp","value":"\ue009"}]
    else: actions += [{"type":"keyDown","value":"\ue003"},{"type":"keyUp","value":"\ue003"}]
    cmd("POST","/actions",{"actions":[{"type":"key","id":"keyboard","actions":actions}]})
    def editor_text():
        lines=cmd("POST",f"/element/{node}/elements",{"using":"css selector","value":".cm-line"})
        return "\n".join(cmd("GET",f"/element/{line[EID]}/text") for line in lines) if lines else cmd("GET",f"/element/{node}/property/value")
    wait_for(lambda: editor_text()==value,"GUI paste exactly preserves source")
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
        wait_for(lambda: all(text(f'.environment-tools [data-tool="{tool}"] [role="status"]') == "已安装" for tool in ["python","node","pyright","debugpy"]), "three verified private tools installed", seconds=300)
        screenshot("managed-environment-native.png")
        click(".environments header button")
        click('select[aria-label="编程语言"] option[value="python3"]')
        wait_for(lambda: "Pyright 已连接" in text(".lsp-status"), "real private language server connected", seconds=45)
        fill(code, "from collections import deque\nitems = deque([1, 2])\nitems.pop")
        python_source=source.with_name("solution.py")
        wait_for(lambda: python_source.exists() and python_source.read_text() == "from collections import deque\nitems = deque([1, 2])\nitems.pop", "multiline Python source persisted exactly")
        cmd("POST","/actions",{"actions":[{"type":"key","id":"lsp-keyboard","actions":[
            {"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":" "},{"type":"keyUp","value":" "},{"type":"keyUp","value":"\ue009"}
        ]}]})
        wait_for(lambda: "popleft" in text(".cm-tooltip-autocomplete"), "real stdlib member completion", seconds=30)
        screenshot("python-completion-native.png")
        time.sleep(.3)  # Completion widgets intentionally ignore accidental clicks immediately after opening.
        def choose_completion():
            option=cmd("POST","/element",{"using":"xpath","value":"//li[@role='option'][contains(.,'popleft')]"})[EID]
            try: cmd("POST",f"/element/{option}/click",{})
            except RuntimeError as error:
                if "stale element reference" in str(error): return False
                raise
            return True
        wait_for(choose_completion, "apply freshly located completion")
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
        fill(code, "sum([1, 2])")
        cmd("POST","/actions",{"actions":[{"type":"key","id":"signature-keyboard","actions":[
            {"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue010"},{"type":"keyUp","value":"\ue010"},{"type":"keyUp","value":"\ue009"},
            {"type":"keyDown","value":"\ue012"},{"type":"keyUp","value":"\ue012"},
            {"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue008"},{"type":"keyDown","value":" "},{"type":"keyUp","value":" "},{"type":"keyUp","value":"\ue008"},{"type":"keyUp","value":"\ue009"}
        ]}]})
        wait_for(lambda: "iterable" in text(".lsp-signature"), "real Pyright signature parameter help", seconds=30)
        screenshot("python-signature-native.png")
        fill(code, 'bad: int = "wrong"')
        wait_for(lambda: element(".cm-lintRange-error"), "real Pyright type diagnostic", seconds=30)
        screenshot("python-diagnostics-native.png")
        fill(code, "def solve(values): return sum(values)")
        click(".actions button:first-child")
        wait_for(lambda: element('[aria-label="本地测试输入"]'), "local runner opened")
        click('[data-action="local-execute"]')
        wait_for(lambda: '"value": 10' in text(".local-result"), "real private Python harness result", seconds=30)
        assert "不代表通过力扣判题" in text(".local-runner")
        screenshot("python-local-run-native.png")
        (evidence/"LOCAL_RUN_RESULT.txt").write_text("PASS: actual native GUI starts a private Python function harness and displays computed result 10. No online verdict.\n")
        click('[data-local-tab="debug"]')
        click(code)
        cmd("POST","/actions",{"actions":[{"type":"key","id":"debug-keys","actions":[{"type":"keyDown","value":"\ue039"},{"type":"keyUp","value":"\ue039"}]}]})
        wait_for(lambda: "断点：1。" in text(".debug-panel"), "F9 breakpoint in source")
        click(".debug-panel .local-actions button:first-of-type")
        wait_for(lambda: "已暂停" in text(".debug-panel"), "real debugger breakpoint", seconds=45)
        wait_for(lambda: element(".debug-inspector > div:first-child > button"), "real call stack loaded")
        click(".debug-inspector > div:first-child > button")
        wait_for(lambda: element(".debug-variable"), "real variable values loaded")
        wait_for(lambda: element(".cm-debug-stopped"), "paused source line highlighted")
        screenshot("python-debug-native.png")
        (evidence/"DEBUG_GUI_RESULT.txt").write_text("PASS: real Linux GUI private debugpy, F9 breakpoint and paused call stack inspector. Stepping verified separately by protocol probe.\n")
        click(code)
        cmd("POST","/actions",{"actions":[{"type":"key","id":"debug-update-keys","actions":[{"type":"keyDown","value":"\ue039"},{"type":"keyUp","value":"\ue039"}]}]})
        apply_points=cmd("POST","/element",{"using":"xpath","value":"//button[text()='应用断点']"})[EID]
        cmd("POST",f"/element/{apply_points}/click",{})
        wait_for(lambda: "断点已更新" in text(".debug-panel"), "live debugger accepts cleared breakpoints")
        cmd("POST","/actions",{"actions":[{"type":"key","id":"debug-stop-keys","actions":[{"type":"keyDown","value":"\ue008"},{"type":"keyDown","value":"\ue035"},{"type":"keyUp","value":"\ue035"},{"type":"keyUp","value":"\ue008"}]}]})
        wait_for(lambda: "调试结束" in text(".debug-panel"), "debugger stopped")
        click(".local-runner header button")
        click('[data-action="open-environments"]')
        wait_for(lambda: element('select[aria-label="开发环境语言"]'), "language-specific tool groups")
        click('select[aria-label="开发环境语言"] option[value="java"]')
        click(".environment-summary button")
        wait_for(lambda: all(text(f'.environment-tools [data-tool="{tool}"] [role="status"]') == "已安装" for tool in ["jdk","jdtls"]), "verified private JDK and JDTLS installed", seconds=300)
        screenshot("java-environment-native.png")
        click(".environments header button")
        click('select[aria-label="编程语言"] option[value="java"]')
        wait_for(lambda: "JDT LS 已连接" in text(".lsp-status"), "real private Java language server connected", seconds=100)
        java_doc="class Solution { void test() { java.util.ArrayList<String> values = new java.util.ArrayList<>(); values. } }"
        fill(code,java_doc)
        keys=[{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue010"},{"type":"keyUp","value":"\ue010"},{"type":"keyUp","value":"\ue009"}]
        for _ in range(4): keys += [{"type":"keyDown","value":"\ue012"},{"type":"keyUp","value":"\ue012"}]
        keys += [{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":" "},{"type":"keyUp","value":" "},{"type":"keyUp","value":"\ue009"}]
        cmd("POST","/actions",{"actions":[{"type":"key","id":"java-completion","actions":keys}]})
        wait_for(lambda: "add(" in text(".cm-tooltip-autocomplete"), "real Java ArrayList member completion", seconds=45)
        screenshot("java-completion-native.png")
        keys=[{"type":"keyDown","value":"\ue00c"},{"type":"keyUp","value":"\ue00c"},{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue011"},{"type":"keyUp","value":"\ue011"},{"type":"keyUp","value":"\ue009"}]
        for _ in range(java_doc.index("ArrayList")+3): keys += [{"type":"keyDown","value":"\ue014"},{"type":"keyUp","value":"\ue014"}]
        keys += [{"type":"keyDown","value":"\ue03c"},{"type":"keyUp","value":"\ue03c"}]
        cmd("POST","/actions",{"actions":[{"type":"key","id":"java-source","actions":keys}]})
        wait_for(lambda: element(".source-viewer"), "Java standard library source viewer", seconds=45)
        wait_for(lambda: "ArrayList.java" in text(".source-viewer header"), "real ArrayList source name")
        screenshot("java-stdlib-native.png")
        click(".source-viewer header button")
        java_solution="class Solution {\n public int solve(int[] values) {\n int total=0;for(int value:values){total+=value;}\n return total;\n }\n}"
        fill(code,java_solution)
        click(".pane-heading .actions button")
        click('[data-local-tab="run"]')
        fill('[aria-label="本地测试输入"]',"[3,-1,8]")
        click('[data-action="local-execute"]')
        wait_for(lambda: '"value":10' in text(".local-result").replace(" ",""),"Java private compilation and exact typed result",seconds=150)
        screenshot("java-local-run-native.png")
        java_saved=data/"top.jacek.inkleet/notebook/sample-sum/solution.java"
        wait_for(lambda: java_saved.exists() and java_saved.read_text()==java_solution,"Java run preserves original saved source")
        (evidence/"JAVA_LOCAL_GUI_RESULT.txt").write_text("PASS: actual Linux GUI private JDK compiles the typed Java Solution harness, computes exact value 10 and preserves original draft. No debugger or online verdict.\n")
        click(".local-runner header > button:last-child")
        (evidence/"JAVA_GUI_RESULT.txt").write_text("PASS: actual Linux GUI private JDK/JDTLS install, ArrayList member completion and F12 read-only standard library source. Separate three-platform protocol checks compare returned source byte-for-byte with private JDK src.zip.\n")
        click('select[aria-label="编程语言"] option[value="rust"]')
        wait_for(lambda: text(code) == marker, "switching away preserves Rust draft and stops Python session")

        # Real application-owned Go and Rust language services, not mocked IPC.
        for group,language,server,code_text,member,definition_word,source_name in [
            ("golang","golang","gopls",'import "strings"; func example() { var builder strings.Builder; builder. }',"WriteString","Builder","builder.go"),
            ("rust","rust","rust-analyzer","fn example() { let mut values = Vec::<i32>::new(); values.pu }","push","Vec","mod.rs"),
            ("cpp","cpp","clangd","void example() { vector<int> values; values.pu }","push_back","vector","vector.h"),
            ("c","c","clangd",'void example(void) { printf(""); struct { int value; } pair; pair.va }',"value","printf","stdio.h"),
        ]:
            click('[data-action="open-environments"]')
            wait_for(lambda: element("dialog.environments"), "environment dialog")
            environment_group="cpp" if group=="c" else group
            click(f'select[aria-label="开发环境语言"] option[value="{environment_group}"]')
            click(".environment-summary button")
            wait_for(lambda: all("已安装" in text(f'[data-tool="{tool}"]') for tool in (
                {"golang":["go","gopls","delve"],"rust":["rustc","cargo","rust-std","rust-src","rust-analyzer-preview","zig","codelldb"],"cpp":["zig","clangd","codelldb"],"c":["zig","clangd","codelldb"]}[group]
            )),f"{group} managed installation",seconds=720)
            click("dialog.environments header button")
            click(f'select[aria-label="编程语言"] option[value="{language}"]')
            wait_for(lambda: server+" 已连接" in text(".lsp-status"),f"{group} connected",seconds=90)
            fill(code,code_text)
            keys=[{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue010"},{"type":"keyUp","value":"\ue010"},{"type":"keyUp","value":"\ue009"}]
            for _ in range(2): keys += [{"type":"keyDown","value":"\ue012"},{"type":"keyUp","value":"\ue012"}]
            keys += [{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":" "},{"type":"keyUp","value":" "},{"type":"keyUp","value":"\ue009"}]
            cmd("POST","/actions",{"actions":[{"type":"key","id":group+"-completion","actions":keys}]})
            wait_for(lambda: member in text(".cm-tooltip-autocomplete"),f"real {group} member completion",seconds=90)
            screenshot(group+"-completion-native.png")
            keys=[{"type":"keyDown","value":"\ue00c"},{"type":"keyUp","value":"\ue00c"},{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue011"},{"type":"keyUp","value":"\ue011"},{"type":"keyUp","value":"\ue009"}]
            for _ in range(code_text.index(definition_word)+1): keys += [{"type":"keyDown","value":"\ue014"},{"type":"keyUp","value":"\ue014"}]
            keys += [{"type":"keyDown","value":"\ue03c"},{"type":"keyUp","value":"\ue03c"}]
            cmd("POST","/actions",{"actions":[{"type":"key","id":group+"-source","actions":keys}]})
            wait_for(lambda: element(".source-viewer"),f"{group} source viewer",seconds=90)
            screenshot(group+"-stdlib-native.png")
            click(".source-viewer header button")
            wait_for(lambda: not cmd("POST","/elements",{"using":"css selector","value":".source-viewer"}),f"{group} source viewer closed")
            assert text(code)==code_text, "Language scaffolding must not change the draft"
            (evidence/(group.upper()+"_GUI_RESULT.txt")).write_text(f"PASS: real Linux client installs private {group} tools, member completion, F12 stdlib source and unchanged draft. No local execution or debugger assertion.\n")
            if group in ("golang","cpp","c","rust"):
                local_solution="func solve(values []int) int {\n total:=0\n for _,value:=range values { total+=value }\n return total\n}"
                if group=="cpp": local_solution="int solve(vector<int>& values) {\n int total=0;\n for(int value:values){total+=value;}\n return total;\n}"
                if group=="c": local_solution="int solve(int* values,int valuesSize) {\n int total=0;\n for(int i=0;i<valuesSize;i++){total+=values[i];}\n return total;\n}"
                if group=="rust": local_solution="fn solve(values: Vec<i32>) -> i32 {\n let mut total=0;\n for value in values {total+=value;}\n total\n}"
                fill(code,local_solution)
                if not cmd("POST","/elements",{"using":"css selector","value":".local-runner"}):
                    click(".pane-heading .actions button")
                click('[data-local-tab="run"]')
                fill('[aria-label="本地测试输入"]',"[3,-1,8]")
                click('[data-action="local-execute"]')
                wait_for(lambda: '"value":10' in text(".local-result").replace(" ",""),f"{group} private compilation and typed local result",seconds=280)
                screenshot(group+"-local-run-native.png")
                saved_solution=data/("top.jacek.inkleet/notebook/sample-sum/solution."+({"golang":"go","cpp":"cpp","c":"c","rust":"rs"}[group]))
                wait_for(lambda: saved_solution.exists() and saved_solution.read_text()==local_solution,f"{group} local run preserves exact saved source")
                (evidence/(group.upper()+"_LOCAL_GUI_RESULT.txt")).write_text(f"PASS: actual Linux GUI compiles a {group} solution using its private downloaded toolchain, executes the bounded typed harness and returns exact value 10. No online judge verdict.\n")
                click('[data-local-tab="debug"]')
                click(code)
                keys=[{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue011"},{"type":"keyUp","value":"\ue011"},{"type":"keyUp","value":"\ue009"}]
                for _ in range(2): keys += [{"type":"keyDown","value":"\ue015"},{"type":"keyUp","value":"\ue015"}]
                keys += [{"type":"keyDown","value":"\ue039"},{"type":"keyUp","value":"\ue039"}]
                cmd("POST","/actions",{"actions":[{"type":"key","id":"go-debug-breakpoint","actions":keys}]})
                wait_for(lambda: "断点：3。" in text(".debug-panel"),f"{group} breakpoint uses original source line")
                click(".debug-panel .local-actions button:first-of-type")
                wait_for(lambda: "已暂停" in text(".debug-panel"),f"{group} debug compiler and real breakpoint",seconds=280)
                wait_for(lambda: element(".cm-debug-stopped"),f"{group} original source pause highlight")
                def local_total():
                    node=cmd("POST","/element",{"using":"xpath","value":"//div[contains(@class,'debug-variable')][button[normalize-space(text())='total']]/code"})[EID]
                    return cmd("GET",f"/element/{node}/text")
                wait_for(lambda: local_total()=="0",f"{group} initial local variable value")
                screenshot(group+"-debug-native.png")
                for _ in range(3):
                    click(code)
                    cmd("POST","/actions",{"actions":[{"type":"key","id":"go-debug-step","actions":[{"type":"keyDown","value":"\ue03a"},{"type":"keyUp","value":"\ue03a"}]}]})
                    time.sleep(.7)
                    if local_total()!="0": break
                assert local_total()!="0",f"{group} variables did not update after stepping"
                cmd("POST","/actions",{"actions":[{"type":"key","id":"go-debug-stop","actions":[{"type":"keyDown","value":"\ue008"},{"type":"keyDown","value":"\ue035"},{"type":"keyUp","value":"\ue035"},{"type":"keyUp","value":"\ue008"}]}]})
                wait_for(lambda: "调试结束" in text(".debug-panel"),f"{group} debugger stop")
                (evidence/(group.upper()+"_DEBUG_GUI_RESULT.txt")).write_text(f"PASS: actual private {group} debugger GUI launch, original source breakpoint line 3, paused source highlight, local total=0, real F10 variable update and Shift+F5 termination.\n")
                click(".local-runner header > button:last-child")
                fill(code,code_text)

        click('select[aria-label="编程语言"] option[value="rust"]')
        fill(code,marker)

        (evidence/"MANAGED_IDE_RESULT.txt").write_text("PASS: actual Linux native GUI tool installation, managed Python/Node/Pyright, member completion, F12 stdlib declaration viewer, type diagnostics and draft-preserving language switch. No debugger verification.\n")
    if os.environ.get("INKLEET_LIVE_CN") == "1":
        click('[data-action="open-catalogue"]')
        search = '[aria-label="搜索中国站题目"]'
        wait_for(lambda: element(search), "catalogue opened")
        cmd("POST", f"/element/{element(search)}/value", {"text": "two sum", "value": list("two sum")})
        click('dialog form button[type="submit"]')
        def live_search_outcome():
            results=cmd("POST","/elements",{"using":"css selector","value":'dialog button[data-slug="two-sum"]'})
            if results: return ("result",None)
            alerts=cmd("POST","/elements",{"using":"css selector","value":'dialog [role="alert"]'})
            if alerts:
                message=cmd("GET",f"/element/{alerts[0][EID]}/text")
                # Only the known upstream access-denied state is environmental.
                # Unknown UI errors, parsing failures and timeouts remain failures.
                if "中国站拒绝访问" in message: return ("blocked",message)
            return None
        outcome,reason=wait_for(live_search_outcome, "live Chinese search result or explicit upstream denial", seconds=30)
        if outcome=="blocked":
            screenshot("public-unavailable-native.png")
            assert text(code)==marker, "Denied search changed current editor draft"
            preserved=data/"top.jacek.inkleet/notebook/sample-sum/solution.rs"
            wait_for(lambda: preserved.read_text()==marker,"Denied search preserves saved source")
            click(".catalogue-heading button")
            raise PublicServiceUnavailable(reason)
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
except PublicServiceUnavailable as error:
    (evidence/"LIVE_CN_RESULT.txt").write_text("UNVERIFIED: public LeetCode CN access denied during live GUI search. Local IDE checks completed; current source preserved. Fresh online question/link/cache sequence not run. " + str(error) + "\n")
    print("::warning::Live public LeetCode CN verification blocked by upstream access denial; not a passing online or authentication result.",flush=True)
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
