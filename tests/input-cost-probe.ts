import {EditorView} from "@codemirror/view";
import {syntaxTreeAvailable,syntaxParserRunning} from "@codemirror/language";
type Sample={parsedBefore:boolean;parsedAfter:boolean;updateMs:number;snapshotMs:number;onChangeMs:number;updates:number;inputToRafMs:number};
declare global{interface Window{__inputCostMeasure?:<T>(phase:"snapshot"|"onChange",work:()=>T)=>T;}}
/** Test-only synchronous phase probe. Nested phases are included in updateMs. */
export function inputCostProbe(parent:HTMLElement){
 const view=EditorView.findFromDOM(parent)!;
 const samples:Sample[]=[];
 let current:Sample|null=null,closed=false;
 const frames=new Set<number>(),original=view.update;
 const measure=<T,>(phase:"snapshot"|"onChange",work:()=>T):T=>{
  const sample=current,start=performance.now();
  try{return work();}finally{if(sample)sample[phase==="snapshot"?"snapshotMs":"onChangeMs"]+=performance.now()-start;}
 };
 window.__inputCostMeasure=measure;
 function update(this:EditorView,transactions:Parameters<EditorView["update"]>[0]){
  const sample=current,relevant=transactions.some(transaction=>transaction.docChanged),start=performance.now();
  try{return original.call(this,transactions);}finally{if(sample&&relevant){sample.updateMs+=performance.now()-start;sample.updates++;}}
 }
 view.update=update;
 const input=(event:Event)=>{
  const typed=event as InputEvent;
  if(typed.inputType!=="insertText"||!view.contentDOM.contains(typed.target as Node))return;
  const sample:Sample={parsedBefore:syntaxTreeAvailable(view.state,view.state.doc.length),parsedAfter:false,updateMs:0,snapshotMs:0,onChangeMs:0,updates:0,inputToRafMs:0},start=performance.now();
  current=sample;
  const frame=requestAnimationFrame(()=>{
   frames.delete(frame);if(closed)return;
   sample.inputToRafMs=performance.now()-start;sample.parsedAfter=syntaxTreeAvailable(view.state,view.state.doc.length);samples.push(sample);if(current===sample)current=null;
  });
  frames.add(frame);
 };
 document.addEventListener("beforeinput",input,true);
 return {
  read:()=>samples.map(sample=>({...sample})),
  ready:()=>syntaxTreeAvailable(view.state,view.state.doc.length)&&!syntaxParserRunning(view),
  dispose(){
   closed=true;current=null;document.removeEventListener("beforeinput",input,true);
   for(const frame of frames)cancelAnimationFrame(frame);frames.clear();
   if(view.update===update)view.update=original;
   if(window.__inputCostMeasure===measure)delete window.__inputCostMeasure;
  },
 };
}
