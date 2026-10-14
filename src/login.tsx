import { IconButton } from "./icons";
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
    <IconButton icon="leetcode" label={identity ? identity.username + " · 退出" : "登录力扣"} disabled={busy || !isTauri()} onClick={identity ? cancel : begin}
      title={identity ? identity.username + " · 退出" : isTauri() ? "登录 LeetCode" : "请在原生客户端登录"} />
    {(open || message) && <div className="login-panel" role="status">
      {message && <p className="error">{message}</p>}
      {open && <div><button disabled={busy} onClick={verify}>{busy ? "正在校验…" : "验证登录"}</button><button onClick={cancel}>取消登录</button></div>}
    </div>}
  </div>;
}
