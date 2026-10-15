import React from "react";
import {createRoot} from "react-dom/client";
import {CodeEditor} from "../src/editor";
export {EditorView} from "@codemirror/view";
export {snippetInsertion,snippetSessionState} from "../src/snippet-session";
export {prepareSnippet} from "../src/snippet-prepare";
export {getCM,vimNormal} from "../src/vim";
export function mountSnippetEditor(parent:HTMLElement,state:{value:string;edits:string[];statuses?:string[]},vim=false){
 const root=createRoot(parent);
 const render=(enabled:boolean)=>root.render(<CodeEditor documentKey="snippet-session-fixture" language="python3" value={state.value} label="代码编辑器" onStatus={status=>state.statuses?.push(status.text)} vimEnabled={enabled} onChange={text=>{state.value=text;state.edits.push(text);}}/>);
 render(vim);return {setVim:render,destroy:()=>root.unmount()};
}
