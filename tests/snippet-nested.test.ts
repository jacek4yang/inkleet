
import test from "node:test";
import assert from "node:assert/strict";
import {EditorState,EditorSelection} from "@codemirror/state";
import {initializeNestedFields,planNestedEdit} from "../src/snippet-nested.ts";
import {prepareSnippet} from "../src/snippet-prepare.ts";
const D="$";
function fixture(source:string){
 const prepared=prepareSnippet(source),state=EditorState.create({doc:prepared.text}),fields=initializeNestedFields(prepared.fields,state.doc);
 assert.ok(fields);return {state,fields};
}
function apply(f:ReturnType<typeof fixture>,id:number,from:number,to:number,insert:string){
 const state=f.state.update({selection:EditorSelection.single(from,to)}).state;
 const tr=state.update({changes:{from,to,insert},selection:{anchor:from+insert.length},userEvent:"input.type"});
 const plan=planNestedEdit(f.fields,id,tr);assert.ok(plan);
 return {state:state.update(tr,{sequential:true,changes:plan.changes,selection:plan.selection}).state,fields:plan.fields};
}
const nested=D+"{1:a"+D+"{2:b}c} / "+D+"1 / "+D+"2";
test("nested child propagation composes child and parent copies",()=>{
 const f=fixture(nested),child=f.fields.find(x=>x.group==="t:2")!;
 const next=apply(f,child.id,child.from,child.to,"LONG");
 assert.equal(next.state.doc.toString(),"aLONGc / aLONGc / LONG");
 assert.equal(next.state.selection.main.head,5);
 assert.deepEqual(next.fields.map(x=>x.id),f.fields.map(x=>x.id));
});
test("later nested child is authoritative through preceding parent replacement",()=>{
 const f=fixture(nested),child=f.fields.filter(x=>x.group==="t:2")[1];
 const next=apply(f,child.id,child.from,child.to,"LONG");
 assert.equal(next.state.doc.toString(),"aLONGc / aLONGc / LONG");
 const source=next.fields.find(x=>x.id===child.id)!;
 assert.equal(next.state.selection.main.head,source.to);
 assert.equal(next.state.doc.sliceString(source.from,source.to),"LONG");
});
test("three levels propagate in child-before-parent order",()=>{
 const f=fixture(D+"{1:A"+D+"{2:B"+D+"{3:C}D}E} / "+D+"1 / "+D+"2 / "+D+"3");
 const child=f.fields.find(x=>x.group==="t:3")!;
 const next=apply(f,child.id,child.from,child.to,"xx");
 assert.equal(next.state.doc.toString(),"ABxxDE / ABxxDE / BxxD / xx");
});
test("whole parent replacement deletes descendants but preserves external child",()=>{
 const f=fixture(nested),parent=f.fields.find(x=>x.group==="t:1")!,external=f.fields.find(x=>x.group==="t:2"&&x.parent===null)!;
 const next=apply(f,parent.id,parent.from,parent.to,"Z");
 assert.equal(next.state.doc.toString(),"Z / Z / b");
 assert.deepEqual(next.fields.filter(x=>x.group==="t:2").map(x=>x.id),[external.id]);
 const remaining=next.fields.find(x=>x.id===external.id)!;
 const again=apply(next,external.id,remaining.from,remaining.to,"Q");
 assert.equal(again.state.doc.toString(),"Z / Z / Q");
});
test("parent literal insertion preserves child identities and immutable paths",()=>{
 const f=fixture(nested),parent=f.fields.find(x=>x.group==="t:1")!;
 const next=apply(f,parent.id,parent.from,parent.from,"!");
 assert.equal(next.state.doc.toString(),"!abc / !abc / b");
 assert.deepEqual(next.fields.map(x=>[x.id,x.originPath]),f.fields.map(x=>[x.id,x.originPath]));
});
test("partial child crossing returns no mirror plan",()=>{
 const f=fixture(nested),parent=f.fields.find(x=>x.group==="t:1")!;
 const state=f.state.update({selection:{anchor:0,head:2}}).state;
 const tr=state.update({changes:{from:0,to:2,insert:"!"},selection:{anchor:1},userEvent:"input.type"});
 assert.equal(planNestedEdit(f.fields,parent.id,tr),null);
 assert.equal(tr.newDoc.toString(),"!c / abc / b");
});
test("cumulative copy budget failure never returns a partial staged plan",()=>{
 const f=fixture(nested),child=f.fields.find(x=>x.group==="t:2")!;
 const state=f.state.update({selection:{anchor:child.from,head:child.to}}).state;
 const tr=state.update({changes:{from:child.from,to:child.to,insert:"LONG"},selection:{anchor:child.from+4},userEvent:"input.type"});
 assert.equal(planNestedEdit(f.fields,child.id,tr,{copies:15}),null);
 assert.equal(tr.newDoc.toString(),"aLONGc / abc / b");
 assert.equal(planNestedEdit(f.fields,child.id,tr,{operations:1}),null);
});
test("same-range parent and child retain source caret ownership",()=>{
 const f=fixture(D+"{1:"+D+"{2:x}} / "+D+"1"),child=f.fields.find(x=>x.group==="t:2")!;
 const next=apply(f,child.id,child.from,child.to,"zz");
 assert.equal(next.state.doc.toString(),"zz / zz");assert.equal(next.state.selection.main.head,2);
});
test("empty nested source preceding and following mirrors is mapped by identity",()=>{
 for(const later of [false,true]){
  const f=fixture(D+"{1:A"+D+"{2:}B} / "+D+"1"),children=f.fields.filter(x=>x.group==="t:2"),child=children[later?1:0];
  const next=apply(f,child.id,child.from,child.to,"x");
  assert.equal(next.state.doc.toString(),"AxB / AxB");assert.equal(next.state.selection.main.head,next.fields.find(x=>x.id===child.id)!.to);
 }
});
test("nonisomorphic duplicate groups and dependency cycles are refused",()=>{
 const prepared=prepareSnippet(nested),state=EditorState.create({doc:prepared.text});
 const mismatch=prepared.fields.map(x=>({...x}));mismatch.find(x=>x.parent!==null)!.group="different";
 assert.equal(initializeNestedFields(mismatch,state.doc),null);
 const cycle=prepared.fields.map(x=>({...x}));cycle.find(x=>x.parent!==null)!.group="t:1";
 assert.equal(initializeNestedFields(cycle,state.doc),null);
 const derived=prepared.fields.map(x=>({...x}));derived[0].derived=true;
 assert.equal(initializeNestedFields(derived,state.doc),null);
});

