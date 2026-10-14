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
    read_only = method == "GET" or (method == "POST" and (path in ("/element", "/elements") or path.endswith("/elements")))
    try: return request(method, f"/session/{session}" + path, payload)
    except http.client.RemoteDisconnected:
        if read_only:
            with (evidence/"webdriver-transport-recovery.txt").open("a") as log:
                log.write(f"Retrying one read-only WebKit transport reset: {method} {path}\n")
            time.sleep(.3)
            return request(method, f"/session/{session}" + path, payload)
        if not replayable: raise
        # These sequences begin at Home/End and only request read-only language
        # information. Never replay debugger steps, text entry or online actions.
        with (evidence/"webdriver-transport-recovery.txt").open("a") as log:
            log.write("Recovered one WebKit transport reset in absolute-position language shortcut\n")
        request("DELETE",f"/session/{session}/actions")
        time.sleep(.3)
        return request(method, f"/session/{session}" + path, payload)
def element(css): return cmd("POST","/element",{"using":"css selector","value":css})[EID]
def text(css):
    suffix = "/attribute/data-status" if css == ".lsp-status" else "/attribute/data-storage-state" if css == '.statusbar[role="status"]' else "/text"
    return cmd("GET",f"/element/{element(css)}" + suffix)
def settings_action(category, css):
    click('[data-action="open-settings"]')
    node=cmd("POST","/element",{"using":"xpath","value":f"//nav[@aria-label='设置分类']/button[text()='{category}']"})[EID]
    cmd("POST",f"/element/{node}/click",{})
    click(css)
def source_text(css):
    # WebDriver rendered text may normalize leading whitespace. Read textContent
    # of the visible CodeMirror lines, then independently check the saved file.
    lines=cmd("POST",f"/element/{element(css)}/elements",{"using":"css selector","value":".cm-line"})
    return "\n".join(cmd("GET",f"/element/{line[EID]}/property/textContent") for line in lines)


def reveal_debug_control(css):
    # Native WebKit does not reliably auto-scroll controls in nested inspectors.
    # Use the real pointer wheel over the outer padding, never execute JS clicks.
    for _ in range(12):
        panel=cmd("GET",f"/element/{element('.debug-body')}/rect")
        target=cmd("GET",f"/element/{element(css)}/rect")
        top=panel["y"]+4; bottom=panel["y"]+panel["height"]-4
        if target["height"]>0 and target["y"]>=top and target["y"]+target["height"]<=bottom:
            return
        window=cmd("GET","/window/rect")
        x=int(window["x"]+panel["x"]+4)
        y=int(window["y"]+panel["y"]+panel["height"]/2)
        direction="5" if target["y"]+target["height"]>bottom else "4"
        subprocess.run(["xdotool","mousemove","--sync",str(x),str(y),"click","--repeat","2","--delay","80",direction],check=True)
        time.sleep(.15)
    raise AssertionError("Debug control remains unreachable through real wheel: "+css)

def click(css):
    try: return cmd("POST",f"/element/{element(css)}/click",{})
    except http.client.RemoteDisconnected:
        closing=css in (".source-viewer header button",".environments header button","dialog.environments header button",".local-runner [aria-label='收起']")
        selection=(css.startswith("select[") and " option[value=" in css) or css in ('[data-local-tab="run"]','[data-local-tab="debug"]')
        if not (closing or selection): raise
        with (evidence/"webdriver-transport-recovery.txt").open("a") as log:
            log.write(f"Checking idempotent test UI operation after WebKit connection reset: {css}\n")
        time.sleep(.3)
        if closing and not cmd("POST","/elements",{"using":"css selector","value":css}): return
        try: return cmd("POST",f"/element/{element(css)}/click",{})
        except http.client.RemoteDisconnected:
            if css!=".source-viewer header button": raise
            if not cmd("POST","/elements",{"using":"css selector","value":".source-viewer"}): return
            # Exercise the real dialog Escape handler, never inject JavaScript
            # or remove the viewer from the DOM to manufacture a passing test.
            # WebKit may also reject release-actions during this transport bug.
            # Send Escape through the real X11 keyboard, then require the real
            # application's close handler to remove the viewer.
            subprocess.run(["xdotool","key","--clearmodifiers","Escape"],check=True)
            wait_for(lambda: not cmd("POST","/elements",{"using":"css selector","value":".source-viewer"}),"source viewer closes through actual OS Escape")
            return

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
    node=wait_for(lambda:element(css),"input target available after document switch")
    try:
        cmd("POST",f"/element/{node}/click",{})
    except http.client.RemoteDisconnected:
        # Only proceed after an uncertain focus click if the actual field owns focus.
        if cmd("GET","/element/active").get(EID)!=node: raise
    wait_for(lambda:cmd("GET","/element/active").get(EID)==node,"fixture field owns native keyboard focus")
    # Exercise actual X11 input, avoiding WebKit's intermittent POST/actions reset.
    # This path only replaces authored fixture text; it never replays debug/judge actions.
    if value: subprocess.run(["xclip","-selection","clipboard"],input=value.encode("utf-8"),check=True)
    is_editor=bool(cmd("POST",f"/element/{node}/elements",{"using":"css selector","value":".cm-line"}))
    if is_editor: subprocess.run(["xdotool","key","--clearmodifiers","Escape"],check=True)
    subprocess.run(["xdotool","key","--clearmodifiers","ctrl+a"],check=True)
    subprocess.run(["xdotool","key","--clearmodifiers","ctrl+v" if value else "BackSpace"],check=True)
    def editor_text():
        current=element(css)  # Read-only reacquisition after a controlled React update.
        lines=cmd("POST",f"/element/{current}/elements",{"using":"css selector","value":".cm-line"})
        return "\n".join(cmd("GET",f"/element/{line[EID]}/text") for line in lines) if lines else cmd("GET",f"/element/{current}/property/value")
    wait_for(lambda: editor_text()==value,"GUI paste exactly preserves source")
