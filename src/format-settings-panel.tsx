import {SettingsColors} from "./settings-colors";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { languages } from "./domain";
import {parseEditorSettingsJSON,serializeEditorSettings,defaultEditorSettings,editorOptions,type EditorSettings,type EditorSettingsSnapshot} from "./format-settings";
import {SettingsJSONEditor} from "./settings-json-editor";
import { IconButton } from "./icons";
import { preferenceRows, type EditorSettingId, type EditorSettingRow } from "./settings-catalog";
import { readEditorSettingState, resetEditorSetting } from "./settings-state";

export type EditorSettingsReload = () => Promise<EditorSettingsSnapshot | null>;
export type EditorFormReport = {
  revision: string | null;
  draft: EditorSettings | null;
  dirty: boolean;
  busy: boolean;
  error: string;
};
const rows = preferenceRows.filter((row): row is EditorSettingRow => row.owner === "editor-settings");

export function FormatSettings({ snapshot, error, formattingStatus, reload, save, visibleRows, onReport, beginOperation, registerDirty }: {
  snapshot: EditorSettingsSnapshot | null;
  error: string;
  formattingStatus: string;
  reload: EditorSettingsReload;
  save: (settings: EditorSettings,expected:string|null) => Promise<EditorSettingsSnapshot|null>;
  registerDirty?:(read:()=>boolean)=>()=>void;
  visibleRows: ReadonlySet<EditorSettingId>;
  onReport: (report: EditorFormReport) => void;
  beginOperation?: () => () => void;
}) {
  const [baseline,setBaseline]=useState<EditorSettingsSnapshot|null>(snapshot);
  const baselineRef=useRef(baseline),baselineText=useRef(snapshot?serializeEditorSettings(snapshot.settings):"");
  const [raw,setRawState]=useState(baselineText.current),rawRef=useRef(raw);
  const [mode,setMode]=useState<"visual"|"json">("visual"),[confirmReload,setConfirmReload]=useState(false);
  const [operation,setOperation]=useState<"save"|"reload"|null>(null),[failure,setFailure]=useState("");
  const guard=useRef(false),alive=useRef(true);
  const busy=operation!==null;
  const parsed=useMemo(()=>{
    if(!baseline&&!raw)return {settings:null,error:""};
    try{return {settings:parseEditorSettingsJSON(raw),error:""};}catch(error){return {settings:null,error:error instanceof Error?error.message:String(error)};}
  },[raw,baseline]);
  const draft=parsed.settings,dirty=raw!==baselineText.current;
  const visibleError=parsed.error||failure||error;
  function setRaw(text:string){rawRef.current=text;setRawState(text);}
  function setDraft(settings:EditorSettings){setRaw(serializeEditorSettings(settings));}
  function exportDraft(){
    const url=URL.createObjectURL(new Blob([rawRef.current],{type:"application/json;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download="editor-settings.draft.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function adopt(next:EditorSettingsSnapshot|null){
    baselineRef.current=next;setBaseline(next);
    baselineText.current=next?serializeEditorSettings(next.settings):"";setRaw(baselineText.current);setFailure("");
  }
  useLayoutEffect(()=>registerDirty?.(()=>rawRef.current!==baselineText.current),[registerDirty]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(guard.current||snapshot===baselineRef.current)return;
    if(rawRef.current===baselineText.current)adopt(snapshot);
    else if(snapshot?.revision!==baselineRef.current?.revision)setFailure("设置已在其他位置变化；当前草稿已保留，请重新读取或导出草稿后处理");
  },[snapshot]);
  useEffect(()=>{
    onReport({revision:baseline?.revision??null,draft,dirty,busy,error:visibleError});
  },[baseline?.revision,draft,dirty,busy,visibleError,onReport]);
  async function submit(){
    if(!draft||!baselineRef.current||guard.current)return;
    guard.current=true;const finish=beginOperation?.();setOperation("save");setFailure("");
    try{
      const settings={...draft};if(settings.tabSize===4)delete settings.tabSize;
      const saved=await save(settings,baselineRef.current.revision);
      if(alive.current){if(saved)adopt(saved);else setFailure("保存结果已被更新操作取代，草稿仍保留，请重新读取确认");}
    }catch(error){if(alive.current)setFailure(String(error));}
    finally{guard.current=false;if(alive.current)setOperation(null);finish?.();}
  }
  async function reread(confirmed=false){
    if(guard.current)return;
    if(!confirmed&&rawRef.current!==baselineText.current){setConfirmReload(true);return;}
    setConfirmReload(false);guard.current=true;const finish=beginOperation?.();setOperation("reload");
    try{const loaded=await reload();if(alive.current&&loaded)adopt(loaded);}
    catch(error){if(alive.current)setFailure(String(error));}
    finally{guard.current=false;if(alive.current)setOperation(null);finish?.();}
  }
  function renderRow(row: EditorSettingRow) {
    if (!draft) return null;
    const state = readEditorSettingState(draft, row.id);
    if (state.status !== "known") return null;
    if(row.kind==="color-overrides")return <div key={row.id} className="settings-row settings-colors-row" data-setting-id={row.id} data-setting-source={state.isDefault?"default":"modified"} hidden={!visibleRows.has(row.id)}>
      <SettingsColors draft={draft} busy={busy} onChange={setDraft}/>
      <IconButton type="button" icon="refresh" label="重置 自定义配色" className="settings-reset" disabled={busy||!state.canReset} onClick={()=>setDraft(resetEditorSetting(draft,row.id))}/>
      <span className="settings-row-description">{state.value}<code>{row.id}</code></span>
    </div>;
    const language = row.kind === "language-format" ? languages.find(item => item.id === row.language) : undefined;
    const label = language?.label ?? row.label;
    const controlId = "setting-" + row.id;
    const defaultLabel = state.defaultValue === "inherit" ? "继承" : typeof state.defaultValue === "boolean" ? (state.defaultValue ? "开启" : "关闭") : String(state.defaultValue);
    const source = state.hasLanguageOverride ? "override" : state.isDefault ? "default" : "modified";
    const descriptionId = "setting-description-" + row.id;
    const description = (state.hasLanguageOverride ? "语言覆盖" : state.isDefault ? "默认设置" : "已修改") + "；默认：" + defaultLabel;
    const rowClass = row.id === "editor.vim" ? "vim-switch" : row.id === "editor.tabSize" ? "editor-tab-size" : row.kind === "language-format" ? "format-language" : row.kind === "editor-option" ? "editor-option" : "format-switch";
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
          : row.kind === "editor-option" ? (row.option.kind==="boolean"?<input id={controlId} aria-describedby={descriptionId} data-settings-focus={row.id} type="checkbox" disabled={busy} checked={Boolean(draft[row.option.key]??row.option.defaultValue)} onChange={event=>setDraft({...draft,[row.option.key]:event.target.checked})}/>:
          <select id={controlId} aria-describedby={descriptionId} data-settings-focus={row.id} disabled={busy} value={String(draft[row.option.key]??row.option.defaultValue)} onChange={event=>setDraft({...draft,[row.option.key]:row.option.kind==="number"?Number(event.target.value):event.target.value})}>
           {row.option.kind==="enum"?row.option.choices?.map(choice=><option key={choice.value} value={choice.value}>{choice.label}</option>):
            [...new Set([Number(draft[row.option.key]??row.option.defaultValue),...Array.from({length:Math.round((row.option.max!-row.option.min!)/(row.option.step??1))+1},(_,i)=>Number((row.option.min!+i*(row.option.step??1)).toFixed(2)))])].sort((a,b)=>a-b).map(value=><option key={value} value={value}>{value}</option>)}
          </select>) : row.kind === "language-format" ? <select id={controlId} aria-describedby={descriptionId} data-settings-focus={row.id} disabled={busy} aria-label={row.label} value={draft.overrides[row.language] === undefined ? "inherit" : String(draft.overrides[row.language])} onChange={event => {
            const overrides = { ...draft.overrides };
            if (event.target.value === "inherit") delete overrides[row.language]; else overrides[row.language] = event.target.value === "true";
            setDraft({ ...draft, overrides });
          }}><option value="inherit">继承 · {draft.formatOnSave ? "开启" : "关闭"}</option><option value="true">开启</option><option value="false">关闭</option></select> : null}
      </label>
      <span id={descriptionId} className="settings-row-description">{row.kind==="editor-option"?row.option.description+" ":""}{description}<code>{row.id}</code></span>
      <IconButton type="button" icon="refresh" label={"重置 " + row.label} title={"重置 " + row.label + " · 默认：" + defaultLabel} className="settings-reset" data-setting-reset={row.id} data-settings-focus={"reset:" + row.id} disabled={busy || !state.canReset} onClick={() => setDraft(resetEditorSetting(draft, row.id))} />
    </div>;
  }
  const appearance=rows.filter(row=>row.group==="appearance");
  const behavior = rows.filter(row => row.group === "behavior");
  const formatting = rows.filter(row => row.id === "editor.formatOnSave");
  const overrides = rows.filter(row => row.kind === "language-format");
  return <section className="format-settings settings-owner" aria-label="格式化设置" data-settings-owner="editor" aria-busy={busy}>
    <div className="settings-view-switch" role="group" aria-label="设置编辑方式">
      <button type="button" disabled={busy} aria-pressed={mode==="visual"} onClick={()=>setMode("visual")}>可视化</button>
      <button type="button" disabled={busy} aria-pressed={mode==="json"} onClick={()=>setMode("json")}>JSON</button>
    </div>
    <div hidden={mode!=="json"} className="settings-json-pane">
      <p>严格 JSON，不支持注释或尾逗号。可粘贴 AI 生成的配置；验证并保存后生效。</p>
      <div className="settings-json-actions"><button type="button" disabled={busy||!draft} onClick={()=>{if(draft)setDraft(draft);}}>格式化 JSON</button><button type="button" disabled={busy} onClick={exportDraft}>导出 JSON 草稿</button></div>
      <SettingsJSONEditor value={raw} onChange={setRaw} onSave={()=>void submit()} disabled={busy}/>
      <details><summary>默认 JSON 与字段说明</summary>
       <p>这是 InkLeet 的配置格式，不是 VS Code / Zed 配置文件。只支持界面列出的字段；不要填写 revision、账号或密钥。</p>
       <pre>{serializeEditorSettings({...defaultEditorSettings,...Object.fromEntries(editorOptions.map(option=>[option.key,option.defaultValue]))})}</pre>
      </details>
    </div>
    <div hidden={mode!=="visual"}>
    {!draft&&raw&&<p className="error">JSON 尚未通过校验，请返回 JSON 修复；原草稿保留。</p>}
    {draft && <>
      <div className="settings-group" hidden={!appearance.some(row=>visibleRows.has(row.id))}><h3>外观</h3>{appearance.map(renderRow)}</div>
      <div className="settings-group" hidden={!behavior.some(row => visibleRows.has(row.id))}><h3>编辑</h3>{behavior.map(renderRow)}</div>
      <div className="settings-group" hidden={!formatting.some(row => visibleRows.has(row.id))}><h3>格式化</h3>{formatting.map(renderRow)}</div>
      <div className="settings-group" hidden={!overrides.some(row => visibleRows.has(row.id))}><h3>语言覆盖</h3>{overrides.map(renderRow)}</div>
    </>}
    </div>
    <div className="settings-form-actions">
      {<button type="button" disabled={busy||!draft||!baseline} data-settings-focus="editor.save" onClick={() => void submit()}>保存设置</button>}
      <button type="button" disabled={busy} data-settings-focus="editor.reload" onClick={() => void reread()}>重新读取</button>
      {busy ? <span role="status">{operation === "save" ? "保存中…" : "读取中…"}</span> : dirty ? <span className="settings-dirty">未保存</span> : null}
    </div>
    {confirmReload&&<ReloadSettingsDialog onCancel={()=>setConfirmReload(false)} onConfirm={()=>void reread(true)}/>}
    {visibleError && <p role="alert" className="error settings-error-detail" tabIndex={-1} data-settings-focus="editor.error">{visibleError}</p>}
    {formattingStatus && <p className="settings-format-status" role="status">{formattingStatus}</p>}
  </section>;
}

function ReloadSettingsDialog({onCancel,onConfirm}:{onCancel:()=>void;onConfirm:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useLayoutEffect(()=>{const opener=document.activeElement,element=ref.current!;element.showModal();return()=>{element.close();if(opener instanceof HTMLElement&&opener.isConnected)opener.focus();};},[]);
 return <dialog ref={ref} className="settings-discard-dialog" role="alertdialog" aria-label="放弃设置草稿并重新读取" onCancel={event=>{event.preventDefault();onCancel();}}>
  <p>重新读取会放弃当前设置草稿。</p><button type="button" autoFocus onClick={onCancel}>继续编辑</button><button type="button" onClick={onConfirm}>放弃草稿并读取</button>
 </dialog>;
}
