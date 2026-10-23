import React, { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { IconButton } from "./icons";
import { defaultDownloadProxy, type DownloadProxyDraft, type ProxyMode, type ProxySettingId } from "./settings-catalog";
import { inspectProxyDraft, readProxySettingState, resetProxyBundle } from "./settings-state";

type Snapshot = { settings: { version: 1; proxy: DownloadProxyDraft }; revision: string | null };
export type DownloadFormReport = { dirty: boolean; busy: boolean; loading: boolean; error: string };
export function DownloadSettings({ visibleRows, addressMatch, onReport, beginOperation }: {
  visibleRows: ReadonlySet<ProxySettingId>;
  addressMatch: boolean;
  onReport: (report: DownloadFormReport) => void;
  beginOperation?: () => () => void;
}) {
  const [saved, setSaved] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<DownloadProxyDraft>(defaultDownloadProxy);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const alive = useRef(true), sequence = useRef(0), guard = useRef(false), reading = useRef<number | null>(null);
  async function load() {
    if (guard.current || reading.current !== null) return;
    const token = ++sequence.current;
    reading.current = token;
    setLoading(true); setNotice("");
    try {
      const snapshot = await invoke<Snapshot>("get_download_settings");
      if (alive.current && token === sequence.current) { setSaved(snapshot); setDraft(snapshot.settings.proxy); setError(""); }
    } catch (error) { if (alive.current && token === sequence.current) setError(String(error)); }
    finally {
      if (reading.current === token) reading.current = null;
      if (alive.current && token === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    if (isTauri()) void load(); else { setLoading(false); setError("请在客户端配置下载代理"); }
    return () => { alive.current = false; ++sequence.current; reading.current = null; };
  }, []);
  async function save() {
    if (!saved || guard.current || reading.current !== null) return;
    guard.current = true; const finish=beginOperation?.(); setSaving(true); setError(""); setNotice("");
    const proxy = { ...draft };
    try {
      const snapshot = await invoke<Snapshot>("save_download_settings", { proxy, expected: saved.revision });
      if (alive.current) { setSaved(snapshot); setDraft(snapshot.settings.proxy); setNotice("已保存，下次下载生效"); }
    } catch (error) { if (alive.current) setError(String(error)); }
    finally { guard.current = false; if (alive.current) setSaving(false); finish?.(); }
  }
  const comparison = inspectProxyDraft(saved?.settings.proxy ?? null, draft);
  const dirty = comparison.status === "known" && comparison.dirty;
  const busy = loading || saving;
  const modeState = readProxySettingState(saved ? draft : null, "downloads.proxy.mode");
  const canReset = modeState.status === "known" && modeState.canResetBundle;
  const showMode = visibleRows.has("downloads.proxy.mode");
  // A visible custom endpoint always retains the selector that controls it.
  const showAddress = (visibleRows.has("downloads.proxy.url") || showMode) && draft.mode === "custom";
  useEffect(() => { onReport({ dirty, busy, loading, error }); }, [dirty, busy, loading, error, onReport]);
  return <section className="download-settings settings-owner" aria-label="下载代理" data-settings-owner="downloads" aria-busy={busy}>
    <div className="settings-group">
      <div className="settings-group-heading"><h3>下载代理</h3><IconButton type="button" icon="refresh" label="重置下载代理" title="重置下载代理 · 默认：跟随系统" className="settings-reset" data-setting-reset="downloads.proxy" data-settings-focus="reset:downloads.proxy" disabled={busy || !canReset} onClick={() => { setDraft(resetProxyBundle(draft)); setNotice(""); }} /></div>
      <div className="settings-row" data-setting-id="downloads.proxy.mode" hidden={!showMode}>
        <label className="settings-field" htmlFor="download-proxy-mode"><span>连接方式{modeState.status === "known" && !modeState.isDefault && <i className="settings-modified-mark" aria-hidden="true" title="已修改" />}</span>
          <select aria-label="连接方式" id="download-proxy-mode" data-settings-focus="downloads.proxy.mode" disabled={busy || !saved} value={draft.mode} onChange={event => { setDraft(current => ({ ...current, mode: event.target.value as ProxyMode })); setNotice(""); }}>
            <option value="system">跟随系统</option><option value="direct">直接连接</option><option value="custom">自定义代理</option>
          </select>
        </label>
      </div>
      {draft.mode === "custom" && <div className="settings-row settings-address" data-setting-id="downloads.proxy.url" data-setting-match={visibleRows.has("downloads.proxy.url") ? undefined : "supporting"} hidden={!showAddress}>
        <label className="settings-field" htmlFor="download-proxy-url"><span>HTTP / HTTPS 地址</span>
          <input aria-label="HTTP / HTTPS 地址" id="download-proxy-url" data-settings-focus="downloads.proxy.url" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={2048} placeholder="http://127.0.0.1:7890" value={draft.url} disabled={busy || !saved} onChange={event => { setDraft(current => ({ ...current, url: event.target.value })); setNotice(""); }} />
        </label>
      </div>}
      {addressMatch && draft.mode !== "custom" && <p className="settings-dependent" data-setting-id="downloads.proxy.url">HTTP / HTTPS 地址 <span>· 自定义代理</span></p>}
    </div>
    <div className="settings-form-actions">
      <button type="button" disabled={!dirty || busy} data-settings-focus="downloads.save" onClick={() => void save()}>{saving ? "保存中…" : "保存下载设置"}</button>
      <button type="button" disabled={busy || !isTauri()} data-settings-focus="downloads.reload" onClick={() => void load()}>重新读取</button>
      {dirty && !busy && <span className="settings-dirty">未保存</span>}
    </div>
    {loading && <p role="status">读取中…</p>}{notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="error settings-error-detail" tabIndex={-1} data-settings-focus="downloads.error">{error}</p>}
  </section>;
}
