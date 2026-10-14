import React,{useEffect,useRef,useState} from "react";
import { languages } from "./domain";
import type { EditorSettings,EditorSettingsSnapshot } from "./format-settings";
export function FormatSettings({snapshot,error,reload,save}:{snapshot:EditorSettingsSnapshot|null;error:string;reload:()=>void;save:(settings:EditorSettings)=>Promise<void>}){
  const [draft,setDraft]=useState<EditorSettings|null>(snapshot?.settings??null),[busy,setBusy]=useState(false),[failure,setFailure]=useState("");
  const guard=useRef(false);
  useEffect(()=>{setDraft(snapshot?.settings??null);},[snapshot]);
  async function submit(){if(!draft||guard.current)return;guard.current=true;setBusy(true);setFailure("");try{await save(draft);}catch(e){setFailure(String(e));}finally{guard.current=false;setBusy(false);}}
  return <section className="format-settings" aria-label="格式化设置">
    <h3>编辑器</h3>
    {draft&&<><label className="vim-switch"><span>Vim</span><input type="checkbox" disabled={busy} checked={draft.vim??false} onChange={e=>setDraft({...draft,vim:e.target.checked})}/></label><label className="format-switch"><span>保存时格式化</span><input type="checkbox" disabled={busy} checked={draft.formatOnSave} onChange={e=>setDraft({...draft,formatOnSave:e.target.checked})}/></label>
    {languages.map(language=><label key={language.id} className="format-language"><span>{language.label}</span><select disabled={busy} aria-label={language.label+" 保存时格式化"} value={draft.overrides[language.id]===undefined?"inherit":String(draft.overrides[language.id])} onChange={e=>{const overrides={...draft.overrides};if(e.target.value==="inherit")delete overrides[language.id];else overrides[language.id]=e.target.value==="true";setDraft({...draft,overrides});}}><option value="inherit">继承</option><option value="true">开启</option><option value="false">关闭</option></select></label>)}
    <div className="settings-form-actions"><button disabled={busy} onClick={()=>void submit()}>保存设置</button><button disabled={busy} onClick={reload}>重新读取</button></div></>}
    {!draft&&<button onClick={reload}>重新读取</button>}
    {(failure||error)&&<p role="alert" className="error">{failure||error}</p>}
  </section>;
}
