import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconCredits } from "./icon-credits";
import { FormatSettings, type EditorFormReport, type EditorSettingsReload } from "./format-settings-panel";
import type { EditorSettings, EditorSettingsSnapshot } from "./format-settings";
import { UserManual } from "./user-manual";
import { DownloadSettings, type DownloadFormReport } from "./download-settings";
import { Icon, IconButton, type IconName } from "./icons";
import { createSettingsCatalog, settingsCategories, type EditorSettingId, type ProxySettingId, type SettingsCategory } from "./settings-catalog";
import { searchSettingsCatalog } from "./settings-search";

export type SettingsSection = Exclude<SettingsCategory, "debug">;
export type SettingsAction = { id: string; label: string; section: SettingsSection; icon: IconName; run: () => void; disabled?: boolean; dataAction?: string };
type Owner = "editor" | "downloads";
type FocusRecord = { element: HTMLElement; key: string | null };
const searchMessages = { "query-too-long": "搜索内容过长", "too-many-terms": "搜索词过多", "no-search-terms": "没有匹配项" };

export function SettingsHub({ onClose, actions, initial = "editor", languageStatus, editorSettings, editorSettingsError, formattingStatus, onReloadEditorSettings, onSaveEditorSettings }: {
  onClose: () => void;
  actions: SettingsAction[];
  initial?: SettingsSection;
  languageStatus: string;
  editorSettings: EditorSettingsSnapshot | null;
  editorSettingsError: string;
  formattingStatus: string;
  onReloadEditorSettings: EditorSettingsReload;
  onSaveEditorSettings: (settings: EditorSettings) => Promise<void>;
}) {
  const [manual, setManual] = useState(false), [credits, setCredits] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), search = useRef<HTMLInputElement>(null);
  const opener = useRef(document.activeElement as HTMLElement | null);
  const lastFocus = useRef<FocusRecord | null>(null), pendingReveal = useRef<Owner | null>(null);
  const [section, setSection] = useState<SettingsSection>(initial), [query, setQuery] = useState("");
  const [modified, setModified] = useState(false);
  const [visited, setVisited] = useState({ editor: initial === "editor", downloads: initial === "downloads" });
  const [editorReport, setEditorReport] = useState<EditorFormReport | null>(null);
  const [downloadReport, setDownloadReport] = useState<DownloadFormReport | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const lastErrors = useRef({ editor: "", downloads: "" });
  const currentRevision = useRef(editorSettings?.revision ?? null);
  currentRevision.current = editorSettings?.revision ?? null;
  const reportEditor = useCallback((report: EditorFormReport) => {
    if (report.revision === currentRevision.current) setEditorReport(report);
  }, []);
  const reportDownloads = useCallback((report: DownloadFormReport) => setDownloadReport(report), []);
  const currentEditor = editorReport?.revision === (editorSettings?.revision ?? null) ? editorReport : null;
  const editorDraft = currentEditor?.draft ?? editorSettings?.settings ?? null;
  const catalog = useMemo(() => createSettingsCatalog(actions), [actions]);
  const normalized = query.trim();
  const result = searchSettingsCatalog(catalog, query, {
    category: normalized ? undefined : section,
    modified: modified ? "editor" : undefined,
    editorDraft,
  });
  const editorRows = new Set<EditorSettingId>(), downloadRows = new Set<ProxySettingId>();
  for (const { row } of result.rows) {
    if (row.owner === "editor-settings") editorRows.add(row.id);
    if (row.owner === "download-settings") downloadRows.add(row.id);
  }
  const editorError = currentEditor?.error || editorSettingsError;
  const showEditor = editorRows.size > 0 || (!normalized && section === "editor" && (!modified || !!currentEditor?.dirty || !!editorError || result.modifiedState === "unknown"));
  const showDownloads = downloadRows.size > 0;
  const addressMatch = !!normalized && result.rows.some(({ row, match }) => row.id === "downloads.proxy.url" && match === "direct");
  const visibleActions = result.rows.flatMap(({ row }) => row.kind === "action" ? [row] : []);
  const categories = settingsCategories.filter(category => category.id !== "debug" && catalog.some(row => row.category === category.id));

  // Retention is changed together with the user navigation, never by an effect
  // that can briefly unmount or re-create an in-flight form owner.
  function retainFor(nextSection: SettingsSection, nextQuery: string, nextModified: boolean) {
    const next = searchSettingsCatalog(catalog, nextQuery, { category: nextQuery.trim() ? undefined : nextSection, modified: nextModified ? "editor" : undefined, editorDraft });
    const editor = nextSection === "editor" && !nextQuery.trim() || next.rows.some(({ row }) => row.owner === "editor-settings");
    const downloads = next.rows.some(({ row }) => row.owner === "download-settings");
    setVisited(current => ({ editor: current.editor || editor, downloads: current.downloads || downloads }));
  }
  function changeQuery(value: string) { retainFor(section, value, modified); setQuery(value); }
  function changeSection(value: SettingsSection) {
    retainFor(value, "", false); setSection(value); setQuery(""); setModified(false);
  }
  function reveal(owner: Owner) {
    pendingReveal.current = owner;
    changeSection(owner === "editor" ? "editor" : "downloads");
  }
  useEffect(() => {
    const previous = opener.current;
    dialog.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useLayoutEffect(() => {
    const root = dialog.current;
    if (!root || manual || credits) return;
    const pending = pendingReveal.current;
    if (pending) {
      const target = root.querySelector<HTMLElement>(`[data-settings-owner="${pending}"] .settings-error-detail`)
        ?? root.querySelector<HTMLElement>(`[data-settings-owner="${pending}"] button:not(:disabled)`);
      if (target?.getClientRects().length) { pendingReveal.current = null; target.focus(); return; }
    }
    const previous = lastFocus.current;
    if (!previous) return;
    if (previous.element.isConnected && previous.element.getClientRects().length) {
      if (!previous.element.matches(":disabled") || previous.element.closest('[data-settings-owner][aria-busy="true"]')) return;
    }
    const active = document.activeElement;
    // Navigation or another modal owns focus once the user has moved away.
    if (active !== document.body && active !== root && active !== previous.element) return;
    const replacement = previous.key ? Array.from(root.querySelectorAll<HTMLElement>("[data-settings-focus]")).find(node => node.dataset.settingsFocus === previous.key && node.getClientRects().length && !node.matches(":disabled")) : null;
    (replacement ?? search.current)?.focus();
  });
  function onKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (manual || credits || event.nativeEvent.isComposing || event.target instanceof Element && event.target.closest("dialog") !== dialog.current) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault(); event.stopPropagation(); search.current?.focus(); search.current?.select();
    }
  }
  const hiddenErrors = [
    ...(!showEditor && editorError ? [{ owner: "editor" as const, label: "编辑器设置出错", error: editorError }] : []),
    ...(!showDownloads && downloadReport?.error ? [{ owner: "downloads" as const, label: "下载设置出错", error: downloadReport.error }] : []),
  ];
  useEffect(() => {
    const downloads = downloadReport?.error ?? "";
    const newlyHidden = [
      editorError && editorError !== lastErrors.current.editor && !showEditor ? "编辑器设置出错，请选择查看" : "",
      downloads && downloads !== lastErrors.current.downloads && !showDownloads ? "下载设置出错，请选择查看" : "",
    ].filter(Boolean);
    lastErrors.current = { editor: editorError, downloads };
    // Category/search navigation alone must not replay an old failure.
    if (newlyHidden.length) setAnnouncement(newlyHidden.join("。"));
    else if (!editorError && !downloads) setAnnouncement("");
  }, [editorError, downloadReport?.error, showEditor, showDownloads]);
  return <dialog ref={dialog} className="settings-hub" aria-labelledby="settings-title" onKeyDown={onKeyDown} onFocusCapture={event => {
    if (event.target instanceof HTMLElement) lastFocus.current = { element: event.target, key: event.target.dataset.settingsFocus ?? null };
  }} onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); onClose(); }}>
    <header><h2 id="settings-title">设置</h2><IconButton type="button" icon="file" label="第三方许可" onClick={() => setCredits(true)} /><IconButton type="button" icon="info" label="使用手册" onClick={() => setManual(true)} /><IconButton type="button" icon="close" label="关闭设置" onClick={onClose} /></header>
    <div className="settings-body">
      <nav aria-label="设置分类">{categories.map(category => <button key={category.id} type="button" aria-label={category.label} aria-current={section === category.id ? "page" : undefined} onClick={() => changeSection(category.id as SettingsSection)}>
        <span>{category.label}</span>{normalized && !modified && <span className="settings-category-count" aria-hidden="true">{result.categoryCounts[category.id]}</span>}
      </button>)}</nav>
      <section className="settings-content">
        <div className="settings-searchbar">
          <div className="settings-search-field"><Icon name="search" /><input ref={search} autoFocus aria-label="搜索设置" placeholder={modified ? "搜索编辑器设置" : "搜索设置"} value={query} maxLength={256} onChange={event => changeQuery(event.target.value)} />
            {query && <IconButton type="button" icon="close" label="清除搜索" onClick={() => { changeQuery(""); search.current?.focus(); }} />}
          </div>
          {section === "editor" && <button type="button" className="settings-modified-filter" aria-label="仅显示已修改的编辑器设置" aria-pressed={modified} title="仅显示已修改的编辑器设置" onClick={() => { retainFor(section, query, !modified); setModified(value => !value); }}>已修改</button>}
        </div>
        <div className="settings-results-heading"><span>{modified ? "编辑器 · 已修改" : normalized ? "搜索结果" : categories.find(category => category.id === section)?.label}</span>
          {(normalized || modified) && <span className="settings-result-count" data-settings-result-count={result.directMatchCount} aria-live="polite">{result.modifiedState === "unknown" ? "—" : result.directMatchCount + " 项"}</span>}
        </div>
        <span className="settings-sr-only" role="alert">{announcement}</span>
        <div className="settings-owner-notices">{hiddenErrors.map(item => <div key={item.owner} className="settings-owner-error"><span title={item.error}>{item.label}</span><button type="button" data-settings-reveal={item.owner} onClick={() => reveal(item.owner)}>查看</button></div>)}</div>
        {result.issue ? <p className="muted settings-empty">{searchMessages[result.issue]}</p> : result.directMatchCount === 0 && result.modifiedState !== "unknown" ? <p className="muted settings-empty">没有匹配项</p> : null}
        {/* Fixed slots preserve the state/guard owners regardless of result order. */}
        {visited.editor && <div hidden={!showEditor}><FormatSettings key={editorSettings?.revision ?? "unloaded"} snapshot={editorSettings} error={editorSettingsError} formattingStatus={formattingStatus} reload={onReloadEditorSettings} save={onSaveEditorSettings} visibleRows={editorRows} onReport={reportEditor} /></div>}
        {visited.downloads && <div hidden={!showDownloads}><DownloadSettings visibleRows={downloadRows} addressMatch={addressMatch} onReport={reportDownloads} /></div>}
        {visibleActions.length > 0 && <div className="settings-actions">{visibleActions.map(row => <button key={row.id} type="button" disabled={row.action.disabled} data-action={row.action.dataAction} data-setting-action={row.action.id} data-setting-id={row.id} onClick={row.action.run}><Icon name={row.action.icon} /><span>{row.action.label}</span></button>)}</div>}
        {!normalized && section === "environment" && <p className="settings-service" role="status">{languageStatus || "语言服务未启动"}</p>}
      </section>
    </div>
    {credits && <IconCredits onClose={() => setCredits(false)} />}
    {manual && <UserManual onClose={() => setManual(false)} />}
  </dialog>;
}
