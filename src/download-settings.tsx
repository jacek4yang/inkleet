import React, { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
type Proxy = { mode:"system"|"direct"|"custom"; url:string };
type Snapshot = { settings:{version:1;proxy:Proxy}; revision:string|null };
export function DownloadSettings() {
  const [saved,setSaved]=useState<Snapshot|null>(null);
  const [draft,setDraft]=useState<Proxy>({mode:"system",url:""});
  const [error,setError]=useState(""),[notice,setNotice]=useState("");
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const alive=useRef(true), sequence=useRef(0), guard=useRef(false);
  async function load() {
    const token=++sequence.current;setLoading(true);setError("");setNotice("");
    try {
      const snapshot=await invoke<Snapshot>("get_download_settings");
      if(alive.current && token===sequence.current){setSaved(snapshot);setDraft(snapshot.settings.proxy);}
    } catch(error){if(alive.current && token===sequence.current)setError(String(error));}
    finally{if(alive.current && token===sequence.current)setLoading(false);}
  }
  useEffect(()=>{
    alive.current=true;
    if(isTauri()) void load();else{setLoading(false);setError("请在客户端配置下载代理");}
    return()=>{alive.current=false;++sequence.current;};
  },[]);
  async function save() {
    if(!saved || guard.current)return;
    guard.current=true;setSaving(true);setError("");setNotice("");
    const proxy={...draft};
    try {
      const snapshot=await invoke<Snapshot>("save_download_settings",{proxy,expected:saved.revision});
      if(alive.current){setSaved(snapshot);setDraft(snapshot.settings.proxy);setNotice("已保存，下次下载生效");}
    } catch(error){if(alive.current)setError(String(error));}
    finally{guard.current=false;if(alive.current)setSaving(false);}
  }
  const dirty=!!saved && (draft.mode!==saved.settings.proxy.mode || (draft.mode==="custom" && draft.url!==saved.settings.proxy.url));
  return <section className="download-settings" aria-label="下载代理">
    <h3>下载代理</h3>
    <label htmlFor="download-proxy-mode">连接方式</label>
    <select id="download-proxy-mode" disabled={loading||saving||!saved} value={draft.mode} onChange={event=>{setDraft(current=>({...current,mode:event.target.value as Proxy["mode"]}));setNotice("");}}>
      <option value="system">跟随系统</option><option value="direct">直接连接</option><option value="custom">自定义代理</option>
    </select>
    {draft.mode==="custom" && <><label htmlFor="download-proxy-url">HTTP / HTTPS 地址</label><input id="download-proxy-url" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={2048} placeholder="http://127.0.0.1:7890" value={draft.url} disabled={saving} onChange={event=>{setDraft(current=>({...current,url:event.target.value}));setNotice("");}} /></>}
    <p className="muted">仅用于工具链、LSP 和调试器安装下载（含 gopls 依赖）。不会改变力扣访问、代码运行或系统网络；已开始的安装保留原连接方式。</p>
    {draft.mode==="custom" && <p className="muted">使用代理软件的 HTTP 或混合端口。暂不支持带账号密码的地址。</p>}
    <div className="settings-form-actions"><button type="button" disabled={!dirty||saving||loading} onClick={()=>void save()}>{saving?"保存中…":"保存下载设置"}</button><button type="button" disabled={saving||loading||!isTauri()} onClick={()=>void load()}>重新读取</button></div>
    {loading&&<p role="status">读取中…</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
  </section>;
}
