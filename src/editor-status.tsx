import React,{useSyncExternalStore} from "react";
import {countColumn} from "@codemirror/state";
import {EditorView,ViewPlugin,type ViewUpdate} from "@codemirror/view";
import {getCM} from "@replit/codemirror-vim";
type Snapshot={mode:string;language:string;line:number;column:number;document:string};
const empty:Snapshot={mode:"",language:"",line:0,column:0,document:""};
let current=empty,active:object|null=null;
const listeners=new Set<()=>void>();
const owners=new Map<object,{language:string;sync:()=>void}>();
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
function publish(owner:object,next:Snapshot){
 active=owner;
 if(Object.keys(next).every(key=>next[key as keyof Snapshot]===current[key as keyof Snapshot]))return;
 current=next;for(const fn of listeners)fn();
}
export function EditorStatus(){
 const s=useSyncExternalStore(subscribe,()=>current,()=>empty);
 return <div className="editor-status"><span className="editor-status-mode" data-mode={s.mode} aria-label="编辑模式">{s.mode}</span><span className="editor-status-meta" aria-label="编辑位置"><span>{s.language}</span><span>{s.line?s.line+":"+s.column:""}</span></span></div>;
}
const names:Record<string,string>={rust:"Rust",python3:"Python",golang:"Go",cpp:"C++",c:"C",java:"Java",markdown:"Markdown"};
export function editorStatus(language:string,documentKey:string,commandHost:HTMLElement|null){
 return ViewPlugin.fromClass(class{
  private cm:ReturnType<typeof getCM>=null;
  private disposed=false;
  private event=()=>{this.sync();};
  constructor(readonly view:EditorView){owners.set(this,{language,sync:()=>this.sync()});this.sync();}
  sync(){
   if(this.disposed)return;
   const cm=getCM(this.view);
   if(cm!==this.cm){this.detach();this.cm=cm;cm?.on("vim-mode-change",this.event);cm?.on("vim-command-done",this.event);cm?.on("dialog",this.event);}
   if(!this.view.hasFocus&&active!==this&&(active||language==="markdown"))return;
   if(commandHost){for(const host of commandHost.parentElement?.children??[])if(host instanceof HTMLElement)host.dataset.active=String(host===commandHost);}
   const vim=cm?.state.vim,head=this.view.state.selection.main.head,line=this.view.state.doc.lineAt(head);
   const mode=!vim?"EDIT":cm?.state.overwrite?"REPLACE":vim.visualBlock?"V-BLOCK":vim.visualLine?"V-LINE":vim.visualMode?"VISUAL":vim.insertMode?"INSERT":"NORMAL";
   publish(this,{mode,language:names[language]??language,line:line.number,column:countColumn(line.text.slice(0,head-line.from),this.view.state.tabSize)+1,document:documentKey});
  }
  update(update:ViewUpdate){if(update.selectionSet||update.docChanged||update.focusChanged||update.transactions.some(tr=>tr.reconfigured))this.sync();}
  detach(){this.cm?.off("vim-mode-change",this.event);this.cm?.off("vim-command-done",this.event);this.cm?.off("dialog",this.event);}
  destroy(){this.disposed=true;this.detach();owners.delete(this);if(active===this){const fallback=[...owners].find(([,owner])=>owner.language!=="markdown")??[...owners][0];if(fallback){active=fallback[0];fallback[1].sync();}else{active=null;current=empty;for(const fn of listeners)fn();}}}
 });
}
