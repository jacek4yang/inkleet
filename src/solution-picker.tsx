import React,{useEffect,useRef,useState,useLayoutEffect} from "react";
import {invoke,isTauri} from "@tauri-apps/api/core";
import {Icon,IconButton} from "./icons";
type Entry={id:string;name:string};
type Operation={kind:"new"|"copy"|"rename";name:string;code:string;expected?:string};
export function SolutionPicker({problem,language,value,code,template,templateAvailable=true,disabled,onChange,onCreated}:{
 problem:string;language:string;value:string;code:string;template:string;templateAvailable?:boolean;disabled:boolean;
 onChange:(id:string)=>void;onCreated:(entry:Entry,code:string)=>void;
}){
 const [entries,setEntries]=useState<Entry[]>([{id:"default",name:"默认解答"}]),[error,setError]=useState(""),[loading,setLoading]=useState(false);
 const [operation,setOperation]=useState<Operation|null>(null),[pending,setPending]=useState(false);
 const alive=useRef(true),request=useRef(0),guard=useRef(false),menu=useRef<HTMLDetailsElement>(null);
 async function refresh(){
  const token=++request.current;setLoading(true);setError("");
  try{
   const result=isTauri()?await invoke<{entries:Entry[];unreadable:number}>("list_solutions",{problem,language}):{entries,unreadable:0};
   if(alive.current&&token===request.current){setEntries(result.entries);if(result.unreadable)setError(result.unreadable+" 份解答记录需检查");}
  }catch(e){if(alive.current&&token===request.current)setError(String(e));}
  finally{if(alive.current&&token===request.current)setLoading(false);}
 }
 useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;++request.current;};},[problem,language]);
 function begin(kind:Operation["kind"]){
  if(menu.current)menu.current.open=false;
  const current=entries.find(item=>item.id===value);
  setError("");setOperation({kind,name:kind==="rename"?current?.name??"":kind==="copy"?(current?.name??"解答")+" 副本":"",code:kind==="copy"?code:template,expected:current?.name});
 }
 async function submit(name:string){
  if(!operation||guard.current)return;guard.current=true;setPending(true);setError("");
  const action=operation;
  try{
   const clean=name.trim();if(!clean||Array.from(clean).length>80||/[\u0000-\u001f\u007f]/.test(clean))throw Error("解答名称须为 1–80 个字符");
   if(entries.some(item=>item.id!==(action.kind==="rename"?value:"")&&item.name.toLowerCase()===clean.toLowerCase()))throw Error("该语言已有同名解答");
   if(action.kind==="rename"){
    const entry=isTauri()?await invoke<Entry>("rename_solution",{problem,language,id:value,name:clean,expected:action.expected}):{id:value,name:clean};
    if(alive.current)setEntries(items=>items.map(item=>item.id===entry.id?entry:item));
   }else{
    const id=crypto.randomUUID().replaceAll("-","");
    const entry=isTauri()?await invoke<Entry>("create_solution",{problem,language,id,name:clean,code:action.code}):{id,name:clean};
    if(alive.current){setEntries(items=>[...items,entry]);onCreated(entry,action.code);}
   }
   if(alive.current)setOperation(null);
  }catch(e){if(alive.current)setError(String(e));}
  finally{guard.current=false;if(alive.current)setPending(false);}
 }
 return <div className="solution-picker">
  <select aria-label="解答" value={value} disabled={pending} onChange={event=>onChange(event.target.value)}>
   {value!=="default"&&!entries.some(entry=>entry.id===value)&&<option value={value}>…</option>}
   {entries.map(entry=><option key={entry.id} value={entry.id}>{entry.name}</option>)}
  </select>
  <details ref={menu} className="solution-menu">
   <summary aria-label="解答操作" title="解答操作"><Icon name="more"/></summary>
   <div>
    <button title={templateAvailable?undefined:"官方模板不可用"} disabled={disabled||loading||pending||!templateAvailable} onClick={()=>begin("new")}>新建解答</button>
    <button disabled={disabled||loading||pending} onClick={()=>begin("copy")}>复制解答</button>
    <button disabled={disabled||loading||pending} onClick={()=>begin("rename")}>重命名</button>
    <button disabled={loading||pending} onClick={()=>{if(menu.current)menu.current.open=false;void refresh();}}>刷新</button>
   </div>
  </details>
  {error&&!operation&&<span role="alert" className="error solution-error">{error}</span>}
  {operation&&<NameDialog key={operation.kind} title={operation.kind==="new"?"新建解答":operation.kind==="copy"?"复制解答":"重命名"} initial={operation.name} pending={pending} error={error} onSubmit={submit} onClose={()=>{if(!guard.current){setOperation(null);setError("");}}}/>}
 </div>;
}
function NameDialog({title,initial,pending,error,onSubmit,onClose}:{title:string;initial:string;pending:boolean;error:string;onSubmit:(name:string)=>Promise<void>;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),[name,setName]=useState(initial),opener=useRef(document.activeElement as HTMLElement|null);
 useLayoutEffect(()=>{dialog.current!.showModal();return()=>{dialog.current?.close();if(opener.current?.isConnected)opener.current.focus();};},[]);
 return <dialog ref={dialog} className="solution-name-dialog" aria-label={title} onCancel={event=>{event.preventDefault();onClose();}}>
  <header><h2>{title}</h2><IconButton icon="close" label="关闭解答命名" disabled={pending} onClick={onClose}/></header>
  <form onSubmit={event=>{event.preventDefault();void onSubmit(name);}}>
   <input autoFocus aria-label="解答名称" maxLength={80} value={name} disabled={pending} onChange={event=>setName(event.target.value)}/>
   {error&&<p role="alert" className="error">{error}</p>}
   <div><button type="button" disabled={pending} onClick={onClose}>取消</button><button type="submit" disabled={pending||!name.trim()}>保存</button></div>
  </form>
 </dialog>;
}
