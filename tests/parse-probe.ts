import {EditorView} from "@codemirror/view";
import {syntaxTree,syntaxTreeAvailable} from "@codemirror/language";
// Test-only read access. Never forces parsing or changes editor state.
export function inspect(){
 const element=document.querySelector<HTMLElement>('[aria-label="代码编辑器"]');
 const view=element?EditorView.findFromDOM(element):null;
 if(!view)return null;
 return {length:view.state.doc.length,treeLength:syntaxTree(view.state).length,
  available:syntaxTreeAvailable(view.state,view.state.doc.length)};
}
