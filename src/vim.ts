import {vim,Vim,getCM} from "@replit/codemirror-vim";
import {Prec,EditorState,Transaction,type Extension} from "@codemirror/state";
import {isolateHistory} from "@codemirror/commands";
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
  let owner:EditorView|null=null,changed=false,pendingOperator=false;
  const historyBridge=EditorState.transactionFilter.of(tr=>{
    const mode=owner&&getCM(owner)?.state.vim;
    if(!mode)return tr;
    if(!tr.docChanged){if(tr.isUserEvent("select.pointer")){changed=false;pendingOperator=false;}return tr;}
    const event=tr.annotation(Transaction.userEvent)??"";
    const operator=event.startsWith("input.type.compose");
    const insertion=mode.insertMode&&(tr.isUserEvent("input.type")||tr.isUserEvent("delete"));
    if(!operator&&!insertion){changed=false;pendingOperator=false;return tr;}
    const join=changed&&(mode.insertMode||event==="input.type.compose");
    changed=true;if(operator&&!mode.insertMode)pendingOperator=true;
    // Prepend, don't rebuild: the original transaction retains all unrelated metadata.
    return [{annotations:join?Transaction.userEvent.of("input.type.compose"):[
      Transaction.userEvent.of("input.type.compose.start"),isolateHistory.of("before")
    ]},tr];
  });
  return [
    Prec.high(vim({status:true})),
    ViewPlugin.fromClass(class{
      private cm:ReturnType<typeof getCM>;
      private modeChanged=()=>{if(this.cm?.state.vim?.insertMode){if(!pendingOperator)changed=false;pendingOperator=false;}else{changed=false;pendingOperator=false;}};
      private commandDone=()=>{if(!this.cm?.state.vim?.insertMode){changed=false;pendingOperator=false;}};
      constructor(readonly view:EditorView){
        owner=view;this.cm=getCM(view);saves.set(view,save);
        this.cm?.on("vim-mode-change",this.modeChanged);this.cm?.on("vim-command-done",this.commandDone);
      }
      destroy(){this.cm?.off("vim-mode-change",this.modeChanged);this.cm?.off("vim-command-done",this.commandDone);saves.delete(this.view);owner=null;changed=false;pendingOperator=false;}
    }),
    historyBridge,
    EditorView.theme({
      ".cm-vim-panel":{minHeight:"22px",padding:"2px 8px",fontFamily:"var(--font-mono)",fontSize:"11px",color:"var(--muted)",backgroundColor:"var(--surface-editor)"},
      ".cm-vim-panel input":{font:"inherit",minWidth:"0",flex:"1"},
    }),
  ];
}
export {getCM};
