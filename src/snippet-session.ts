import {SnippetPreparationService} from "./snippet-service.ts";
import {ChangeSet,EditorSelection,EditorState,StateEffect,StateField,Transaction,type Extension,type TransactionSpec} from "@codemirror/state";
import {EditorView,Decoration,showTooltip,ViewPlugin,type ViewUpdate,type Tooltip,type DecorationSet} from "@codemirror/view";
import {isolateHistory} from "@codemirror/commands";
import {validatePreparedSnippet} from "./snippet-validation.ts";
import {snippetLimits,snippetParserIdentity} from "./snippet-budget.ts";
import type {PreparedSnippet,PreparedTransform,SnippetField} from "./snippet-prepare.ts";
type Session={owner:object;dormant:boolean;revision:number;from:number;to:number;transforms:PreparedTransform[];dirty:boolean;waiting:boolean;error:string|null;fields:SnippetField[];navigation:string[];active:number;choicesOpen:boolean;choiceIndex:number};
const setSession=StateEffect.define<Session|null>({map:(value,mapping)=>{
 if(!value)return null;
 if(mapping.empty)return value;
 let touched=false,count=0;
 mapping.iterChangedRanges((from,to)=>{
  if(++count>32||value.fields.some(f=>from<=f.to&&to>=f.from))touched=true;
 });
 if(touched)return null;
 return {...value,from:mapping.mapPos(value.from,1),to:mapping.mapPos(value.to,-1),fields:value.fields.map(f=>{
  if(f.from===f.to){const pos=mapping.mapPos(f.from,1);return {...f,from:pos,to:pos};}
  return {...f,from:mapping.mapPos(f.from,1),to:mapping.mapPos(f.to,-1)};
 })};
}});
function decorations(session:Session|null):DecorationSet{
 if(!session||session.dormant)return Decoration.none;
 const active=session.fields.find(f=>f.id===session.active)?.group;
 return Decoration.set(session.fields.filter(f=>!f.final&&!f.derived&&f.to>f.from).map(f=>Decoration.mark({class:f.group===active?"cm-snippet-field cm-snippet-field-active":"cm-snippet-field"}).range(f.from,f.to)),true);
}
export const snippetSessionState=StateField.define<Session|null>({
 create:()=>null,
 update(value,tr){
  for(const effect of tr.effects)if(effect.is(setSession))return effect.value;
  // Unfiltered edits and text history must not leave stale linked ranges.
  if(tr.docChanged)return null;
  if(value&&tr.selection){
   if(value.dormant)return value;
   if(!tr.newSelection.eq(tr.startState.selection))value={...value,waiting:false,error:null};
   const selection=tr.newSelection;
   if(selection.ranges.length!==1)return null;
   const activeId=value.active;
   const current=value.fields.find(f=>f.id===activeId);
   if(current&&selection.main.from>=current.from&&selection.main.to<=current.to)return value;
   const field=value.fields.find(f=>!f.final&&!f.derived&&selection.main.from>=f.from&&selection.main.to<=f.to);
   return field?{...value,active:field.id,choicesOpen:!!field.choices?.length,choiceIndex:Math.max(0,field.choices?.indexOf(tr.newDoc.sliceString(field.from,field.to))??0)}:null;
  }
  return value;
 },
 provide:field=>[EditorView.decorations.from(field,decorations),showTooltip.from(field,choiceTooltip)]
});
const cancelSpec={effects:setSession.of(null)};
const filter=EditorStateTransactionFilter();
function EditorStateTransactionFilter():Extension{
 // Kept in a helper to make the filter's bounded synchronous work explicit.
 return EditorState.transactionFilter.of(tr=>{
  const session=tr.startState.field(snippetSessionState,false);
  if(!session||!tr.docChanged||tr.effects.some(effect=>effect.is(setSession)))return tr;
  if(session.dormant)return [tr,cancelSpec];
  if(tr.annotation(Transaction.remote)||tr.isUserEvent("undo")||tr.isUserEvent("redo")||tr.newSelection.ranges.length!==1||tr.startState.selection.ranges.length!==1||!(tr.isUserEvent("input.type")||tr.isUserEvent("input.paste")||tr.isUserEvent("input.drop")||tr.isUserEvent("input.complete")||tr.isUserEvent("delete")))return [tr,cancelSpec];
  const changes:{from:number;to:number}[]=[];
  tr.changes.iterChangedRanges((from,to)=>{if(changes.length<33)changes.push({from,to});});
  if(changes.length>32||session.revision>=Number.MAX_SAFE_INTEGER)return [tr,cancelSpec];
  const contains=(f:SnippetField)=>!f.final&&!f.derived&&changes.every(c=>c.from>=f.from&&c.to<=f.to);
  const active=session.fields.find(f=>f.id===session.active);
  const before=tr.startState.selection.main;
  const target=active&&contains(active)&&before.from>=active.from&&before.to<=active.to?active:null;
  if(!target)return [tr,cancelSpec];
  const targetIndex=session.fields.indexOf(target);
  const mapped=session.fields.map((f,index)=>{
   if(f.id===target.id)return {...f,from:tr.changes.mapPos(f.from,-1),to:tr.changes.mapPos(f.to,1)};
   if(f.from===f.to){const pos=tr.changes.mapPos(f.from,index<targetIndex?-1:1);return {...f,from:pos,to:pos};}
   return {...f,from:tr.changes.mapPos(f.from,1),to:tr.changes.mapPos(f.to,-1)};
  });
  if(mapped.some(f=>f.from>f.to))return [tr,cancelSpec];
  const primary=mapped[targetIndex];
  if(primary.to-primary.from>snippetLimits.output)return [tr,cancelSpec];
  const text=tr.newDoc.sliceString(primary.from,primary.to);
  const mirrors=mapped.filter(f=>f.group===target.group&&!f.derived&&f.id!==target.id);
  if(text.length>snippetLimits.output||text.length*(mirrors.length+1)>snippetLimits.copies)return [tr,cancelSpec];
  const replacements=mirrors.map(f=>({from:f.from,to:f.to,insert:text,id:f.id})).sort((a,b)=>a.from-b.from||a.to-b.to);
  // Same-position mirrored empty fields need a distinct insertion-order contract.
  // This intermediate session refuses them at activation; never guess here.
  for(let i=1;i<replacements.length;i++)if(replacements[i].from<replacements[i-1].to||replacements[i].from===replacements[i-1].from&&replacements[i].to===replacements[i].from&&replacements[i-1].to===replacements[i-1].from)return [tr,cancelSpec];
  const mirrorSet=ChangeSet.of(replacements,tr.newDoc.length);
  let delta=0;const ranges=new Map<number,{from:number;to:number}>();
  for(const edit of replacements){const from=edit.from+delta;ranges.set(edit.id,{from,to:from+text.length});delta+=text.length-(edit.to-edit.from);}
  const ordinals=new Map(session.fields.map((f,index)=>[f.id,index]));
  const fields=mapped.map((f,index)=>{
   const replacement=ranges.get(f.id);if(replacement)return {...f,...replacement};
   if(f.from===f.to){
    // Preserve source ordering at empty stops sharing a mirror insertion boundary.
    let position=mirrorSet.mapPos(f.from,-1);
    for(const edit of replacements)if(edit.from===f.from&&edit.to===edit.from&&ordinals.get(edit.id)!<index)position+=edit.insert.length;
    return {...f,from:position,to:position};
   }
   return {...f,from:mirrorSet.mapPos(f.from,1),to:mirrorSet.mapPos(f.to,-1)};
  });
  if(fields.some(f=>f.from>f.to))return [tr,cancelSpec];
  const selection=tr.newSelection.map(mirrorSet),finalTarget=fields.find(f=>f.id===target.id)!;
  if(selection.main.from<finalTarget.from||selection.main.to>finalTarget.to)return [tr,cancelSpec];
  return [tr,{sequential:true,changes:mirrorSet,selection,effects:setSession.of({...session,fields,active:target.id,choicesOpen:false,revision:session.revision+1,from:mirrorSet.mapPos(tr.changes.mapPos(session.from,-1),-1),to:mirrorSet.mapPos(tr.changes.mapPos(session.to,1),1),dirty:session.dirty||session.transforms.some(t=>t.sourceGroup===target.group),waiting:false,error:null})}];
 });
}
export const snippetSession:Extension=[
 snippetSessionState,filter,ViewPlugin.define(view=>new SnippetTransformRuntime(view)),
 EditorView.baseTheme({
  ".cm-snippet-field":{borderBottom:"1px dotted currentColor"},
  ".cm-snippet-field-active":{backgroundColor:"var(--active-line, #80808022)",borderBottomStyle:"solid"},
  ".cm-snippet-message":{padding:"4px 8px",maxWidth:"320px"},
  ".cm-snippet-choices":{maxHeight:"240px",maxWidth:"420px",overflowY:"auto",padding:"3px"},
  ".cm-snippet-choices button":{display:"block",width:"100%",border:"0",padding:"4px 8px",background:"transparent",color:"inherit",font:"inherit",textAlign:"left",whiteSpace:"pre"},
  ".cm-snippet-choices button[aria-selected=true]":{backgroundColor:"var(--selection, #80808033)"}
 })
];
export function endSnippet(view:EditorView):boolean{
 const session=view.state.field(snippetSessionState,false);if(!session||session.dormant)return false;
 view.dispatch({effects:setSession.of(session.dirty?{...session,owner:{},dormant:true,waiting:false,error:null,choicesOpen:false}:null)});return true;
}
export function moveSnippetField(view:EditorView,direction:1|-1):boolean{
 const session=view.state.field(snippetSessionState,false);if(!session||session.dormant||view.composing)return false;
 const active=session.fields.find(f=>f.id===session.active)!;
 const index=session.navigation.indexOf(active.group);
 if(session.dirty&&!(direction===-1&&index===0))return runtimes.get(view)?.leave(direction)??true;
 const next=session.navigation[Math.max(0,index+direction)];
 if(!next){endSnippet(view);return true;}
 const field=session.fields.find(f=>f.group===next&&!f.derived)!;
 view.dispatch({selection:EditorSelection.single(field.from,field.final?field.from:field.to),effects:setSession.of(field.final?null:{...session,active:field.id,choicesOpen:!!field.choices?.length,choiceIndex:Math.max(0,field.choices?.indexOf(view.state.sliceDoc(field.from,field.to))??0)}),scrollIntoView:true});
 return true;
}
type Edit={from:number;to:number;insert:string};
export function snippetInsertion(state:EditorState,prepared:PreparedSnippet,from:number,to:number,additional:Edit[]=[]):TransactionSpec|null{
 let result:PreparedSnippet;try{result=validatePreparedSnippet(prepared);}catch{return null;}
 // Intermediate flat-session checkpoint. Unsupported structures never insert
 // partially. Production LSP advertisement stays disabled until all gates pass.
 if(result.needsTransformEvaluation||result.fields.some(f=>f.parent!==null)||state.selection.ranges.length!==1)return null;
 const fields=result.fields;
 const defaults=new Map<string,string>();
 for(const f of fields){if(f.final||f.derived)continue;const value=result.text.slice(f.from,f.to);if(defaults.has(f.group)&&defaults.get(f.group)!==value)return null;defaults.set(f.group,value);}
 for(let i=0;i<fields.length;i++)for(let j=0;j<i;j++){
  const a=fields[i],b=fields[j];
  if(a.from<b.to&&b.from<a.to||a.group===b.group&&a.from===a.to&&b.from===b.to&&a.from===b.from)return null;
 }
 if(!Array.isArray(additional))return null;
 const main:Edit={from,to,insert:result.text},edits=[main,...additional];
 if(additional.length>20||edits.some(e=>!e||!Number.isSafeInteger(e.from)||!Number.isSafeInteger(e.to)||e.from<0||e.from>e.to||e.to>state.doc.length||typeof e.insert!=="string"||e.insert.length>snippetLimits.output))return null;
 if(edits.reduce((sum,e)=>sum+e.insert.length,0)>snippetLimits.copies)return null;
 const boundary=(pos:number)=>{if(pos<=0||pos>=state.doc.length)return true;const pair=state.doc.sliceString(pos-1,pos+1);return !(/[\uD800-\uDBFF]/.test(pair[0])&&/[\uDC00-\uDFFF]/.test(pair[1]));};
 if(edits.some(e=>!boundary(e.from)||!boundary(e.to)))return null;
 edits.sort((a,b)=>a.from-b.from||a.to-b.to||Number(a===main)-Number(b===main));
 for(let i=1;i<edits.length;i++){const a=edits[i-1],b=edits[i];if(b.from<a.to||a.from===a.to&&b.from===b.to&&a.from===b.from)return null;}
 const start=from+edits.filter(e=>e!==main&&(e.from<from||e.from===from&&e.to===e.from)).reduce((n,e)=>n+e.insert.length-(e.to-e.from),0);
 const absolute=fields.map(f=>({...f,from:f.from+start,to:f.to+start,choices:f.choices?[...f.choices]:undefined}));
 const first=absolute.find(f=>f.group===result.navigation[0]&&!f.derived);
 const session=first&&!first.final?{owner:{},dormant:false,revision:0,from:start,to:start+result.text.length,transforms:result.transforms,dirty:false,waiting:false,error:null,fields:absolute,navigation:[...result.navigation],active:first.id,choicesOpen:!!first.choices?.length,choiceIndex:0}:null;
 return {changes:edits,selection:EditorSelection.single(first?.from??start+result.text.length,first&&!first.final?first.to:first?.from??start+result.text.length),effects:setSession.of(session),annotations:isolateHistory.of("full"),userEvent:"input.complete",scrollIntoView:true};
}

