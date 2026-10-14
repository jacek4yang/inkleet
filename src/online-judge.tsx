import { IconButton } from "./icons";
import React, { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Language } from "./domain";
import type { RemoteQuestion } from "./catalogue";
import type { Identity } from "./login";
type Kind = "online-run" | "submission";
type Snapshot = Readonly<{ id: string; account: string; questionId: string; slug: string; language: Language; solution?: string; code: string; testCase: string; kind: Kind }>;
type State =
  | { state: "waiting"; server_id: string }
  | { state: "finished"; server_id: string; result: Record<string, unknown> }
  | { state: "unknown" | "rejected" | "acknowledged"; message: string };
type Job = { snapshot: Snapshot; state: State; created: number };
function Confirm({ title, children, accept, dismiss }: { title: string; children: React.ReactNode; accept: () => void; dismiss: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog className="judge-confirm" ref={ref} onCancel={e => { e.preventDefault(); dismiss(); }} aria-label={title}>
    <h2>{title}</h2>{children}<div><button onClick={dismiss}>取消</button><button className="primary" onClick={accept}>确认</button></div>
  </dialog>;
}
function printable(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
}
export function useOnlineJudge({ identity, question, language, solution = "default", code }: {
  identity: Identity | null; question: RemoteQuestion | undefined; language: Language; solution?: string; code: string;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cases, setCases] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<Snapshot | null>(null);
  const [ack, setAck] = useState<Job | null>(null);
  const guard = useRef(false);
  const generation = useRef(0);
  const account = identity?.account ?? "";
  const input = question ? cases[question.questionId] ?? question.exampleTestcases ?? question.sampleTestCase ?? "" : "";
  const related = jobs.filter(j => j.snapshot.account === account && j.snapshot.questionId === question?.questionId);
  const current = [...related].reverse().find(j => j.snapshot.language === language && (j.snapshot.solution ?? "default") === solution);
  const blocked = related.some(j => ["waiting", "unknown"].includes(j.state.state));
  function remember(job: Job) { setJobs(old => [...old.filter(j => j.snapshot.id !== job.snapshot.id), job]); }
  useEffect(() => {
    const token = ++generation.current;
    guard.current = false; setBusy(false); setConfirm(null); setAck(null); setError(""); setPhase("");
    if (!account || !isTauri()) { setJobs([]); return; }
    invoke<Job[]>("list_judgements", { account }).then(data => {
      if (generation.current === token) setJobs(data);
    }).catch(e => { if (generation.current === token) setError(String(e)); });
    return () => { generation.current++; };
  }, [account]);
  async function poll(initial: Job, token: number) {
    let job = initial;
    const deadline = Date.now() + 120_000;
    while (job.state.state === "waiting" && generation.current === token) {
      if (Date.now() >= deadline) { setPhase("仍在评测；已停止等待，可继续查询。不会重新提交。"); return; }
      await new Promise(resolve => setTimeout(resolve, 1800));
      if (generation.current !== token) return;
      job = await invoke<Job>("check_judge", { account: job.snapshot.account, id: job.snapshot.id });
      if (generation.current !== token) return;
      remember(job);
    }
    if (generation.current === token) setPhase("");
  }
  async function send(snapshot: Snapshot) {
    if (guard.current) return;
    guard.current = true; const token = ++generation.current;
    setConfirm(null); setOpen(true); setBusy(true); setError(""); setPhase("正在发送一次请求…");
    try {
      const job = await invoke<Job>("start_judge", { snapshot });
      if (generation.current !== token) return;
      remember(job);
      setPhase(job.state.state === "waiting" ? "中国站正在评测…" : "");
      await poll(job, token);
    } catch (e) {
      if (generation.current === token) {
        setError(String(e)); setPhase("");
        // IPC 失败后只恢复本机日志，绝不自动再次发送评测。
        try { const saved = await invoke<Job[]>("list_judgements", { account: snapshot.account }); if (generation.current === token) setJobs(saved); } catch {}
      }
    } finally { if (generation.current === token) { guard.current = false; setBusy(false); } }
  }
  function request(kind: Kind) {
    if (!identity || !question || guard.current || blocked) return;
    if (!code.trim()) { setOpen(true); setError("请先编写代码。"); return; }
    const snapshot: Snapshot = Object.freeze({
      id: crypto.randomUUID(), account, questionId: question.questionId, slug: question.titleSlug,
      language, solution, code, testCase: input, kind,
    });
    if (kind === "submission") setConfirm(snapshot); else void send(snapshot);
  }
  async function resume(job: Job) {
    if (guard.current) return;
    guard.current = true; const token = ++generation.current;
    setBusy(true); setError(""); setPhase("继续查询原评测编号…");
    try {
      const latest = await invoke<Job>("check_judge", { account: job.snapshot.account, id: job.snapshot.id });
      if (generation.current !== token) return;
      remember(latest); await poll(latest, token);
    } catch (e) { if (generation.current === token) { setError(String(e)); setPhase(""); } }
    finally { if (generation.current === token) { guard.current = false; setBusy(false); } }
  }
  function stopWaiting() {
    // 只在已经取得评测编号后提供取消；取消不声称终止远端评测。
    generation.current++; guard.current = false; setBusy(false);
    setPhase("已停止等待，远端评测可能仍在进行；可继续查询原编号。");
  }
  async function acknowledge(job: Job) {
    setAck(null);
    try { remember(await invoke<Job>("acknowledge_unknown_judge", { account: job.snapshot.account, id: job.snapshot.id, confirmed: true })); }
    catch (e) { setError(String(e)); }
  }
  const stale = current && (current.snapshot.code !== code || (current.snapshot.kind === "online-run" && current.snapshot.testCase !== input));
  const panel = question && <>
    <div className="judge-toggle"><IconButton icon="tests" label={open ? "收起测试与结果" : "测试用例与结果"} aria-expanded={open} onClick={() => setOpen(!open)} /></div>
    {open && <section className="judge-panel" aria-label="在线评测">
      <label>测试用例<textarea aria-label="在线测试用例" spellCheck={false} value={input} onChange={e => setCases(old => ({ ...old, [question.questionId]: e.target.value }))} /></label>
      {phase && <p role="status">{phase}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {current && <div className="judge-result">
        <strong>{current.snapshot.kind === "submission" ? "正式提交" : "在线运行"} · {current.snapshot.language}</strong>
        {stale && <p className="cache-warning">结果对应发起时的代码和用例快照；当前内容已改变。</p>}
        {current.state.state === "waiting" && <><p>评测编号：{current.state.server_id}</p>
          {busy ? <button onClick={stopWaiting}>停止等待</button> : <button onClick={() => resume(current)}>继续查询</button>}</>}
        {current.state.state === "unknown" && <><p className="error">{current.state.message}</p><button disabled={busy} onClick={() => setAck(current)}>我已核查官方记录</button></>}
        {["rejected", "acknowledged"].includes(current.state.state) && <p>{"message" in current.state ? current.state.message : ""}</p>}
        {current.state.state === "finished" && <>
          <p>{printable(current.state.result.status_msg ?? "评测已结束")} · 编号 {current.state.server_id}</p>
          {current.snapshot.kind === "online-run" && <p className="cache-warning">这是测试用例运行结果，不代表正式提交通过。</p>}
          {Object.entries(current.state.result).filter(([key]) => key !== "status_msg").map(([key, value]) =>
            <details key={key} open={["full_compile_error", "full_runtime_error", "code_output", "expected_output"].includes(key)}><summary>{key}</summary><pre>{printable(value)}</pre></details>)}
        </>}
      </div>}
      {blocked && !current && <p>其他解答有待确认评测，请切回处理。</p>}
    </section>}
    {confirm && <Confirm title="确认正式提交" dismiss={() => setConfirm(null)} accept={() => send(confirm)}>
      <p>将这份 {confirm.language} 代码快照发送给 leetcode.cn，记入账号 {identity?.username} 的正式提交记录。</p>
      <p>题目：{confirm.slug}；代码 {confirm.code.length} 字符。不会上传笔记。</p>
    </Confirm>}
    {ack && <Confirm title="解除未知提交保护" dismiss={() => setAck(null)} accept={() => acknowledge(ack)}>
      <p>只有确认已查看官方提交记录后再继续。上次请求可能已被接收，再次提交可能产生重复记录。</p>
      <p>这一步只解除保护，不会自动重发代码。</p>
    </Confirm>}
  </>;
  return { busy, blocked, run: () => request("online-run"), submit: () => request("submission"), panel };
}
