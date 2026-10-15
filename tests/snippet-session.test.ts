import {evaluateSnippetTransforms} from "../src/snippet-transform.worker-core.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {EditorState,StateEffect,StateField,Transaction} from "@codemirror/state";
import {history,undo,redo} from "@codemirror/commands";
import {snippetSession,snippetSessionState,snippetInsertion,moveSnippetField,endSnippet,moveSnippetChoice,chooseSnippetValue,snippetChoiceOpen,snippetTransformSnapshot,snippetTransformCommit} from "../src/snippet-session.ts";
import {prepareSnippet} from "../src/snippet-prepare.ts";
const S="$",sample=S+"{1:abc}-"+S+"1-"+S+"0";
function start(source=sample,doc=""){
 let state=EditorState.create({doc,extensions:[history(),snippetSession]});
 const spec=snippetInsertion(state,prepareSnippet(source),0,doc.length);assert.ok(spec);
 state=state.update(spec).state;return state;
}
test("narrowed selections keep linked fields through growth shrink and paste",()=>{
 let s=start();s=s.update({selection:{anchor:1}}).state;
 s=s.update({changes:{from:1,insert:"Z"},selection:{anchor:2},userEvent:"input.type"}).state;
 assert.equal(s.doc.toString(),"aZbc-aZbc-");
 s=s.update({changes:{from:1,to:3,insert:""},selection:{anchor:1},userEvent:"delete.backward"}).state;
 assert.equal(s.doc.toString(),"ac-ac-");
 s=s.update({changes:{from:0,to:2,insert:"中文😀"},selection:{anchor:4},userEvent:"input.paste"}).state;
 assert.equal(s.doc.toString(),"中文😀-中文😀-");
 assert.ok(s.field(snippetSessionState));
});
test("editing a later mirror correctly maps source selection through earlier replacements",()=>{
 let s=start();s=s.update({selection:{anchor:5}}).state;
 s=s.update({changes:{from:5,insert:"Z"},selection:{anchor:6},userEvent:"input.type"}).state;
 assert.equal(s.doc.toString(),"aZbc-aZbc-");assert.equal(s.selection.main.head,7);
 const active=s.field(snippetSessionState)!;assert.equal(active.fields.find(f=>f.id===active.active)!.from,5);
});
test("initial insertion and imports are atomic, mirrored edits are one undo event",()=>{
 let s=EditorState.create({doc:"token",extensions:[history(),snippetSession]});
 const spec=snippetInsertion(s,prepareSnippet(sample),0,5,[{from:0,to:0,insert:"import\n"}]);assert.ok(spec);
 s=s.update(spec).state;assert.equal(s.doc.toString(),"import\nabc-abc-");
 s=s.update({changes:{from:7,to:10,insert:"x"},selection:{anchor:8},userEvent:"input.type"}).state;
 assert.equal(s.doc.toString(),"import\nx-x-");
 const target=()=>({state:s,dispatch:(tr:any)=>{s=tr.state;}});
 assert.equal(undo(target() as any),true);assert.equal(s.doc.toString(),"import\nabc-abc-");assert.equal(s.field(snippetSessionState),null);
 assert.equal(undo(target() as any),true);assert.equal(s.doc.toString(),"token");
 assert.equal(redo(target() as any),true);assert.equal(s.doc.toString(),"import\nabc-abc-");assert.equal(s.field(snippetSessionState),null);
 assert.equal(redo(target() as any),true);assert.equal(s.doc.toString(),"import\nx-x-");assert.equal(s.field(snippetSessionState),null);
});
test("boundary crossing and unfiltered changes preserve typing but end linkage",()=>{
 let s=start();s=s.update({changes:{from:2,to:5,insert:"!"},selection:{anchor:3},userEvent:"input.type"}).state;
 assert.equal(s.doc.toString(),"ab!bc-");assert.equal(s.field(snippetSessionState),null);
 s=start();s=s.update({changes:{from:1,insert:"!"},filter:false}).state;
 assert.equal(s.doc.toString(),"a!bc-abc-");assert.equal(s.field(snippetSessionState),null);
});
test("mirror budget exhaustion does not partially modify remaining fields",()=>{
 let s=start(S+"{1:x} "+Array(20).fill(S+"1").join(" "));
 s=s.update({changes:{from:0,to:1,insert:"a".repeat(65536)},selection:{anchor:65536},userEvent:"input.paste"}).state;
 assert.equal(s.field(snippetSessionState),null);assert.ok(s.doc.toString().endsWith(Array(20).fill("x").join(" ")));
});
test("Tab navigation, first Shift-Tab and final empty stop are deterministic",()=>{
 let s=start(S+"{2:two} "+S+"{1:one} "+S+"0");
 const view={get state(){return s;},composing:false,dispatch:(spec:any)=>{s=s.update(spec).state;}};
 assert.equal(s.selection.main.from,4);
 assert.equal(moveSnippetField(view as any,-1),true);assert.equal(s.selection.main.from,4);
 assert.equal(moveSnippetField(view as any,1),true);assert.equal(s.selection.main.from,0);
 assert.equal(moveSnippetField(view as any,1),true);assert.equal(s.selection.main.head,8);assert.equal(s.field(snippetSessionState),null);
 s=start(S+"1"+S+"0");s=s.update({changes:{from:0,insert:"x"},selection:{anchor:1},userEvent:"input.type"}).state;
 assert.equal(moveSnippetField(view as any,1),true);assert.equal(s.selection.main.head,1);
});
test("unrelated transaction effects survive mirror propagation",()=>{
 const effect=StateEffect.define<number>(),field=StateField.define({create:()=>0,update:(v,tr)=>tr.effects.reduce((v,e)=>e.is(effect)?e.value:v,v)});
 let s=EditorState.create({extensions:[snippetSession,field]});
 s=s.update(snippetInsertion(s,prepareSnippet(sample),0,0)!).state;
 s=s.update({changes:{from:1,insert:"!"},effects:effect.of(42),userEvent:"input.type"}).state;
 assert.equal(s.field(field),42);assert.equal(s.doc.toString(),"a!bc-a!bc-");
});
test("unsupported or invalid activation is all-or-nothing",()=>{
 const s=EditorState.create({doc:"token",extensions:[snippetSession]});
 for(const source of [S+"{1:"+S+"{2/a/b/}}",S+"{1/a/b/}",S+"1"+S+"1"]){
  assert.equal(snippetInsertion(s,prepareSnippet(source),0,5),null,source);
 }
 assert.equal(snippetInsertion(s,prepareSnippet(sample),0,5,[{from:2,to:2,insert:"bad"}]),null);
 assert.equal(snippetInsertion(s,prepareSnippet(sample),0,5,[{from:0,to:0,insert:"a"},{from:0,to:0,insert:"b"}]),null);
 assert.ok(snippetInsertion(s,prepareSnippet(sample),0,5,[{from:0,to:0,insert:"a"}]));
 const unicode=EditorState.create({doc:"😀",extensions:[snippetSession]});
 assert.equal(snippetInsertion(unicode,prepareSnippet(sample),1,1),null);
});