function choiceAllowed(session:Session,field:SnippetField,index:number):boolean{
 const text=field.choices?.[index];return typeof text==="string"&&text.length<=snippetLimits.output&&text.length*session.fields.filter(f=>f.group===field.group).length<=snippetLimits.copies;
}
function choiceTooltip(session:Session|null):Tooltip|null{
 const field=session?.fields.find(f=>f.id===session.active);
 if(session&&field&&(session.waiting||session.error))return {pos:field.from,above:false,create:()=>{
  const dom=document.createElement("div");dom.className="cm-snippet-message";
  dom.setAttribute("role",session.error?"alert":"status");dom.textContent=session.error?"参数转换失败，按 Esc 退出":"参数转换中…";
  if(session.error)dom.title=session.error.slice(0,200);return {dom};
 }};
 if(session?.dormant||!session?.choicesOpen||!field?.choices?.length)return null;
 const owner=session.owner,active=field.id,index=session.choiceIndex,options=field.choices;
 return {pos:field.from,above:false,create:view=>{
  const dom=document.createElement("div");dom.className="cm-snippet-choices";dom.setAttribute("role","listbox");dom.setAttribute("aria-label","参数选项");
  const buttons=options.map((text,i)=>{
   const button=document.createElement("button");button.type="button";button.tabIndex=-1;button.setAttribute("role","option");button.setAttribute("aria-selected",String(i===index));
   button.disabled=!choiceAllowed(session,field,i);
   button.textContent=text?text.slice(0,200)+(text.length>200?"…":""):"(空)";button.title=button.disabled?"超出补全大小限制":text.slice(0,1000);
   button.addEventListener("mousedown",event=>event.preventDefault());
   button.addEventListener("click",()=>{
    const current=view.state.field(snippetSessionState,false);
    if(current?.owner!==owner||current.active!==active)return;
    chooseSnippetValue(view,i,false);
   });
   dom.appendChild(button);return button;
  });
  return {dom,mount:()=>{
   const selected=buttons[index];if(!selected)return;
   const top=selected.offsetTop,bottom=top+selected.offsetHeight;
   if(top<dom.scrollTop)dom.scrollTop=top;else if(bottom>dom.scrollTop+dom.clientHeight)dom.scrollTop=Math.max(0,bottom-dom.clientHeight);
  }};
 }};
}
export function snippetChoiceOpen(view:EditorView):boolean{
 const session=view.state.field(snippetSessionState,false);
 return !!session?.choicesOpen&&!view.composing;
}
export function moveSnippetChoice(view:EditorView,direction:1|-1):boolean{
 const session=view.state.field(snippetSessionState,false),field=session?.fields.find(f=>f.id===session.active);
 if(!session?.choicesOpen||!field?.choices?.length||view.composing)return false;
 let choiceIndex=session.choiceIndex;
 for(let count=0;count<field.choices.length;count++){
  choiceIndex=(choiceIndex+direction+field.choices.length)%field.choices.length;
  if(choiceAllowed(session,field,choiceIndex)){view.dispatch({effects:setSession.of({...session,choiceIndex})});return true;}
 }
 return true;
}
export function chooseSnippetValue(view:EditorView,index:number,advance=false):boolean{
 const session=view.state.field(snippetSessionState,false),field=session?.fields.find(f=>f.id===session.active);
 if(!session?.choicesOpen||!field?.choices||!Number.isInteger(index)||index<0||index>=field.choices.length||view.composing)return false;
 if(!choiceAllowed(session,field,index))return false;
 const insert=field.choices[index];
 if(insert===view.state.sliceDoc(field.from,field.to)){
  view.dispatch({selection:{anchor:field.to},effects:setSession.of({...session,choicesOpen:false})});
  if(advance)moveSnippetField(view,1);return true;
 }
 view.dispatch({changes:{from:field.from,to:field.to,insert},selection:{anchor:field.from+insert.length},annotations:isolateHistory.of("full"),userEvent:"input.complete"});
 if(advance)moveSnippetField(view,1);return true;
}
export function acceptSnippetChoice(view:EditorView,advance=false):boolean{
 const session=view.state.field(snippetSessionState,false);if(!session?.choicesOpen||view.composing)return false;chooseSnippetValue(view,session.choiceIndex,advance);return true;
}