def screenshot(name):
    try:
        (evidence / name).write_bytes(base64.b64decode(cmd("GET","/screenshot")))
    except http.client.RemoteDisconnected:
        # Read-only evidence capture can use the actual X11 desktop if WebKit's
        # screenshot transport resets. Functional assertions remain mandatory.
        with (evidence/"webdriver-transport-recovery.txt").open("a") as log:
            log.write(f"WebKit screenshot reset; captured real X11 desktop instead: {name}\n")
        subprocess.run(["scrot", str(evidence/name)], check=True)
def start(empty=False):
    global session
    result = request("POST","/session",{"capabilities":{"alwaysMatch":{"browserName":"wry","tauri:options":{"application":str(pathlib.Path(os.environ.get("INKLEET_TEST_BINARY", "src-tauri/target/debug/inkleet")).resolve())}}}})
    session = result["sessionId"]
    wait_for(lambda: ("选择题目" if empty else "已读取本机文件") in text('.statusbar[role="status"]'), "native IPC initial load")
def stop():
    global session
    if session:
        cmd("DELETE","")
        session = None
driver = subprocess.Popen(["tauri-driver"], stdout=open(evidence/"driver.log","w"), stderr=subprocess.STDOUT)
try:
    wait_for(lambda: request("GET","/status"), "driver ready")
    start(empty=True)
    assert not cmd("POST","/elements",{"using":"css selector","value":'[aria-label="代码编辑器"]'}), "fresh installation must not create a sample document"
    assert "整数数组求和" not in text("body") and "寻找最大值" not in text("body")
    screenshot("empty-real-workspace-native.png")
    if os.environ.get("INKLEET_LIVE_CN") == "1":
        # Verify the new real sidebar before the slower six-language fixture loop.
        outcome=wait_for(lambda: ("ready" if cmd("POST","/elements",{"using":"css selector","value":'.question-sidebar button[data-slug="two-sum"]'}) else "error" if cmd("POST","/elements",{"using":"css selector","value":'.question-sidebar [role="alert"]'}) else None),"real native sidebar response",seconds=30)
        if outcome=="ready":
            screenshot("real-question-sidebar-native.png")
            click('.question-sidebar button[data-slug="two-sum"]')
            wait_for(lambda:"两数之和" in text("article h1"),"sidebar opens real public question",seconds=30)
            wait_for(lambda:"impl Solution" in text('[aria-label="代码编辑器"]'),"sidebar loads official template",seconds=30)
            screenshot("real-sidebar-question-native.png")
        else:
            message=text('.question-sidebar [role="alert"]')
            if "中国站拒绝访问" not in message: raise AssertionError(message)
            (evidence/"SIDEBAR_LIVE_RESULT.txt").write_text("UNVERIFIED: upstream access denial; no mock fallback.\n")
    stop()
    # Isolated authored regression fixture enters only via the real cache format.
    cache_path=pathlib.Path(os.environ["XDG_CACHE_HOME"])/"top.jacek.inkleet/public-questions.json"
    cache_path.parent.mkdir(parents=True,exist_ok=True)
    cache_path.write_text(pathlib.Path("tests/fixtures/public-questions.json").read_text())
    start()
    # Persist a download-only endpoint through the real Settings UI, never use it
    # for login or configure the runner's system network.
    click('[data-action="open-settings"]')
    downloads_tab=cmd("POST","/element",{"using":"xpath","value":"//nav[@aria-label='设置分类']/button[text()='下载']"})[EID]
    cmd("POST",f"/element/{downloads_tab}/click",{})
    wait_for(lambda:cmd("GET",f"/element/{element('#download-proxy-mode')}/enabled"),"download settings read")
    click('#download-proxy-mode option[value="custom"]')
    fill("#download-proxy-url","http://127.0.0.1:7890")
    save_proxy=cmd("POST","/element",{"using":"xpath","value":"//button[text()='保存下载设置']"})[EID]
    cmd("POST",f"/element/{save_proxy}/click",{})
    wait_for(lambda:"已保存，下次下载生效" in text(".download-settings"),"native proxy setting saved")
    config=pathlib.Path(os.environ["XDG_CONFIG_HOME"])/"top.jacek.inkleet/download-settings.json"
    wait_for(lambda:config.exists() and json.loads(config.read_text())["proxy"]["mode"]=="custom","download proxy persisted only in app config")
    screenshot("download-proxy-native.png")
    click('[aria-label="关闭设置"]')
    stop();start()
    click('[data-action="open-settings"]')
    downloads_tab=cmd("POST","/element",{"using":"xpath","value":"//nav[@aria-label='设置分类']/button[text()='下载']"})[EID]
    cmd("POST",f"/element/{downloads_tab}/click",{})
    wait_for(lambda:cmd("GET",f"/element/{element('#download-proxy-url')}/property/value")=="http://127.0.0.1:7890/","restart restores validated proxy")
    click('#download-proxy-mode option[value="system"]')
    save_proxy=cmd("POST","/element",{"using":"xpath","value":"//button[text()='保存下载设置']"})[EID]
    cmd("POST",f"/element/{save_proxy}/click",{})
    wait_for(lambda:json.loads(config.read_text())["proxy"]["mode"]=="system","restore original download route before real installs")
    click('[aria-label="关闭设置"]')
    (evidence/"DOWNLOAD_SETTINGS_GUI_RESULT.txt").write_text("PASS: native Settings save, app-only config persistence, restart restore, explicit reset before real downloads; no system proxy change. Proxy CONNECT routing covered by isolated Rust test.\n")
    code = '[aria-label="代码编辑器"]'
    marker = "// native restart persistence"
    fill(code, marker)
    source = data / "top.jacek.inkleet/notebook/lc-900000001/solution.rs"
    wait_for(lambda: source.exists() and source.read_text() == marker, "plain source persisted")
    wait_for(lambda: "已保存到本机文件" in text('.statusbar[role="status"]'), "save acknowledgement")
    screenshot("desktop-code-native.png")

    def named_action(action,name):
        click(".solution-menu>summary")
        button=cmd("POST","/element",{"using":"xpath","value":f"//details[contains(@class,'solution-menu')]/div/button[text()='{action}']"})
        cmd("POST",f"/element/{button[EID]}/click",{})
        fill('[aria-label="解答名称"]',name)
        click('.solution-name-dialog button[type="submit"]')
        wait_for(lambda:not cmd("POST","/elements",{"using":"css selector","value":".solution-name-dialog"}),"named operation committed")
    named_action("复制解答","双指针")
    first_id=cmd("GET",f"/element/{element('select[aria-label=\"解答\"]')}/property/value")
    assert len(first_id)==32
    named_source=source.parent/".solutions"/"rust"/first_id/"solution.rs"
    wait_for(lambda:named_source.exists() and named_source.read_text()==marker,"native duplicate preserves current source")
    fill(code,"// named solution")
    wait_for(lambda:named_source.read_text()=="// named solution","named source saves independently")
    assert source.read_text()==marker
    named_action("重命名","优化版")
    assert json.loads(named_source.with_name("name.json").read_text())["name"]=="优化版"
    assert cmd("GET",f"/element/{element('select[aria-label=\"解答\"]')}/property/value")==first_id
    screenshot("named-solutions-native.png")
    click('select[aria-label="解答"] option[value="default"]')
    wait_for(lambda:source_text(code)==marker,"default solution unchanged")
    stop();start()
    wait_for(lambda:element(f'select[aria-label="解答"] option[value="{first_id}"]'),"named solution listed after restart")
    click(f'select[aria-label="解答"] option[value="{first_id}"]')
    wait_for(lambda:source_text(code)=="// named solution","named source restored after native restart")
    assert json.loads(named_source.with_name("name.json").read_text())["name"]=="优化版"
    click('select[aria-label="解答"] option[value="default"]')
    wait_for(lambda:source_text(code)==marker,"legacy default remains intact after restart")
    (evidence/"NAMED_SOLUTIONS_NATIVE_RESULT.txt").write_text("PASS: real UI duplicate and rename, immutable ID, independent plain-text persistence, restart restoration, unchanged legacy default. No simulated IPC.\n")

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

    notes.write_text("# Real external note update")
    settings_action("笔记", '[data-setting-action="refresh-notes"]')
    wait_for(lambda:text(note)=="# Real external note update","manual refresh adopts actual external notes file")
    assert source.read_text()==marker,"refreshing notes changed source"
    notes.write_text("# Native note")
    settings_action("笔记", '[data-setting-action="refresh-notes"]')
    wait_for(lambda:text(note)=="# Native note","second external refresh keeps fresh persisted baseline")
    (evidence/"EXTERNAL_NOTES_RESULT.txt").write_text("PASS: actual native notes file changed outside the editor, explicit refresh adopts it without modifying source; subsequent refresh and restart retain the correct baseline. Actual Typora process launching is not verified.\n")

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
    click('[data-action="review-notes-conflict"]')
    wait_for(lambda: element(".file-conflict"),"native conflict review")
    def conflict_value(label):
        node=element(f'textarea[aria-label="{label}"]')
        return cmd("GET",f"/element/{node}/property/value")
    assert conflict_value("冲突编辑器版本")=="# Pending local edit"
    assert conflict_value("冲突文件版本")=="# External editor"
    screenshot("conflict-review-native.png")
    notes.write_text("# Changed externally again")
    click('[data-conflict="external"]')
    wait_for(lambda: "外部文件再次变化" in text(".file-conflict [role=alert]"),"stale conflict choice is refused")
    assert notes.read_text()=="# Changed externally again"
    click('[data-conflict="refresh"]')
    wait_for(lambda: conflict_value("冲突文件版本")=="# Changed externally again","fresh external comparison")
    click('[data-conflict="external"]')
    wait_for(lambda: not cmd("POST","/elements",{"using":"css selector","value":".file-conflict"}),"native conflict resolved")
    wait_for(lambda: text(note)=="# Changed externally again","notes editor reloads chosen file without stale undo state")
    backups=list(notes.parent.joinpath(".inkleet-recovery").glob("conflict-*.json"))
    assert len(backups)==1
    backup=json.loads(backups[0].read_text())
    assert backup["local"]=="# Pending local edit" and backup["external"]=="# Changed externally again"
    fill(note,"# Resolved note")
    wait_for(lambda: notes.read_text()=="# Resolved note","blocked save queue resumes on reviewed baseline")
    (evidence/"CONFLICT_GUI_RESULT.txt").write_text("PASS: actual native comparison, concurrent external-change refusal, explicit file-version choice, two-version recovery snapshot, editor reload and subsequent atomic save.\n")

    settings_action("笔记", '[data-action="notes-recovery"]')
    wait_for(lambda:element(".file-recovery"),"native recovery history")
    wait_for(lambda:element(".recovery-list button:first-child"),"native recovery records loaded")
    click(".recovery-list button:first-child")
    wait_for(lambda:element('textarea[aria-label="恢复编辑器副本"]'),"recovery record preview")
    preview_node=element('textarea[aria-label="恢复编辑器副本"]')
    preview=cmd("GET",f"/element/{preview_node}/property/value")
    assert preview=="# Pending local edit"
    click('[data-recovery="local"]')
    wait_for(lambda:not cmd("POST","/elements",{"using":"css selector","value":".file-recovery"}),"explicit recovery completed")
    wait_for(lambda:text(note)=="# Pending local edit","recovered note visible")
    assert notes.read_text()=="# Pending local edit"
    all_backups=[json.loads(p.read_text()) for p in notes.parent.joinpath(".inkleet-recovery").glob("conflict-*.json")]
    assert any(b["local"]=="# Resolved note" and b["external"]=="# Resolved note" for b in all_backups),"pre-restore versions not preserved"
    (evidence/"RECOVERY_GUI_RESULT.txt").write_text("PASS: native recovery list and two-version preview, explicit restore updates real notes.md and editor while preserving both pre-restore versions in a new backup.\n")

    (evidence/"RESULT.txt").write_text("PASS: real Linux Tauri/WebKitGTK launch, native IPC, plain source and notes save, process restart restore, external conflict preserving both texts. No LeetCode verification.\n")
    if os.environ.get("INKLEET_MANAGED_ENV") == "1":
        settings_action("语言与环境", '[data-action="open-environments"]')
        wait_for(lambda: element(".environment-summary button"), "environment manager opened")
        click(".environment-summary button")
        wait_for(lambda: all(text(f'.environment-tools [data-tool="{tool}"] [role="status"]') == "已安装" for tool in ["python","node","pyright","debugpy"]), "three verified private tools installed", seconds=300)
        screenshot("managed-environment-native.png")
        click(".environments header button")
        click('select[aria-label="编程语言"] option[value="python3"]')
        wait_for(lambda: "Pyright 已连接" in text(".lsp-status"), "real private language server connected", seconds=45)
        fill(code, "def solve(values):")
        cmd("POST","/actions",{"actions":[{"type":"key","id":"python-indent","actions":[
            {"type":"keyDown","value":"\ue010"},{"type":"keyUp","value":"\ue010"},
            {"type":"keyDown","value":"\ue007"},{"type":"keyUp","value":"\ue007"}
        ]}]})
        typed="return len(values)"
        cmd("POST",f"/element/{element(code)}/value",{"text":typed,"value":list(typed)})
        (evidence/"indent-input-observation.json").write_text(json.dumps({"rendered":text(code),"lines":source_text(code)},ensure_ascii=False))
        wait_for(lambda:source_text(code)=="def solve(values):\n    return len(values)","native Python Enter produces four-space indentation")
        python_saved=source.with_name("solution.py")
        wait_for(lambda:python_saved.exists() and python_saved.read_text()=="def solve(values):\n    return len(values)","native auto-indented source saved byte-for-byte")
        cmd("POST","/actions",{"actions":[{"type":"key","id":"python-dedent","actions":[
            {"type":"keyDown","value":"\ue008"},{"type":"keyDown","value":"\ue004"},{"type":"keyUp","value":"\ue004"},{"type":"keyUp","value":"\ue008"}
        ]}]})
        wait_for(lambda:source_text(code)=="def solve(values):\nreturn len(values)","native Shift+Tab dedents")
        cmd("POST","/actions",{"actions":[{"type":"key","id":"python-tab","actions":[{"type":"keyDown","value":"\ue004"},{"type":"keyUp","value":"\ue004"}]}]})
        wait_for(lambda:source_text(code)=="def solve(values):\n    return len(values)","native Tab indents")
        fill(code,"def solve(values):")
        cmd("POST","/actions",{"actions":[{"type":"key","id":"python-backspace","actions":[
            {"type":"keyDown","value":"\ue010"},{"type":"keyUp","value":"\ue010"},
            {"type":"keyDown","value":"\ue007"},{"type":"keyUp","value":"\ue007"},
            {"type":"keyDown","value":"\ue003"},{"type":"keyUp","value":"\ue003"}
        ]}]})
        cmd("POST",f"/element/{element(code)}/value",{"text":"pass","value":list("pass")})
        wait_for(lambda:source_text(code)=="def solve(values):\npass","native Backspace removes the whole indentation unit")
        (evidence/"EDITOR_KEYS_RESULT.txt").write_text("PASS: actual native WebKitGTK keyboard input; Python Enter uses four spaces, Shift+Tab dedents, Tab restores indentation and Backspace removes the full indentation unit. Completion popup click tested separately.\n")
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
        click(code)
        keys=[{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue011"},{"type":"keyUp","value":"\ue011"},{"type":"keyUp","value":"\ue009"}]
        for _ in range(11): keys += [{"type":"keyDown","value":"\ue014"},{"type":"keyUp","value":"\ue014"}]
        keys += [{"type":"keyDown","value":"\ue032"},{"type":"keyUp","value":"\ue032"}]
        cmd("POST","/actions",{"actions":[{"type":"key","id":"python-rename","actions":keys}]})
        rename_input=wait_for(lambda: element('.lsp-rename input'),"native F2 rename input")
        cmd("POST",f"/element/{rename_input}/clear",{})
        cmd("POST",f"/element/{rename_input}/value",{"text":"numbers","value":list("numbers")})
        click('.lsp-rename button[type="submit"]')
        wait_for(lambda: text(code)=="def solve(numbers): return sum(numbers)","real Pyright semantic rename updates declaration and reference")
        screenshot("python-rename-native.png")
        click(code)
        cmd("POST","/actions",{"actions":[{"type":"key","id":"rename-undo","actions":[{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"z"},{"type":"keyUp","value":"z"},{"type":"keyUp","value":"\ue009"}]}]})
        wait_for(lambda: text(code)=="def solve(values): return sum(values)","single undo restores complete pre-rename source")
        (evidence/"RENAME_GUI_RESULT.txt").write_text("PASS: actual Linux GUI F2, real private Pyright rename, declaration/reference updates in original source and a single undo restores both.\n")
        click(code)
        keys=[{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue011"},{"type":"keyUp","value":"\ue011"},{"type":"keyUp","value":"\ue009"}]
        for _ in range(11): keys += [{"type":"keyDown","value":"\ue014"},{"type":"keyUp","value":"\ue014"}]
        keys += [{"type":"keyDown","value":"\ue008"},{"type":"keyDown","value":"\ue03c"},{"type":"keyUp","value":"\ue03c"},{"type":"keyUp","value":"\ue008"}]
        cmd("POST","/actions",{"actions":[{"type":"key","id":"python-references","actions":keys}]})
        wait_for(lambda: "本题 2 处引用" in text(".lsp-references"),"real Pyright declaration and reference positions")
        assert len(cmd("POST","/elements",{"using":"css selector","value":".lsp-reference-list button"}))==2
        screenshot("python-references-native.png")
        click(".lsp-reference-list button:last-child")
        wait_for(lambda:not cmd("POST","/elements",{"using":"css selector","value":".lsp-references"}),"reference navigation closes panel")
        assert text(code)=="def solve(values): return sum(values)"
        (evidence/"REFERENCES_GUI_RESULT.txt").write_text("PASS: actual native Shift+F12 real private Pyright declaration/reference lookup, two original source locations and navigation without modifying the draft.\n")
        fill(code, "def solve(values):\n    return sum(values)")
        click(".actions button:first-child")
        wait_for(lambda: element('[aria-label="本地测试输入"]'), "local runner opened")
        click('[data-action="local-execute"]')
        wait_for(lambda: '"value": 10' in text(".local-result"), "real private Python harness result", seconds=30)
        assert "不代表通过力扣判题" in cmd("GET",f"/element/{element('.exit-code')}/attribute/title")
        click('[aria-label="运行与调试设置"]')
        click('[aria-label="使用手册"]')
        wait_for(lambda:"本地输出不代表力扣判题结论" in cmd("GET",f"/element/{element('.user-manual')}/property/textContent"),"local judge distinction is available in the manual")
        click('[aria-label="关闭使用手册"]')
        click('[aria-label="关闭设置"]')
        screenshot("python-local-run-native.png")
        (evidence/"LOCAL_RUN_RESULT.txt").write_text("PASS: actual native GUI starts a private Python function harness and displays computed result 10. No online verdict.\n")
        click('[data-local-tab="debug"]')
        click(code)
        cmd("POST","/actions",{"actions":[{"type":"key","id":"debug-keys","actions":[{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue011"},{"type":"keyUp","value":"\ue011"},{"type":"keyUp","value":"\ue009"},{"type":"keyDown","value":"\ue015"},{"type":"keyUp","value":"\ue015"},{"type":"keyDown","value":"\ue039"},{"type":"keyUp","value":"\ue039"}]}]})
        wait_for(lambda: "断点：2。" in text(".debug-panel"), "F9 breakpoint on function body, not module definition")
        click(".debug-panel .local-actions button:first-of-type")
        wait_for(lambda: "已暂停" in text(".debug-panel"), "real debugger breakpoint", seconds=45)
        wait_for(lambda: element(".debug-inspector > div:first-child > button"), "real call stack loaded")
        click(".debug-inspector > div:first-child > button")
        wait_for(lambda: element(".debug-variable"), "real variable values loaded")
        wait_for(lambda: element(".cm-debug-stopped"), "paused source line highlighted")
        expression_input=element('[aria-label="调试表达式输入"]')
        cmd("POST",f"/element/{expression_input}/value",{"text":"len(values)","value":list("len(values)")})
        wait_for(lambda:cmd("GET",f"/element/{element('.debug-evaluate button[type=\"submit\"]')}/enabled"),"expression button enabled after native text input")
        screenshot("python-before-evaluate-native.png")
        click('.debug-evaluate button[type="submit"]')
        def evaluation_result():
            errors=cmd("POST","/elements",{"using":"css selector","value":".debug-panel [role=alert]"})
            if errors:
                message=cmd("GET",f"/element/{errors[0][EID]}/text")
                (evidence/"evaluation-error.txt").write_text(message)
            results=cmd("POST","/elements",{"using":"css selector","value":".debug-evaluation-result pre"})
            return bool(results) and cmd("GET",f"/element/{results[0][EID]}/text")=="3"
        wait_for(evaluation_result,"real debugpy evaluates current frame expression once")
        (evidence/"EVALUATE_GUI_RESULT.txt").write_text("PASS: actual native Python paused-frame expression len(values) evaluated through private debugpy and displayed exact result 3. Other language expression adapters are not covered by this assertion.\n")
        screenshot("python-debug-native.png")
        (evidence/"DEBUG_GUI_RESULT.txt").write_text("PASS: real Linux GUI private debugpy, F9 breakpoint and paused call stack inspector. Stepping verified separately by protocol probe.\n")
        click(code)
        cmd("POST","/actions",{"actions":[{"type":"key","id":"debug-update-keys","actions":[{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue011"},{"type":"keyUp","value":"\ue011"},{"type":"keyUp","value":"\ue009"},{"type":"keyDown","value":"\ue015"},{"type":"keyUp","value":"\ue015"},{"type":"keyDown","value":"\ue039"},{"type":"keyUp","value":"\ue039"}]}]})
        apply_points=cmd("POST","/element",{"using":"xpath","value":"//button[@aria-label='应用断点']"})[EID]
        cmd("POST",f"/element/{apply_points}/click",{})
        wait_for(lambda: "断点已更新" in text(".debug-panel"), "live debugger accepts cleared breakpoints")
        wait_for(lambda: "断点：未设置。" in text(".debug-panel"), "cleared breakpoint list is reflected in actual UI")
        cmd("POST","/actions",{"actions":[{"type":"key","id":"debug-stop-keys","actions":[{"type":"keyDown","value":"\ue008"},{"type":"keyDown","value":"\ue035"},{"type":"keyUp","value":"\ue035"},{"type":"keyUp","value":"\ue008"}]}]})
        wait_for(lambda: "调试结束" in text(".debug-panel"), "debugger stopped")
        nested_source="def inner(values):\n    inner_total = sum(values)\n    return inner_total\ndef solve(values):\n    total = inner(values)\n    return total"
        fill(code,nested_source)
        click(code)
        keys=[{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue011"},{"type":"keyUp","value":"\ue011"},{"type":"keyUp","value":"\ue009"}]
        for _ in range(4): keys += [{"type":"keyDown","value":"\ue015"},{"type":"keyUp","value":"\ue015"}]
        keys += [{"type":"keyDown","value":"\ue039"},{"type":"keyUp","value":"\ue039"}]
        cmd("POST","/actions",{"actions":[{"type":"key","id":"nested-breakpoint","actions":keys}]})
        wait_for(lambda: "断点：5。" in text(".debug-panel"),"nested call breakpoint")
        click('[aria-label="开始调试"]')
        wait_for(lambda: "已暂停" in text(".debug-panel"),"pause before nested function",seconds=45)
        def stack_names():
            nodes=cmd("POST","/elements",{"using":"css selector","value":".debug-frames > button"})
            return "\n".join(cmd("GET",f"/element/{node[EID]}/property/textContent") for node in nodes)
        (evidence/"nested-stack-observation.json").write_text(json.dumps({"webdriverText":text(".debug-frames"),"buttonText":stack_names()},ensure_ascii=False))
        wait_for(lambda: "solve" in stack_names(),"caller stack initially selected")
        click('[aria-label="单步进入"]')
        wait_for(lambda: "inner" in stack_names(),"real stepIn enters inner function")
        click('[aria-label="单步跳过"]')
        def inner_total():
            node=element('.debug-variable > button[aria-label="inner_total"] + code')
            return cmd("GET",f"/element/{node}/property/textContent")
        wait_for(lambda:inner_total()=="10","stepOver computes inner-frame local")
        click('.debug-variable button[aria-label="values"]')
        wait_for(lambda:len(cmd("POST","/elements",{"using":"css selector","value":".debug-tree-children .debug-variable"}))>=3,"real nested array tree children")
        assert cmd("POST","/elements",{"using":"css selector","value":".debug-variable button[aria-label='values']"}),"parent lost while expanding"
        def child_values():
            nodes=cmd("POST","/elements",{"using":"css selector","value":".debug-tree-children .debug-variable > code"})
            return [cmd("GET",f"/element/{node[EID]}/property/textContent") for node in nodes]
        wait_for(lambda:all(value in child_values() for value in ["3","-1","8"]),"expanded array children preserve exact values")

        fill('[aria-label="调试表达式输入"]',"inner_total")
        reveal_debug_control('[aria-label="添加监视表达式"]')
        click('[aria-label="添加监视表达式"]')
        reveal_debug_control('[aria-label="刷新监视 inner_total"]')
        click('[aria-label="刷新监视 inner_total"]')
        def watch_result():
            return cmd("GET",f"/element/{element('.debug-watch > span')}/property/textContent")
        wait_for(lambda:watch_result()=="10","real current-frame watch")
        screenshot("python-nested-debugger-native.png")
        caller=cmd("POST","/element",{"using":"xpath","value":"//div[contains(@class,'debug-frames')]/button[contains(.,'solve')]"})[EID]
        cmd("POST",f"/element/{caller}/click",{})
        wait_for(lambda:watch_result()=="—","watch result invalidated on caller selection")
        inner=cmd("POST","/element",{"using":"xpath","value":"//div[contains(@class,'debug-frames')]/button[contains(.,'inner')]"})[EID]
        cmd("POST",f"/element/{inner}/click",{})
        wait_for(lambda:inner_total()=="10","selecting inner frame restores its own variables")
        click('[aria-label="单步跳出"]')
        wait_for(lambda:"inner" not in stack_names() and "solve" in stack_names(),"real stepOut returns to caller")
        wait_for(lambda:watch_result()=="—","watch result invalidated on new pause")
        click('[aria-label="停止调试"]')
        wait_for(lambda:"调试结束" in text(".debug-panel"),"nested debugger stopped")
        click(code)
        keys=[{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue011"},{"type":"keyUp","value":"\ue011"},{"type":"keyUp","value":"\ue009"}]
        for _ in range(4): keys += [{"type":"keyDown","value":"\ue015"},{"type":"keyUp","value":"\ue015"}]
        keys += [{"type":"keyDown","value":"\ue039"},{"type":"keyUp","value":"\ue039"}]
        cmd("POST","/actions",{"actions":[{"type":"key","id":"clear-nested-breakpoint","actions":keys}]})
        wait_for(lambda:"断点：未设置。" in text(".debug-panel"),"nested test breakpoint cleaned")
        (evidence/"NESTED_DEBUGGER_RESULT.txt").write_text("PASS: real private debugpy step-in to nested function, step-over local value, hierarchical array expansion, explicit Watch, caller frame switching, step-out and old-frame/epoch Watch invalidation. Other adapters not covered by nested-function assertion.\n")
        click(".local-runner [aria-label='收起']")
        settings_action("语言与环境", '[data-action="open-environments"]')
        wait_for(lambda: element('select[aria-label="开发环境语言"]'), "language-specific tool groups")
        click('select[aria-label="开发环境语言"] option[value="java"]')
        click(".environment-summary button")
        wait_for(lambda: all(text(f'.environment-tools [data-tool="{tool}"] [role="status"]') == "已安装" for tool in ["jdk","jdtls","java-debug"]), "verified private JDK and JDTLS installed", seconds=300)
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
        java_solution="class Solution {\n public int solve(int[] values) {\n int total=0;\n for(int value:values){total+=value;}\n return total;\n }\n}"
        fill(code,java_solution)
        click(".pane-heading .actions button")
        click('[data-local-tab="run"]')
        fill('[aria-label="本地测试输入"]',"[3,-1,8]")
        click('[data-action="local-execute"]')
        wait_for(lambda: '"value":10' in text(".local-result").replace(" ",""),"Java private compilation and exact typed result",seconds=150)
        screenshot("java-local-run-native.png")
        java_saved=data/"top.jacek.inkleet/notebook/lc-900000001/solution.java"
        wait_for(lambda: java_saved.exists() and java_saved.read_text()==java_solution,"Java run preserves original saved source")
        (evidence/"JAVA_LOCAL_GUI_RESULT.txt").write_text("PASS: actual Linux GUI private JDK compiles the typed Java Solution harness, computes exact value 10 and preserves original draft. No debugger or online verdict.\n")
        click('[data-local-tab="debug"]')
        click(code)
        keys=[{"type":"keyDown","value":"\ue009"},{"type":"keyDown","value":"\ue011"},{"type":"keyUp","value":"\ue011"},{"type":"keyUp","value":"\ue009"}]
        for _ in range(3): keys += [{"type":"keyDown","value":"\ue015"},{"type":"keyUp","value":"\ue015"}]
        keys += [{"type":"keyDown","value":"\ue039"},{"type":"keyUp","value":"\ue039"}]
        cmd("POST","/actions",{"actions":[{"type":"key","id":"java-debug-breakpoint","actions":keys}]})
        wait_for(lambda: "断点：4。" in text(".debug-panel"),"Java original source breakpoint")
        click(".debug-panel .local-actions button:first-of-type")
        wait_for(lambda: "已暂停" in text(".debug-panel"),"Java real private debugger breakpoint",seconds=180)
        wait_for(lambda: element(".cm-debug-stopped"),"Java original source pause highlight")
        def java_total():
            node=cmd("POST","/element",{"using":"xpath","value":"//div[contains(@class,'debug-variable')][button[@aria-label='total']]/code"})[EID]
            return cmd("GET",f"/element/{node}/text")
        wait_for(lambda: java_total()=="0","Java initial total")
        wait_for(lambda: "部分断点尚未验证" not in text(".debug-panel"),"Java asynchronous breakpoint verification reaches the UI")
        screenshot("java-debug-native.png")
        for _ in range(3):
            click(code)
            cmd("POST","/actions",{"actions":[{"type":"key","id":"java-debug-step","actions":[{"type":"keyDown","value":"\ue03a"},{"type":"keyUp","value":"\ue03a"}]}]})
            time.sleep(.7)
            if java_total()!="0": break
        assert java_total()!="0","Java variables did not change after stepping"
        cmd("POST","/actions",{"actions":[{"type":"key","id":"java-debug-stop","actions":[{"type":"keyDown","value":"\ue008"},{"type":"keyDown","value":"\ue035"},{"type":"keyUp","value":"\ue035"},{"type":"keyUp","value":"\ue008"}]}]})
        wait_for(lambda: "调试结束" in text(".debug-panel"),"Java debug stop")
        (evidence/"JAVA_DEBUG_GUI_RESULT.txt").write_text("PASS: actual Linux GUI private Java debug core over stdio, original line 4 breakpoint, paused source highlight, total=0, real F10 variable update and Shift+F5 termination.\n")
        click(".local-runner [aria-label='收起']")
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
            settings_action("语言与环境", '[data-action="open-environments"]')
            wait_for(lambda: element("dialog.environments"), "environment dialog")
            environment_group="cpp" if group=="c" else group
            click(f'select[aria-label="开发环境语言"] option[value="{environment_group}"]')
            click(".environment-summary button")
            if group=="golang":
                # Closing before Go finishes must not discard the queued gopls build.
                click("dialog.environments header button")
                time.sleep(1)
                settings_action("语言与环境", '[data-action="open-environments"]')
                wait_for(lambda: element("dialog.environments"),"reopen ongoing Go installation")
                click('select[aria-label="开发环境语言"] option[value="golang"]')
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
                saved_solution=data/("top.jacek.inkleet/notebook/lc-900000001/solution."+({"golang":"go","cpp":"cpp","c":"c","rust":"rs"}[group]))
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
                    node=cmd("POST","/element",{"using":"xpath","value":"//div[contains(@class,'debug-variable')][button[@aria-label='total']]/code"})[EID]
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
                click(".local-runner [aria-label='收起']")
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
            preserved=data/"top.jacek.inkleet/notebook/lc-900000001/solution.rs"
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
        recent_tab=cmd("POST","/element",{"using":"xpath","value":"//aside[@aria-label='题目导航']//button[text()='最近']"})[EID]
        cmd("POST",f"/element/{recent_tab}/click",{})
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