test("remote formatter and inactive-field changes never trigger linked edits",()=>{
 for(const spec of [
 {changes:{from:1,insert:"!"},userEvent:"input.type",annotations:Transaction.remote.of(true)},
 {changes:{from:1,insert:"!"},userEvent:"input.format"},
 {changes:{from:5,insert:"!"},userEvent:"input.type"}
 ]){
  let s=start();s=s.update(spec).state;assert.equal(s.field(snippetSessionState),null);
  assert.equal(s.doc.length,9,"only original edit is retained");
 }
});
test("moving final selection outside the edited field safely ends linkage",()=>{
 let s=start();s=s.update({changes:{from:1,insert:"!"},selection:{anchor:9},userEvent:"input.type"}).state;
 assert.equal(s.field(snippetSessionState),null);assert.equal(s.doc.toString(),"a!bc-abc-");
});

test("session effects map through composed original-coordinate edits",()=>{
 let s=EditorState.create({doc:"__token",extensions:[snippetSession]});
 const insertion=snippetInsertion(s,prepareSnippet(sample),2,7)!;
 s=s.update(insertion,{changes:{from:0,insert:"prefix"}}).state;
 assert.equal(s.doc.toString(),"prefix__abc-abc-");
 const active=s.field(snippetSessionState)!;assert.equal(active.fields[0].from,8);
 s=s.update({selection:{anchor:9}}).state;
 s=s.update({changes:{from:9,insert:"!"},selection:{anchor:10},userEvent:"input.type"}).state;
 assert.equal(s.doc.toString(),"prefix__a!bc-a!bc-");
});
test("composed edits intersecting new snippet fields invalidate session effects",()=>{
 let s=EditorState.create({extensions:[snippetSession]});
 s=s.update(snippetInsertion(s,prepareSnippet(sample),0,0)!,{sequential:true,changes:{from:1,insert:"!"}}).state;
 assert.equal(s.doc.toString(),"a!bc-abc-");assert.equal(s.field(snippetSessionState),null);
});

