import React, { useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileConflict } from "./conflict";
type Entry = { id: string; modified: number; bytes: number };
type Backup = { format: string; file: string; local: string; external: string | null; choice: string };
export function RecoveryDialog({ target, onClose, onRefresh, onRestore }: {
  target: FileConflict; onClose: () => void; onRefresh: () => Promise<void>;
  onRestore: (id: string, side: "local" | "external", reviewed: string | null) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null), generation = useRef(0), guard = useRef(false);
  const [entries, setEntries] = useState<Entry[]>([]), [unreadable, setUnreadable] = useState(0);
  const [selected, setSelected] = useState<{ id: string; backup: Backup } | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const args = { problem: target.problem, language: target.language, solution: target.solution, kind: target.kind };
  async function act(fn: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true; setPending(true); setError("");
    try { await fn(); } catch (e) { setError(String(e)); }
    finally { guard.current = false; setPending(false); }
  }
  async function list() {
    const token = ++generation.current;
    const result = await invoke<{ entries: Entry[]; unreadable: number }>("list_recovery", args);
    if (token !== generation.current) return;
    setEntries(result.entries); setUnreadable(result.unreadable); setSelected(null);
  }
  useLayoutEffect(() => {
    dialog.current!.showModal(); void act(list);
    return () => { ++generation.current; dialog.current?.close(); };
  }, []);
  return <dialog ref={dialog} className="file-recovery file-conflict" aria-labelledby="recovery-title" onCancel={e => { e.preventDefault(); if (!pending) onClose(); }}>
    <header><div><h2 id="recovery-title">{target.kind === "notes" ? "笔记" : "源码"}恢复副本</h2><p>{target.problem} · {target.kind === "notes" ? "notes.md" : target.language}</p></div><button disabled={pending} onClick={onClose}>关闭恢复记录</button></header>
    <p>这里只列出处理文件冲突时保留的副本，不是完整编辑历史。恢复前会再次保存当前编辑器和文件版本；文件或草稿变化时要求刷新确认。</p>
    <button disabled={pending} data-recovery="refresh" onClick={() => void act(async () => { await onRefresh(); await list(); })}>刷新记录与当前版本</button>
    {unreadable > 0 && <p role="alert">有 {unreadable} 个条目无法读取，已保留在磁盘，未自动删除。</p>}
    <div className="recovery-list" aria-label="恢复记录">{entries.map(entry => <button key={entry.id} data-recovery-id={entry.id} disabled={pending} aria-pressed={selected?.id === entry.id} onClick={() => void act(async () => {
      const token = ++generation.current;
      const backup = await invoke<Backup>("read_recovery", { ...args, id: entry.id });
      if (token === generation.current) setSelected({ id: entry.id, backup });
    })}>{entry.modified ? new Date(entry.modified * 1000).toLocaleString() : "时间未知"} · {Math.ceil(entry.bytes / 1024)} KiB · {entry.id}</button>)}</div>
    {!pending && entries.length === 0 && <p>当前文件还没有冲突恢复副本。</p>}
    {selected && <><div className="conflict-versions">
      <label>当时的编辑器版本<textarea aria-label="恢复编辑器副本" readOnly value={selected.backup.local} spellCheck={false} /></label>
      <label>{selected.backup.external === null ? "当时文件不存在（恢复为空白稿）" : "当时的文件版本"}<textarea aria-label="恢复文件副本" readOnly value={selected.backup.external ?? ""} spellCheck={false} /></label>
    </div><div className="conflict-actions">
      <button data-recovery="local" disabled={pending} onClick={() => void act(() => onRestore(selected.id, "local", selected.backup.local))}>保留当前两份内容并恢复编辑器副本</button>
      <button data-recovery="external" disabled={pending} onClick={() => void act(() => onRestore(selected.id, "external", selected.backup.external))}>保留当前两份内容并恢复文件副本</button>
    </div></>}
    {error && <p className="error" role="alert">{error}</p>}
    {pending && <p role="status">正在读取或保护恢复副本…</p>}
  </dialog>;
}
