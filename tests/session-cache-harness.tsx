import React,{useLayoutEffect} from "react";
import {createRoot} from "react-dom/client";
import {EditorView} from "@codemirror/view";
import {undoDepth,redoDepth} from "@codemirror/commands";
import {CodeEditor} from "../src/editor";
function Mounted({documentKey,value,onChange,ready}:{documentKey:string;value:string;onChange:(text:string)=>void;ready:()=>void}){
 // Child layout effects create/reconfigure the actual editor before this owner
 // acknowledges a committed switch. No timed sleep or render-batching assumption.
 useLayoutEffect(()=>{ready();},[documentKey,value,ready]);
 return <CodeEditor documentKey={documentKey} language="python3" value={value} label="会话代码" onChange={onChange}/>;
}
export function mountSessionEditor(parent:HTMLElement){
 const root=createRoot(parent),drafts=new Map<string,string>();
 let current="";
 function view(){return EditorView.findFromDOM(parent.querySelector(".cm-editor") as HTMLElement)!;}
 return {
  open(key:string,value?:string):Promise<void>{
   current=key;if(value!==undefined)drafts.set(key,value);
   return new Promise(resolve=>root.render(<Mounted documentKey={key} value={drafts.get(key)??""}
     onChange={text=>drafts.set(key,text)} ready={resolve}/>));
  },
  inspect(){const v=view();return {key:current,text:v.state.doc.toString(),draft:drafts.get(current),anchor:v.state.selection.main.anchor,head:v.state.selection.main.head,top:v.scrollDOM.scrollTop,left:v.scrollDOM.scrollLeft,undo:undoDepth(v.state),redo:redoDepth(v.state)};},
  dispose(){root.unmount();},
 };
}