test("choice keyboard state and selection update mirrors atomically",()=>{
 let s=start(S+"{1|one,two,three|} / "+S+"1; "+S+"{2:done}"+S+"0");
 const view={get state(){return s;},composing:false,dispatch:(spec:any)=>{s=s.update(spec).state;}};
 assert.equal(snippetChoiceOpen(view as any),true);
 assert.equal(moveSnippetChoice(view as any,1),true);assert.equal(s.field(snippetSessionState)!.choiceIndex,1);
 assert.equal(chooseSnippetValue(view as any,1),true);assert.equal(s.doc.toString(),"two / two; done");assert.equal(snippetChoiceOpen(view as any),false);
 assert.equal(moveSnippetField(view as any,-1),true);assert.equal(s.field(snippetSessionState)!.choiceIndex,1);
 assert.equal(chooseSnippetValue(view as any,2,true),true);assert.equal(s.doc.toString(),"three / three; done");
 assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),"done");
 const target={state:s,dispatch:(tr:any)=>{s=tr.state;}};assert.equal(undo(target as any),true);
 assert.equal(s.doc.toString(),"two / two; done","one undo reverses exactly the last choice and all mirrors");
});
test("choice values are literal and never reparsed as snippet source",()=>{
 let s=start(S+"{1|one,"+S+"{99}|} / "+S+"1");
 const view={get state(){return s;},composing:false,dispatch:(spec:any)=>{s=s.update(spec).state;}};
 assert.equal(chooseSnippetValue(view as any,1),true);assert.equal(s.doc.toString(),S+"{99} / "+S+"{99}");
 assert.equal(s.field(snippetSessionState)!.fields.some(f=>f.group==="t:99"),false);
});

test("oversized explicit choices are refused before any text or history change",()=>{
 const prepared=prepareSnippet(S+"{1:a} "+Array(17).fill(S+"1").join(" "));
 prepared.fields[0].choices=["a","x".repeat(65536)];
 let s=EditorState.create({extensions:[history(),snippetSession]});
 s=s.update(snippetInsertion(s,prepared,0,0)!).state;
 const before=s,view={get state(){return s;},composing:false,dispatch:(spec:any)=>{s=s.update(spec).state;}};
 assert.equal(chooseSnippetValue(view as any,1),false);assert.equal(s,before);
 assert.equal(moveSnippetChoice(view as any,1),true);assert.equal(s.field(snippetSessionState)!.choiceIndex,0,"keyboard skips unavailable large choices");
});

test("same-value empty choices close picker without creating a text undo step",()=>{
 let s=start(S+"{1|,x|} / "+S+"1; "+S+"{2:z}"+S+"0");
 const before=s.doc.toString(),view={get state(){return s;},composing:false,dispatch:(spec:any)=>{s=s.update(spec).state;}};
 assert.equal(chooseSnippetValue(view as any,0),true);assert.equal(s.doc.toString(),before);assert.equal(snippetChoiceOpen(view as any),false);
 const target={state:s,dispatch:(tr:any)=>{s=tr.state;}};assert.equal(undo(target as any),true);assert.equal(s.doc.toString(),"");
 s=start(S+"{1|,x|} / "+S+"1; "+S+"{2:z}"+S+"0");assert.equal(chooseSnippetValue(view as any,0,true),true);
 assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),"z");
});

