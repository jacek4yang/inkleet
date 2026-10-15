
import test from "node:test";
import assert from "node:assert/strict";
import {EditorState} from "@codemirror/state";
import {history,undo,redo} from "@codemirror/commands";
import {prepareSnippet} from "../src/snippet-prepare.ts";
import {evaluateSnippetTransforms} from "../src/snippet-transform.worker-core.ts";
import {snippetSession,snippetSessionState,snippetInsertion,moveSnippetField,snippetTransformSnapshot,snippetTransformCommit} from "../src/snippet-session.ts";
import {encodeSnippetSnapshot,restoreSnippetFields} from "../src/snippet-transform-identity.ts";
const D="$";
function start(source:string,variables={}){
 let state=EditorState.create({extensions:[history(),snippetSession]});
 const prepared=evaluateSnippetTransforms(prepareSnippet(source,variables)),spec=snippetInsertion(state,prepared,0,0);assert.ok(spec);
 return state.update(spec).state;
}
function navigate(state:EditorState,direction:1|-1){
 const view={get state(){return state;},composing:false,dispatch:(spec:any)=>{state=state.update(spec).state;}};
 assert.equal(moveSnippetField(view as any,direction),true);return state;
}
function edit(state:EditorState,insert:string){
 const r=state.selection.main;return state.update({changes:{from:r.from,to:r.to,insert},selection:{anchor:r.from+insert.length},userEvent:"input.type"}).state;
}
function settle(state:EditorState,direction:1|-1|0=0){
 const session=state.field(snippetSessionState)!,snapshot=snippetTransformSnapshot(state);assert.ok(snapshot);
 const result=evaluateSnippetTransforms(snapshot),spec=snippetTransformCommit(state,session.owner,session.revision,result,direction);assert.ok(spec);
 return state.update(spec).state;
}
test("nested child and ancestor transforms settle without losing live paths",()=>{
 const upper=D+"{1:/upcase}";
 let s=start(D+"{1:a"+D+"{2:b}-"+D+"{2/(.*)/"+upper+"/}} / "+D+"1 / "+D+"{1/(.*)/"+upper+"/}");
 assert.equal(s.doc.toString(),"ab-B / ab-B / AB-B");
 const paths=s.field(snippetSessionState)!.fields.map(f=>[f.id,(f as any).originPath]);
 s=navigate(s,1);s=edit(s,"bee");assert.equal(s.doc.toString(),"abee-B / abee-B / AB-B");
 s=settle(s);assert.equal(s.doc.toString(),"abee-BEE / abee-BEE / ABEE-BEE");
 assert.deepEqual(s.field(snippetSessionState)!.fields.map(f=>[f.id,(f as any).originPath]),paths);
 const f=s.field(snippetSessionState)!.fields.find(f=>f.id===s.field(snippetSessionState)!.active)!;
 s=s.update({selection:{anchor:f.from,head:f.to}}).state;s=edit(s,"c");s=settle(s);
 assert.equal(s.doc.toString(),"ac-C / ac-C / AC-C");
 const target={get state(){return s;},dispatch:(tr:any)=>{s=tr.state;}};
 assert.equal(undo(target as any),true);assert.equal(s.doc.toString(),"ac-BEE / ac-BEE / ABEE-BEE");assert.equal(s.field(snippetSessionState),null);
 assert.equal(redo(target as any),true);assert.equal(s.doc.toString(),"ac-C / ac-C / AC-C");assert.equal(s.field(snippetSessionState),null);
});
test("cloned parents accept equivalent frozen variable transforms with unique groups",()=>{
 let s=start(D+"{1:a"+D+"{FILE/(.*)/"+D+"{1:/upcase}/}} / "+D+"1 / "+D+"{2:z}",{FILE:{kind:"value",value:"x"}});
 assert.equal(s.doc.toString(),"aX / aX / z");
 const derived=s.field(snippetSessionState)!.fields.filter(f=>f.derived);assert.equal(derived.length,2);assert.notEqual(derived[0].group,derived[1].group);
 s=s.update({selection:{anchor:0}}).state;s=s.update({changes:{from:0,insert:"!"},selection:{anchor:1},userEvent:"input.type"}).state;
 assert.equal(s.doc.toString(),"!aX / !aX / z");s=settle(s);assert.equal(s.doc.toString(),"!aX / !aX / z");
});
test("pruned sparse live IDs round-trip through dense worker identities",()=>{
 let s=start(D+"{1:a"+D+"{2:b}-"+D+"{2/(.*)/"+D+"{1:/upcase}/}} / "+D+"{3:x} / "+D+"{3/(.*)/"+D+"{1:/upcase}/} "+D+"0");
 s=edit(s,"Z");const ids=s.field(snippetSessionState)!.fields.map(f=>f.id);assert.ok(ids.some((id,i)=>id!==i));
 s=settle(s);assert.deepEqual(s.field(snippetSessionState)!.fields.map(f=>f.id),ids);
 s=navigate(s,1);s=edit(s,"yz");s=settle(s);assert.equal(s.doc.toString(),"Z / yz / YZ ");
 assert.deepEqual(s.field(snippetSessionState)!.fields.map(f=>f.id),ids);
});
test("lost editable sources retire ownership while external survivors retain it",()=>{
 let s=start(D+"{1:"+D+"{2:b}} / "+D+"{2/(.*)/"+D+"{1:/upcase}/} "+D+"0");
 s=edit(s,"Z");assert.equal(s.doc.toString(),"Z / B ");assert.equal(s.field(snippetSessionState)!.transforms.length,0);assert.equal(snippetTransformSnapshot(s),null);
 s=start(D+"{1:"+D+"{2:b}} / "+D+"2 / "+D+"{2/(.*)/"+D+"{1:/upcase}/} "+D+"0");
 s=edit(s,"Z");s=settle(s);s=navigate(s,1);s=edit(s,"q");s=settle(s);assert.equal(s.doc.toString(),"Z / q / Q ");
});
test("coincident empty derived outputs retain individual source-order ranges",()=>{
 let s=start(D+"{1:b} "+D+"{1/^(a)?b$/"+D+"{1:+A}/}"+D+"{1/^(a)?b$/"+D+"{1:+BC}/}"+D+"0");
 assert.equal(s.doc.toString(),"b ");s=edit(s,"ab");s=settle(s);assert.equal(s.doc.toString(),"ab ABC");
 const ranges=s.field(snippetSessionState)!.fields.filter(f=>f.derived).map(f=>[f.from,f.to]);
 assert.deepEqual(ranges,[[3,4],[4,6]]);
});
test("save settlement maps reversed parent endpoints around growing derived children",()=>{
 let s=start(D+"{1:"+D+"{2:a}-"+D+"{2/a/long/}} / "+D+"1 "+D+"0");
 s=navigate(s,1);s=edit(s,"aa");
 const parent=s.field(snippetSessionState)!.fields.find(f=>f.group==="t:1"&&!f.derived)!;
 s=s.update({selection:{anchor:parent.to,head:parent.from}}).state;
 assert.equal(s.field(snippetSessionState)!.fields.find(f=>f.id===s.field(snippetSessionState)!.active)!.group,"t:1");
 s=settle(s);assert.equal(s.doc.toString(),"aa-longa / aa-longa ");
 assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),"aa-longa");assert.ok(s.selection.main.anchor>s.selection.main.head);
});
test("dense restoration rejects identity corruption and preserves original metadata",()=>{
 const prepared=prepareSnippet(D+"{1:a"+D+"{2:b}}");
 const fields=prepared.fields.map(f=>({...f,id:f.id+10,parent:f.parent===null?null:f.parent+10,custom:"kept"}));
 const encoded=encodeSnippetSnapshot(prepared.text,fields,prepared.navigation,[]);
 const restored=restoreSnippetFields(encoded.prepared,fields,encoded.wireToStable);assert.ok(restored);
 assert.deepEqual(restored.map(f=>f.id),fields.map(f=>f.id));assert.ok(restored.every(f=>f.custom==="kept"));
 assert.equal(restoreSnippetFields(encoded.prepared,fields,encoded.wireToStable.map(()=>10)),null);
 assert.throws(()=>encodeSnippetSnapshot(prepared.text,[...fields,fields[0]],prepared.navigation,[]),/identity/);
});

