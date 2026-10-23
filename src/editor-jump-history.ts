import {EditorSelection,StateEffect,StateField} from "@codemirror/state";
import {EditorView,ViewPlugin} from "@codemirror/view";
import {emptyJumpHistory,moveJump,recordJump,type JumpHistory,type JumpVisit} from "./editor-jump-history-model.ts";
const setHistory=StateEffect.define<JumpHistory>();
export const editorJumpHistory=StateField.define<JumpHistory>({
 create:emptyJumpHistory,
 update(value,tr){if(tr.docChanged)return emptyJumpHistory();for(const effect of tr.effects)if(effect.is(setHistory))value=effect.value;return value;}
});
const asSelection=(visit:JumpVisit)=>EditorSelection.create(visit.selection.ranges.map(r=>EditorSelection.range(r.anchor,r.head)),visit.selection.mainIndex);
const viewport=ViewPlugin.fromClass(class{
 ticket=0;pending:JumpVisit["scroll"]|null=null;closed=false;
 constructor(readonly view:EditorView){}
 cancel(){++this.ticket;this.pending=null;}
 settle(){if(this.pending){this.view.scrollDOM.scrollTop=this.pending.top;this.view.scrollDOM.scrollLeft=this.pending.left;}this.cancel();}
 update(update:import("@codemirror/view").ViewUpdate){if(update.docChanged||update.selectionSet)this.cancel();}
 restore(visit:JumpVisit){
  const ticket=++this.ticket,doc=this.view.state.doc,selection=this.view.state.selection;
  this.pending={...visit.scroll};
  this.view.requestMeasure({read:()=>null,write:()=>{
   if(this.closed||ticket!==this.ticket||this.view.state.doc!==doc||!this.view.state.selection.eq(selection))return;
   this.view.scrollDOM.scrollTop=visit.scroll.top;this.view.scrollDOM.scrollLeft=visit.scroll.left;this.pending=null;
  }});
 }
 destroy(){this.settle();this.closed=true;}
},{eventHandlers:{compositionstart(){this.cancel();},wheel(){this.cancel();},mousedown(){this.settle();},blur(){this.settle();}}});
export const editorJumpExtensions=[editorJumpHistory,viewport];
export function settleEditorJump(view:EditorView){view.plugin(viewport)?.settle();}
export function captureEditorVisit(view:EditorView):JumpVisit{
 // Settle prior CodeMirror scroll effects before capturing or restoring a visit.
 // This public geometry read occurs only on explicit navigation, outside updates.
 view.coordsAtPos(view.state.selection.main.head);
 return {selection:{ranges:view.state.selection.ranges.map(({anchor,head})=>({anchor,head})),mainIndex:view.state.selection.mainIndex},
  scroll:view.plugin(viewport)?.pending??{top:view.scrollDOM.scrollTop,left:view.scrollDOM.scrollLeft}};
}
export function jumpEditor(view:EditorView,selection:EditorSelection,origin=captureEditorVisit(view)){
 const target={selection:{ranges:selection.ranges.map(({anchor,head})=>({anchor,head})),mainIndex:selection.mainIndex},scroll:{top:view.scrollDOM.scrollTop,left:view.scrollDOM.scrollLeft}};
 const history=view.state.field(editorJumpHistory,false);
 view.plugin(viewport)?.cancel();
 view.dispatch({selection,effects:[...(history?[setHistory.of(recordJump(history,origin,target))]:[]),EditorView.scrollIntoView(selection.main.head,{y:"center"})]});
}
export function moveEditorJump(view:EditorView,direction:-1|1,cancelNavigation:()=>void=()=>{}):boolean{
 if(!view.hasFocus||view.composing)return true;
 cancelNavigation();
 const current=captureEditorVisit(view);
 const history=view.state.field(editorJumpHistory,false);if(!history)return true;
 const move=moveJump(history,current,direction);if(!move)return true;
 view.dispatch({selection:asSelection(move.target),effects:setHistory.of(move.history)});
 view.plugin(viewport)?.restore(move.target);return true;
}