test("derived fields update only in an isolated transform-on-leave commit",()=>{
 const source=S+"{1:hello} -> "+S+"{1/(.*)/"+S+"{1:/upcase}/}; "+S+"{2:tail}"+S+"0";
 let s=EditorState.create({extensions:[history(),snippetSession]});
 const prepared=evaluateSnippetTransforms(prepareSnippet(source));
 s=s.update(snippetInsertion(s,prepared,0,0)!).state;
 s=s.update({changes:{from:0,to:5,insert:"world"},selection:{anchor:5},userEvent:"input.type"}).state;
 assert.equal(s.doc.toString(),"world -> HELLO; tail","derived output stays committed until leaving field");
 const session=s.field(snippetSessionState)!,snapshot=snippetTransformSnapshot(s)!;
 const evaluated=evaluateSnippetTransforms(snapshot),spec=snippetTransformCommit(s,session.owner,session.revision,evaluated,1);
 assert.ok(spec);s=s.update(spec).state;
 assert.equal(s.doc.toString(),"world -> WORLD; tail");assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),"tail");
 const target=()=>({state:s,dispatch:(tr:any)=>{s=tr.state;}});
 assert.equal(undo(target() as any),true);assert.equal(s.doc.toString(),"world -> HELLO; tail");assert.equal(s.field(snippetSessionState),null);
 assert.equal(undo(target() as any),true);assert.equal(s.doc.toString(),"hello -> HELLO; tail");
 assert.equal(redo(target() as any),true);assert.equal(redo(target() as any),true);assert.equal(s.doc.toString(),"world -> WORLD; tail");assert.equal(s.field(snippetSessionState),null);
});
test("transform commit rejects changed ownership revision or source contents",()=>{
 const source=S+"{1:a} "+S+"{1/a/b/} "+S+"0";
 let s=EditorState.create({extensions:[snippetSession]});
 s=s.update(snippetInsertion(s,evaluateSnippetTransforms(prepareSnippet(source)),0,0)!).state;
 s=s.update({changes:{from:0,to:1,insert:"aa"},selection:{anchor:2},userEvent:"input.type"}).state;
 const session=s.field(snippetSessionState)!,evaluated=evaluateSnippetTransforms(snippetTransformSnapshot(s)!);
 assert.equal(snippetTransformCommit(s,{},session.revision,evaluated,1),null);
 assert.equal(snippetTransformCommit(s,session.owner,session.revision+1,evaluated,1),null);
 const changed=structuredClone(evaluated);changed.text="z"+changed.text.slice(1);
 assert.equal(snippetTransformCommit(s,session.owner,session.revision,changed,1),null);
});
test("save settlement maps caret but does not advance the active parameter",()=>{
 const source=S+"{1:a} "+S+"{1/a/longer/} "+S+"{2:z}"+S+"0";
 let s=EditorState.create({extensions:[snippetSession]});
 s=s.update(snippetInsertion(s,evaluateSnippetTransforms(prepareSnippet(source)),0,0)!).state;
 s=s.update({changes:{from:0,to:1,insert:"aa"},selection:{anchor:2},userEvent:"input.type"}).state;
 const before=s.field(snippetSessionState)!;
 s=s.update(snippetTransformCommit(s,before.owner,before.revision,evaluateSnippetTransforms(snippetTransformSnapshot(s)!),0)!).state;
 assert.equal(s.doc.toString(),"aa longera z");assert.equal(s.selection.main.head,2);
 const after=s.field(snippetSessionState)!;assert.equal(after.active,before.active);assert.equal(after.dirty,false);
});

test("derived output before its source is never selected and maps caret on settlement",()=>{
 const source=S+"{1/a/longer/} "+S+"{1:a}"+S+"0";
 let s=EditorState.create({extensions:[snippetSession]});
 s=s.update(snippetInsertion(s,evaluateSnippetTransforms(prepareSnippet(source)),0,0)!).state;
 assert.equal(s.doc.toString(),"longer a");assert.equal(s.selection.main.from,7);
 s=s.update({changes:{from:7,to:8,insert:"aa"},selection:{anchor:9},userEvent:"input.type"}).state;
 const current=s.field(snippetSessionState)!;
 s=s.update(snippetTransformCommit(s,current.owner,current.revision,evaluateSnippetTransforms(snippetTransformSnapshot(s)!),0)!).state;
 assert.equal(s.doc.toString(),"longera aa");assert.equal(s.selection.main.head,10);
});

