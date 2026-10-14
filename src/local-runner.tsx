import React, { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { DebugPanel } from "./debug-panel";
import type { Language } from "./domain";
type Snapshot = { code: string; input: string; metadata: string; title: string; language: Language };
type Result = { id: number; phase: string; title: string; stdout: string; stderr: string; results: string[]; exitCode: number | null; timedOut: boolean; canceled: boolean; truncated: boolean; elapsedMs: number; error: string };
const busy = (r: Result | null) => !!r && ["queued", "compiling", "running", "canceling"].includes(r.phase);
export function LocalRunner({ code, language, title, metadata, sampleInput, onClose, breakpoints, onPauseLine }: {
  code: string; language: Language; title: string; metadata: string; sampleInput: string; onClose: () => void; breakpoints: number[]; onPauseLine: (line: number) => void;
}) {
  const [input, setInput] = useState(sampleInput);
  const [pane, setPane] = useState<"run" | "debug">("run");
  const [result, setResult] = useState<Result | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const guard = useRef(false), alive = useRef(true), sequence = useRef(0);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const current = ++sequence.current;
      try {
        const next = await invoke<Result | null>("local_run_status");
        if (alive.current && sequence.current === current) setResult(next);
      } catch (e) { if (alive.current) setError(String(e)); }
      finally { if (alive.current) timer = setTimeout(poll, 300); }
    }
    if (isTauri()) void poll();
    return () => { alive.current = false; clearTimeout(timer); };
  }, []);
  useEffect(() => { if (!["python3", "golang", "cpp", "c", "rust", "java"].includes(language)) setPane("run"); }, [language]);
  async function run() {
    if (guard.current || busy(result)) return;
    guard.current = true; setPending(true); setError("");
    const next = { code, input, metadata, title, language };
    try {
      const id = await invoke<number>("start_local_run", { snapshot: next });
      if (alive.current) {
        ++sequence.current;
        setSnapshot(next);
        setResult({ id, phase: "queued", title, stdout: "", stderr: "", results: [], exitCode: null, timedOut: false, canceled: false, truncated: false, elapsedMs: 0, error: "" });
      }
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { guard.current = false; if (alive.current) setPending(false); }
  }
  async function cancel() {
    if (!result || guard.current) return;
    guard.current = true;
    try { await invoke("cancel_local_run", { id: result.id }); }
    catch (e) { if (alive.current) setError(String(e)); }
    finally { guard.current = false; }
  }
  const stale = snapshot && (snapshot.code !== code || snapshot.input !== input || snapshot.language !== language || snapshot.metadata !== metadata || snapshot.title !== title);
  return <section className="local-runner" aria-label="本地运行">
    <header><div className="local-actions"><button data-local-tab="run" aria-pressed={pane === "run"} onClick={() => setPane("run")}>运行结果</button><button data-local-tab="debug" disabled={!["python3", "golang", "cpp", "c", "rust", "java"].includes(language)} title={["python3", "golang", "cpp", "c", "rust", "java"].includes(language) ? "断点调试" : "此语言的界面调试尚未接入"} aria-pressed={pane === "debug"} onClick={() => setPane("debug")}>调试</button></div><button onClick={onClose}>收起</button></header>
    <details className="local-safety"><summary>仅运行可信代码 · 本机执行，不上传 · 非安全沙箱</summary><p className="muted">使用应用独立工具链执行快照。Java / Go / C 源码编译最多 120 秒，Rust / C/C++ 首次准备标准库及链接最多 240 秒；程序运行 10 秒超时，输出最多 64 KiB。以当前用户权限运行，Java 堆内存上限 256 MiB，其他语言尚无内存硬限制。</p></details>
    <div data-runner-pane="run" hidden={pane !== "run"}>
    <label>测试输入<textarea aria-label="本地测试输入" value={input} onChange={e => setInput(e.target.value)} spellCheck={false} placeholder="每个参数填写一个 JSON 值；多组用例依次排列。" /></label>
    <div className="local-actions"><button data-action="local-execute" onClick={run} disabled={!isTauri() || !["python3", "golang", "cpp", "c", "rust", "java"].includes(language) || pending || busy(result)}>{pending ? "启动中…" : "本地执行"}</button>{busy(result) && <button onClick={cancel} disabled={result?.phase === "canceling"}>停止</button>}<span role="status">{result ? busy(result) ? result.phase === "canceling" ? "正在停止" : result.phase === "compiling" ? "编译中…" : "执行中…" : result.canceled ? "已停止" : result.timedOut ? "超过时限，已终止" : result.phase === "error" || result.error ? "未完成" : "执行结束 · " + result.elapsedMs + " ms" : "尚未运行"}</span></div>
    {stale && <p className="cache-warning">当前代码或用例已改变，下面是上一次快照的结果。</p>}
    {!snapshot && result && <p className="muted">以下为先前运行的结果，不能视为当前草稿的结果。</p>}
    {(error || result?.error) && <p role="alert" className="error">{error || result?.error}</p>}
    {result?.truncated && <p role="alert">输出达到上限，已截断并终止进程。</p>}
    {result?.results.map((value, index) => <pre key={index} className="local-result">{value}</pre>)}
    {result?.stdout && <><h4>标准输出</h4><pre>{result.stdout}</pre></>}
    {result?.stderr && <><h4>错误输出</h4><pre>{result.stderr}</pre></>}

    {result && !busy(result) && <p className="muted">退出码：{result.exitCode ?? "无"}。本地输出仅供调试，不代表通过力扣判题。</p>}
    </div>
    <div data-runner-pane="debug" hidden={pane !== "debug"}><DebugPanel snapshot={{ code, input, metadata, title, language }} breakpoints={breakpoints} onPauseLine={onPauseLine} running={busy(result) || pending} /></div>
  </section>;
}
