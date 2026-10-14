"""Opt-in native performance evidence. Test instrumentation only; no app telemetry."""
import json, os, pathlib, platform, subprocess, time

def processes(binary):
    all_rows = {}
    for path in pathlib.Path("/proc").glob("[0-9]*"):
        try:
            fields=(path/"stat").read_text().rsplit(")",1)[1].split()
            pid=int(path.name)
            all_rows[pid]={"pid":pid,"parent":int(fields[1]),"start":fields[19],
                "ticks":int(fields[11])+int(fields[12]),"rss":int(fields[21])*os.sysconf("SC_PAGE_SIZE"),
                "exe":str((path/"exe").resolve())}
        except (OSError,ValueError,IndexError): pass
    roots={pid for pid,row in all_rows.items() if row["exe"]==binary}
    if not roots: raise AssertionError("verified native process missing")
    selected=set(roots)
    while True:
        children={pid for pid,row in all_rows.items() if row["parent"] in selected}
        updated=selected|children
        if updated==selected: break
        selected=updated
    return {str(pid):all_rows[pid] for pid in selected}

def resource_delta(before,after,elapsed):
    common={pid for pid in before.keys()&after.keys() if before[pid]["start"]==after[pid]["start"]}
    ticks=sum(after[pid]["ticks"]-before[pid]["ticks"] for pid in common)
    cpu=ticks/os.sysconf("SC_CLK_TCK")
    return {"wallSeconds":elapsed,"cpuSecondsStableProcesses":cpu,"oneCorePercent":100*cpu/elapsed,
        "rssBeforeSum":sum(row["rss"] for row in before.values()),"rssAfterSum":sum(row["rss"] for row in after.values()),
        "newOrReusedPids":sorted(after.keys()-common),"exitedOrReusedPids":sorted(before.keys()-common),
        "before":before,"after":after}

