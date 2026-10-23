import {Vim,getCM} from "@replit/codemirror-vim";
import {EditorView,ViewPlugin} from "@codemirror/view";
type Routes={definition:(view:EditorView)=>boolean;documentation?:(view:EditorView)=>void};
const owners=new WeakMap<EditorView,Routes>();
Vim.defineAction("inkleetDefinition",cm=>{
 const view:EditorView=cm.cm6,owner=owners.get(view);
 // Vim may settle its cursor after an action returns. Resolve from that final
 // selection, and never route a callback belonging to a replaced view state.
 queueMicrotask(()=>{if(owner&&owners.get(view)===owner)owner.definition(view);});
});
Vim.mapCommand("gd","action","inkleetDefinition",{}, {context:"normal"});
Vim.defineAction("inkleetDocumentation",cm=>{
 const view:EditorView=cm.cm6,owner=owners.get(view);
 queueMicrotask(()=>{const mode=getCM(view)?.state.vim;if(owner&&owners.get(view)===owner&&mode&&!mode.insertMode&&!mode.visualMode)owner.documentation?.(view);});
});
Vim.mapCommand("K","action","inkleetDocumentation",{}, {context:"normal"});
export function vimNavigation(routes:Routes){
 return ViewPlugin.fromClass(class{
  constructor(readonly view:EditorView){owners.set(view,routes);}
  destroy(){owners.delete(this.view);}
 });
}
