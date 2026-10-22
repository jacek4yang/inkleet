import React,{useState} from "react";
import {commandChoices,shortcutChoices,validateKeybindings,type BindableCommand} from "./keybindings";
import {commandBindingLabel} from "./command-registry";
import type {EditorSettings} from "./format-settings";
export function SettingsKeybindings({draft,busy,onChange}:{draft:EditorSettings;busy:boolean;onChange:(next:EditorSettings)=>void}){
 const [command,setCommand]=useState<BindableCommand>("workbench.settings"),[error,setError]=useState("");
 function change(key:string){
  const next={...draft.keybindings};
  if(key)next[command]=key;else delete next[command];
  try{validateKeybindings(next);setError("");onChange({...draft,keybindings:Object.keys(next).length?next:undefined});}
  catch(e){setError(e instanceof Error?e.message:String(e));}
 }
 return <div className="settings-keybindings">
  <label>命令<select disabled={busy} aria-label="自定义快捷键命令" value={command} onChange={e=>{setCommand(e.target.value as BindableCommand);setError("");}}>
   {commandChoices.map(([id,label])=><option key={id} value={id}>{label} · {id}</option>)}
  </select></label>
  <label>附加快捷键<select disabled={busy} aria-label="自定义附加快捷键" value={draft.keybindings?.[command]??""} onChange={e=>change(e.target.value)}>
   <option value="">无 · 保留默认键</option>
   {shortcutChoices.map(key=><option key={key} value={key}>{commandBindingLabel(key,navigator.platform)}</option>)}
  </select></label>
  <p>保存后生效。附加键不替换默认键；编辑命令仅在对应编辑器内生效。Mod 在 macOS 是 Command，其他平台是 Ctrl。不处理输入法组合、AltGr 和长按重复。</p>
  <code>{command}</code>{error&&<p role="alert" className="error">{error}</p>}
 </div>;
}