test("save settlement preserves source-relative caret beside an empty derived insertion",()=>{
 const source=S+"{1/^(a)?b$/"+S+"{1:+X}/}"+S+"{1:b}"+S+"0";
 let s=EditorState.create({extensions:[snippetSession]});
 s=s.update(snippetInsertion(s,evaluateSnippetTransforms(prepareSnippet(source)),0,0)!).state;
 s=s.update({changes:{from:0,to:1,insert:"ab"},selection:{anchor:0},userEvent:"input.type"}).state;
 const current=s.field(snippetSessionState)!;
 s=s.update(snippetTransformCommit(s,current.owner,current.revision,evaluateSnippetTransforms(snippetTransformSnapshot(s)!),0)!).state;
 assert.equal(s.doc.toString(),"Xab");assert.equal(s.selection.main.head,1);
 assert.equal(s.field(snippetSessionState)!.fields.find(f=>f.id===current.active)!.from,1);
});
test("backward transform navigation selects the current choice rather than resetting it",()=>{
 const source=S+"{1|one,two|} "+S+"{2:a} "+S+"{2/a/A/}"+S+"0";
 let s=EditorState.create({extensions:[snippetSession]});
 s=s.update(snippetInsertion(s,evaluateSnippetTransforms(prepareSnippet(source)),0,0)!).state;
 const view={get state(){return s;},composing:false,dispatch:(spec:any)=>{s=s.update(spec).state;}};
 chooseSnippetValue(view as any,1,true);
 const selected=s.selection.main;
 s=s.update({changes:{from:selected.from,to:selected.to,insert:"aa"},selection:{anchor:selected.from+2},userEvent:"input.type"}).state;
 const current=s.field(snippetSessionState)!;
 s=s.update(snippetTransformCommit(s,current.owner,current.revision,evaluateSnippetTransforms(snippetTransformSnapshot(s)!),-1)!).state;
 assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),"two");
 assert.equal(s.field(snippetSessionState)!.choiceIndex,1);
});

test("ending navigation preserves dirty transforms only until explicit save or another edit",()=>{
 const source=S+"{1:a} "+S+"{1/a/b/}"+S+"0";
 let s=EditorState.create({extensions:[snippetSession]});
 const insert=()=>{s=s.update(snippetInsertion(s,evaluateSnippetTransforms(prepareSnippet(source)),0,s.doc.length)!).state;};
 insert();s=s.update({changes:{from:0,to:1,insert:"aa"},selection:{anchor:2},userEvent:"input.type"}).state;
 const view={get state(){return s;},composing:false,dispatch:(spec:any)=>{s=s.update(spec).state;}};
 assert.equal(endSnippet(view as any),true);
 const dormant=s.field(snippetSessionState)!;assert.equal(dormant.dormant,true);assert.equal(moveSnippetField(view as any,1),false);
 const spec=snippetTransformCommit(s,dormant.owner,dormant.revision,evaluateSnippetTransforms(snippetTransformSnapshot(s)!),0)!;
 s=s.update(spec).state;assert.equal(s.doc.toString(),"aa ba");assert.equal(s.field(snippetSessionState),null);
 insert();s=s.update({changes:{from:0,to:1,insert:"aa"},selection:{anchor:2},userEvent:"input.type"}).state;endSnippet(view as any);
 s=s.update({changes:{from:0,insert:"x"},selection:{anchor:1},userEvent:"input.type"}).state;
 assert.equal(s.field(snippetSessionState),null,"later edits discard dormant transform authority");
 assert.equal(s.doc.toString(),"xaa b","no hidden transform rewrite follows new user editing");
});

