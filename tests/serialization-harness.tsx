import React from "react";
import {createRoot} from "react-dom/client";
import {CodeEditor} from "../src/editor";
export {EditorView} from "@codemirror/view";
export function mountSerializationEditor(parent:HTMLElement,state:{edits:string[];saves:string[];statuses:string[];errors:string[]}){
 const root=createRoot(parent);
 root.render(<CodeEditor documentKey="serialization-fixture" language="python3" value="value = 0" label="代码编辑器"
 onChange={text=>state.edits.push(text)} onStatus={status=>state.statuses.push(status.text)}
 formatting={{enabled:true,save:async text=>{state.saves.push(text);return true;},report:message=>state.errors.push(message)}}/>);
 return ()=>root.unmount();
}
