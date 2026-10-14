import React, { useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
export type Identity = { username: string; account: string; persistence: string };
export function Login({ onIdentity }: { onIdentity: (value: Identity | null) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  async function begin() {
    const token = ++generation.current;
    setBusy(true); setMessage("");
    try { await invoke("open_login"); if (token !== generation.current) return; setOpen(true); setIdentity(null); onIdentity(null); }
    catch (error) { if (token === generation.current) setMessage(String(error)); }
    finally { if (token === generation.current) setBusy(false); }
  }
  async function verify() {
    const token = ++generation.current;
    setBusy(true); setMessage("");
    try { const result = await invoke<Identity>("verify_login"); if (token !== generation.current) return; setIdentity(result); onIdentity(result); setOpen(false); }
    catch (error) { if (token === generation.current) setMessage(String(error)); }
    finally { if (token === generation.current) setBusy(false); }
  }
  async function cancel() {
    const token = ++generation.current;
    setBusy(true);
    try { await invoke("cancel_login"); if (token !== generation.current) return; setOpen(false); setIdentity(null); onIdentity(null); setMessage(""); }
    catch (error) { if (token === generation.current) setMessage(String(error)); }
    finally { if (token === generation.current) setBusy(false); }
  }
  return <div className="login-area">
    <button disabled={busy || !isTauri()} onClick={identity ? cancel : begin}
      title={isTauri() ? "官方登录；当前原型仅保留本次运行会话" : "请在原生客户端登录"}>
      {identity ? identity.username + " · 退出" : "登录力扣"}
    </button>
    {(open || message || identity) && <div className="login-panel" role="status">
      <p>{identity ? "已通过中国站登录状态校验 · 仅本次运行有效" : "请在独立窗口完成力扣官方登录，再回到这里校验。当前原型不保存密码或持久化会话。第三方弹窗登录尚未支持。"}</p>
      {message && <p className="error">{message}</p>}
      {open && <div><button disabled={busy} onClick={verify}>{busy ? "正在校验…" : "已完成登录，校验会话"}</button><button onClick={cancel}>取消登录</button></div>}
    </div>}
  </div>;
}
