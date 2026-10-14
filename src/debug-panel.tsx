import React, { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Language } from "./domain";
type Snapshot = { code: string; input: string; metadata: string; title: string; language: Language };
type State = { id: number; phase: string; title: string; threadId: number | null; epoch: number; output: string; truncated: boolean; reason: string; error: string; breakpoints: { line?: number; verified?: boolean; message?: string }[] };
type Frame = { id: number; name: string; line: number; source?: { name?: string; path?: string } };
type Scope = { name: string; variablesReference: number; expensive?: boolean };
type Variable = { name: string; value: string; type?: string; variablesReference: number };
const active = (state: State | null) => state && state.phase !== "finished";
export function DebugPanel({ snapshot, breakpoints, onPauseLine, running }: { snapshot: Snapshot; breakpoints: number[]; onPauseLine: (line: number) => void; running: boolean }) {
  const [state, setState] = useState<State | null>(null), [original, setOriginal] = useState<Snapshot | null>(null);
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
  const stale = !!original && (original.code !== snapshot.code || original.metadata !== snapshot.metadata || original.input !== snapshot.input || original.title !== snapshot.title || original.language !== snapshot.language);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await invoke<State | null>("debug_status");
        if (alive.current) { latest.current = next; setState(next); }
      } catch (e) { if (alive.current) setError(String(e)); }
      finally { if (alive.current) timer = setTimeout(poll, 250); }
    }
    if (isTauri()) void poll();
    return () => { alive.current = false; ++version.current; ++evaluationVersion.current; clearTimeout(timer); pauseCallback.current(0); };
  }, []);
  async function inspect(kind: string, reference: number, current: State) {
    return invoke<Record<string, unknown>>("debug_request", { id: current.id, epoch: current.epoch, kind, reference });
  }
  async function showVariables(reference: number, current = latest.current) {
    if (!current || current.phase !== "paused") return;
    const request = ++version.current;
    try {
      const response = await inspect("variables", reference, current);
      if (alive.current && request === version.current && latest.current?.epoch === current.epoch) setVariables((response.variables as Variable[] ?? []).slice(0, 100));
    } catch (e) { if (alive.current && request === version.current) setError(String(e)); }
  }
  async function showFrame(frame: Frame, current = latest.current) {
    if (!current || current.phase !== "paused") return;
    const request = ++version.current; ++evaluationVersion.current; setEvaluation(null); frameRef.current = frame.id; setFrame(frame.id); setVariables([]);
    if (!stale && original && (/(?:^|[\\/])(?:solution\.(?:py|go|cpp|c|rs)|Solution\.java)$/.test(frame.source?.path ?? frame.source?.name ?? ""))) pauseCallback.current(frame.line);
    else pauseCallback.current(0);
    try {
      const response = await inspect("scopes", frame.id, current);
      if (!alive.current || request !== version.current || latest.current?.epoch !== current.epoch) return;
      const items = (response.scopes as Scope[] ?? []).slice(0, 20); setScopes(items);
      if (items[0]) await showVariables(items[0].variablesReference, current);
    } catch (e) { if (alive.current && request === version.current) setError(String(e)); }
  }
  useEffect(() => {
    ++version.current; ++evaluationVersion.current; setEvaluation(null); setFrames([]); setScopes([]); setVariables([]); setFrame(null); pauseCallback.current(0);
    if (!state || state.phase !== "paused") return;
    const current = state, request = version.current;
    void inspect("stackTrace", 0, current).then(async response => {
      if (!alive.current || request !== version.current || latest.current?.epoch !== current.epoch) return;
      const items = (response.stackFrames as Frame[] ?? []).slice(0,64); setFrames(items);
      if (items[0]) await showFrame(items[0], current);
    }).catch(e => { if (alive.current && request === version.current) setError(String(e)); });
  }, [state?.id, state?.epoch, stale, original?.code]);
  async function evaluate() {
    const current = latest.current, frame = frameRef.current;
    if (!current || current.phase !== "paused" || frame === null || guard.current || evaluationGuard.current || stale || snapshot.language === "java") return;
    if (!expression.trim() || new TextEncoder().encode(expression).length > 1024) { setError("请输入不超过 1024 字节的表达式"); return; }
    evaluationGuard.current = true; setEvaluating(true); setEvaluation(null); setError("");
    const token = ++evaluationVersion.current;
    try {
      const result = await invoke<{ result: string; type?: string; truncated?: boolean; variablesReference: number }>("evaluate_debug", { id: current.id, epoch: current.epoch, frame, expression });
      if (alive.current && token === evaluationVersion.current && latest.current?.id === current.id && latest.current?.epoch === current.epoch && latest.current?.phase === "paused" && frameRef.current === frame) setEvaluation(result);
    } catch (e) {
      if (alive.current && token === evaluationVersion.current) setError(String(e));
    } finally { evaluationGuard.current = false; if (alive.current) setEvaluating(false); }
  }
  async function action(kind: string) {
    if (guard.current || (evaluationGuard.current && kind !== "stop")) return;
    guard.current = true; setPending(true); setError(""); setNotice("");
    try {
      if (kind === "start") {
        const value = { ...snapshot };
        await invoke("start_debug", { snapshot: value, lines: breakpoints });
        if (alive.current) setOriginal(value);
      } else if (state) {
        if (kind === "breakpoints") { await invoke("set_debug_breakpoints", {id: state.id, code: snapshot.code, lines: breakpoints}); if (alive.current) setNotice("断点已更新"); }
        else if (kind === "stop") await invoke("stop_debug", { id: state.id });
        else await invoke("debug_request", { id: state.id, epoch: state.epoch, kind, reference: 0 });
      }
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { guard.current = false; if (alive.current) setPending(false); }
  }
  const keyAction=useRef<(kind:string)=>boolean>(()=>false);
  keyAction.current=kind=>{if(pending||guard.current||(evaluationGuard.current&&kind!=="stop")||!["python3","golang","cpp","c","rust","java"].includes(snapshot.language)||running)return false;void action(kind);return true;};
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
  return <div className="debug-panel" aria-label="本地断点调试">
    <div className="local-actions"><strong>断点调试</strong>
      <button disabled={!isTauri() || !["python3", "golang", "cpp", "c", "rust", "java"].includes(snapshot.language) || !!active(state) || pending || running} onClick={() => action("start")}>{pending && !active(state) ? "启动调试…" : "开始调试"}</button>
      {active(state) && <><button disabled={pending || evaluating || !["paused", "running"].includes(state?.phase ?? "")} onClick={() => action(paused ? "continue" : "pause")}>{paused ? "继续" : "暂停"}</button>
        {(["next", "stepIn", "stepOut"] as const).map((kind, index) => <button key={kind} disabled={!paused || pending || evaluating} onClick={() => action(kind)}>{["单步跳过", "单步进入", "单步跳出"][index]}</button>)}
        <button disabled={pending || evaluating || stale || !original || !["paused", "running"].includes(state?.phase ?? "")} onClick={() => action("breakpoints")}>应用断点</button><button disabled={pending} onClick={() => action("stop")}>停止调试</button></>}
    </div>
    <p className="muted">点击代码左侧断点栏或按 F9。断点：{breakpoints.join(", ") || "未设置"}。运行中可用“应用断点”更新。F5 开始 / 继续，F10 单步跳过，F11 进入，Shift+F11 跳出，Shift+F5 停止。连续执行限时 30 秒，整个会话最多 30 分钟。</p>
    <p role="status">{state ? state.phase === "paused" ? "已暂停 · " + state.reason : state.phase === "finished" ? "调试结束 · " + state.reason : state.phase === "compiling" ? "正在编译调试快照…" : state.phase === "starting" ? "正在连接调试器…" : "调试运行中" : "尚未调试"}</p>
    {notice && <p role="status">{notice}</p>}
    {stale && <p className="cache-warning">代码或用例已改变，调试仍使用启动时快照；当前编辑器不显示旧快照停靠行。</p>}
    {(error || state?.error) && <p className="error" role="alert">{error || state?.error}</p>}
    {state?.breakpoints.some(b => !b.verified) && <p className="cache-warning">部分断点尚未验证，可能不是可执行行。</p>}
    {paused && <div className="debug-inspector"><div><h4>调用栈</h4>{frames.map(frame => <button key={frame.id} aria-pressed={frame.id === selectedFrame} onClick={() => showFrame(frame)}>{frame.name.slice(0, 200)} · {frame.line}</button>)}</div>
      <div><h4>变量</h4><div className="local-actions">{scopes.map(scope => <button key={scope.variablesReference} onClick={() => showVariables(scope.variablesReference)}>{scope.name.slice(0,100)}</button>)}</div>
        {variables.map((variable,index) => <div className="debug-variable" key={index}><button disabled={!variable.variablesReference} onClick={() => showVariables(variable.variablesReference)}>{variable.variablesReference ? "▸ " : ""}{variable.name.slice(0,200)}</button><code>{variable.value.slice(0,4000)}</code></div>)}</div></div>}
    {paused && <form className="debug-evaluate" aria-label="调试表达式" onSubmit={event => { event.preventDefault(); void evaluate(); }}>
      <label>表达式<input aria-label="调试表达式输入" value={expression} maxLength={1024} disabled={evaluating || snapshot.language === "java"} onChange={event => { ++evaluationVersion.current; setExpression(event.target.value); setEvaluation(null); }} placeholder="例如 len(values) 或 total + 1" /></label>
      <button type="submit" disabled={pending || evaluating || stale || selectedFrame === null || !expression.trim() || snapshot.language === "java"}>{evaluating ? "求值中…" : "求值一次"}</button>
      <p className="muted">{snapshot.language === "java" ? "当前 Java 调试核心暂不支持表达式求值。" : "仅显式点击时求值，不会自动重复。表达式可能调用函数或改变程序状态；超时将停止本次调试。"}</p>
      {evaluation && <div className="debug-evaluation-result"><pre>{evaluation.result}</pre>{evaluation.type && <span>{evaluation.type}</span>}{evaluation.truncated && <p>结果过长，已截断显示。</p>}{evaluation.variablesReference > 0 && <button type="button" onClick={() => showVariables(evaluation.variablesReference)}>展开求值结果</button>}</div>}
    </form>}
    {state?.output && <pre>{state.output}</pre>}
  </div>;
}
