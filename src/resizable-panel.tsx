import React,{useEffect,useLayoutEffect,useRef,useState} from "react";
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
/** Layout only: hiding a dock never unmounts or cancels the owned process. */
export function useResizablePanel(name:string,visible:boolean,initial=300){
  const panel=useRef<HTMLElement>(null);
  const [height,setHeight]=useState(()=>{try{const n=Number(localStorage.getItem("inkleet.panel."+name));return Number.isFinite(n)&&n>=80&&n<=2000?n:initial;}catch{return initial;}});
  const [maximum,setMaximum]=useState(600),[warning,setWarning]=useState("");
  const drag=useRef<{id:number;y:number;height:number;start:number}|null>(null);
  const persist=(value:number)=>{try{localStorage.setItem("inkleet.panel."+name,String(value));setWarning("");}catch{setWarning("面板高度无法保存，本次仍有效");}};
  useLayoutEffect(()=>{
    const node=panel.current,parent=node?.parentElement;if(!node||!parent)return;
    const measure=()=>{
      const visibleChildren=Array.from(parent.children).filter(el=>!el.hasAttribute("hidden"));
      const docks=visibleChildren.filter(el=>el.classList.contains("resizable-panel")).length;
      const reserved=visibleChildren.filter(el=>!el.classList.contains("resizable-panel")&&!el.classList.contains("editor-host")&&!el.classList.contains("lsp-status")&&!["absolute","fixed"].includes(getComputedStyle(el).position)).reduce((sum,el)=>sum+(el as HTMLElement).getBoundingClientRect().height,0);
      // Deterministic shared budget: never feed the other dock's clamped height
      // back into this dock's limit (that creates ResizeObserver oscillation).
      setMaximum(Math.max(0,parent.clientHeight-reserved-140)/Math.max(1,docks));
    };
    const observer=new ResizeObserver(measure);observer.observe(parent);
    for(const child of Array.from(parent.children))if(child!==node&&!child.classList.contains("editor-host"))observer.observe(child);
    const mutations=new MutationObserver(measure);mutations.observe(parent,{childList:true,subtree:true,attributes:true,attributeFilter:["hidden"]});
    measure();return()=>{observer.disconnect();mutations.disconnect();};
  },[visible]);
  useEffect(()=>{if(!visible)drag.current=null;},[visible]);
  const minimum=Math.min(80,maximum),shown=clamp(height,minimum,maximum);
  const finish=(event:React.PointerEvent,restore=false)=>{
    const moving=drag.current;if(!moving||moving.id!==event.pointerId)return;
    drag.current=null;
    if(restore){setHeight(moving.start);return;}
    // Pointer-up can arrive before React commits the final move. Persist the
    // terminal pointer coordinate, not the previous render's height.
    const value=clamp(moving.height+moving.y-event.clientY,minimum,maximum);
    setHeight(value);persist(value);
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handle=<div className="panel-resizer" role="separator" aria-label={name==="local"?"调整本地面板高度":"调整测试结果高度"} aria-orientation="horizontal" aria-valuemin={Math.round(minimum)} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(shown)} tabIndex={0} title={warning||"拖动调整高度 · ↑ ↓ · Home / End"}
    onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:event.pointerId,y:event.clientY,height:shown,start:height};}}
    onPointerMove={event=>{const moving=drag.current;if(moving?.id===event.pointerId)setHeight(clamp(moving.height+moving.y-event.clientY,minimum,maximum));}}
    onPointerUp={event=>finish(event)}
    onPointerCancel={event=>finish(event,true)}
    onLostPointerCapture={()=>{if(drag.current){setHeight(drag.current.start);drag.current=null;}}}
    onKeyDown={event=>{
      if(event.key==="Escape"&&drag.current){setHeight(drag.current.start);drag.current=null;event.preventDefault();return;}
      const next=event.key==="ArrowUp"?shown+(event.shiftKey?48:16):event.key==="ArrowDown"?shown-(event.shiftKey?48:16):event.key==="Home"?minimum:event.key==="End"?maximum:null;
      if(next!==null){event.preventDefault();const value=clamp(next,minimum,maximum);setHeight(value);persist(value);}
    }} />;
  return {panel,handle,style:{height:shown,maxHeight:"none"} as React.CSSProperties};
}
