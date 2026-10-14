import {drawSelection,EditorView,ViewPlugin,type ViewUpdate} from "@codemirror/view";
import {getCM} from "@replit/codemirror-vim";
// Visual-only INSERT overlay. Never changes Vim insert/overwrite state or document.
export function steadyVimCursor(){
 return [drawSelection({cursorBlinkRate:0}),ViewPlugin.fromClass(class{
  layer=document.createElement("div");
  private destroyed=false;
  private cm:ReturnType<typeof getCM>;
  private measure={read:()=>this.read(),write:(rects:{left:number;top:number;width:number;height:number}[])=>this.paint(rects)};
  private schedule=()=>{if(!this.destroyed)this.view.requestMeasure(this.measure);};
  private composing=()=>{this.view.dom.classList.add("inkleet-composing");this.layer.replaceChildren();};
  private composed=()=>{this.view.dom.classList.remove("inkleet-composing");this.schedule();};
  constructor(readonly view:EditorView){
   this.cm=getCM(view);this.layer.className="inkleet-insert-cursors";this.layer.setAttribute("aria-hidden","true");
   view.scrollDOM.appendChild(this.layer);view.dom.classList.add("inkleet-steady-vim");
   this.cm?.on("vim-mode-change",this.schedule);this.cm?.on("vim-command-done",this.schedule);
   view.contentDOM.addEventListener("compositionstart",this.composing);view.contentDOM.addEventListener("compositionend",this.composed);
   this.schedule();
  }
  read(){
   if(this.destroyed||this.view.composing||!this.cm?.state.vim?.insertMode||this.cm.state.overwrite||!this.view.hasFocus)return [];
   const view=this.view,base=view.scrollDOM.getBoundingClientRect();
   return view.state.selection.ranges.flatMap(range=>{
    if(!range.empty)return [];
    const pos=view.coordsAtPos(range.head,1);if(!pos)return [];
    const char=view.coordsForChar(range.head),line=view.state.doc.lineAt(range.head);
    const isTab=view.state.sliceDoc(range.head,range.head+1)==="\t";
    const width=char&&range.head<line.to&&!isTab?Math.abs(char.right-char.left)/view.scaleX:view.defaultCharacterWidth;
    return [{left:((char&&!isTab?char.left:pos.left)-base.left)/view.scaleX+view.scrollDOM.scrollLeft,top:(pos.top-base.top)/view.scaleY+view.scrollDOM.scrollTop,width:Math.max(1,width),height:(pos.bottom-pos.top)/view.scaleY}];
   });
  }
  paint(rects:{left:number;top:number;width:number;height:number}[]){
   if(this.destroyed)return;
   this.layer.replaceChildren(...rects.map(rect=>{const node=document.createElement("div");node.className="inkleet-insert-cursor";Object.assign(node.style,{left:rect.left+"px",top:rect.top+"px",width:rect.width+"px",height:rect.height+"px"});return node;}));
  }
  update(update:ViewUpdate){if(update.docChanged||update.selectionSet||update.geometryChanged||update.viewportChanged||update.focusChanged)this.schedule();}
  destroy(){this.destroyed=true;this.cm?.off("vim-mode-change",this.schedule);this.cm?.off("vim-command-done",this.schedule);this.view.contentDOM.removeEventListener("compositionstart",this.composing);this.view.contentDOM.removeEventListener("compositionend",this.composed);this.layer.remove();this.view.dom.classList.remove("inkleet-steady-vim","inkleet-composing");}
 }),EditorView.theme({
  "&.inkleet-steady-vim .cm-cursorLayer":{animation:"none !important"},
  "&.inkleet-steady-vim:not(.inkleet-composing) .cm-content":{caretColor:"transparent !important"},
  "&.inkleet-steady-vim .cm-cursorLayer:not(.cm-vimCursorLayer)":{display:"none"},
  ".inkleet-insert-cursors":{position:"absolute",inset:"0",pointerEvents:"none",zIndex:"150"},
  ".inkleet-insert-cursor":{position:"absolute",background:"var(--vim-cursor)",borderRadius:"0"},
 })];
}