test("ancestor boundaries do not absorb external empty mirror insertions",()=>{
 for(const [source,expected,later] of [
  [D+"{1:"+D+"{2:}A}"+D+"1"+D+"2","xAxAx",false],
  [D+"2"+D+"{1:A"+D+"{2:}}"+D+"1","xAxAx",true]
 ]){
  const f=fixture(source as string),children=f.fields.filter(x=>x.group==="t:2"&&x.parent!==null),child=children[later?children.length-1:0];
  const next=apply(f,child.id,child.from,child.to,"x");
  assert.equal(next.state.doc.toString(),expected);
  for(const parent of next.fields.filter(x=>x.group==="t:1"))assert.equal(next.state.doc.sliceString(parent.from,parent.to),later?"Ax":"xA");
  assert.equal(next.state.selection.main.head,next.fields.find(x=>x.id===child.id)!.to);
 }
});
test("repeated children keep all four mirrors and occurrence paths",()=>{
 const f=fixture(D+"{1:"+D+"{2:x}-"+D+"{2:x}} / "+D+"1"),child=f.fields.filter(x=>x.group==="t:2").at(-1)!;
 const next=apply(f,child.id,child.from,child.to,"Q");
 assert.equal(next.state.doc.toString(),"Q-Q / Q-Q");
 assert.deepEqual(next.fields.map(x=>[x.id,x.originPath]),f.fields.map(x=>[x.id,x.originPath]));
});

test("coincident same-group empty activation stays explicitly unsupported",()=>{
 const prepared=prepareSnippet(D+"2"+D+"{1:"+D+"{2:}A}"+D+"1"),state=EditorState.create({doc:prepared.text});
 assert.equal(initializeNestedFields(prepared.fields,state.doc),null);
});
