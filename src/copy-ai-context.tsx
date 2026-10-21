import React,{useEffect,useRef,useState} from "react";
export function CopyAIContext({snapshot,disabled=false}:{snapshot:()=>string;disabled?:boolean}){
 const alive=useRef(true),pending=useRef(false),dialog=useRef<HTMLDialogElement>(null),area=useRef<HTMLTextAreaElement>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[manual,setManual]=useState<string|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(manual!==null){dialog.current?.showModal();area.current?.focus();area.current?.select();}},[manual]);
 async function copy(){
  if(disabled||pending.current)return;
  let text:string;
  try{text=snapshot();}catch{setMessage("生成复制内容失败，草稿未改变");return;}
  pending.current=true;setBusy(true);setMessage("");
  try{
   if(!navigator.clipboard?.writeText)throw new Error("Clipboard unavailable");
   await navigator.clipboard.writeText(text);
   if(alive.current)setMessage("已复制题目、当前代码和题解");
  }catch{if(alive.current){setMessage("自动复制未成功，请手动复制");setManual(text);}}
  finally{pending.current=false;if(alive.current)setBusy(false);}
 }
 return <><button type="button" aria-label="复制给 AI" title={message||"复制题目详情、当前语言代码和题解笔记；不会发送给 AI"} disabled={disabled||busy} onClick={()=>void copy()}>{busy?"复制中…":message.startsWith("已复制")?"已复制":"复制给 AI"}</button>
 {message&&<span role="status" style={{position:"absolute",width:1,height:1,overflow:"hidden",clipPath:"inset(50%)"}}>{message}</span>}
 {manual!==null&&<dialog className="copy-ai-dialog" ref={dialog} aria-label="手动复制给 AI" onCancel={event=>{event.preventDefault();setManual(null);}}>
  <p>自动复制未成功。下方已选中完整内容，请按 Ctrl+C（macOS：⌘C）。</p>
  <textarea ref={area} aria-label="待复制的题目与题解" readOnly value={manual} rows={16}/>
  <div><button type="button" onClick={()=>{area.current?.focus();area.current?.select();}}>全选内容</button><button type="button" onClick={()=>setManual(null)}>关闭</button></div>
 </dialog>}</>;
}
