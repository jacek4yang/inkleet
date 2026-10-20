import React,{useLayoutEffect} from "react";
import {createRoot} from "react-dom/client";
import {SourceViewer} from "../src/source-viewer";
import type {Source} from "../src/source-protocol";
export {EditorState,EditorSelection,StateEffect} from "@codemirror/state";
export {EditorView} from "@codemirror/view";
export {undo,redo,undoDepth,redoDepth,isolateHistory} from "@codemirror/commands";
export {indentUnit} from "@codemirror/language";

function MountedSource({source,tabSize,ready}:{source:Source;tabSize:number;ready:()=>void}){
 // Acknowledge after the real source viewer has applied its child layout effects.
 useLayoutEffect(()=>{ready();},[source,tabSize,ready]);
 return <SourceViewer source={source} tabSize={tabSize} onClose={()=>{}}/>;
}
export function mountSourceTabSize(parent:HTMLElement,source:Source){
 const root=createRoot(parent);
 return {
  setTabSize(tabSize:number):Promise<void>{return new Promise(resolve=>root.render(<MountedSource source={source} tabSize={tabSize} ready={resolve}/>));},
  destroy(){root.unmount();},
 };
}
