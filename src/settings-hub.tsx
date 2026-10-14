import { FormatSettings } from "./format-settings-panel";
import type { EditorSettings,EditorSettingsSnapshot } from "./format-settings";
import { UserManual } from "./user-manual";
import { DownloadSettings } from "./download-settings";
import React, { useEffect, useRef, useState } from "react";
import { Icon, IconButton, type IconName } from "./icons";
export type SettingsSection = "editor" | "environment" | "files" | "notes" | "debug" | "downloads";
export type SettingsAction = { id: string; label: string; section: SettingsSection; icon: IconName; run: () => void; disabled?: boolean; dataAction?: string };
const sections: [SettingsSection,string][] = [["editor","编辑器"],["environment","语言与环境"],["downloads","下载"],["files","源码"],["notes","笔记"],["debug","运行与调试"]];
export function SettingsHub({ onClose, actions, initial = "editor", languageStatus, editorSettings, editorSettingsError, onReloadEditorSettings, onSaveEditorSettings }: { onClose: () => void; actions: SettingsAction[]; initial?: SettingsSection; languageStatus: string; editorSettings:EditorSettingsSnapshot|null; editorSettingsError:string; onReloadEditorSettings:()=>void; onSaveEditorSettings:(settings:EditorSettings)=>Promise<void> }) {
  const [manual,setManual] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef(document.activeElement as HTMLElement | null);
  const [section,setSection] = useState(initial), [query,setQuery] = useState("");
  useEffect(() => {
    const previous = opener.current;
    dialog.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const normalized = query.trim().toLocaleLowerCase();
  const showFormatting=normalized?"编辑器 格式化 format 保存 vim 键盘".includes(normalized):section==="editor";
  const showDownloads = normalized ? "下载 代理 proxy http https".includes(normalized) : section === "downloads";
  const visible = actions.filter(action => normalized ? action.label.toLocaleLowerCase().includes(normalized) : action.section === section);
  return <dialog ref={dialog} className="settings-hub" aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id="settings-title">设置</h2><IconButton icon="info" label="使用手册" onClick={()=>setManual(true)} /><IconButton icon="close" label="关闭设置" onClick={onClose} /></header>
    <div className="settings-body">
      <nav aria-label="设置分类">{sections.map(([id,label]) => <button key={id} aria-current={section === id ? "page" : undefined} onClick={() => { setSection(id); setQuery(""); }}>{label}</button>)}</nav>
      <section><input autoFocus aria-label="搜索设置" placeholder="搜索设置" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="settings-actions">{visible.map(action => <button key={action.id} disabled={action.disabled} data-action={action.dataAction} data-setting-action={action.id} onClick={action.run}><Icon name={action.icon} /><span>{action.label}</span></button>)}</div>
        {!visible.length && !showDownloads && !showFormatting && section !== "debug" && <p className="muted">没有匹配项</p>}
        {showFormatting && <FormatSettings key={editorSettings?.revision??"unloaded"} snapshot={editorSettings} error={editorSettingsError} reload={onReloadEditorSettings} save={onSaveEditorSettings} />}
        {showDownloads && <DownloadSettings />}
        {!normalized && section === "environment" && <p className="settings-service" role="status">{languageStatus || "语言服务未启动"}</p>}

      </section>
    </div>
    {manual && <UserManual onClose={()=>setManual(false)} />}
  </dialog>;
}