export function snippetTransformSnapshot(state:EditorState):PreparedSnippet|null{
 const session=state.field(snippetSessionState,false);if(!session||!session.dirty)return null;
 if(session.to-session.from>snippetLimits.output||session.from<0||session.to>state.doc.length)throw Error("Snippet transform region limit");
 return validatePreparedSnippet({schemaVersion:1,parserIdentity:snippetParserIdentity,
  text:state.doc.sliceString(session.from,session.to),
  fields:session.fields.map(f=>({...f,from:f.from-session.from,to:f.to-session.from})),
  navigation:session.navigation,transforms:session.transforms,
  needsTransformEvaluation:session.transforms.length>0,transformState:session.transforms.length?"pending":"resolved"});
}
function sameTransforms(a:PreparedTransform[],b:PreparedTransform[]):boolean{
 return a.length===b.length&&a.every((t,i)=>{
  const other=b[i];return t.target===other.target&&t.pattern===other.pattern&&t.flags===other.flags&&t.sourceGroup===other.sourceGroup&&t.sourceValue===other.sourceValue&&t.format.length===other.format.length&&t.format.every((f,j)=>{
   const g=other.format[j];if(f.kind!==g.kind)return false;
   return f.kind==="text"&&g.kind==="text"?f.value===g.value:f.kind==="capture"&&g.kind==="capture"&&f.index===g.index&&f.operation===g.operation&&f.ifValue===g.ifValue&&f.elseValue===g.elseValue;
  });
 });
}
export function snippetTransformCommit(state:EditorState,owner:object,revision:number,prepared:PreparedSnippet,direction:1|-1|0):TransactionSpec|null{
 const session=state.field(snippetSessionState,false);if(!session||session.owner!==owner||session.revision!==revision||!session.dirty)return null;
 let result:PreparedSnippet;try{result=validatePreparedSnippet(prepared);}catch{return null;}
 if(result.needsTransformEvaluation||result.fields.length!==session.fields.length||!sameTransforms(result.transforms,session.transforms))return null;
 const fields=result.fields.map(f=>({...f,from:f.from+session.from,to:f.to+session.from}));
 const edits:{from:number;to:number;insert:string;id:number}[]=[];
 for(let i=0;i<fields.length;i++){
  const before=session.fields[i],after=fields[i];
  if(before.id!==after.id||before.group!==after.group||before.parent!==after.parent||before.derived!==after.derived||before.final!==after.final||
    (before.choices?.length??0)!==(after.choices?.length??0)||before.choices?.some((text,j)=>text!==after.choices?.[j]))return null;
  const oldText=state.doc.sliceString(before.from,before.to),newText=result.text.slice(result.fields[i].from,result.fields[i].to);
  if(before.derived){if(oldText!==newText)edits.push({from:before.from,to:before.to,insert:newText,id:before.id});}
  else if(oldText!==newText)return null;
 }
 edits.sort((a,b)=>a.from-b.from||a.to-b.to||a.id-b.id);
 for(let i=1;i<edits.length;i++)if(edits[i].from<edits[i-1].to)return null;
 const changes=ChangeSet.of(edits,state.doc.length);
 if(changes.apply(state.doc).sliceString(session.from,session.from+result.text.length)!==result.text)return null;
 const current=fields.find(f=>f.id===session.active)!;
 const nextGroup=direction===0?current.group:session.navigation[Math.max(0,session.navigation.indexOf(current.group)+direction)];
 const next=fields.find(f=>f.group===nextGroup&&!f.derived);
 const nextSession=next&&!next.final&&!(direction===0&&session.dormant)?{...session,revision:session.revision+1,to:session.from+result.text.length,fields,active:next.id,dirty:false,waiting:false,error:null,choicesOpen:direction!==0&&!!next.choices?.length,choiceIndex:Math.max(0,next.choices?.indexOf(result.text.slice(next.from-session.from,next.to-session.from))??0)}:null;
 const previous=session.fields.find(f=>f.id===session.active)!,chosen=state.selection.main;
 const inside=state.selection.ranges.length===1&&chosen.from>=previous.from&&chosen.to<=previous.to;
 const settledSelection=inside?EditorSelection.single(current.from+chosen.anchor-previous.from,current.from+chosen.head-previous.from):state.selection.map(changes);
 const selection=direction===0?settledSelection:EditorSelection.single(next?.from??session.from+result.text.length,next&&!next.final?next.to:next?.from??session.from+result.text.length);
 return {changes,selection,effects:setSession.of(nextSession),annotations:isolateHistory.of("full"),userEvent:"input.snippet-transform",scrollIntoView:true};
}
const runtimes=new WeakMap<EditorView,SnippetTransformRuntime>();
class SnippetTransformRuntime {
 private readonly view:EditorView;private readonly service=new SnippetPreparationService();private closed=false;
 private active:{owner:object;revision:number;doc:EditorState["doc"];selection:EditorSelection;direction:1|-1|0;after?:()=>void;actionKind?:"save"|"format"}|null=null;
 constructor(view:EditorView){this.view=view;runtimes.set(view,this);}
 update(update:ViewUpdate){
  const session=update.state.field(snippetSessionState);
  if(this.active&&(update.docChanged||update.selectionSet&&!update.state.selection.eq(this.active.selection)||session?.owner!==this.active.owner||session.revision!==this.active.revision))this.cancel();
  if(this.active&&update.focusChanged&&!this.view.hasFocus&&!this.active.after){
   const owner=this.active.owner;this.cancel();
   queueMicrotask(()=>{if(this.closed||this.active)return;const current=this.view.state.field(snippetSessionState,false);if(current?.owner===owner)this.view.dispatch({effects:setSession.of({...current,waiting:false})});});
  }
 }
 private cancel(){this.active=null;this.service.cancel();}
 leave(direction:1|-1|0,after?:()=>void,actionKind?:"save"|"format"):boolean{
  const view=this.view,session=view.state.field(snippetSessionState);
  if(this.closed||!session?.dirty)return false;
  if(view.composing)return true;
  if(this.active&&this.active.doc===view.state.doc&&this.active.owner===session.owner&&this.active.revision===session.revision){
   this.active.direction=direction;if(after&&(this.active.actionKind!=="save"||actionKind==="save")){this.active.after=after;this.active.actionKind=actionKind;}return true;
  }
  this.cancel();
  let snapshot:PreparedSnippet|null;
  try{snapshot=snippetTransformSnapshot(view.state);}catch(error){this.report(session,String(error));return true;}
  if(!snapshot)return false;
  const ticket={owner:session.owner,revision:session.revision,doc:view.state.doc,selection:view.state.selection,direction,after,actionKind};
  this.active=ticket;
  view.dispatch({effects:setSession.of({...session,waiting:true,error:null,choicesOpen:false})});
  void this.service.evaluate(snapshot).then(result=>{
   if(this.closed)return;
   const current=view.state.field(snippetSessionState);
   if(this.active!==ticket||view.state.doc!==ticket.doc||current?.owner!==ticket.owner||current.revision!==ticket.revision||!view.state.selection.eq(ticket.selection)||!view.hasFocus&&!ticket.after||view.composing){
    if(this.active===ticket){this.active=null;if(current?.owner===ticket.owner)view.dispatch({effects:setSession.of({...current,waiting:false})});}
    return;
   }
   const spec=snippetTransformCommit(view.state,ticket.owner,ticket.revision,result,ticket.direction);
   this.active=null;
   if(!spec){this.report(current,"转换结果与当前参数不一致");return;}
   view.dispatch(spec);
   if(!this.closed&&runtimes.get(view)===this)ticket.after?.();
  }).catch(error=>{
   if(this.closed||this.active!==ticket)return;
   this.active=null;const current=view.state.field(snippetSessionState);
   if(current?.owner===ticket.owner&&current.revision===ticket.revision)this.report(current,String(error));
  });
  return true;
 }
 private report(session:Session,error:string){if(!this.closed&&this.view.state.field(snippetSessionState)?.owner===session.owner)this.view.dispatch({effects:setSession.of({...session,waiting:false,error:error.slice(0,200)})});}
 destroy(){this.closed=true;this.cancel();this.service.destroy();runtimes.delete(this.view);}
}
export function settleSnippetForAction(view:EditorView,action:()=>void,kind:"save"|"format"="save"):boolean{
 const session=view.state.field(snippetSessionState,false);
 return session?.dirty?(runtimes.get(view)?.leave(0,action,kind)??true):false;
}

export function discardSnippet(view:EditorView):boolean{
 if(!view.state.field(snippetSessionState,false))return false;view.dispatch({effects:setSession.of(null)});return true;
}