test("nested navigation edits every child and parent mirror in one undo event",()=>{
 let s=start(S+"{1:a"+S+"{2:b}c} / "+S+"1 / "+S+"2");
 const view={get state(){return s;},composing:false,dispatch:(spec:any)=>{s=s.update(spec).state;}};
 assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),"abc");
 assert.equal(moveSnippetField(view as any,1),true);
 const range=s.selection.main;
 assert.equal(s.sliceDoc(range.from,range.to),"b");
 s=s.update({changes:{from:range.from,to:range.to,insert:"LONG"},selection:{anchor:range.from+4},userEvent:"input.type"}).state;
 assert.equal(s.doc.toString(),"aLONGc / aLONGc / LONG");
 assert.equal(s.field(snippetSessionState)!.nested,true);
 const target=()=>({state:s,dispatch:(tr:any)=>{s=tr.state;}});
 assert.equal(undo(target() as any),true);assert.equal(s.doc.toString(),"abc / abc / b");assert.equal(s.field(snippetSessionState),null);
 assert.equal(redo(target() as any),true);assert.equal(s.doc.toString(),"aLONGc / aLONGc / LONG");assert.equal(s.field(snippetSessionState),null);
});
test("replacing a nested parent preserves navigation to the external child survivor",()=>{
 let s=start(S+"{1:a"+S+"{2:b}c} / "+S+"1 / "+S+"2");
 const range=s.selection.main;
 s=s.update({changes:{from:range.from,to:range.to,insert:"Z"},selection:{anchor:1},userEvent:"input.type"}).state;
 assert.equal(s.doc.toString(),"Z / Z / b");
 const view={get state(){return s;},composing:false,dispatch:(spec:any)=>{s=s.update(spec).state;}};
 assert.equal(moveSnippetField(view as any,1),true);assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),"b");
 const child=s.selection.main;
 s=s.update({changes:{from:child.from,to:child.to,insert:"Q"},selection:{anchor:child.from+1},userEvent:"input.type"}).state;
 assert.equal(s.doc.toString(),"Z / Z / Q");
 assert.equal(moveSnippetField(view as any,1),true);assert.equal(s.field(snippetSessionState),null);
});
test("nested activation with imports is atomic and boundary crossing retains only original edit",()=>{
 let s=EditorState.create({doc:"token",extensions:[history(),snippetSession]});
 const spec=snippetInsertion(s,prepareSnippet(S+"{1:a"+S+"{2:b}c} / "+S+"1"),0,5,[{from:0,to:0,insert:"import\n"}]);assert.ok(spec);
 s=s.update(spec).state;assert.equal(s.doc.toString(),"import\nabc / abc");
 const r=s.selection.main;
 s=s.update({changes:{from:r.from,to:r.from+2,insert:"!"},selection:{anchor:r.from+1},userEvent:"input.type"}).state;
 assert.equal(s.doc.toString(),"import\n!c / abc");assert.equal(s.field(snippetSessionState),null);
});
test("nested cursor selection chooses the innermost editable occurrence",()=>{
 let s=start(S+"{1:a"+S+"{2:bc}d} / "+S+"1");
 s=s.update({selection:{anchor:2}}).state;
 const session=s.field(snippetSessionState)!;assert.equal(session.fields.find(f=>f.id===session.active)!.group,"t:2");
 s=s.update({changes:{from:2,insert:"!"},selection:{anchor:3},userEvent:"input.type"}).state;
 assert.equal(s.doc.toString(),"ab!cd / ab!cd");
});
test("nested derived sessions remain refused after worker evaluation",()=>{
 const s=EditorState.create({extensions:[snippetSession]}),source=S+"{1:a"+S+"{2:b}} "+S+"{2/b/B/}";
 const prepared=evaluateSnippetTransforms(prepareSnippet(source));
 assert.equal(snippetInsertion(s,prepared,0,0),null);
});

test("nested explicit choice overflow leaves document and session untouched",()=>{
 let s=start(S+"{1:"+S+"{2|x,"+"q".repeat(40000)+"|}-"+S+"2} / "+S+"1");
 const view={get state(){return s;},composing:false,dispatch:(spec:any)=>{s=spec.state??s.update(spec).state;}};
 moveSnippetField(view as any,1);
 const before=s,owner=s.field(snippetSessionState)!.owner;
 assert.equal(chooseSnippetValue(view as any,1,false),false);
 assert.equal(s,before);assert.equal(s.doc.toString(),"x-x / x-x");assert.equal(s.field(snippetSessionState)!.owner,owner);
});
