import React from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import {EditorView} from "@codemirror/view";
import {undoDepth,redoDepth} from "@codemirror/commands";
import {CodeEditor} from "../src/editor";
export function mountSessionEditor(parent:HTMLElement){
 const root=createRoot(parent),drafts=new Map<string,string>();
 let current="";
 function view(){return EditorView.findFromDOM(parent.querySelector(".cm-editor") as HTMLElement)!;}
 return {
  open(key:string,value?:string){
   current=key;if(value!==undefined)drafts.set(key,value);
   flushSync(()=>root.render(<CodeEditor documentKey={key} language="python3" value={drafts.get(key)??""} label="会话代码"
     onChange={text=>drafts.set(key,text)}/>));
  },
  inspect(){const v=view();return {key:current,text:v.state.doc.toString(),draft:drafts.get(current),anchor:v.state.selection.main.anchor,head:v.state.selection.main.head,top:v.scrollDOM.scrollTop,left:v.scrollDOM.scrollLeft,undo:undoDepth(v.state),redo:redoDepth(v.state)};},
  dispose(){flushSync(()=>root.unmount());},
 };
}
