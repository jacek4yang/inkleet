import {Prec,type Extension} from "@codemirror/state";
import {EditorView,ViewPlugin,keymap} from "@codemirror/view";
import {CommandRegistry,commandBindingLabel,type Command} from "./command-registry";
let nextPalette=0;
export function editorCommands(commands:Command<EditorView>[]):Extension{
  const registry=new CommandRegistry<EditorView>();
  for(const command of commands)registry.register(command);
  const plugin=ViewPlugin.fromClass(class{
    close:(restore?:boolean)=>void=()=>{};
    constructor(readonly view:EditorView){}
    open(){
      if(this.view.composing)return false;
      this.close(false);
      const view=this.view,doc=view.state.doc,previous=document.activeElement;
      const panel=document.createElement("div");panel.className="editor-command-palette";panel.setAttribute("role","dialog");panel.setAttribute("aria-label","编辑器命令");
      const input=document.createElement("input");input.type="text";input.placeholder="命令";input.setAttribute("aria-label","搜索编辑器命令");input.autocomplete="off";input.spellcheck=false;
      const listId="editor-commands-"+(++nextPalette);
      input.setAttribute("role","combobox");input.setAttribute("aria-expanded","true");input.setAttribute("aria-controls",listId);input.setAttribute("aria-autocomplete","list");
      const list=document.createElement("div");list.id=listId;list.className="editor-command-list";list.setAttribute("role","listbox");list.setAttribute("aria-label","可用命令");
      const error=document.createElement("div");error.setAttribute("role","alert");
      panel.append(input,list,error);document.body.append(panel);
      let selected=0,closed=false,items=registry.list(view);
      const close=(restore=true)=>{
        if(closed)return;restore=restore&&panel.contains(document.activeElement);closed=true;this.close=()=>{};panel.remove();document.removeEventListener("pointerdown",outside,true);
        if(restore&&view.dom.isConnected){view.focus();}
        else if(restore&&previous instanceof HTMLElement&&previous.isConnected)previous.focus();
      };
      const execute=(id:string)=>{
        if(closed||view.state.doc!==doc){close();return;}
        try{view.focus();if(registry.execute(id,view))close(false);else{error.textContent="命令当前不可用";input.focus();}}catch(e){error.textContent=String(e).slice(0,300);input.focus();}
      };
      const paint=()=>{
        items=registry.list(view,input.value);selected=Math.min(selected,Math.max(0,items.length-1));list.replaceChildren();
        items.forEach((command,index)=>{
          const button=document.createElement("button");button.type="button";button.id=listId+"-"+index;button.tabIndex=-1;button.setAttribute("role","option");button.setAttribute("aria-selected",String(index===selected));
          const title=document.createElement("span");title.textContent=command.label;button.append(title);
          if(command.key){const key=document.createElement("kbd");key.textContent=commandBindingLabel(command.key,navigator.platform);button.append(key);}
          button.onclick=()=>execute(command.id);list.append(button);
        });
        if(items.length)input.setAttribute("aria-activedescendant",listId+"-"+selected);else input.removeAttribute("aria-activedescendant");
        if(!items.length){const empty=document.createElement("div");empty.className="command-empty";empty.textContent="无匹配命令";list.append(empty);}
      };
      const outside=(event:PointerEvent)=>{if(!panel.contains(event.target as Node))close(false);};
      document.addEventListener("pointerdown",outside,true);
      input.oninput=()=>{selected=0;paint();};
      panel.onkeydown=event=>{
        event.stopPropagation();
        if(event.isComposing||event.keyCode===229)return;
        if(event.key==="Escape"){event.preventDefault();close();}
        else if(event.key==="ArrowDown"||event.key==="ArrowUp"){
          event.preventDefault();selected=items.length?(selected+(event.key==="ArrowDown"?1:-1)+items.length)%items.length:0;paint();
          list.children[selected]?.scrollIntoView({block:"nearest"});
        }else if(event.key==="Enter"){
          event.preventDefault();if(items[selected])execute(items[selected].id);
        }else if(event.key==="Tab"){
          close(false);
        }
      };
      this.close=close;paint();input.focus();return true;
    }
    update(update:import("@codemirror/view").ViewUpdate){if(update.docChanged)this.close();}
    destroy(){this.close(false);}
  });
  return [plugin,Prec.high(keymap.of([
    {key:"Mod-Shift-p",run:view=>view.plugin(plugin)?.open()??false},
    ...commands.filter(c=>c.key).map(c=>({key:c.key!,run:(view:EditorView)=>!view.composing&&registry.execute(c.id,view)})),
  ]))];
}
