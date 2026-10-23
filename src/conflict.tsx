import React, { useLayoutEffect, useRef, useState } from "react";
export type FileConflict = { key: string; saveKey: string; problem: string; language: string; solution?: string; kind: "code" | "notes"; local: string; external: string | null };
export function ConflictDialog({ conflict, onRefresh, onResolve, onClose }: {
  conflict: FileConflict; onRefresh: () => Promise<void>;
  onResolve: (choice: "local" | "external") => Promise<void>; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const guard = useRef(false);
  useLayoutEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  async function act(operation: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true; setPending(true); setError("");
    try { await operation(); } catch (e) { setError(String(e)); }
    finally { guard.current = false; setPending(false); }
  }
  return <dialog ref={ref} className="file-conflict" aria-labelledby="conflict-title" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <header><div><h2 id="conflict-title">{conflict.kind === "code" ? "源码" : "笔记"}文件冲突</h2><p>题目 {conflict.problem} · {conflict.kind === "code" ? conflict.language : "notes.md"}</p></div><button disabled={pending} onClick={onClose}>稍后处理</button></header>
    <p>确认后先将这两份内容保留到本题的 .inkleet-recovery 目录，再应用你的选择。外部文件再次变化时会停止，要求重新对比。</p>
    <div className="conflict-versions">
      <label>编辑器版本<textarea aria-label="冲突编辑器版本" readOnly value={conflict.local} spellCheck={false} /></label>
      <label>{conflict.external === null ? "文件版本（已删除）" : "文件版本"}<textarea aria-label="冲突文件版本" readOnly value={conflict.external ?? ""} spellCheck={false} /></label>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="conflict-actions"><button data-conflict="refresh" disabled={pending} onClick={() => void act(onRefresh)}>刷新对比</button><button data-conflict="external" disabled={pending} onClick={() => void act(() => onResolve("external"))}>使用文件版本</button><button data-conflict="local" disabled={pending} onClick={() => void act(() => onResolve("local"))}>使用编辑器版本</button></div>
    {pending && <p role="status">正在保护副本并处理…</p>}
  </dialog>;
}
