import { IconButton } from "./icons";
import React, { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { retryDelay, shouldRefresh } from "./login-flow";
export type Identity = { username: string; account: string; persistence: string };
type QrReply = { attempt: number; state: string; svg: string | null; identity: Identity | null };
export function Login({ onIdentity }: { onIdentity: (value: Identity | null) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"native" | "web">("native");
  const [qr, setQr] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  const [forgetFailed, setForgetFailed] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const generation = useRef(0);
  const openedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useRef(onIdentity); notify.current = onIdentity;
  const preference = useRef(remember); preference.current = remember;
  function invalidate() { if (timer.current) clearTimeout(timer.current); timer.current = null; return ++generation.current; }
  function accept(value: Identity) {
    setForgetFailed(false); setRestoreFailed(false);
    setIdentity(value); notify.current(value); setOpen(false); setQr(null);
    setMessage(value.persistence === "system-keychain" ? "" : "登录仅本次有效；未保存到系统安全存储。");
  }
  async function restore(token: number) {
    try { const value = await invoke<Identity | null>("login_status"); if (token === generation.current) { setRestoreFailed(false); setMessage(""); setIdentity(value); notify.current(value); if (value) setOpen(false); } }
    catch (error) { if (token === generation.current) { if(String(error).includes("STORAGE_RECOVERY_REQUIRED"))setForgetFailed(true); setRestoreFailed(true); setMessage("暂时无法恢复登录；已保存的会话未被删除，可以稍后重试。"); } }
  }
  useEffect(() => {
    if (!isTauri()) return;
    const token = ++generation.current; void restore(token);
    return () => { invalidate(); void invoke("cancel_login").catch(() => {}); };
  }, []);
  function schedule(token: number, attempt: number, refreshes: number, failures = 0, delay = 1000) {
    if (token !== generation.current) return;
    timer.current = setTimeout(async () => {
      if (token !== generation.current) return;
      if (Date.now() - openedAt.current > 10 * 60_000) { setQr(null); setMessage("扫码等待已暂停，点击重新扫码继续。"); return; }
      if (document.hidden) { schedule(token, attempt, refreshes, failures); return; }
      try {
        const result = await invoke<QrReply>("qr_login_poll", { attempt });
        if (token !== generation.current || result.attempt !== attempt) return;
        if (result.state === "SUCCEED" && result.identity) { invalidate(); accept(result.identity); return; }
        if (result.state === "WAITING") { setMessage(""); schedule(token, attempt, refreshes); return; }
        if (shouldRefresh(result.state, refreshes)) { await createQr(token, refreshes + 1); return; }
        setQr(null); setMessage(result.state === "EXPIRED" || result.state === "INVALID" ? "二维码已过期，自动刷新已暂停；点击重新扫码继续。" : "扫码登录暂不可用，请重试或使用官方网页登录。");
      } catch (error) {
        if (token !== generation.current) return;
        if (!/network|RATE_LIMIT/i.test(String(error))) { setQr(null); setMessage("扫码流程或会话验证未完成，请重试或使用官方网页登录。"); return; }
        setMessage("连接暂时中断或受到限流，正在等待重试；二维码不会被随意更换。");
        const delay = retryDelay(error, failures + 1);
        if (delay === null) { setMessage("服务要求较长冷却，自动请求已暂停，请稍后再试。"); return; }
        if (failures < 4) schedule(token, attempt, refreshes, failures + 1, delay);
        else setMessage("暂时无法确认扫码状态，请重新扫码或使用官方网页登录。");
      }
    }, delay);
  }
  async function createQr(token: number, refreshes = 0) {
    setBusy(true); setQr(null); setMessage(refreshes ? "二维码已过期，正在自动刷新…" : "正在准备二维码…");
    try {
      const result = await invoke<QrReply>("qr_login_start", { remember: preference.current });
      if (token !== generation.current) return;
      if (!result.svg || result.state !== "WAITING") throw Error("Invalid QR response");
      setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`); setMessage("");
      schedule(token, result.attempt, refreshes);
    } catch (error) { if (token === generation.current) { if(String(error).includes("STORAGE_RECOVERY_REQUIRED")){setForgetFailed(true);setMessage("上次取消登录后，系统凭据未能恢复。请先忘记此设备，再重新登录。");}else setMessage("无法创建二维码。可以重试，或选择官方网页登录。 "); } }
    finally { if (token === generation.current) setBusy(false); }
  }
  async function begin() { setRestoreFailed(false); openedAt.current = Date.now(); const token = invalidate(); setOpen(true); setMode("native"); await createQr(token); }
  async function fallback() {
    const token = invalidate(); setBusy(true); setQr(null); setMessage("");
    try { await invoke("open_login", { remember: preference.current }); if (token === generation.current) setMode("web"); }
    catch (error) { if (token === generation.current) {if(String(error).includes("STORAGE_RECOVERY_REQUIRED"))setForgetFailed(true);setMessage(String(error));} }
    finally { if (token === generation.current) setBusy(false); }
  }
  async function verify() {
    const token = invalidate(); setBusy(true); setMessage("");
    try { const result = await invoke<Identity>("verify_login"); if (token === generation.current) accept(result); }
    catch (error) { if (token === generation.current) {if(String(error).includes("STORAGE_RECOVERY_REQUIRED"))setForgetFailed(true);setMessage(String(error));} }
    finally { if (token === generation.current) setBusy(false); }
  }
  async function cancel() {
    const token = invalidate(); setBusy(true);
    try { await invoke("cancel_login"); if (token === generation.current) { setOpen(false); setQr(null); setMessage(""); } }
    catch (error) { if (token === generation.current) {if(String(error).includes("STORAGE_RECOVERY_REQUIRED"))setForgetFailed(true);setMessage(String(error));} }
    finally { if (token === generation.current) setBusy(false); }
  }
  async function signOut() {
    const token = invalidate(); setBusy(true); setIdentity(null); notify.current(null);
    try { await invoke("sign_out"); if (token === generation.current) { setOpen(false); setForgetFailed(false); setMessage(""); } }
    catch { if (token === generation.current) {setForgetFailed(true);setMessage("本次登录已退出，但无法确认系统保存的会话已删除。请解锁系统钥匙串后重试退出。");} }
    finally { if (token === generation.current) setBusy(false); }
  }
  return <div className="login-area">
    <IconButton icon="leetcode" label={identity ? identity.username + " · 退出" : "登录力扣"} disabled={busy || !isTauri()} onClick={identity ? signOut : begin}
      title={identity ? identity.username + " · 退出并忘记此设备" : isTauri() ? "登录 LeetCode" : "请在原生客户端登录"} />
    {(open || message) && <div className="login-panel" role="region" aria-label="LeetCode 登录">
      {open && <><strong>力扣中国站</strong><p>{mode === "native" ? "使用力扣 App 首页右上角扫一扫，并在手机确认。" : "在官方窗口完成登录，然后验证账号。"}</p>
        {qr && <img className="login-qr" src={qr} alt="力扣 App 登录二维码" />}
        <label className="login-remember"><input type="checkbox" checked={remember} disabled={busy || mode === "web"} onChange={event => { preference.current = event.target.checked; setRemember(event.target.checked); void begin(); }} />记住此设备（系统安全存储）</label></>}
      {message && <p role="status">{message}</p>}
      {restoreFailed && !open && <button disabled={busy} onClick={() => { const token = invalidate(); setBusy(true); void restore(token).finally(() => { if (token === generation.current) setBusy(false); }); }}>重试恢复登录</button>}
      {forgetFailed && <button disabled={busy} onClick={signOut}>重试忘记此设备</button>}
      {open && <div className="login-actions">
        {mode === "native" ? <><button disabled={busy} onClick={begin}>重新扫码</button><button disabled={busy} onClick={fallback}>官方网页登录</button></> : <button disabled={busy} onClick={verify}>{busy ? "正在校验…" : "验证登录"}</button>}
        <button onClick={cancel}>取消登录</button>
      </div>}
    </div>}
  </div>;
}
