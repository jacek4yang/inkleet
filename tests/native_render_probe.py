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
def native_keys(payload):
    # Real X11 events, prospectively selected instead of the flaky WebKit action
    # transport. No mutation is retried; all source/selection assertions remain.
    sources=payload.get("actions",[])
    assert len(sources)==1 and sources[0].get("type")=="key", "unsupported native action source"
    mapping={"\ue010":"End","\ue007":"Return","\ue008":"Shift_L","\ue004":"Tab","\ue003":"BackSpace","\ue009":"Control_L","\ue03c":"F12","\ue012":"Left","\ue011":"Home","\ue014":"Right","\ue032":"F2","\ue015":"Down","\ue039":"F9","\ue035":"F5","\ue00c":"Escape","\ue03a":"F10","z":"z"," ":"space"}
    command=["xdotool"];held=set();used=set()
    for action in sources[0].get("actions",[]):
        kind=action.get("type");key=mapping.get(action.get("value"))
        assert kind in ("keyDown","keyUp") and key is not None, "unsupported native key"
        if kind=="keyDown":
            assert key not in held, "duplicate keyDown"
            held.add(key)
        else:
            assert key in held, "unpaired keyUp"
            held.remove(key)
        used.add(key);command.extend(["keydown" if kind=="keyDown" else "keyup",key])
    assert len(command)>1 and not held, "native key sequence must be balanced"
    try: subprocess.run(command,check=True)
    except Exception:
        subprocess.run(["xdotool","keyup",*sorted(used)],check=False)
        raise

def cmd(method, path, payload=None):
    if method=="POST" and path=="/actions":
        return native_keys(payload)
    if method=="DELETE" and path=="/actions":
        subprocess.run(["xdotool","keyup","Control_L","Shift_L","Alt_L","Super_L"],check=True)
        return
    read_only = method == "GET" or (method == "POST" and (path in ("/element", "/elements") or path.endswith("/elements")))
    try: return request(method, f"/session/{session}" + path, payload)
    except http.client.RemoteDisconnected:
        if not read_only: raise
        with (evidence/"webdriver-transport-recovery.txt").open("a") as log:
            log.write(f"Retrying one read-only WebKit transport reset: {method} {path}\n")
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


def reveal_debug_control(css, fallback="down"):
    # Native WebKit does not reliably auto-scroll controls in nested inspectors.
    # Use the real pointer wheel over the outer padding, never execute JS clicks.
    for _ in range(12):
        panel=cmd("GET",f"/element/{element('.debug-body')}/rect")
        try: target=cmd("GET",f"/element/{element(css)}/rect")
        except RuntimeError as error:
            if "element not interactable" not in str(error): raise
            target=None
        top=panel["y"]+4; bottom=panel["y"]+panel["height"]-4
        if target and target["height"]>0 and target["y"]>=top and target["y"]+target["height"]<=bottom:
            return
        window=cmd("GET","/window/rect")
        x=int(window["x"]+panel["x"]+4)
        y=int(window["y"]+panel["y"]+panel["height"]/2)
        direction=("4" if fallback=="up" else "5") if target is None else ("5" if target["y"]+target["height"]>bottom else "4")
        subprocess.run(["xdotool","mousemove","--sync",str(x),str(y),"click","--repeat","2","--delay","80",direction],check=True)
        time.sleep(.15)
    raise AssertionError("Debug control remains unreachable through real wheel: "+css)

def click_debug_action(css):
    # A debugger action is not idempotent: emit exactly one real pointer click.
    # Do not fall back to another injection path after an uncertain mutation.
    node=element(css)
    wait_for(lambda:cmd("GET",f"/element/{element(css)}/enabled"),"debug action becomes enabled: "+css)
    node=element(css)
    rect=cmd("GET",f"/element/{node}/rect")
    window=cmd("GET","/window/rect")
    assert rect["width"]>0 and rect["height"]>0, "debug action has no visible bounds"
    assert rect["x"]>=0 and rect["y"]>=0 and rect["x"]+rect["width"]<=window["width"] and rect["y"]+rect["height"]<=window["height"], "debug action is outside the window"
    x=int(window["x"]+rect["x"]+rect["width"]/2)
    y=int(window["y"]+rect["y"]+rect["height"]/2)
    subprocess.run(["xdotool","mousemove","--sync",str(x),str(y),"click","1"],check=True)


def focus_code_editor():
    # Prospectively choose one real OS focus click. Never replay a failed action.
    rect=cmd("GET",f"/element/{element('.code-pane > .editor-host')}/rect")
    window=cmd("GET","/window/rect")
    assert rect["width"]>40 and rect["height"]>40,"code viewport is not visible"
    x=int(window["x"]+rect["x"]+rect["width"]/2)
    y=int(window["y"]+rect["y"]+min(32,rect["height"]/2))
    subprocess.run(["xdotool","mousemove","--sync",str(x),str(y),"click","1"],check=True)
    def focused():
        active=cmd("GET","/element/active")[EID]
        return cmd("GET",f"/element/{active}/attribute/aria-label")=="代码编辑器"
    wait_for(focused,"actual code editor keyboard focus")

