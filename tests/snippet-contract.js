import {EditorState} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {snippet,nextSnippetField,prevSnippetField,pickedCompletion,snippetKeymap} from "@codemirror/autocomplete";
import {history,undo,redo} from "@codemirror/commands";

// CI-only characterization of the pinned library, NOT the production LSP bridge.
const eq=(actual,expected,label)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(label+": "+JSON.stringify(actual)+" != "+JSON.stringify(expected));};
const text=v=>v.state.doc.toString();
const selected=v=>v.state.selection.ranges.map(r=>v.state.sliceDoc(r.from,r.to));
export function runSnippetContract(){
  const passed=[],limitations=[],views=[],hosts=[];
  function make(doc="",extra=[]){
    const host=document.body.appendChild(document.createElement("div"));hosts.push(host);
    const view=new EditorView({parent:host,state:EditorState.create({doc,extensions:[EditorState.allowMultipleSelections.of(true),snippetKeymap.of([]),history(),...extra]})});
    views.push(view);return view;
  }
  // Deliberately strict test-only plan guard. Production requires URI/version/
  // provider ownership, resolve validation and coordination with all edit filters.
  function atomic(plans){return EditorState.transactionFilter.of(tr=>{
    const completion=tr.annotation(pickedCompletion),plan=completion&&plans.get(completion);
    if(!plan)return tr;
    if(tr.startState.readOnly||tr.startState!==plan.state)return [];
    const main=[];tr.changes.iterChanges((from,to)=>main.push({from,to}));
    if(main.length!==1||main[0].from!==plan.from||main[0].to!==plan.to)return [];
    const edits=[...plan.extra].sort((a,b)=>a.from-b.from);let end=-1;
    for(const e of edits){
      if(!Number.isInteger(e.from)||!Number.isInteger(e.to)||e.from<0||e.to<e.from||e.to>tr.startState.doc.length||typeof e.insert!=="string"||e.from<=end||!(e.to<plan.from||e.from>plan.to))return [];
      end=e.to;
    }
    // Same start-state coordinates. CM maps selection and native snippet effects.
    // Change filters do NOT run again on the added edits.
    return [tr,{changes:edits}];
  });}
  function prepare(view,plans,extra){
    view.dispatch({selection:{anchor:3}});
    const item={label:"call"};plans.set(item,{state:view.state,from:1,to:3,extra});
    return ()=>snippet("call(${1:x})${0}")(view,item,1,3);
  }
  try{
    {
      const v=make();snippet("a${2:b}c${1:d}e${0}")(v,null,0,0);
      eq(text(v),"abcde","expansion");eq(selected(v),["d"],"first stop");
      eq(nextSnippetField(v),true,"next");eq(selected(v),["b"],"second stop");
      eq(prevSnippetField(v),true,"previous");eq(selected(v),["d"],"previous selection");
      nextSnippetField(v);eq(nextSnippetField(v),true,"final stop");
      eq(v.state.selection.main.head,5,"zero last");eq(nextSnippetField(v),false,"session ended");
      passed.push("numeric ordering, backwards navigation, final zero");
    }
    {
      const v=make();snippet("${1:name} = ${1:name};${0}")(v,null,0,0);
      eq(selected(v),["name","name"],"mirror selections");
      v.dispatch(v.state.replaceSelection("value"));eq(text(v),"value = value;","mirror editing");
      eq(nextSnippetField(v),true,"mapped final");eq(v.state.selection.main.head,text(v).length,"final offset");
      passed.push("populated mirrors via multiple selections");
    }
    {
      const v=make();snippet("${1:name} = ${1};${0}")(v,null,0,0);
      eq(text(v),"name = ;","missing default propagation");eq(selected(v),["name",""],"unequal fields");
      limitations.push("Repeated indices do not propagate default text.");
    }
    {
      const v=make();snippet("$1 ${1|one,two|}${0}")(v,null,0,0);
      eq(text(v),"$1 1|one,two|","unsupported LSP constructs");
      limitations.push("Bare $1 stays literal; choice syntax becomes field text.");
    }
    {
      const plans=new WeakMap();let changes=0;
      const v=make("\nca\n",[atomic(plans),EditorView.updateListener.of(u=>{if(u.docChanged)changes++;})]);
      prepare(v,plans,[{from:0,to:0,insert:"import x\n"}])();
      const expected="import x\n\ncall(x)\n";
      eq(text(v),expected,"atomic import");eq(changes,1,"single update");eq(selected(v),["x"],"mapped field");
      eq(v.state.selection.main.from,expected.lastIndexOf("x"),"field position");
      eq(nextSnippetField(v),true,"mapped effect");eq(v.state.selection.main.head,expected.lastIndexOf(")")+1,"mapped final");
      eq(undo(v),true,"undo");eq(text(v),"\nca\n","undo both");
      eq(redo(v),true,"redo");eq(text(v),expected,"redo both");
      passed.push("atomic import, mapped fields/effects, one undo and redo");
    }
    {
      const v=make("",[EditorState.readOnly.of(true)]);snippet("${1:x}${0}")(v,null,0,0);
      eq(text(v),"x","programmatic readonly characterization");
      limitations.push("readOnly alone does not block programmatic snippet insertion.");
    }
    for(const scenario of ["readonly","stale","overlap","invalid","duplicate"]){
      const plans=new WeakMap(),v=make("\nca\n",[atomic(plans),...(scenario==="readonly"?[EditorState.readOnly.of(true)]:[])]);
      const extra=scenario==="overlap"?[{from:2,to:2,insert:"BAD"}]:scenario==="invalid"?[{from:99,to:99,insert:"BAD"}]:scenario==="duplicate"?[{from:0,to:0,insert:"a"},{from:0,to:0,insert:"b"}]:[{from:0,to:0,insert:"import x\n"}];
      const accept=prepare(v,plans,extra);
      if(scenario==="stale")v.dispatch({selection:{anchor:2}});
      const before=text(v),selection=v.state.selection.toJSON();accept();
      eq(text(v),before,scenario+" text");eq(v.state.selection.toJSON(),selection,scenario+" selection");
      eq(undo(v),false,scenario+" history");eq(nextSnippetField(v),false,scenario+" session");
      passed.push(scenario+": complete operation rejected");
    }
    return {expectedVersion:"6.20.3",passed,limitations,scope:"Browser programmatic contract only. Production snippets remain disabled; real keyboard, Vim, IME, nesting and native WebView are not covered."};
  }finally{for(const v of views)v.destroy();for(const h of hosts)h.remove();}
}
window.runSnippetContract=runSnippetContract;
