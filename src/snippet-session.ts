import {ChangeSet,EditorSelection,EditorState,StateEffect,StateField,Transaction,type Extension,type TransactionSpec} from "@codemirror/state";
import {EditorView,Decoration,showTooltip,type Tooltip,type DecorationSet} from "@codemirror/view";
import {isolateHistory} from "@codemirror/commands";
import {validatePreparedSnippet} from "./snippet-validation.ts";
import {snippetLimits} from "./snippet-budget.ts";
import type {PreparedSnippet,SnippetField} from "./snippet-prepare.ts";
type Session={owner:object;fields:SnippetField[];navigation:string[];active:number;choicesOpen:boolean;choiceIndex:number};
const setSession=StateEffect.define<Session|null>({map:(value,mapping)=>{
 if(!value)return null;
 if(mapping.empty)return value;
 let touched=false,count=0;
 mapping.iterChangedRanges((from,to)=>{
  if(++count>32||value.fields.some(f=>from<=f.to&&to>=f.from))touched=true;
 });
 if(touched)return null;
 return {...value,fields:value.fields.map(f=>{
  if(f.from===f.to){const pos=mapping.mapPos(f.from,1);return {...f,from:pos,to:pos};}
  return {...f,from:mapping.mapPos(f.from,1),to:mapping.mapPos(f.to,-1)};
 })};
}});
function decorations(session:Session|null):DecorationSet{
 if(!session)return Decoration.none;
 const active=session.fields.find(f=>f.id===session.active)?.group;
 return Decoration.set(session.fields.filter(f=>!f.final&&f.to>f.from).map(f=>Decoration.mark({class:f.group===active?"cm-snippet-field cm-snippet-field-active":"cm-snippet-field"}).range(f.from,f.to)),true);
}
export const snippetSessionState=StateField.define<Session|null>({
 create:()=>null,
 update(value,tr){
  for(const effect of tr.effects)if(effect.is(setSession))return effect.value;
  // Unfiltered edits and text history must not leave stale linked ranges.
  if(tr.docChanged)return null;
  if(value&&tr.selection){
   const selection=tr.newSelection;
   if(selection.ranges.length!==1)return null;
   const current=value.fields.find(f=>f.id===value.active);
   if(current&&selection.main.from>=current.from&&selection.main.to<=current.to)return value;
   const field=value.fields.find(f=>!f.final&&selection.main.from>=f.from&&selection.main.to<=f.to);
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
  if(tr.annotation(Transaction.remote)||tr.isUserEvent("undo")||tr.isUserEvent("redo")||tr.newSelection.ranges.length!==1||tr.startState.selection.ranges.length!==1||!(tr.isUserEvent("input.type")||tr.isUserEvent("input.paste")||tr.isUserEvent("input.drop")||tr.isUserEvent("input.complete")||tr.isUserEvent("delete")))return [tr,cancelSpec];
  const changes:{from:number;to:number}[]=[];
  tr.changes.iterChangedRanges((from,to)=>{if(changes.length<33)changes.push({from,to});});
  if(changes.length>32)return [tr,cancelSpec];
  const contains=(f:SnippetField)=>!f.final&&changes.every(c=>c.from>=f.from&&c.to<=f.to);
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
  const mirrors=mapped.filter(f=>f.group===target.group&&f.id!==target.id);
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
  return [tr,{sequential:true,changes:mirrorSet,selection,effects:setSession.of({...session,fields,active:target.id,choicesOpen:false})}];
 });
}
export const snippetSession:Extension=[
 snippetSessionState,filter,
 EditorView.baseTheme({
  ".cm-snippet-field":{borderBottom:"1px dotted currentColor"},
  ".cm-snippet-field-active":{backgroundColor:"var(--active-line, #80808022)",borderBottomStyle:"solid"},
  ".cm-snippet-choices":{maxHeight:"240px",maxWidth:"420px",overflowY:"auto",padding:"3px"},
  ".cm-snippet-choices button":{display:"block",width:"100%",border:"0",padding:"4px 8px",background:"transparent",color:"inherit",font:"inherit",textAlign:"left",whiteSpace:"pre"},
  ".cm-snippet-choices button[aria-selected=true]":{backgroundColor:"var(--selection, #80808033)"}
 })
];
export function endSnippet(view:EditorView):boolean{
 if(!view.state.field(snippetSessionState,false))return false;
 view.dispatch({effects:setSession.of(null)});return true;
}
export function moveSnippetField(view:EditorView,direction:1|-1):boolean{
 const session=view.state.field(snippetSessionState,false);if(!session||view.composing)return false;
 const active=session.fields.find(f=>f.id===session.active)!;
 const index=session.navigation.indexOf(active.group),next=session.navigation[Math.max(0,index+direction)];
 if(!next){endSnippet(view);return true;}
 const field=session.fields.find(f=>f.group===next)!;
 view.dispatch({selection:EditorSelection.single(field.from,field.final?field.from:field.to),effects:setSession.of(field.final?null:{...session,active:field.id,choicesOpen:!!field.choices?.length,choiceIndex:Math.max(0,field.choices?.indexOf(view.state.sliceDoc(field.from,field.to))??0)}),scrollIntoView:true});
 return true;
}
type Edit={from:number;to:number;insert:string};
export function snippetInsertion(state:EditorState,prepared:PreparedSnippet,from:number,to:number,additional:Edit[]=[]):TransactionSpec|null{
 let result:PreparedSnippet;try{result=validatePreparedSnippet(prepared);}catch{return null;}
 // Intermediate flat-session checkpoint. Unsupported structures never insert
 // partially. Production LSP advertisement stays disabled until all gates pass.
 if(result.needsTransformEvaluation||result.fields.some(f=>f.parent!==null||f.derived)||state.selection.ranges.length!==1)return null;
 const fields=result.fields;
 const defaults=new Map<string,string>();
 for(const f of fields){if(f.final)continue;const value=result.text.slice(f.from,f.to);if(defaults.has(f.group)&&defaults.get(f.group)!==value)return null;defaults.set(f.group,value);}
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
 const first=absolute.find(f=>f.group===result.navigation[0]);
 const session=first&&!first.final?{owner:{},fields:absolute,navigation:[...result.navigation],active:first.id,choicesOpen:!!first.choices?.length,choiceIndex:0}:null;
 return {changes:edits,selection:EditorSelection.single(first?.from??start+result.text.length,first&&!first.final?first.to:first?.from??start+result.text.length),effects:setSession.of(session),annotations:isolateHistory.of("full"),userEvent:"input.complete",scrollIntoView:true};
}

function choiceTooltip(session:Session|null):Tooltip|null{
 const field=session?.fields.find(f=>f.id===session.active);
 if(!session?.choicesOpen||!field?.choices?.length)return null;
 const owner=session.owner,active=field.id,index=session.choiceIndex,options=field.choices;
 return {pos:field.from,above:false,create:view=>{
  const dom=document.createElement("div");dom.className="cm-snippet-choices";dom.setAttribute("role","listbox");dom.setAttribute("aria-label","参数选项");
  const buttons=options.map((text,i)=>{
   const button=document.createElement("button");button.type="button";button.tabIndex=-1;button.setAttribute("role","option");button.setAttribute("aria-selected",String(i===index));
   button.textContent=text?text.slice(0,200)+(text.length>200?"…":""):"(空)";button.title=text.slice(0,1000);
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
 const choiceIndex=(session.choiceIndex+direction+field.choices.length)%field.choices.length;
 view.dispatch({effects:setSession.of({...session,choiceIndex})});return true;
}
export function chooseSnippetValue(view:EditorView,index:number,advance=false):boolean{
 const session=view.state.field(snippetSessionState,false),field=session?.fields.find(f=>f.id===session.active);
 if(!session?.choicesOpen||!field?.choices||!Number.isInteger(index)||index<0||index>=field.choices.length||view.composing)return false;
 const insert=field.choices[index];
 view.dispatch({changes:{from:field.from,to:field.to,insert},selection:{anchor:field.from+insert.length},annotations:isolateHistory.of("full"),userEvent:"input.complete"});
 if(advance)moveSnippetField(view,1);return true;
}
export function acceptSnippetChoice(view:EditorView,advance=false):boolean{
 const session=view.state.field(snippetSessionState,false);return session?chooseSnippetValue(view,session.choiceIndex,advance):false;
}