def click(css):
    # Only known visible transport-sensitive controls use one OS click.
    # WebDriver retains auto-scroll for other controls and native options.
    if css in (".pane-heading .actions button", '[data-action="local-execute"]'):
        return click_debug_action(css)
    try: return cmd("POST",f"/element/{element(css)}/click",{})
    except http.client.RemoteDisconnected:
        closing=css in (".source-viewer header button",".environments header button","dialog.environments header button",".local-runner [aria-label='收起']")
        selection=(" option[value=" in css) or css in ('[data-local-tab="run"]','[data-local-tab="debug"]')
        if not (closing or selection): raise
        with (evidence/"webdriver-transport-recovery.txt").open("a") as log:
            log.write(f"Checking idempotent test UI operation after WebKit connection reset: {css}\n")
        time.sleep(.3)
        if css==".local-runner [aria-label='收起']" and cmd("POST","/elements",{"using":"css selector","value":".local-runner[hidden]"}): return
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
def save_editor(css):
    node=element(css)
    if cmd("GET","/element/active").get(EID)!=node: click(css)
    assert cmd("GET","/element/active").get(EID)==node,"explicit save target owns focus"
    subprocess.run(["xdotool","key","--clearmodifiers","ctrl+s"],check=True)

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
# Diagnostic fixture only: no account, online writes, tool installation or user data.
editor_config=pathlib.Path(os.environ["XDG_CONFIG_HOME"])/"top.jacek.inkleet/editor-settings.json"
editor_config.parent.mkdir(parents=True,exist_ok=True)
editor_config.write_text(json.dumps({"version":1,"formatOnSave":False,"overrides":{}}))
cache_path=pathlib.Path(os.environ["XDG_CACHE_HOME"])/"top.jacek.inkleet/public-questions.json"
cache_path.parent.mkdir(parents=True,exist_ok=True)
cache_path.write_text(pathlib.Path("tests/fixtures/public-questions.json").read_text())
driver=subprocess.Popen(["tauri-driver"],stdout=open(evidence/"driver.log","w"),stderr=subprocess.STDOUT)
try:
    wait_for(lambda:request("GET","/status"),"driver ready")
    start()
    code='[aria-label="代码编辑器"]'
    authored="use std::collections::HashMap;\n\nfn solve(values: &[i32]) -> i32 {\n    let mut map = HashMap::new();\n    map.insert(1, 2);\n    values.iter().sum()\n}"
    fill(code,authored)
    wait_for(lambda:cmd("POST","/execute/sync",{"script":"return document.fonts.status === 'loaded'","args":[]}),"fonts loaded")
    def probe(label):
        focus_code_editor()
        time.sleep(.5)
        sample=cmd("POST","/execute/sync",{"script":"""
          const editor=document.querySelector('.code-pane .cm-editor'),content=editor.querySelector('.cm-content'),scroller=editor.querySelector('.cm-scroller');
          const props=['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing','textShadow','transform','opacity','filter'];
          const style=Object.fromEntries(props.map(k=>[k,getComputedStyle(content)[k]]));
          const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
          const walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT);const text=walker.nextNode();
          let glyph=null;if(text&&text.length){const r=document.createRange();r.setStart(text,0);r.setEnd(text,1);glyph=rect(r);}
          return {style,editor:rect(editor),content:rect(content),scroller:rect(scroller),glyph,
            scroll:{top:scroller.scrollTop,left:scroller.scrollLeft},dpr:devicePixelRatio,viewportScale:visualViewport?.scale,fonts:document.fonts.status};
        ""","args":[]})
        screenshot(label+"-native.png")
        return sample
    closed=probe("render-closed")
    click('.pane-heading .actions button[aria-label="本地"]')
    wait_for(lambda:cmd("GET",f"/element/{element('.local-runner')}/displayed"),"dock open")
    opened=probe("render-open")
    click(".local-runner [aria-label='收起']")
    reclosed=probe("render-reclosed")
    assert source_text(code)==authored,"render probe changed source"
    (evidence/"render-probe.json").write_text(json.dumps({"closed":closed,"open":opened,"reclosed":reclosed},indent=2))
    assert closed["style"]==opened["style"]==reclosed["style"],"dock changed computed typography"
    (evidence/"RENDER_RESULT.txt").write_text("PASS: authored source unchanged; font readiness and computed typography equal across dock closed/open/reclosed. Inspect original-resolution screenshots and geometry separately. Headless renderer is not the user's GPU.\n")
except Exception:
    if session:
        try:screenshot("render-failure.png")
        except Exception:pass
    raise
finally:
    stop()
    driver.terminate()
    driver.wait(timeout=10)
