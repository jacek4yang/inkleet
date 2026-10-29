import {isolateHistory} from "@codemirror/commands";
import {EditorView,type ViewUpdate} from "@codemirror/view";
import type {Text} from "@codemirror/state";
import {sourceActions,sourceActionChanges,type SourceChange} from "./code-action-model";
import "./code-actions.css";

type Actions=(from:number,to:number,doc:Text)=>Promise<{items:unknown;resolve:(token:number)=>Promise<unknown>}|null>;
/** Explicit, preview-first source edits. The operation never saves or executes commands. */
export function codeActions(request:Actions,status:(message:string)=>void,captureValidity:()=>()=>boolean){
  let destroyed=false,generation=0,closeActive:(restore?:boolean)=>void=()=>{};
  function open(view:EditorView){
    if(destroyed||view.compositionStarted||!view.hasFocus)return false;
    closeActive(false);
    const doc=view.state.doc,selection=view.state.selection,sessionCurrent=captureValidity(),ticket=++generation;
    const owner=view.dom.ownerDocument,panel=owner.createElement("dialog");panel.className="lsp-code-actions";panel.setAttribute("aria-label","代码操作");
    const heading=owner.createElement("h2");heading.textContent="代码操作";
    const list=owner.createElement("div");list.className="lsp-code-action-list";list.setAttribute("aria-label","可用代码操作");
    const preview=owner.createElement("section");preview.hidden=true;preview.setAttribute("aria-label","代码操作预览");
    const title=owner.createElement("h3"),changes=owner.createElement("div");changes.className="lsp-code-action-changes";
    const commit=owner.createElement("button");commit.type="button";commit.textContent="应用";
    const back=owner.createElement("button");back.type="button";back.textContent="返回";
    preview.append(title,changes,commit,back);
    const message=owner.createElement("p");message.setAttribute("role","status");message.textContent="正在读取代码操作…";
    const cancel=owner.createElement("button");cancel.type="button";cancel.textContent="取消";
    panel.append(heading,list,preview,message,cancel);owner.body.append(panel);
    let closed=false,pending=false,proposed:SourceChange[]|null=null;
    const current=()=>!closed&&!destroyed&&ticket===generation&&sessionCurrent()&&view.state.doc===doc&&view.state.selection.eq(selection)&&!view.compositionStarted;
    function close(restore=true){
      if(closed)return;
      restore=restore&&panel.contains(owner.activeElement);closed=true;proposed=null;panel.close();panel.remove();
      if(ticket===generation){++generation;closeActive=()=>{};}
      if(restore&&!destroyed&&view.dom.isConnected)view.focus();
    }
    closeActive=close;
    cancel.onclick=()=>close();panel.oncancel=event=>{event.preventDefault();close();};
    panel.onkeydown=event=>{event.stopPropagation();if(event.isComposing||event.keyCode===229){if(event.key==="Enter")event.preventDefault();}else if(event.key==="Enter"&&event.repeat)event.preventDefault();};
    panel.addEventListener("compositionstart",()=>{proposed=null;close(false);});
    back.onclick=()=>{if(!current()){close();return;}proposed=null;preview.hidden=true;list.hidden=false;message.textContent="";list.querySelector<HTMLButtonElement>("button")?.focus();};
    commit.onclick=()=>{
      if(!current()||!proposed||pending){close();return;}
      const edits=proposed,restore=panel.contains(owner.activeElement);close(false);
      view.dispatch({changes:edits,annotations:isolateHistory.of("full"),userEvent:"input.codeAction"});
      if(restore)view.focus();status("已应用代码操作 · "+edits.length+" 处修改");
    };
    panel.showModal();cancel.focus();
    void (async()=>{
      try{
        const response=await request(selection.main.from,selection.main.to,doc);
        if(!current())return;
        if(!response){close();return;}
        const items=sourceActions(response.items);message.textContent=items.length?"":"此位置没有可安全应用的本题源码操作";
        for(const action of items){
          const button=owner.createElement("button");button.type="button";button.textContent=action.title;
          button.onclick=()=>{void (async()=>{
            if(pending||!current())return;pending=true;message.textContent="正在准备预览…";
            for(const item of list.querySelectorAll("button"))item.disabled=true;
            try{
              const resolved=await response.resolve(action.token);if(!current())return;
              const edits=sourceActionChanges(doc.toString(),resolved);
              // Render every changed byte rather than silently eliding the proposal.
              const encoder=new TextEncoder();let bytes=0;for(const edit of edits){bytes+=encoder.encode(doc.sliceString(edit.from,edit.to)).length+encoder.encode(edit.insert).length;if(bytes>262144)throw Error("代码操作预览超过 256 KiB，未应用任何修改");}
              changes.replaceChildren();
              for(const edit of edits){
                const row=owner.createElement("div"),where=owner.createElement("span"),before=owner.createElement("pre"),after=owner.createElement("pre");
                row.className="lsp-code-action-change";const line=doc.lineAt(edit.from);where.textContent=line.number+":"+(edit.from-line.from+1);
                before.setAttribute("aria-label","原文本");before.textContent=doc.sliceString(edit.from,edit.to);
                after.setAttribute("aria-label","新文本");after.textContent=edit.insert;
                row.append(where,before,after);changes.append(row);
              }
              proposed=edits;title.textContent=action.title+" · "+edits.length+" 处修改";list.hidden=true;preview.hidden=false;message.textContent="";commit.focus();
            }catch(error){if(current())message.textContent=String(error);}
            finally{if(current()){pending=false;for(const item of list.querySelectorAll("button"))item.disabled=false;}}
          })();};
          list.append(button);
        }
        if(panel.contains(owner.activeElement))list.querySelector<HTMLButtonElement>("button")?.focus();
      }catch(error){if(current())message.textContent=String(error);}
    })();
    return true;
  }
  return {open,extensions:[
    EditorView.updateListener.of((update:ViewUpdate)=>{if(update.docChanged||update.selectionSet)closeActive();}),
    EditorView.domEventObservers({compositionstart(){closeActive(false);}}),
  ],destroy(){destroyed=true;closeActive(false);++generation;}};
}