def run_performance(g):
    cmd,wait_for,click,start,stop,focus=[g[name] for name in ("cmd","wait_for","click","start","stop","focus_code_editor")]
    evidence=g["evidence"]
    binary=str(pathlib.Path(os.environ.get("INKLEET_TEST_BINARY","src-tauri/target/debug/inkleet")).resolve())
    def js(script,args=None): return cmd("POST","/execute/sync",{"script":script,"args":args or []})
    def keys(value): subprocess.run(["xdotool","key","--clearmodifiers",value],check=True)
    def copied():
        return subprocess.run(["xclip","-selection","clipboard","-o"],capture_output=True,check=True,timeout=5).stdout.decode()
    def verify_source(expected):
        keys("ctrl+a");keys("ctrl+c")
        wait_for(lambda:copied()==expected,"full native clipboard matches performance source")
        keys("ctrl+End")
    def paste(value):
        focus();keys("Escape")
        subprocess.run(["xclip","-selection","clipboard"],input=value.encode(),check=True)
        keys("ctrl+a");keys("ctrl+v")
        # Use the whole recovery snapshot, not virtualized rendered lines.
        draft=g["data"]/"top.jacek.inkleet/notebook/lc-900000001/.inkleet-drafts/solution.py.json"
        wait_for(lambda:draft.exists() and json.loads(draft.read_text()).get("text")==value,
            "large performance source reaches durable recovery",seconds=45)
        verify_source(value)
    report={"source":os.environ.get("INKLEET_BINARY_SOURCE"),"harnessSource":os.environ.get("INKLEET_HARNESS_SOURCE"),
        "instrumented":True,"instrumentation":"test-only build alias; protected Tauri internals unchanged; base source plus recorded harness overlay","binary":binary,"buildMode":os.environ.get("INKLEET_BUILD_MODE","unknown"),
        "kernel":platform.platform(),"cpu":next((line.split(":",1)[1].strip() for line in pathlib.Path("/proc/cpuinfo").read_text().splitlines() if line.startswith("model name")),"unknown"),
        "logicalCpus":os.cpu_count(),"compositingDisabled":os.environ.get("WEBKIT_DISABLE_COMPOSITING_MODE"),"environment":"Linux WebKitGTK on GitHub Actions Xvfb; real X11 input, private Pyright and durable draft IPC",
        "limitations":["input-to-rAF is not OS-key-to-screen or completed paint","RSS sums double-count shared pages and are not peak/private memory",
            "two /proc snapshots exclude CPU of descendants that start and exit between samples","fixed runner phase order; paired equal-byte fixtures alternate order; no hardware-independent speed claim","IPC timings include bridge/backend scheduling; syncMs is invoke call time, not pure serialization","IPC records without endAt are censored at capture; no source or response content is logged","CPU snapshots approximately bracket, but do not exactly match, the wall interval"],
        "fixtureDesign":"Python valid one-line function definitions versus padded comment lines, equal UTF-8 byte and line counts at each size; insertion at final comment",
        "samples":[]}
    output=evidence/"NATIVE_PERFORMANCE.json"
    stop();start()
    click('select[aria-label="编程语言"] option[value="python3"]')
    wait_for(lambda:"Pyright 已连接" in g["text"](".lsp-status"),"performance private Pyright ready",seconds=60)
    assert not cmd("POST","/elements",{"using":"css selector","value":".local-runner"}),"fresh app runner must be unopened"
    report["viewport"]=js("return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio};")
    try:
        for phase in ("unopened","visible","hidden"):
            if phase=="visible":
                paste("def solve(values): return list(range(8192))")
                click('.pane-heading .actions button[aria-label="本地"]')
                g["fill"]('[aria-label="本地测试输入"]',"[3,-1,8]")
                click('[data-action="local-execute"]')
                wait_for(lambda:js("return document.querySelector('.local-result')?.textContent?.includes('8191');"),
                    "real bounded array result available",seconds=60)
            elif phase=="hidden":
                click('.local-runner [aria-label="收起"]')
                wait_for(lambda:js("return document.querySelector('.local-runner')?.hidden;"),"performance runner hidden")
            output_bytes=js("return new TextEncoder().encode([...document.querySelectorAll('.local-raw pre')].map(n=>n.textContent).join('')).length;")
            for lines in (100,1000,10000):
                # Alternate order, with identical byte and line counts for each pair.
                fixtures=("comments","functions") if (lines==1000) == (phase=="visible") else ("functions","comments")
                for fixture in fixtures:
                    rows=(("def fixture_%05d(): return %d"%(i,i)) if fixture=="functions" else ("# performance fixture %d"%i) for i in range(lines-2))
                    source="def solve(values): return list(range(8192))\n"+"".join(row.ljust(48)+"\n" for row in rows)+"# "
                    paste(source)
                    for burst in range(3):
                        js("""
                            const sample={frames:[],gaps:[],tasks:[],inputIntervals:[],frameIntervals:[],ipc:[],startedAt:performance.now(),longTaskSupported:!!(window.PerformanceObserver&&PerformanceObserver.supportedEntryTypes?.includes('longtask'))};
                            let last=performance.now(),active=true,frame;
                            function tick(now){sample.gaps.push(now-last);sample.frameIntervals.push({startAt:last,endAt:now});last=now;if(active)frame=requestAnimationFrame(tick);}
                            frame=requestAnimationFrame(tick);
                            const input=event=>{if(event.inputType!=='insertText'||!event.target.closest('[aria-label="代码编辑器"]'))return;
                                const at=performance.now();requestAnimationFrame(()=>{const endAt=performance.now();sample.frames.push(endAt-at);sample.inputIntervals.push({startAt:at,endAt});});};
                            document.addEventListener('beforeinput',input,true);
                            let observer;
                            if(sample.longTaskSupported){observer=new PerformanceObserver(list=>{for(const e of list.getEntries())sample.tasks.push(e.duration);});observer.observe({type:'longtask'});}
                            if(!window.__inkleetIpcInstrumentation)throw Error('test build instrumentation absent');
                            window.__nativePerf={sample,active:true,stop(){if(!active)return;active=false;this.active=false;sample.stoppedAt=performance.now();
                                cancelAnimationFrame(frame);document.removeEventListener('beforeinput',input,true);observer?.disconnect();}};
                        """)
                        before=processes(binary);begin=time.monotonic()
                        typed="0123456789"*4
                        try:
                            subprocess.run(["xdotool","type","--clearmodifiers","--delay","20",typed],check=True)
                            wait_for(lambda:js("return window.__nativePerf.sample.frames.length;")==len(typed),"all native input-to-rAF samples")
                            elapsed=time.monotonic()-begin;after=processes(binary)
                            sample=js("window.__nativePerf.stop();window.__nativePerf.sample.capturedAt=performance.now();return window.__nativePerf.sample;")
                        finally:
                            js("window.__nativePerf?.stop();")
                        source+=typed
                        verify_source(source)
                        ordered=sorted(sample["frames"])
                        sample.update({"phase":phase,"fixture":fixture,"lines":lines,"burst":burst,"sourceBytes":len(source.encode()),"outputBytes":output_bytes,
                            "inputToRafP50Ms":ordered[len(ordered)//2],"inputToRafP95Ms":ordered[int(len(ordered)*.95)],
                            "inputToRafMaxMs":max(ordered),"longestTaskMs":max(sample["tasks"],default=0) if sample["longTaskSupported"] else None,
                            "resources":resource_delta(before,after,elapsed)})
                        report["samples"].append(sample)
                        output.write_text(json.dumps(report,indent=2))
        assert len(report["samples"])==54
        for phase in ("unopened","visible","hidden"):
            for lines in (100,1000,10000):
                for burst in range(3):
                    pair=[item for item in report["samples"] if item["phase"]==phase and item["lines"]==lines and item["burst"]==burst]
                    assert len(pair)==2 and len({item["sourceBytes"] for item in pair})==1,"paired fixture byte sizes differ"
        (evidence/"NATIVE_PERFORMANCE_RESULT.txt").write_text("PASS: 54 paired-fixture native X11 input bursts, complete source integrity and descriptive timing/resource samples. No smoothness threshold or speedup claim; actual IME/physical display not covered.\n")
    finally:
        output.write_text(json.dumps(report,indent=2))
        try: js("window.__nativePerf?.stop();")
        finally: stop();start()
