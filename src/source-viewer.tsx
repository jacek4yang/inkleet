import React,{useLayoutEffect,useRef,useState} from "react";
import {Compartment,EditorSelection,EditorState,Prec} from "@codemirror/state";
import {EditorView,keymap} from "@codemirror/view";
import {basicSetup} from "codemirror";
import {python} from "@codemirror/lang-python";
import {go} from "@codemirror/lang-go";
import {cpp} from "@codemirror/lang-cpp";
import {rust} from "@codemirror/lang-rust";
import {java} from "@codemirror/lang-java";
import {vim,getCM} from "@replit/codemirror-vim";
import {steadyVimCursor} from "./steady-cursor";
import {vimNavigation} from "./vim-navigation";
import {SourceHistory} from "./source-history";
import {chooseSourceTarget,sourceSpan,type Source} from "./source-protocol";
function Icon({kind}:{kind:"back"|"forward"|"close"|"return"}){
 const d={back:"M10 3 5 8l5 5M5 8h9",forward:"m6 3 5 5-5 5M2 8h9",close:"m4 4 8 8M12 4l-8 8",return:"M6 3 2 7l4 4M2 7h8a4 4 0 0 1 4 4v2"}[kind];
 return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d}/></svg>;
}
export function SourceViewer({source,onClose,vimEnabled=false}:{source:Source;onClose:()=>void;vimEnabled?:boolean}){
 const dialog=useRef<HTMLDialogElement>(null),host=useRef<HTMLDivElement>(null),actions=useRef<{move:(direction:-1|1)=>void;close:()=>void;configure:(enabled:boolean)=>void}|null>(null);
 const [info,setInfo]=useState({name:source.name,path:source.uri.split("?")[0],declaration:source.declaration,back:true,forward:false,message:""});
 const closeCallback=useRef(onClose);closeCallback.current=onClose;
 useLayoutEffect(()=>{
  const navigation=source.navigation,element=dialog.current!,parent=host.current!;
  const history=new SourceHistory({source:navigation.primary,selection:navigation.originSelection,scroll:navigation.originScroll});
  const first=sourceSpan(source.text,source.range);
  if(!first){closeCallback.current();return;}
  history.push({source,selection:{ranges:[first],mainIndex:0},scroll:{top:0,left:0}});
  let destroyed=false,generation=0,abort:AbortController|null=null,swapping=false,view:EditorView;
  const vimSlot=new Compartment();
  const vimExtensions=(enabled:boolean)=>enabled?[Prec.high(vim({status:false})),steadyVimCursor()]:[];
  let enabled=vimEnabled;
  const selection=()=>({ranges:view.state.selection.ranges.map(({anchor,head})=>({anchor,head})),mainIndex:view.state.selection.mainIndex});
  const capture=()=>history.update(selection(),{top:view.scrollDOM.scrollTop,left:view.scrollDOM.scrollLeft});
  const update=(message="")=>{
   if(destroyed)return;const current=history.current.source;
   let path=current.uri.split("?")[0];try{path=decodeURI(path);}catch{}
   setInfo({name:current.name,path,declaration:current.declaration,back:history.canBack,forward:history.canForward,message});
  };
  const cancel=()=>{++generation;abort?.abort();abort=null;navigation.cancel();};
  const close=()=>{if(destroyed)return;cancel();element.close();closeCallback.current();};
  const apply=(center:boolean)=>{
   const ticket=generation,visit=history.current;
   swapping=true;view.setState(state(visit.source.text,visit.source.language,EditorSelection.fromJSON(visit.selection)));swapping=false;
   update();view.focus();
   if(center)view.dispatch({effects:EditorView.scrollIntoView(visit.selection.ranges[visit.selection.mainIndex].head,{y:"center"})});
   else view.requestMeasure({read:()=>null,write:()=>{if(!destroyed&&ticket===generation){view.scrollDOM.scrollTop=visit.scroll.top;view.scrollDOM.scrollLeft=visit.scroll.left;}}});
  };
  const move=(direction:-1|1)=>{if(destroyed)return;capture();cancel();if(history.move(direction))apply(false);else update();};
  const follow=async(pos:number)=>{
   if(destroyed||view.composing||!navigation.current())return;
   capture();cancel();const ticket=generation,controller=new AbortController();abort=controller;
   const origin=history.current.source,line=view.state.doc.lineAt(pos);
   const valid=()=>!destroyed&&generation===ticket&&!controller.signal.aborted&&navigation.current();
   update("正在查找");
   try{
    const response=await navigation.definition(origin,{line:line.number-1,character:pos-line.from},controller.signal);
    if(!valid())return;
    const target=await chooseSourceTarget(response.locations,controller.signal);
    if(!valid())return;
    if(!target){update(response.locations.length?"":"未找到定义");return;}
    const loaded=target.uri===origin.uri?origin:await navigation.load(target,controller.signal);
    if(!valid())return;
    if(!loaded){navigation.origin(target);return;}
    const selected=sourceSpan(loaded.text,target.range);if(!selected)throw Error("定义位置与源码内容不一致");
    capture();
    const changed=history.push({source:loaded,selection:{ranges:[selected],mainIndex:0},scroll:{top:0,left:0}});
    abort=null;
    if(changed){++generation;apply(true);}else update();
    if(response.omitted)update("部分定义结果未显示");
   }catch(error){if(valid())update(error instanceof Error?error.message:String(error));}
  };
  function state(text:string,language:string,selected:EditorSelection){
   return EditorState.create({doc:text,selection:selected,extensions:[
    basicSetup,language==="java"?java():language==="golang"?go():language==="rust"?rust():language==="cpp"||language==="c"?cpp():python(),
    vimSlot.of(vimExtensions(enabled)),
    vimNavigation({definition:target=>{void follow(target.state.selection.main.head);return true;}}),
    Prec.highest(keymap.of([
     {key:"F12",run:target=>{void follow(target.state.selection.main.head);return true;}},
     {key:"Alt-ArrowLeft",run:()=>{move(-1);return true;}},{key:"Alt-ArrowRight",run:()=>{move(1);return true;}},
     {key:"Ctrl-o",run:target=>{const mode=getCM(target)?.state.vim;if(!mode||mode.insertMode)return false;move(-1);return true;}},
     {key:"Ctrl-i",run:target=>{const mode=getCM(target)?.state.vim;if(!mode||mode.insertMode)return false;move(1);return true;}},
    ])),
    EditorState.readOnly.of(true),EditorView.editable.of(false),
    EditorView.contentAttributes.of({"aria-label":"只读标准库源码",tabindex:"0",spellcheck:"false"}),
    EditorView.theme({"&":{height:"100%",fontSize:"13px",backgroundColor:"var(--surface-editor)"},".cm-scroller":{fontFamily:"var(--font-mono)",overflow:"auto"},".cm-content":{padding:"4px 0"},".cm-gutters":{backgroundColor:"var(--surface-editor)",border:"none"},".cm-line":{padding:"0 6px"},".cm-activeLine":{backgroundColor:"var(--editor-active-line, #8888880c)"}}),
    EditorView.domEventHandlers({
     mousedown(event,target){if(!(event.ctrlKey||event.metaKey)||event.button!==0)return false;const pos=target.posAtCoords({x:event.clientX,y:event.clientY});if(pos===null)return false;event.preventDefault();void follow(pos);return true;},
     scroll(){if(!swapping&&!destroyed)capture();return false;}
    }),
    EditorView.updateListener.of(transaction=>{
     if(!swapping&&transaction.selectionSet){cancel();capture();update();}
    })
   ]});
  }
  element.showModal();
  view=new EditorView({state:state(source.text,source.language,EditorSelection.single(first.anchor,first.head)),parent,
   // readOnly is advisory in CodeMirror. This boundary also rejects Vim/API
   // edits using filter:false; trusted navigation alone may replace the state.
   dispatchTransactions(transactions,target){if(transactions.some(t=>t.docChanged))return;target.update(transactions);}
  });
  actions.current={move,close,configure(value){enabled=value;view.dispatch({effects:vimSlot.reconfigure(vimExtensions(value))});}};
  update();view.focus();view.dispatch({effects:EditorView.scrollIntoView(first.anchor,{y:"center"})});
  return()=>{destroyed=true;cancel();actions.current=null;element.close();view.destroy();history.clear();};
 },[source]);
 useLayoutEffect(()=>{actions.current?.configure(vimEnabled);},[vimEnabled]);
 return <dialog className="source-viewer" ref={dialog} aria-label="源码查看" aria-labelledby="source-title" onCancel={event=>{event.preventDefault();actions.current?.close();}}>
  <header>
   <nav aria-label="源码导航"><button aria-label="后退" title="后退 · Alt+← / Ctrl+O" disabled={!info.back} onClick={()=>actions.current?.move(-1)}><Icon kind="back"/></button><button aria-label="前进" title="前进 · Alt+→ / Ctrl+I" disabled={!info.forward} onClick={()=>actions.current?.move(1)}><Icon kind="forward"/></button></nav>
   <div className="source-heading"><h2 id="source-title">{info.name}</h2><span className="source-path">{info.path}</span></div>
   <span className="source-kind">{info.declaration?"声明":"只读"}</span>
   <button aria-label="返回代码" title="返回代码" onClick={()=>{source.navigation.origin();actions.current?.close();}}><Icon kind="return"/></button>
   <button aria-label="关闭源码" title="关闭 · Esc" onClick={()=>actions.current?.close()}><Icon kind="close"/></button>
  </header>
  <div className="source-editor" ref={host}/>
  {info.message&&<div className="source-message" role="status">{info.message}</div>}
 </dialog>;
}
