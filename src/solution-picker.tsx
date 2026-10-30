import type {LiveCode} from "./live-code";
import React,{useEffect,useRef,useState,useLayoutEffect} from "react";
import {invoke,isTauri} from "@tauri-apps/api/core";
import {Icon,IconButton} from "./icons";
type Entry={id:string;name:string};
type Operation={kind:"new"|"copy"|"rename"|"archive";id:string;name:string;code:string;expected?:string};
type Listing={entries:Entry[];archived?:Entry[];unreadable:number};
export function SolutionPicker({problem,language,value,codeSource,template,templateAvailable=true,disabled,onChange,onCreated,prepareArchive,onArchived,onRestored}:{
 problem:string;language:string;value:string;codeSource:LiveCode;template:string;templateAvailable?:boolean;disabled:boolean;
 onChange:(id:string)=>void;onCreated:(entry:Entry,code:string)=>void;
 prepareArchive:(id:string,code:string)=>Promise<string>;onArchived:(id:string,code:string)=>void;onRestored:(entry:Entry)=>void;
}){
 const [entries,setEntries]=useState<Entry[]>([{id:"default",name:"默认解答"}]),[archived,setArchived]=useState<Entry[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(false);
 const [operation,setOperation]=useState<Operation|null>(null),[archiveOpen,setArchiveOpen]=useState(false),[pending,setPending]=useState(false);
 const alive=useRef(true),request=useRef(0),guard=useRef(false),menu=useRef<HTMLDetailsElement>(null),selected=useRef(value),owner=useRef(0);
 selected.current=value;
 async function refresh(){
  const token=++request.current;setLoading(true);setError("");
  try{
   const result=isTauri()?await invoke<Listing>("list_solutions",{problem,language}):{entries,archived,unreadable:0};
   if(alive.current&&token===request.current){
    setEntries(result.entries);setArchived(result.archived??[]);
    if(result.unreadable)setError(result.unreadable+" 份解答记录需检查");
    // An interrupted reply can leave a successful archive on disk. A confirmed
    // listing is authoritative, but never switches away from a newer selection.
    if((result.archived??[]).some(entry=>entry.id===selected.current))onChange("default");
   }
  }catch(e){if(alive.current&&token===request.current)setError(String(e));}
  finally{if(alive.current&&token===request.current)setLoading(false);}
 }
 useEffect(()=>{alive.current=true;++owner.current;void refresh();return()=>{alive.current=false;++request.current;++owner.current;};},[problem,language]);
 function closeMenu(){if(menu.current)menu.current.open=false;}
 function begin(kind:Operation["kind"]){
  if(disabled||loading||guard.current)return;
  closeMenu();const current=entries.find(item=>item.id===value);
  if((kind==="rename"||kind==="archive")&&!current)return;
  if(kind==="archive"&&value==="default")return;
  setError("");setOperation({kind,id:value,name:kind==="rename"||kind==="archive"?current?.name??"":kind==="copy"?(current?.name??"解答")+" 副本":"",code:kind==="copy"||kind==="archive"?codeSource.read():template,expected:current?.name});
 }
 async function submit(name:string){
  if(!operation||operation.kind==="archive"||guard.current)return;
  guard.current=true;++request.current;setPending(true);setError("");
  const action=operation,token=owner.current,current=()=>alive.current&&owner.current===token;
  try{
   const clean=name.trim();if(!clean||Array.from(clean).length>80||/[\u0000-\u001f\u007f]/.test(clean))throw Error("解答名称须为 1–80 个字符");
   if([...entries,...archived].some(item=>item.id!==(action.kind==="rename"?action.id:"")&&item.name.toLowerCase()===clean.toLowerCase()))throw Error("该语言已有同名解答（含归档）");
   if(action.kind==="rename"){
    const entry=isTauri()?await invoke<Entry>("rename_solution",{problem,language,id:action.id,name:clean,expected:action.expected}):{id:action.id,name:clean};
    if(current())setEntries(items=>items.map(item=>item.id===entry.id?entry:item));
   }else{
    const id=crypto.randomUUID().replaceAll("-","");
    const entry=isTauri()?await invoke<Entry>("create_solution",{problem,language,id,name:clean,code:action.code}):{id,name:clean};
    if(current()){setEntries(items=>[...items,entry]);if(selected.current===action.id)onCreated(entry,action.code);}
   }
   if(current())setOperation(null);
  }catch(e){if(current())setError(String(e));}
  finally{guard.current=false;if(current())setPending(false);}
 }
 async function archive(){
  if(!operation||operation.kind!=="archive"||guard.current)return;
  guard.current=true;++request.current;setPending(true);setError("");
  const action=operation,token=owner.current,current=()=>alive.current&&owner.current===token;
  try{
   if(selected.current!==action.id||codeSource.read()!==action.code)throw Error("当前解答已变化，请重新确认归档");
   const baseline=await prepareArchive(action.id,action.code);
   if(!current()||selected.current!==action.id||codeSource.read()!==action.code)throw Error("当前解答已变化，请重新确认归档");
   const entry=isTauri()?await invoke<Entry>("archive_solution",{problem,language,id:action.id,expected:action.expected,code:action.code,baseline}):{id:action.id,name:action.name};
   if(current()){
    setEntries(items=>items.filter(item=>item.id!==entry.id));setArchived(items=>[...items.filter(item=>item.id!==entry.id),entry]);
    onArchived(entry.id,action.code);setOperation(null);
   }
  }catch(e){if(current())setError(String(e));}
  finally{guard.current=false;if(current())setPending(false);}
 }
 async function restore(entry:Entry){
  if(guard.current||loading)return;guard.current=true;++request.current;setPending(true);setError("");
  const token=owner.current,selection=selected.current,current=()=>alive.current&&owner.current===token;
  try{
   const restored=isTauri()?await invoke<Entry>("restore_solution",{problem,language,id:entry.id,expected:entry.name}):entry;
   if(current()){
    setArchived(items=>items.filter(item=>item.id!==restored.id));setEntries(items=>[...items.filter(item=>item.id!==restored.id),restored]);
    // A late restore may update the list, but cannot reclaim a newer document.
    if(selected.current===selection){onRestored(restored);setArchiveOpen(false);}
   }
  }catch(e){if(current())setError(String(e));}
  finally{guard.current=false;if(current())setPending(false);}
 }
 return <div className="solution-picker">
  <select aria-label="解答" title={entries.find(entry=>entry.id===value)?.name??value} value={value} disabled={pending} onChange={event=>onChange(event.target.value)}>
   {value!=="default"&&!entries.some(entry=>entry.id===value)&&<option value={value}>待刷新解答</option>}
   {entries.map(entry=><option key={entry.id} value={entry.id}>{entry.name}</option>)}
  </select>
  <details ref={menu} className="solution-menu">
   <summary aria-label="解答操作" title="解答操作"><Icon name="more"/></summary>
   <div>
    <button title={templateAvailable?undefined:"官方模板不可用"} disabled={disabled||loading||pending||!templateAvailable} onClick={()=>begin("new")}>新建解答</button>
    <button disabled={disabled||loading||pending} onClick={()=>begin("copy")}>复制解答</button>
    <button disabled={disabled||loading||pending} onClick={()=>begin("rename")}>重命名</button>
    <button title={value==="default"?"默认解答保留，其他解答可归档":undefined} disabled={disabled||loading||pending||value==="default"} onClick={()=>begin("archive")}>归档解答</button>
    <button disabled={loading||pending} onClick={()=>{closeMenu();setError("");setArchiveOpen(true);}}>已归档{archived.length>0?"（"+archived.length+"）":""}</button>
    <button disabled={loading||pending} onClick={()=>{closeMenu();void refresh();}}>刷新</button>
   </div>
  </details>
  {error&&!operation&&!archiveOpen&&<span role="alert" className="error solution-error">{error}</span>}
  {operation&&operation.kind!=="archive"&&<NameDialog key={operation.kind} title={operation.kind==="new"?"新建解答":operation.kind==="copy"?"复制解答":"重命名"} initial={operation.name} pending={pending} error={error} onSubmit={submit} onClose={()=>{if(!guard.current){setOperation(null);setError("");}}}/>}
  {operation?.kind==="archive"&&<SolutionDialog title="归档解答" pending={pending} onClose={()=>{if(!guard.current){setOperation(null);setError("");}}}>
   <p className="solution-full-name">归档「{operation.name}」？</p><p>代码、未保存草稿和恢复副本会保留，可从「已归档」恢复。共享笔记不受影响。</p>
   {error&&<p role="alert" className="error">{error}</p>}
   <div className="solution-dialog-actions"><button disabled={pending} onClick={()=>{if(!guard.current){setOperation(null);setError("");}}}>取消</button><button disabled={pending} onClick={()=>void archive()}>确认归档</button></div>
  </SolutionDialog>}
  {archiveOpen&&<SolutionDialog title="已归档解答" pending={pending} onClose={()=>{if(!guard.current){setArchiveOpen(false);setError("");}}}>
   {archived.length?<ul className="solution-archives">{archived.map(entry=><li key={entry.id}><span>{entry.name}</span><button disabled={pending||loading} aria-label={"恢复解答「"+entry.name+"」"} onClick={()=>void restore(entry)}>恢复</button></li>)}</ul>:<p>没有已归档解答。</p>}
   {error&&<p role="alert" className="error">{error}</p>}
   <div className="solution-dialog-actions"><button disabled={pending||loading} onClick={()=>void refresh()}>刷新</button><button disabled={pending} onClick={()=>{if(!guard.current){setArchiveOpen(false);setError("");}}}>关闭</button></div>
  </SolutionDialog>}
 </div>;
}
function SolutionDialog({title,pending,onClose,children}:{title:string;pending:boolean;onClose:()=>void;children:React.ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null),opener=useRef(document.activeElement as HTMLElement|null);
 useLayoutEffect(()=>{dialog.current!.showModal();return()=>{dialog.current?.close();if(opener.current?.isConnected)opener.current.focus();};},[]);
 return <dialog ref={dialog} className="solution-name-dialog" aria-label={title} onCancel={event=>{event.preventDefault();onClose();}}>
  <header><h2>{title}</h2><IconButton icon="close" label={"关闭"+title} disabled={pending} onClick={onClose}/></header>{children}
 </dialog>;
}
function NameDialog({title,initial,pending,error,onSubmit,onClose}:{title:string;initial:string;pending:boolean;error:string;onSubmit:(name:string)=>Promise<void>;onClose:()=>void}){
 const [name,setName]=useState(initial);
 return <SolutionDialog title={title} pending={pending} onClose={onClose}><form onSubmit={event=>{event.preventDefault();void onSubmit(name);}}>
  <input autoFocus aria-label="解答名称" maxLength={80} value={name} disabled={pending} onChange={event=>setName(event.target.value)}/>
  {error&&<p role="alert" className="error">{error}</p>}
  <div><button type="button" disabled={pending} onClick={onClose}>取消</button><button type="submit" disabled={pending||!name.trim()}>保存</button></div>
 </form></SolutionDialog>;
}
