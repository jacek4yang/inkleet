import "./reading-layout.css";
import React,{useCallback,useEffect,useLayoutEffect,useRef,useState} from "react";
import {bounded,parseReadingPreferences,readingDefaults,readingStorageKey,splitBounds,type ReadingPreferences} from "./reading-preferences";

type Drag={id:number;x:number;ratio:number;start:number;width:number;viewport:number;node:HTMLDivElement};
function release(drag:Drag){if(drag.node.hasPointerCapture(drag.id))drag.node.releasePointerCapture(drag.id);}
export function useReadingLayout(focus:boolean) {
 const root=useRef<HTMLElement>(null);
 const [preferences,setPreferences]=useState(()=>{try{return parseReadingPreferences(localStorage.getItem(readingStorageKey));}catch{return {...readingDefaults};}});
 const [bounds,setBounds]=useState({min:25,max:65});
 const [warning,setWarning]=useState("");
 const drag=useRef<Drag|null>(null),current=useRef(preferences);
 const update=useCallback((patch:Partial<ReadingPreferences>,persist=true)=>{
  const next={...current.current,...patch};current.current=next;setPreferences(next);
  if(persist)try{const saved=drag.current?{...next,ratio:drag.current.start}:next;localStorage.setItem(readingStorageKey,JSON.stringify(saved));setWarning("");}catch{setWarning("阅读偏好无法保存，本次仍有效");}
 },[]);
 const cancel=useCallback(()=>{const moving=drag.current;if(moving){drag.current=null;release(moving);update({ratio:moving.start},false);}},[update]);
 useLayoutEffect(()=>{
  const node=root.current;if(!node)return;
  let geometry="";
  const measure=()=>{
   const sidebar=node.querySelector<HTMLElement>(".sidebar"),width=node.clientWidth-(sidebar?.getBoundingClientRect().width??0)-8;
   const next=`${node.clientWidth}:${width}`;
   if(geometry!==next)cancel();geometry=next;setBounds(splitBounds(width));
  };
  const observer=new ResizeObserver(measure);observer.observe(node);measure();
  return()=>{observer.disconnect();cancel();};
 },[focus,cancel]);
 useLayoutEffect(()=>{if(preferences.hidden)cancel();},[preferences.hidden,cancel]);
 useEffect(()=>{
  const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"&&drag.current){event.preventDefault();event.stopPropagation();cancel();}};
  window.addEventListener("keydown",escape,true);window.addEventListener("resize",cancel);return()=>{window.removeEventListener("keydown",escape,true);window.removeEventListener("resize",cancel);cancel();};
 },[cancel]);
 const ratio=bounded(preferences.ratio,44,bounds.min,bounds.max);
 const geometryMatches=()=>{const moving=drag.current,node=root.current;if(!moving||!node||window.innerWidth!==moving.viewport||window.innerWidth<=760||current.current.hidden)return false;const sidebar=node.querySelector<HTMLElement>(".sidebar");return node.clientWidth-(sidebar?.getBoundingClientRect().width??0)-8===moving.width;};
 const valueAt=(x:number)=>{const moving=drag.current!;return bounded(moving.ratio+(x-moving.x)/moving.width*100,44,bounds.min,bounds.max);};
 const reset=()=>{cancel();update({ratio:readingDefaults.ratio});};
 const handle=<div className="reading-resizer" role="separator" aria-label="调整题面宽度" aria-controls="reading-pane code-pane" aria-orientation="vertical" aria-valuemin={Math.round(bounds.min)} aria-valuemax={Math.round(bounds.max)} aria-valuenow={Math.round(ratio)} aria-valuetext={`${Math.round(ratio)}%`} tabIndex={0} title="拖动调整宽度 · ← → · Home / End · 双击或 Enter 重置"
  onPointerDown={event=>{
   if(event.button!==0||!event.isPrimary||drag.current)return;
   const node=root.current;if(!node||node.clientWidth<=760||current.current.hidden)return;
   const sidebar=node.querySelector<HTMLElement>(".sidebar"),width=node.clientWidth-(sidebar?.getBoundingClientRect().width??0)-8;
   if(width<=0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
   drag.current={id:event.pointerId,x:event.clientX,ratio,start:current.current.ratio,width,viewport:window.innerWidth,node:event.currentTarget};
  }}
  onPointerMove={event=>{if(drag.current?.id!==event.pointerId)return;if(!geometryMatches()){cancel();return;}update({ratio:valueAt(event.clientX)},false);}}
  onPointerUp={event=>{const moving=drag.current;if(moving?.id!==event.pointerId)return;if(!geometryMatches()){cancel();return;}const next=valueAt(event.clientX);drag.current=null;release(moving);update({ratio:next});}}
  onPointerCancel={event=>{if(drag.current?.id===event.pointerId)cancel();}}
  onLostPointerCapture={event=>{if(drag.current?.id===event.pointerId)cancel();}}
  onDoubleClick={reset}
  onKeyDown={event=>{
   if(drag.current){if(event.key==="Escape")cancel();event.preventDefault();return;}
   const next=event.key==="ArrowLeft"?ratio-(event.shiftKey?10:2):event.key==="ArrowRight"?ratio+(event.shiftKey?10:2):event.key==="Home"?bounds.min:event.key==="End"?bounds.max:event.key==="Enter"?readingDefaults.ratio:null;
   if(next!==null){event.preventDefault();update({ratio:bounded(next,44,bounds.min,bounds.max)});}
  }}/>;
 return {root,preferences,update,handle,warning,style:{"--reading-ratio":ratio+"fr","--code-ratio":(100-ratio)+"fr","--problem-font-size":preferences.fontSize+"px"} as React.CSSProperties};
}

/** Keep incomplete numeric edits local until the user commits them. */
export function ReadingFontSize({value,onCommit}:{value:number;onCommit:(value:number)=>void}) {
 const [draft,setDraft]=useState(String(value));
 useEffect(()=>{setDraft(String(value));},[value]);
 const commit=()=>{const next=draft.trim()?Math.round(bounded(Number(draft),value,10,32)):value;setDraft(String(next));onCommit(next);};
 return <input aria-label="题面字号" type="number" min={10} max={32} value={draft}
  onChange={event=>setDraft(event.target.value)} onBlur={commit}
  onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();event.currentTarget.blur();}else if(event.key==="Escape"){event.preventDefault();setDraft(String(value));}}}/>;
}
