"""Targeted native case editor diagnosis against a pinned installed preview."""
import pathlib
helper_source=pathlib.Path("tests/native_smoke.py").read_text()
marker="# Legacy interaction fixtures intentionally opt out;"
assert helper_source.count(marker)==1
helpers=helper_source.split(marker,1)[0]
assert "subprocess.Popen" not in helpers
exec(compile(helpers,"tests/native_smoke.py","exec"),globals())
evidence=pathlib.Path("evidence/case-probe");evidence.mkdir(parents=True,exist_ok=True)
code='[aria-label="代码编辑器"]'
def observe(stage):
    script="""
    const target=document.querySelector('[aria-label="预期结果"]');
    const info=node=>node?{tag:node.tagName,role:node.getAttribute('role'),label:node.getAttribute('aria-label'),rect:node.getBoundingClientRect().toJSON(),display:getComputedStyle(node).display,visibility:getComputedStyle(node).visibility,overflow:getComputedStyle(node).overflow,scrollTop:node.scrollTop,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight}:null;
    const ancestors=[];for(let node=target;node;node=node.parentElement)ancestors.push(info(node));
    const r=target?.getBoundingClientRect();
    return {lspStatus:document.querySelector('.lsp-status')?.getAttribute('data-status'),active:info(document.activeElement),target:info(target),ancestors,detailsOpen:document.querySelector('.case-expectation')?.open,selected:document.querySelector('[aria-label="预期结果比较目标"]')?.value,hit:r?info(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)):null};
    """
    try:
        value=cmd("POST","/execute/sync",{"script":script,"args":[]})
        (evidence/(stage+".json")).write_text(json.dumps(value,ensure_ascii=False,indent=2))
    except Exception as error:
        (evidence/(stage+"-observation-error.txt")).write_text(str(error))
    try:screenshot(stage+".png")
    except Exception as error:(evidence/(stage+"-screenshot-error.txt")).write_text(str(error))
    subprocess.run(["scrot",str(evidence/(stage+"-desktop.png"))],check=False)
cache=pathlib.Path(os.environ["XDG_CACHE_HOME"])/"top.jacek.inkleet/public-questions.json"
cache.parent.mkdir(parents=True,exist_ok=True)
fixture=json.loads(pathlib.Path("tests/fixtures/public-questions.json").read_text())
metadata=json.loads(fixture[0]["metaData"]);metadata["return"]={"type":"void"}
fixture[0]["metaData"]=json.dumps(metadata);cache.write_text(json.dumps(fixture))
settings=pathlib.Path(os.environ["XDG_CONFIG_HOME"])/"top.jacek.inkleet/editor-settings.json"
settings.parent.mkdir(parents=True,exist_ok=True)
settings.write_text(json.dumps({"version":1,"formatOnSave":False,"vim":False,"overrides":{}}))
driver=subprocess.Popen(["tauri-driver"],stdout=open(evidence/"driver.log","w"),stderr=subprocess.STDOUT)
try:
    wait_for(lambda:request("GET","/status"),"driver ready")
    start()
    settings_action("语言与环境",'[data-action="open-environments"]')
    wait_for(lambda:element(".environment-summary button"),"environment manager")
    click(".environment-summary button")
    wait_for(lambda:all(text(f'.environment-tools [data-tool="{tool}"] [role="status"]')=="已安装" for tool in ["python","node","pyright","debugpy"]),"private Python group installed",seconds=300)
    click(".environments header button")
    click('select[aria-label="编程语言"] option[value="python3"]')
    fill(code,"def solve(values):\n    values.reverse()")
    wait_for(lambda:"Pyright 已连接" in text(".lsp-status"),"Pyright ready",seconds=60)
    click('.pane-heading .actions button[aria-label="本地"]')
    fill('[aria-label="本地测试输入"]',"[1,2,3]")
    click_debug_action('[data-action="local-execute"]')
    wait_for(lambda:json.loads(text('pre[aria-label="调用后 values"]'))==[3,2,1],"actual void result",seconds=30)
    observe("01-before-expansion")
    click(".case-expectation summary")
    observe("02-expanded")
    click('select[aria-label="预期结果比较目标"] option[value="argument:0"]')
    observe("03-selected-before-fill")
    fill('[aria-label="预期结果"]',"[3,2,1]")
    observe("04-filled")
    click_debug_action('[data-action="local-execute"]')
    wait_for(lambda:"符合预期" in text(".case-result"),"actual argument comparison",seconds=30)
    observe("05-matched")
    panel_before=cmd("GET",f"/element/{element('.local-runner')}/rect")
    separator=cmd("GET",f"/element/{element('[aria-label=\"调整本地面板高度\"]')}/rect")
    window=cmd("GET","/window/rect")
    x=int(window["x"]+separator["x"]+separator["width"]/2);y=int(window["y"]+separator["y"]+separator["height"]/2)
    subprocess.run(["xdotool","mousemove","--sync",str(x),str(y),"mousedown","1","mousemove","--sync",str(x),str(y+50),"mouseup","1"],check=True)
    wait_for(lambda:cmd("GET",f"/element/{element('.local-runner')}/rect")["height"]<panel_before["height"]-20,"smaller native case panel")
    fill('[aria-label="预期结果"]',"[1,2,3]")
    observe("06-small-panel-filled")
    click_debug_action('[data-action="local-execute"]')
    wait_for(lambda:"与预期不符" in text(".case-result"),"small-panel expected comparison",seconds=30)
    observe("07-small-panel-mismatch")

    (evidence/"TARGETED_RESULT.txt").write_text("PASS: isolated installed-preview Python mutation, expectation interaction and smaller-panel real scrolling/focus. This does not replace the full native suite.\n")
except Exception as error:
    (evidence/"failure.txt").write_text(repr(error))
    observe("failure-before-cleanup")
    raise
finally:
    try:stop()
    finally:
        driver.terminate()
        try:driver.wait(timeout=5)
        except subprocess.TimeoutExpired:driver.kill();driver.wait()
