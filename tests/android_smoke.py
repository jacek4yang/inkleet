"""Actual disposable Android emulator, APK, accessibility input and native files.
No owner account, cookies, network submission, JavaScript injection or mock IPC.
"""
import os, pathlib, re, subprocess, time, traceback, xml.etree.ElementTree as ET
APP = "top.jacek.inkleet"
ADB = str(pathlib.Path(os.environ["ANDROID_HOME"]) / "platform-tools/adb")
OUT = pathlib.Path("evidence/android")
OUT.mkdir(parents=True, exist_ok=True)
def adb(*args, timeout=45, binary=False):
    result = subprocess.run([ADB, "-s", "emulator-5554", *args], check=True, capture_output=True, timeout=timeout)
    return result.stdout if binary else result.stdout.decode("utf-8", errors="replace").strip()
def wait(fn, label, seconds=60):
    end=time.monotonic()+seconds
    last=None
    while time.monotonic()<end:
        try:
            value=fn()
            if value: return value
        except Exception as error: last=error
        time.sleep(2)
    raise AssertionError(f"{label}: {last}")
def screenshot(name):
    (OUT/name).write_bytes(adb("exec-out","screencap","-p",binary=True))
def hierarchy(name="latest-ui.xml"):
    adb("shell","uiautomator","dump","/sdcard/inkleet-smoke.xml",timeout=60)
    xml=adb("shell","cat","/sdcard/inkleet-smoke.xml")
    (OUT/name).write_text(xml,encoding="utf-8")
    return ET.fromstring(xml)
def nodes_named(name):
    root=hierarchy()
    return [n for n in root.iter("node") if name in (n.get("text"),n.get("content-desc"))]
def tap(node):
    values=[int(x) for x in re.findall(r"\d+",node.get("bounds",""))]
    assert len(values)==4 and values[2]>values[0] and values[3]>values[1],node.attrib
    adb("shell","input","tap",str((values[0]+values[2])//2),str((values[1]+values[3])//2))
def tap_named(name):
    found=wait(lambda:nodes_named(name),f"accessible control {name}")
    assert len(found)==1,[n.attrib for n in found]
    tap(found[0])
def notes_file():
    paths=adb("shell","run-as",APP,"find",".","-type","f","-name","notes.md").splitlines()
    matches=[p for p in paths if p.endswith("/notebook/sample-sum/notes.md")]
    assert len(matches)==1,paths
    assert re.fullmatch(r"[A-Za-z0-9_./-]+",matches[0]),matches[0]
    return matches[0]
def launch():
    output=adb("shell","monkey","-p",APP,"-c","android.intent.category.LAUNCHER","1")
    assert "Events injected: 1" in output,output
    wait(lambda:nodes_named("笔记"),"native app renders workspace",120)
try:
    wait(lambda:adb("shell","getprop","sys.boot_completed",timeout=10)=="1","Android boots",900)
    (OUT/"device.txt").write_text(adb("shell","getprop","ro.build.fingerprint")+"\n"+adb("shell","getprop","ro.product.cpu.abi"))
    adb("shell","input","keyevent","KEYCODE_WAKEUP")
    adb("shell","input","keyevent","KEYCODE_MENU")
    candidates=list(pathlib.Path("src-tauri/gen/android/app/build/outputs/apk").rglob("*.apk"))
    assert len(candidates)==1,candidates
    (OUT/"install.txt").write_text(adb("install","-r",str(candidates[0]),timeout=180))
    launch()
    screenshot("android-workbench.png")
    tap_named("笔记")
    def editor():
        root=hierarchy()
        named=[n for n in root.iter("node") if n.get("content-desc")=="Markdown 笔记" or n.get("text")=="Markdown 笔记"]
        editable=[n for n in root.iter("node") if n.get("class")=="android.widget.EditText"]
        choices=named or editable
        return choices if len(choices)==1 else None
    node=wait(editor,"accessible Markdown editor")
    tap(node[0])
    marker="AndroidNativePersistence20261014"
    adb("shell","input","text",marker)
    path=wait(notes_file,"notes saved through native IPC")
    saved=wait(lambda:(value if marker in (value:=adb("shell","run-as",APP,"cat",path)) else None),"typed note persisted exactly")
    screenshot("android-note-native.png")
    hierarchy("note-before-restart.xml")
    adb("shell","am","force-stop",APP)
    launch()
    tap_named("笔记")
    wait(lambda:any(marker in n.get("text","") for n in hierarchy().iter("node")),"note restored visibly after process restart")
    assert adb("shell","run-as",APP,"cat",path)==saved,"restart changed saved Markdown"
    screenshot("android-note-restored.png")
    hierarchy("note-after-restart.xml")
    (OUT/"RESULT.txt").write_text("PASS: actual x86_64 Android emulator installs APK, renders native workbench, accepts real accessibility/keyboard note input, writes private notes.md through IPC and restores it visibly after process restart. No ARM64 physical-phone, login, judge or mobile language-tool verification.\n")
except Exception:
    (OUT/"RESULT.txt").write_text("FAIL: Android native verification did not complete.\n"+traceback.format_exc())
    for name,fn in [("failure.png",lambda:screenshot("failure.png")),("failure-ui.xml",lambda:hierarchy("failure-ui.xml"))]:
        try: fn()
        except Exception as error: (OUT/(name+".error.txt")).write_text(str(error))
    raise
finally:
    try: (OUT/"app-logcat.txt").write_text(adb("logcat","-d","-t","2000"),encoding="utf-8")
    except Exception: pass
