import React,{useEffect,useLayoutEffect,useRef,useState} from "react";
import {CommandRegistry,commandBindingLabel,editorPlatform} from "./command-registry";
import type {WorkbenchCommand} from "./command-preferences";
import {matchUserShortcut,type UserKeybindings} from "./keybindings";
import {IconButton} from "./icons";
export function commandModalOpen(){return !!document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]');}
export function WorkbenchCommands({commands,bindings}:{commands:WorkbenchCommand[];bindings:UserKeybindings}){
 const [open,setOpen]=useState(false);
 const current=useRef({commands,bindings});current.current={commands,bindings};
 useEffect(()=>{
  const handle=(event:KeyboardEvent)=>{
   if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.repeat||event.getModifierState("AltGraph")||commandModalOpen())return;
   const mac=editorPlatform(navigator.platform)==="mac";
   if((mac?event.metaKey&&!event.ctrlKey:event.ctrlKey&&!event.metaKey)&&event.shiftKey&&!event.altKey&&event.key.toLowerCase()==="p"){
    event.preventDefault();setOpen(true);return;
   }
   // Editor commands are owned by the focused CodeMirror view, never by App.
   for(const command of current.current.commands){
    const binding=current.current.bindings[command.id as keyof UserKeybindings];
    if(binding&&matchUserShortcut(event,binding,mac)&&(!command.enabled||command.enabled(undefined))){
     event.preventDefault();command.run(undefined);return;
    }
   }
  };
  document.addEventListener("keydown",handle);
  return()=>document.removeEventListener("keydown",handle);
 },[]);
 return <><IconButton icon="search" label="命令面板" shortcut="Ctrl/Command+Shift+P" onClick={()=>{if(!commandModalOpen())setOpen(true);}}/>
  {open&&<WorkbenchPalette commands={commands} bindings={bindings} onClose={()=>setOpen(false)}/>}</>;
}
function WorkbenchPalette({commands,bindings,onClose}:{commands:WorkbenchCommand[];bindings:UserKeybindings;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),executing=useRef(false);
 const [query,setQuery]=useState(""),[selected,setSelected]=useState(0),[error,setError]=useState("");
 const registry=new CommandRegistry<void>();commands.forEach(command=>registry.register(command));
 const items=registry.list(undefined,query),index=Math.min(selected,Math.max(0,items.length-1));
 useLayoutEffect(()=>{const previous=document.activeElement,element=dialog.current!;element.showModal();input.current?.focus();
  return()=>{element.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
 useEffect(()=>{dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:"nearest"});},[index,query]);
 function execute(id:string){
  if(executing.current)return;
  const command=commands.find(item=>item.id===id);
  if(!command||command.enabled&&!command.enabled(undefined)){setError("命令当前不可用");return;}
  executing.current=true;dialog.current?.close();onClose();
  // React commits removal/focus restoration before another dialog is opened.
  setTimeout(()=>{command.run(undefined);},0);
 }
 return <dialog ref={dialog} className="workbench-command-palette" aria-label="工作台命令" onCancel={e=>{e.preventDefault();onClose();}}
  onKeyDown={e=>{e.stopPropagation();if(e.nativeEvent.isComposing||e.keyCode===229){if(e.key==="Escape")e.preventDefault();return;}
   if(e.target!==input.current)return;
   if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();setSelected(items.length?(index+(e.key==="ArrowDown"?1:-1)+items.length)%items.length:0);}
   else if(e.key==="Enter"){e.preventDefault();if(items[index])execute(items[index].id);}
  }}>
  <input ref={input} aria-label="搜索工作台命令" role="combobox" aria-expanded="true" aria-controls="workbench-command-list" aria-activedescendant={items[index]?"workbench-command-"+index:undefined}
   autoComplete="off" spellCheck={false} placeholder="搜索命令…" value={query} onChange={e=>{setQuery(e.target.value);setSelected(0);}}/>
  <div id="workbench-command-list" className="editor-command-list" role="listbox" aria-label="工作台可用命令">
   {items.map((command,i)=><button type="button" key={command.id} id={"workbench-command-"+i} role="option" aria-selected={i===index} tabIndex={-1} onClick={()=>execute(command.id)}>
    <span>{command.label}</span>{bindings[command.id as keyof UserKeybindings]&&<kbd>{commandBindingLabel(bindings[command.id as keyof UserKeybindings]!,navigator.platform)}</kbd>}
   </button>)}
   {!items.length&&<p>无匹配命令</p>}
  </div>{error&&<p role="alert">{error}</p>}
  <button type="button" onClick={onClose}>关闭</button>
 </dialog>;
}
