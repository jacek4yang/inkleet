import type { DebugPosition } from "./debug-position";
import { VariableNode } from "./debug-variable-tree";
import { debugVariables, debugFrames, debugScopes, debugThreads, type DebugVariable, type DebugFrame as Frame, type DebugScope as Scope } from "./debug-model";
import { IconButton } from "./icons";
import React, { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Language } from "./domain";
type Snapshot = { documentKey?: string; code: string; input: string; metadata: string; title: string; language: Language };
type State = { id: number; phase: string; title: string; threadId: number | null; epoch: number; output: string; truncated: boolean; reason: string; error: string; capabilities?:{supportsStepInTargetsRequest?:boolean}; breakpoints: { line?: number; verified?: boolean; message?: string }[] };
type Variable = DebugVariable;
type Watch = { id: number; expression: string; result?: string; error?: string; token?: string };
// One owned snapshot survives panel unmounts; never adopt an unknown session.
let ownedSnapshot: { id: number; snapshot: Snapshot } | null = null;
const active = (state: State | null) => state && state.phase !== "finished";
export function DebugPanel({ snapshot, breakpoints, onPauseLine, running }: { snapshot: Snapshot; breakpoints: number[]; onPauseLine: (position:DebugPosition|null) => void; running: boolean }) {
  const [state, setState] = useState<State | null>(null), [original, setOriginal] = useState<Snapshot | null>(null);
  const [targets,setTargets]=useState<{id:number;label:string}[]>([]),[choosing,setChoosing]=useState(false);
  const targetVersion=useRef(0);
  const topFrame=useRef<{id:number;thread:number}|null>(null);
  const [threads, setThreads] = useState<{id:number;name:string}[]>([]), [selectedThread, setThread] = useState<number | null>(null);
  const [inspectionRevision, setInspectionRevision] = useState(0), inspectionVersion = useRef(0);
  const [watches, setWatches] = useState<Watch[]>([]), watchNext = useRef(0);
  const [expression, setExpression] = useState(""), [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<{ result: string; type?: string; truncated?: boolean; variablesReference: number } | null>(null);
  const evaluationGuard = useRef(false), evaluationVersion = useRef(0), frameRef = useRef<number | null>(null);
  const [notice,setNotice] = useState("");
  const [error, setError] = useState(""), [pending, setPending] = useState(false);
  const [frames, setFrames] = useState<Frame[]>([]), [variables, setVariables] = useState<Variable[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]), [selectedFrame, setFrame] = useState<number | null>(null);
  frameRef.current = selectedFrame;
  const alive = useRef(true), guard = useRef(false), latest = useRef<State | null>(null), version = useRef(0), pauseCallback = useRef(onPauseLine);
  pauseCallback.current = onPauseLine;
  const stale = (!!active(state) && !original) || (!!original && (original.documentKey !== snapshot.documentKey || original.code !== snapshot.code || original.metadata !== snapshot.metadata || original.input !== snapshot.input || original.title !== snapshot.title || original.language !== snapshot.language));
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await invoke<State | null>("debug_status");
        if (alive.current) { latest.current = next; setState(next); setOriginal(next && ownedSnapshot?.id === next.id ? ownedSnapshot.snapshot : null); }
      } catch (e) { if (alive.current) setError(String(e)); }
      finally { if (alive.current) timer = setTimeout(poll, 250); }
    }
    if (isTauri()) void poll();
    return () => { alive.current = false; ++version.current; ++evaluationVersion.current; clearTimeout(timer); pauseCallback.current(null); };
  }, []);
  async function inspect(kind: string, reference: number, current: State) {
    return invoke<Record<string, unknown>>("debug_request", { id: current.id, epoch: current.epoch, kind, reference });
  }
  function currentPause(current: State) {
    return alive.current && latest.current?.id === current.id && latest.current?.epoch === current.epoch && latest.current?.phase === "paused";
  }
  async function readChildren(reference: number, current = latest.current, frame = frameRef.current): Promise<Variable[]> {
    if (!current || !currentPause(current)) throw new Error("暂停位置已改变");
    const revision = inspectionVersion.current;
    const response = await inspect("variables", reference, current);
    if (revision !== inspectionVersion.current || !currentPause(current) || frameRef.current !== frame) throw new Error("忽略旧调用栈的变量");
    return debugVariables(response.variables);
  }
  async function showVariables(reference: number, current = latest.current) {
    if (!current || current.phase !== "paused") return;
    const request = ++version.current;
    try {
      const response = await inspect("variables", reference, current);
      if (alive.current && request === version.current && currentPause(current)) setVariables(debugVariables(response.variables));
    } catch (e) { if (alive.current && request === version.current) setError(String(e)); }
  }
  async function showFrame(frame: Frame, current = latest.current) {
    if (!current || current.phase !== "paused") return;
    const request = ++version.current; ++evaluationVersion.current; ++targetVersion.current;setTargets([]);setChoosing(false); setEvaluation(null); frameRef.current = frame.id; setFrame(frame.id); setVariables([]); setScopes([]);
    if (!stale && original && frame.inkleetSource!==false && (/(?:^|[\\/])(?:solution\.(?:py|go|cpp|c|rs)|Solution\.java)$/.test(frame.source?.path ?? frame.source?.name ?? ""))) pauseCallback.current({line:frame.line,column:frame.column,endLine:frame.endLine,endColumn:frame.endColumn,frameId:frame.id,execution:topFrame.current?.id===frame.id&&topFrame.current.thread===(current.threadId??0)});
    else pauseCallback.current(0);
    try {
      const response = await inspect("scopes", frame.id, current);
      if (!alive.current || request !== version.current || !currentPause(current)) return;
      const items = debugScopes(response.scopes); setScopes(items);
      const first = items.find(item => !item.expensive); if (first) await showVariables(first.variablesReference, current);
    } catch (e) { if (alive.current && request === version.current) setError(String(e)); }
  }
  async function showThread(thread: number, current = latest.current) {
    if (!current || !currentPause(current)) return;
    const request = ++version.current; ++evaluationVersion.current;
    setThread(thread); setFrames([]); setScopes([]); setVariables([]); setFrame(null); frameRef.current = null; setEvaluation(null); pauseCallback.current(0);
    try {
      const response = await inspect("stackTrace", thread, current);
      if (request !== version.current || !currentPause(current)) return;
      const items = debugFrames(response.stackFrames); setFrames(items); topFrame.current=items[0]?{id:items[0].id,thread:thread||current.threadId||0}:null;
      if (items[0]) await showFrame(items[0], current);
    } catch (e) { if (request === version.current && currentPause(current)) setError(String(e)); }
  }
  useEffect(() => {
    ++version.current; ++evaluationVersion.current; ++targetVersion.current;setTargets([]);setChoosing(false);setEvaluation(null); setThreads([]); setThread(null); setFrames([]); setScopes([]); setVariables([]); setFrame(null); frameRef.current = null; pauseCallback.current(0);
    if (!state || state.phase !== "paused") return;
    const current = state;
    void showThread(current.threadId ?? 0, current);
    void inspect("threads", 0, current).then(response => {
      if (currentPause(current)) setThreads(debugThreads(response.threads));
    }).catch(() => { /* Stack inspection remains usable if an adapter omits thread enumeration. */ });
  }, [state?.id, state?.epoch, stale, original?.code]);
  async function evaluate(value = expression, watchId?: number) {
    const current = latest.current, frame = frameRef.current;
    if (!current || current.phase !== "paused" || frame === null || guard.current || evaluationGuard.current || stale || snapshot.language === "java") return;
    if (!value.trim() || new TextEncoder().encode(value).length > 1024) { setError("请输入不超过 1024 字节的表达式"); return; }
    evaluationGuard.current = true; setEvaluating(true); setEvaluation(null); setError("");
    const token = ++evaluationVersion.current;
    // Evaluation may mutate even when the adapter reports an error. Hide all
    // previous inspection values before sending; never replay other watches.
    ++targetVersion.current;setTargets([]);setChoosing(false);
    const revision = ++inspectionVersion.current;
    setInspectionRevision(revision); ++version.current; setVariables([]);
    try {
      const result = await invoke<{ result: string; type?: string; truncated?: boolean; variablesReference: number }>("evaluate_debug", { id: current.id, epoch: current.epoch, frame, expression: value });
      if (alive.current && token === evaluationVersion.current && latest.current?.id === current.id && currentPause(current) && latest.current?.phase === "paused" && frameRef.current === frame) {
        if (watchId === undefined) setEvaluation(result);
        else setWatches(items => items.map(item => item.id === watchId ? {...item, result: result.result, error: undefined, token: `${current.id}:${current.epoch}:${frame}:${revision}`} : item));
      }
    } catch (e) {
      if (alive.current && token === evaluationVersion.current) {
        if (watchId === undefined) setError(String(e));
        else setWatches(items => items.map(item => item.id === watchId ? {...item, result: undefined, error: String(e), token: `${current.id}:${current.epoch}:${frame}:${revision}`} : item));
      }
    } finally {
      evaluationGuard.current = false;
      if (alive.current) setEvaluating(false);
      if (currentPause(current) && frameRef.current === frame && revision === inspectionVersion.current) {
        const request = ++version.current;
        try {
          const response = await inspect("scopes", frame, current);
          if (request === version.current && currentPause(current) && frameRef.current === frame) {
            const fresh = debugScopes(response.scopes); setScopes(fresh);
            const first = fresh.find(scope => !scope.expensive);
            if (first) await showVariables(first.variablesReference, current);
          }
        } catch (error) { if (request === version.current && currentPause(current)) setError(String(error)); }
      }
    }
  }
  async function chooseTarget(){
    const current=latest.current,frame=frameRef.current;
    if(!current||!currentPause(current)||frame===null||stale||current.capabilities?.supportsStepInTargetsRequest!==true||guard.current||evaluationGuard.current)return;
    const token=++targetVersion.current;setChoosing(true);setTargets([]);setError("");
    try{
      const response=await inspect("stepInTargets",frame,current);
      if(token!==targetVersion.current||!currentPause(current)||frameRef.current!==frame)return;
      const seen=new Set<number>();
      const values=(Array.isArray(response.targets)?response.targets:[]).slice(0,100).flatMap((item:unknown)=>{
        if(!item||typeof item!=="object")return [];
        const value=item as {id?:unknown;label?:unknown};
        if(typeof value.id!=="number"||!Number.isSafeInteger(value.id)||value.id<0||seen.has(value.id)||typeof value.label!=="string")return [];
        seen.add(value.id);return [{id:value.id,label:value.label.slice(0,200)}];
      });
      setTargets(values);if(!values.length)setNotice("当前位置没有可选步入目标");
    }catch(error){if(token===targetVersion.current&&currentPause(current))setError(String(error));}
    finally{if(token===targetVersion.current&&alive.current)setChoosing(false);}
  }
  async function action(kind: string, target?:number) {
    if (guard.current || (evaluationGuard.current && kind !== "stop")) return;
    guard.current = true; ++targetVersion.current;setTargets([]);setChoosing(false);setPending(true); setError(""); setNotice("");
    try {
      if (kind === "start") {
        const value = { ...snapshot };
        const id = await invoke<number>("start_debug", { snapshot: value, lines: breakpoints });
        ownedSnapshot = { id, snapshot: value };
        if (alive.current) setOriginal(value);
      } else if (state) {
        if (kind === "breakpoints") { await invoke("set_debug_breakpoints", {id: state.id, code: snapshot.code, lines: breakpoints}); if (alive.current) setNotice("断点已更新"); }
        else if (kind === "stop") await invoke("stop_debug", { id: state.id });
        else await invoke("debug_request", { id: state.id, epoch: state.epoch, kind, reference: target??0 });
      }
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { guard.current = false; if (alive.current) setPending(false); }
  }
  const inspectionOnly = selectedThread !== null && state?.threadId !== null && selectedThread !== state?.threadId;
  const keyAction=useRef<(kind:string)=>boolean>(()=>false);
  keyAction.current=kind=>{if(inspectionOnly && ["next","stepIn","stepOut"].includes(kind))return false;if(pending||guard.current||(evaluationGuard.current&&kind!=="stop")||!["python3","golang","cpp","c","rust","java"].includes(snapshot.language)||running)return false;void action(kind);return true;};
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.repeat||!isTauri()||event.altKey||event.ctrlKey||event.metaKey||document.querySelector("dialog[open]"))return;
      const current=latest.current;
      let kind:string|undefined;
      if(event.key==="F5"){if(event.shiftKey&&active(current))kind="stop";else if(!event.shiftKey)kind=current?.phase==="paused"?"continue":!active(current)?"start":undefined;}
      if(current?.phase==="paused"){if(event.key==="F10"&&!event.shiftKey)kind="next";if(event.key==="F11")kind=event.shiftKey?"stepOut":"stepIn";}
      if(kind&&keyAction.current(kind))event.preventDefault();
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[]);
  const paused = state?.phase === "paused";
  const frameToken = `${state?.id}:${state?.epoch}:${selectedFrame}:${inspectionRevision}`;
  function addWatch() { const value = expression.trim(); if (value && watches.length < 20 && !watches.some(w => w.expression === value)) setWatches(items => [...items, {id: ++watchNext.current, expression: value}]); }
  return <div className="debug-panel" aria-label="本地断点调试">
    <div className="local-actions">
      {!active(state) && <IconButton icon="play" label="开始调试" shortcut="F5" disabled={!isTauri() || !["python3", "golang", "cpp", "c", "rust", "java"].includes(snapshot.language) || !!active(state) || pending || running} onClick={() => action("start")} />}
      {active(state) && <><IconButton icon={paused ? "play" : "pause"} label={paused ? "继续" : "暂停"} shortcut={paused ? "F5" : undefined} disabled={pending || evaluating || !["paused", "running"].includes(state?.phase ?? "")} onClick={() => action(paused ? "continue" : "pause")} />
        {(["next", "stepIn", "stepOut"] as const).map((kind, index) => <IconButton key={kind} icon={(["next","into","out"] as const)[index]} label={["单步跳过", "单步进入", "单步跳出"][index]} shortcut={["F10","F11","Shift+F11"][index]} title={inspectionOnly ? "先选择当前暂停线程，再执行单步" : undefined} disabled={!paused || pending || evaluating || inspectionOnly} onClick={() => action(kind)} />)}
        {state?.capabilities?.supportsStepInTargetsRequest===true&&<IconButton icon="target" label="选择函数步入" disabled={!paused||pending||evaluating||choosing||inspectionOnly||stale||selectedFrame!==topFrame.current?.id} onClick={()=>void chooseTarget()} />}
        <IconButton icon="breakpoint" label="应用断点" disabled={pending || evaluating || stale || !original || !["paused", "running"].includes(state?.phase ?? "")} onClick={() => action("breakpoints")} /><IconButton icon="stop" label="停止调试" shortcut="Shift+F5" disabled={pending} onClick={() => action("stop")} /></>}
    </div>
    <div className="debug-body">    {targets.length>0&&<div className="debug-targets" role="group" aria-label="选择步入函数" onKeyDown={event=>{if(event.key==="Escape"){++targetVersion.current;setTargets([]);event.stopPropagation();}}}>{targets.map(target=><button key={target.id} onClick={()=>void action("stepInTarget",target.id)}>{target.label}</button>)}<IconButton icon="close" label="取消选择步入函数" onClick={()=>{++targetVersion.current;setTargets([]);}} /></div>}<div className="debug-meta"><span className="breakpoint-summary">断点：{breakpoints.join(", ") || "未设置"}。</span>
    <p role="status" hidden={!state} title={state?.reason}>{state ? state.phase === "paused" ? "已暂停" : state.phase === "finished" ? "调试结束 · " + state.reason : state.phase === "compiling" ? "正在编译调试快照…" : state.phase === "starting" ? "正在连接调试器…" : "调试运行中" : "尚未调试"}</p></div>
    {notice && <p role="status">{notice}</p>}
    {stale && <p className="cache-warning">代码或用例已改变，调试仍使用启动时快照；当前编辑器不显示旧快照停靠行。</p>}
    {(error || state?.error) && <p className="error" role="alert">{error || state?.error}</p>}
    {state?.breakpoints.some(b => !b.verified) && <p className="cache-warning">部分断点尚未验证，可能不是可执行行。</p>}
    {paused && <div className="debug-inspector"><div className="debug-frames"><h4>调用栈</h4>{threads.length > 1 && <select aria-label="调试线程" value={selectedThread ?? ""} onChange={event => void showThread(Number(event.target.value))}>{threads.map(thread => <option key={thread.id} value={thread.id}>{thread.name}</option>)}</select>}{frames.map(frame => <button key={frame.id} aria-pressed={frame.id === selectedFrame} title={`${frame.name} · ${frame.line}`} onClick={() => showFrame(frame)}><span className="debug-frame-name">{frame.name.slice(0, 200)}</span><span className="debug-frame-line"> · {frame.line}</span></button>)}</div>
      <div><h4>变量</h4><div className="local-actions">{scopes.map(scope => <button key={scope.variablesReference} onClick={() => showVariables(scope.variablesReference)}>{scope.name.slice(0,100)}</button>)}</div>
        {variables.map((variable,index) => <VariableNode key={frameToken + ":" + index + ":" + variable.name} variable={variable} token={frameToken} read={reference => readChildren(reference)} />)}</div></div>}
    {paused && <form className="debug-evaluate" aria-label="调试表达式" onSubmit={event => { event.preventDefault(); void evaluate(); }}>
      <label>表达式<input aria-label="调试表达式输入" value={expression} maxLength={1024} disabled={evaluating || snapshot.language === "java"} onChange={event => { ++evaluationVersion.current; setExpression(event.target.value); setEvaluation(null); }} placeholder="" /></label>
      <IconButton icon="play" label="求值一次" title={snapshot.language === "java" ? "Java 暂不支持表达式求值" : "求值一次 · 可能改变程序状态；超时停止当前调试"} type="submit" disabled={pending || evaluating || stale || selectedFrame === null || !expression.trim() || snapshot.language === "java"} />
      {evaluation && <div className="debug-evaluation-result"><pre>{evaluation.result}</pre>{evaluation.type && <span>{evaluation.type}</span>}{evaluation.truncated && <p>结果过长，已截断显示。</p>}{evaluation.variablesReference > 0 && <button type="button" onClick={() => showVariables(evaluation.variablesReference)}>展开求值结果</button>}</div>}
    </form>}
    {paused && <section className="debug-watches" aria-label="监视表达式">
      <header><h4>Watches</h4><IconButton icon="add" type="button" label="添加监视表达式" title="添加当前表达式；仅手动刷新，表达式可能改变程序状态" disabled={!expression.trim() || watches.length >= 20 || watches.some(w => w.expression === expression.trim())} onClick={addWatch} /></header>
      {watches.map(watch => <div className="debug-watch" key={watch.id}>
        <code title={watch.expression}>{watch.expression}</code>
        <span className={watch.error ? "error" : ""}>{watch.token === frameToken ? watch.error ?? watch.result : "—"}</span>
        <IconButton icon="refresh" label={"刷新监视 " + watch.expression} title="在当前栈帧求值一次，可能改变程序状态" disabled={pending || evaluating || stale || selectedFrame === null || snapshot.language === "java"} onClick={() => void evaluate(watch.expression, watch.id)} />
        <IconButton icon="close" type="button" label={"删除监视 " + watch.expression} onClick={() => setWatches(items => items.filter(item => item.id !== watch.id))} />
      </div>)}
    </section>}
    {state?.output && <pre>{state.output}</pre>}
    </div>
  </div>;
}
