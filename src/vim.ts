import {vim,Vim,getCM} from "@replit/codemirror-vim";
import {Prec,type Extension} from "@codemirror/state";
import {EditorView,ViewPlugin} from "@codemirror/view";
const saves=new WeakMap<EditorView,(view:EditorView)=>boolean>();
Vim.defineEx("write","w",(cm,params)=>{
  const view:EditorView=cm.cm6;
  // The app supports only writing this document, never a path/range/forced overwrite.
  if(!/^w(?:r(?:i(?:t(?:e)?)?)?)?\s*$/.test(params.input.trim())){
    const node=document.createElement("span");node.textContent="仅支持 :w 保存当前文档";
    cm.openNotification(node,{bottom:true,duration:3000});return;
  }
  if(!saves.get(view)?.(view)){
    const node=document.createElement("span");node.textContent="当前无法保存";
    cm.openNotification(node,{bottom:true,duration:3000});
  }
});
export function vimNormal(view:EditorView){const mode=getCM(view)?.state.vim;return !!mode&&!mode.insertMode;}
export function vimEditing(save:(view:EditorView)=>boolean):Extension{
  return [
    Prec.high(vim({status:true})),
    ViewPlugin.fromClass(class{
      constructor(readonly view:EditorView){saves.set(view,save);}
      destroy(){saves.delete(this.view);}
    }),
    EditorView.theme({
      ".cm-vim-panel":{minHeight:"22px",padding:"2px 8px",fontFamily:"var(--font-mono)",fontSize:"11px",color:"var(--muted)",backgroundColor:"var(--surface-editor)"},
      ".cm-vim-panel input":{font:"inherit",minWidth:"0",flex:"1"},
    }),
  ];
}
export {getCM};