test("unchanged empty derived siblings retain their own side of changed insertions",()=>{
 for(const firstChanges of [true,false]){
  const a=firstChanges?"A":"",b=firstChanges?"":"BC";
  let s=start(D+"{1:b} "+D+"{1/^(a)?b$/"+D+"{1:+"+a+"}/}"+D+"{1/^(a)?b$/"+D+"{1:+"+b+"}/}"+D+"0");
  s=edit(s,"ab");s=settle(s);
  assert.equal(s.doc.toString(),"ab "+a+b);
  assert.deepEqual(s.field(snippetSessionState)!.fields.filter(f=>f.derived).map(f=>[f.from,f.to]),firstChanges?[[3,4],[4,4]]:[[3,3],[3,5]]);
 }
});
test("forged equal-text ranges and reordered navigation cannot acquire ownership",()=>{
 let s=start(D+"{1:a} "+D+"{1/a/aa/} "+D+"{2:a}"+D+"0");s=edit(s,"aa");
 const session=s.field(snippetSessionState)!,result=evaluateSnippetTransforms(snippetTransformSnapshot(s)!);
 assert.equal(result.text,"aa aaa a");
 const forged=structuredClone(result),field=forged.fields.find(f=>f.group==="t:2")!;field.from=3;field.to=4;
 assert.equal(snippetTransformCommit(s,session.owner,session.revision,forged,0),null);
 const reordered=structuredClone(result);reordered.navigation.reverse();
 assert.equal(snippetTransformCommit(s,session.owner,session.revision,reordered,0),null);
});
