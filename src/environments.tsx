import React, { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
type Tool = { id: string; version: string; size: number; phase: string; downloaded: number; message: string };
type Overview = { platform: string; supported: boolean; tools: Tool[] };
const labels: Record<string, string> = { debugpy: "Python 调试器 · debugpy", python: "Python 运行时与标准库", node: "语言服务运行时", pyright: "Python 语言服务 · Pyright" };
const phases: Record<string, string> = { ready: "已安装", missing: "未安装", broken: "需要修复", queued: "准备中", downloading: "下载中", verifying: "校验中", extracting: "解压中", canceling: "取消中", canceled: "已取消", error: "未完成" };
const busy = (phase: string) => ["queued", "downloading", "verifying", "extracting", "canceling"].includes(phase);
const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + " MiB";
export function Environments({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const pending = useRef(new Set<string>());
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [, setActions] = useState(0);
  const statusSequence = useRef(0);
  async function refreshStatus() {
    const sequence = ++statusSequence.current;
    const value = await invoke<Overview>("environment_status");
    if (alive.current && sequence === statusSequence.current) setOverview(value);
  }
  useEffect(() => {
    dialog.current?.showModal(); alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!isTauri()) return;
      try {
        await refreshStatus();
      } catch (e) { if (alive.current) setError(String(e)); }
      finally { if (alive.current) timer = setTimeout(poll, 700); }
    }
    void poll();
    return () => { alive.current = false; clearTimeout(timer); };
  }, []);
  async function action(id: string, cancel = false) {
    if (pending.current.has(id)) return;
    pending.current.add(id); setActions(v => v + 1); setError("");
    try {
      await invoke(cancel ? "cancel_environment_install" : "install_environment", { id });
      await refreshStatus();
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { pending.current.delete(id); if (alive.current) setActions(v => v + 1); }
  }
  return <dialog ref={dialog} className="environments" aria-labelledby="environment-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><h2 id="environment-title">开发环境</h2><button onClick={onClose}>关闭</button></header>
    <p>工具由墨题下载并保存在自己的目录中，不修改系统 PATH，也不需要你预装 Python 或 Node.js。</p>
    <p className="muted">固定版本与 SHA-256 校验，失败保留下载断点。关闭这个窗口后，安装仍会继续。环境隔离不等于运行不可信代码的安全沙箱。</p>
    {!isTauri() ? <p>请在原生桌面客户端安装开发环境。</p> : !overview ? <p role="status">正在检查本机工具…</p> : !overview.supported ? <p>当前平台尚未提供本地开发环境；仍可编辑、保存和导出源码。</p> : <>
      <div className="environment-summary"><span>{overview.platform}</span><button disabled={overview.tools.every(t => t.phase === "ready" || busy(t.phase) || pending.current.has(t.id))} onClick={() => { for (const tool of overview.tools) if (tool.phase !== "ready" && !busy(tool.phase)) void action(tool.id); }}>安装缺少的 Python 工具</button></div>
      <div className="environment-tools">{overview.tools.map(tool => <section key={tool.id} data-tool={tool.id}>
        <div><strong>{labels[tool.id] ?? tool.id}</strong><small>{tool.version} · 下载 {mib(tool.size)}</small></div>
        <div><span role="status">{phases[tool.phase] ?? tool.phase}</span>{busy(tool.phase) ? <button disabled={tool.phase === "canceling" || pending.current.has(tool.id)} onClick={() => void action(tool.id, true)}>取消</button> : tool.phase !== "ready" && <button disabled={pending.current.has(tool.id)} onClick={() => void action(tool.id)}>{tool.phase === "missing" ? "安装" : "重试 / 修复"}</button>}</div>
        {busy(tool.phase) && <progress max={tool.size} value={tool.downloaded} aria-label={labels[tool.id] + "下载进度"} />}
        {tool.message && <p className={tool.phase === "error" || tool.phase === "broken" ? "error" : "muted"}>{tool.message}</p>}
      </section>)}</div>
    </>}
    {error && <p role="alert" className="error">{error}</p>}
    <p className="muted">Rust、Go、C/C++、Java 工具链和对应调试器仍在接入，未安装项不会伪装成可用。下载来源：Python Build Standalone、Node.js 官方发行版、Microsoft Pyright / debugpy。</p>
  </dialog>;
}
