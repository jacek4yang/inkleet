
import test from "node:test";
import assert from "node:assert/strict";
import {EditorState} from "@codemirror/state";
import {history,undo} from "@codemirror/commands";
import {prepareSnippet} from "../src/snippet-prepare.ts";
import {normalizeSnippetEol} from "../src/snippet-layout.ts";
import {evaluateSnippetTransforms} from "../src/snippet-transform.worker-core.ts";
import {snippetInsertion,snippetSession,snippetSessionState,moveSnippetField,chooseSnippetValue} from "../src/snippet-session.ts";
const D="$";
test("LF CRLF and CR produce identical logical offsets and preserve indentation",()=>{
 for(const eol of ["\n","\r\n","\r"]){
  const prepared=prepareSnippet("start"+eol+"  "+D+"{1:中文😀"+eol+"    next}"+eol+D+"1"+D+"0"),r=normalizeSnippetEol(prepared);
  assert.equal(r.text,"start\n  中文😀\n    next\n中文😀\n    next");
  for(const f of r.fields.filter(f=>f.group==="t:1"))assert.equal(r.text.slice(f.from,f.to),"中文😀\n    next");
  assert.equal(r.fields.find(f=>f.final)!.from,r.text.length);
  assert.deepEqual(normalizeSnippetEol(r),r,"normalization is idempotent");
 }
});
test("multiline choices and zero stops map to the same logical document",()=>{
 const r=normalizeSnippetEol(prepareSnippet(D+"{1|a\r\nb,c\rd|}\r\n"+D+"2"+D+"0"));
 assert.equal(r.text,"a\nb\n");assert.deepEqual(r.fields[0].choices,["a\nb","c\nd"]);
 assert.equal(r.fields.find(f=>f.group==="t:2")!.from,4);
 let s=EditorState.create({extensions:[snippetSession]});s=s.update(snippetInsertion(s,r,0,0)!).state;
 const view={get state(){return s;},composing:false,dispatch:(spec:any)=>{s=spec.state??s.update(spec).state;}};
 assert.equal(chooseSnippetValue(view as any,1,true),true);assert.equal(s.doc.toString(),"c\nd\n");assert.equal(s.selection.main.head,4);
});
test("CRLF imports and primary snippet are one undoable correctly positioned insertion",()=>{
 let s=EditorState.create({doc:"token",extensions:[history(),snippetSession]});
 const prepared=prepareSnippet(D+"{1:a\r\nb} = "+D+"1"+D+"0");
 const spec=snippetInsertion(s,prepared,0,5,[{from:0,to:0,insert:"use x;\r\n"}]);assert.ok(spec);
 s=s.update(spec).state;assert.equal(s.doc.toString(),"use x;\na\nb = a\nb");
 assert.equal(s.selection.main.from,7);assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),"a\nb");
 assert.equal(s.field(snippetSessionState)!.to,s.doc.length);
 const target={get state(){return s;},dispatch:(tr:any)=>{s=tr.state;}};
 assert.equal(undo(target as any),true);assert.equal(s.doc.toString(),"token");
});
test("transform output CRLF is normalized before mapping later field positions",()=>{
 const source=D+"{1:a} "+D+"{1/a/x\r\ny/} "+D+"{2:tail}"+D+"0";
 const r=evaluateSnippetTransforms(prepareSnippet(source));
 assert.equal(r.text,"a x\ny tail");assert.equal(r.text.slice(r.fields.find(f=>f.group==="t:2")!.from,r.fields.find(f=>f.group==="t:2")!.to),"tail");
 let s=EditorState.create({extensions:[snippetSession]});s=s.update(snippetInsertion(s,r,0,0)!).state;
 const view={get state(){return s;},composing:false,dispatch:(spec:any)=>{s=s.update(spec).state;}};
 moveSnippetField(view as any,1);assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),"tail");
});
test("multiline variable values stay literal after logical EOL mapping",()=>{
 const r=normalizeSnippetEol(prepareSnippet(D+"VALUE "+D+"{1:end}"+D+"0",{VALUE:{kind:"value",value:D+"2\r\ntext"}}));
 assert.equal(r.text,D+"2\ntext end");assert.equal(r.text.slice(r.fields[0].from,r.fields[0].to),"end");
});

test("oversized additional edit arrays refuse before cloning or reading entries",()=>{
 const state=EditorState.create(),additional=new Array(21);
 Object.defineProperty(additional,"map",{get(){throw Error("Oversized collection was traversed");}});
 assert.equal(snippetInsertion(state,prepareSnippet(D+"{1:x}"),0,0,additional),null);
});
test("normalizing imports never mutates caller-owned additional edits",()=>{
 const state=EditorState.create({doc:"token"}),additional=[{from:0,to:0,insert:"use x;\r\n"}];
 assert.ok(snippetInsertion(state,prepareSnippet(D+"{1:x}"),0,5,additional));
 assert.equal(additional[0].insert,"use x;\r\n");
});
