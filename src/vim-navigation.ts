import {Vim} from "@replit/codemirror-vim";
import {EditorView,ViewPlugin} from "@codemirror/view";
type Routes={definition:(view:EditorView)=>boolean;back?:(view:EditorView)=>boolean;forward?:(view:EditorView)=>boolean};
const owners=new WeakMap<EditorView,Routes>();
for(const [name,route] of [["inkleetDefinition","definition"],["inkleetSourceBack","back"],["inkleetSourceForward","forward"]] as const){
 Vim.defineAction(name,(cm)=>{const view:EditorView=cm.cm6;const owner=owners.get(view);queueMicrotask(()=>{if(owner&&owners.get(view)===owner)owner[route]?.(view);});});
}
Vim.mapCommand("gd","action","inkleetDefinition",{}, {context:"normal"});
// Source history bindings are installed only by the readonly viewer keymap.
// Do not replace the editable editor's native Vim jump list globally.
export function vimNavigation(routes:Routes){
 return ViewPlugin.fromClass(class{
  constructor(readonly view:EditorView){owners.set(view,routes);}
  destroy(){owners.delete(this.view);}
 });
}
