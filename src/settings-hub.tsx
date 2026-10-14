import { DownloadSettings } from "./download-settings";
import React, { useEffect, useRef, useState } from "react";
import { Icon, IconButton, type IconName } from "./icons";
export type SettingsSection = "editor" | "environment" | "files" | "notes" | "debug" | "downloads";
export type SettingsAction = { id: string; label: string; section: SettingsSection; icon: IconName; run: () => void; disabled?: boolean; dataAction?: string };
const sections: [SettingsSection,string][] = [["editor","编辑器"],["environment","语言与环境"],["downloads","下载"],["files","源码"],["notes","笔记"],["debug","运行与调试"]];
export function SettingsHub({ onClose, actions, initial = "editor", languageStatus }: { onClose: () => void; actions: SettingsAction[]; initial?: SettingsSection; languageStatus: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef(document.activeElement as HTMLElement | null);
  const [section,setSection] = useState(initial), [query,setQuery] = useState("");
  useEffect(() => {
    const previous = opener.current;
    dialog.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const normalized = query.trim().toLocaleLowerCase();
  const showDownloads = normalized ? "下载 代理 proxy http https".includes(normalized) : section === "downloads";
  const visible = actions.filter(action => normalized ? action.label.toLocaleLowerCase().includes(normalized) : action.section === section);
  return <dialog ref={dialog} className="settings-hub" aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id="settings-title">设置</h2><IconButton icon="close" label="关闭设置" onClick={onClose} /></header>
    <div className="settings-body">
      <nav aria-label="设置分类">{sections.map(([id,label]) => <button key={id} aria-current={section === id ? "page" : undefined} onClick={() => { setSection(id); setQuery(""); }}>{label}</button>)}</nav>
      <section><input autoFocus aria-label="搜索设置" placeholder="搜索设置" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="settings-actions">{visible.map(action => <button key={action.id} disabled={action.disabled} data-action={action.dataAction} data-setting-action={action.id} onClick={action.run}><Icon name={action.icon} /><span>{action.label}</span></button>)}</div>
        {!visible.length && !showDownloads && section !== "debug" && <p className="muted">没有匹配项</p>}
        {showDownloads && <DownloadSettings />}
        {!normalized && section === "environment" && <p className="settings-service" role="status">{languageStatus || "语言服务未启动"}</p>}
        {!normalized && section === "debug" && <div className="settings-reference">
          <h3>快捷键</h3><dl><dt>开始 / 继续</dt><dd>F5</dd><dt>停止</dt><dd>Shift+F5</dd><dt>单步跳过</dt><dd>F10</dd><dt>单步进入 / 跳出</dt><dd>F11 / Shift+F11</dd><dt>切换断点</dt><dd>F9</dd></dl>
          <h3>执行边界</h3><p>仅运行可信代码。工具目录隔离不是安全沙箱，程序使用当前用户权限执行。本地输出不代表力扣判题结果。</p>
          <p>普通运行限时10秒；调试连续执行限时30秒，会话最多30分钟。表达式只在点击时求值，可能调用函数或改变状态；超时会停止当前调试。</p>
        </div>}
      </section>
    </div>
  </dialog>;
}
