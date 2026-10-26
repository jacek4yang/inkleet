import React,{useLayoutEffect,useMemo,useRef,useState} from "react";
import {diagnosticExcerpt,ownedDiagnosticLine,parseCompilerDiagnostics} from "./compiler-diagnostics";
import "./compiler-diagnostics.css";
export function CompilerDiagnostics({raw,language,source,onJump,stale=false}:{raw:string;language:string;source?:string;stale?:boolean;onJump?:(line:number,source:string)=>void}){
 const report=useMemo(()=>parseCompilerDiagnostics(raw,language),[raw,language]);
 const owner=useMemo(()=>({raw,language,source}),[raw,language,source]);
 const currentOwner=useRef(owner);currentOwner.current=owner;
 const alive=useRef(true),request=useRef(0),pendingOwner=useRef<typeof owner|null>(null);
 const [copy,setCopy]=useState<{owner:typeof owner;message:string;pending:boolean}|null>(null);
 useLayoutEffect(()=>{alive.current=true;return ()=>{alive.current=false;++request.current;};},[]);
 const visibleCopy=copy?.owner===owner?copy:null;
 async function copyLog(){
  if(pendingOwner.current===owner)return;
  pendingOwner.current=owner;const ticket=++request.current;
  setCopy({owner,message:"",pending:true});
  let message="已复制原始错误输出";
  try{await navigator.clipboard.writeText(raw);}
  catch{message="复制失败，请展开原始错误输出并手动复制";}
  finally{
   if(pendingOwner.current===owner)pendingOwner.current=null;
   if(alive.current&&ticket===request.current&&currentOwner.current===owner)setCopy({owner,message,pending:false});
  }
 }
 return <section className="compiler-diagnostics" aria-label="错误输出">
  <div className="diagnostic-heading"><h4>错误输出</h4><button type="button" disabled={visibleCopy?.pending} onClick={()=>void copyLog()}>复制原始错误输出</button></div>
  {visibleCopy?.message&&<p role="status">{visibleCopy.message}</p>}
  {report.items.length>0?<><p className="muted">诊断摘要 · {report.items.length} 条{stale?" · 对应运行时源码，当前代码已改变":""}</p>
   <ol className="diagnostic-list">{report.items.map((item,index)=>{
    const line=source===undefined?null:ownedDiagnosticLine(item,language,source);
    const location=item.file+":"+item.line+(item.column?":"+item.column:"");
    return <li key={index}><div className="diagnostic-location"><span>{item.severity==="error"?"错误":item.severity==="warning"?"警告":"提示"}</span>{line!==null&&onJump&&!stale?<button type="button" onClick={()=>onJump(line,source!)} title="定位到本次运行源码行">{location}</button>:<code>{location}</code>}</div>
     <p className="diagnostic-message">{item.message}</p>
     {line!==null&&source!==undefined&&<div className="diagnostic-excerpt" aria-label="运行源码片段">{diagnosticExcerpt(source,line).map(row=><div key={row.line} data-active={row.active}><span aria-hidden="true">{row.line}</span><pre>{row.text||" "}</pre></div>)}</div>}
    </li>;
   })}</ol></>:<p className="muted">未识别到可结构化的诊断，请查看原始错误输出。</p>}
  {report.limited&&<p className="muted">摘要达到解析上限；原始错误输出仍完整保留如下。</p>}
  <details className="diagnostic-raw" open={!report.items.length}><summary>原始错误输出</summary><pre tabIndex={0}>{raw}</pre></details>
 </section>;
}
