import React, { useEffect, useRef, useState } from "react";
import { languages } from "./domain";
import type { EditorSettings, EditorSettingsSnapshot } from "./format-settings";
import { IconButton } from "./icons";
import { preferenceRows, type EditorSettingId, type EditorSettingRow } from "./settings-catalog";
import { inspectEditorDraft, readEditorSettingState, resetEditorSetting } from "./settings-state";

export type EditorSettingsReload = () => Promise<EditorSettingsSnapshot | null>;
export type EditorFormReport = {
  revision: string | null;
  draft: EditorSettings | null;
  dirty: boolean;
  busy: boolean;
  error: string;
};
const rows = preferenceRows.filter((row): row is EditorSettingRow => row.owner === "editor-settings");

export function FormatSettings({ snapshot, error, formattingStatus, reload, save, visibleRows, onReport }: {
  snapshot: EditorSettingsSnapshot | null;
  error: string;
  formattingStatus: string;
  reload: EditorSettingsReload;
  save: (settings: EditorSettings) => Promise<void>;
  visibleRows: ReadonlySet<EditorSettingId>;
  onReport: (report: EditorFormReport) => void;
}) {
  const [draft, setDraft] = useState<EditorSettings | null>(snapshot?.settings ?? null);
  const [operation, setOperation] = useState<"save" | "reload" | null>(null);
  const [failure, setFailure] = useState("");
  const guard = useRef(false), alive = useRef(true);
  const busy = operation !== null;
  const comparison = inspectEditorDraft(snapshot?.settings ?? null, draft);
  const dirty = comparison.status === "known" && comparison.dirty;
  const visibleError = failure || error;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setDraft(snapshot?.settings ?? null); }, [snapshot]);
  useEffect(() => {
    onReport({ revision: snapshot?.revision ?? null, draft, dirty, busy, error: visibleError });
  }, [snapshot?.revision, draft, dirty, busy, visibleError, onReport]);

  async function submit() {
    if (!draft || guard.current) return;
    guard.current = true; setOperation("save"); setFailure("");
    try {
      // Canonicalize a copy; a failed save must retain the user's exact draft.
      const settings = { ...draft };
      if (settings.tabSize === 4) delete settings.tabSize;
      await save(settings);
    } catch (error) { if (alive.current) setFailure(String(error)); }
    finally { guard.current = false; if (alive.current) setOperation(null); }
  }
  async function reread() {
    if (guard.current) return;
    guard.current = true; setOperation("reload");
    try {
      const loaded = await reload();
      // Null means a newer App operation superseded this read. Revision equality
      // is not a success signal: even a same-revision reload must complete.
      if (alive.current && loaded) { setDraft(loaded.settings); setFailure(""); }
    } catch (error) { if (alive.current) setFailure(String(error)); }
    finally { guard.current = false; if (alive.current) setOperation(null); }
  }
  function renderRow(row: EditorSettingRow) {
    if (!draft) return null;
    const state = readEditorSettingState(draft, row.id);
    if (state.status !== "known") return null;
    const language = row.kind === "language-format" ? languages.find(item => item.id === row.language) : undefined;
    const label = language?.label ?? row.label;
    const controlId = "setting-" + row.id;
    const defaultLabel = state.defaultValue === "inherit" ? "继承" : typeof state.defaultValue === "boolean" ? (state.defaultValue ? "开启" : "关闭") : String(state.defaultValue);
    const source = state.hasLanguageOverride ? "override" : state.isDefault ? "default" : "modified";
    const descriptionId = "setting-description-" + row.id;
    const description = (state.hasLanguageOverride ? "语言覆盖" : state.isDefault ? "默认设置" : "已修改") + "；默认：" + defaultLabel;
    const rowClass = row.id === "editor.vim" ? "vim-switch" : row.id === "editor.tabSize" ? "editor-tab-size" : row.kind === "language-format" ? "format-language" : "format-switch";
    return <div key={row.id} className="settings-row" data-setting-id={row.id} data-setting-source={source} data-setting-effective={String(state.effectiveValue)} hidden={!visibleRows.has(row.id)}>
      <label className={"settings-field " + rowClass} htmlFor={controlId}>
        <span>{label}{!state.isDefault && <i className="settings-modified-mark" aria-hidden="true" title={state.hasLanguageOverride ? "语言覆盖" : "已修改"} />}</span>
        {row.id === "editor.vim" ? <input id={controlId} aria-describedby={descriptionId} data-settings-focus={row.id} type="checkbox" disabled={busy} checked={draft.vim ?? false} onChange={event => setDraft({ ...draft, vim: event.target.checked })} />
          : row.id === "editor.formatOnSave" ? <input id={controlId} aria-describedby={descriptionId} data-settings-focus={row.id} type="checkbox" disabled={busy} checked={draft.formatOnSave} onChange={event => setDraft({ ...draft, formatOnSave: event.target.checked })} />
          : row.id === "editor.tabSize" ? <select id={controlId} aria-describedby={descriptionId} data-settings-focus={row.id} disabled={busy} aria-label={row.label} value={draft.tabSize ?? 4} onChange={event => {
            const next = { ...draft }, size = Number(event.target.value);
            if (size === 4) delete next.tabSize; else next.tabSize = size;
            setDraft(next);
          }}>{[1, 2, 3, 4, 5, 6, 7, 8].map(size => <option key={size} value={size}>{size}</option>)}</select>
          : row.kind === "language-format" ? <select id={controlId} aria-describedby={descriptionId} data-settings-focus={row.id} disabled={busy} aria-label={row.label} value={draft.overrides[row.language] === undefined ? "inherit" : String(draft.overrides[row.language])} onChange={event => {
            const overrides = { ...draft.overrides };
            if (event.target.value === "inherit") delete overrides[row.language]; else overrides[row.language] = event.target.value === "true";
            setDraft({ ...draft, overrides });
          }}><option value="inherit">继承 · {draft.formatOnSave ? "开启" : "关闭"}</option><option value="true">开启</option><option value="false">关闭</option></select> : null}
      </label>
      <span id={descriptionId} className="settings-sr-only">{description}</span>
      <IconButton type="button" icon="refresh" label={"重置 " + row.label} title={"重置 " + row.label + " · 默认：" + defaultLabel} className="settings-reset" data-setting-reset={row.id} data-settings-focus={"reset:" + row.id} disabled={busy || !state.canReset} onClick={() => setDraft(resetEditorSetting(draft, row.id))} />
    </div>;
  }
  const behavior = rows.filter(row => row.group === "behavior");
  const formatting = rows.filter(row => row.id === "editor.formatOnSave");
  const overrides = rows.filter(row => row.kind === "language-format");
  return <section className="format-settings settings-owner" aria-label="格式化设置" data-settings-owner="editor" aria-busy={busy}>
    {draft && <>
      <div className="settings-group" hidden={!behavior.some(row => visibleRows.has(row.id))}><h3>编辑</h3>{behavior.map(renderRow)}</div>
      <div className="settings-group" hidden={!formatting.some(row => visibleRows.has(row.id))}><h3>格式化</h3>{formatting.map(renderRow)}</div>
      <div className="settings-group" hidden={!overrides.some(row => visibleRows.has(row.id))}><h3>语言覆盖</h3>{overrides.map(renderRow)}</div>
    </>}
    <div className="settings-form-actions">
      {draft && <button type="button" disabled={busy} data-settings-focus="editor.save" onClick={() => void submit()}>保存设置</button>}
      <button type="button" disabled={busy} data-settings-focus="editor.reload" onClick={() => void reread()}>重新读取</button>
      {busy ? <span role="status">{operation === "save" ? "保存中…" : "读取中…"}</span> : dirty ? <span className="settings-dirty">未保存</span> : null}
    </div>
    {visibleError && <p role="alert" className="error settings-error-detail" tabIndex={-1} data-settings-focus="editor.error">{visibleError}</p>}
    {formattingStatus && <p className="settings-format-status" role="status">{formattingStatus}</p>}
  </section>;
}
