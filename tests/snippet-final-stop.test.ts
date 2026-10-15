
import test from "node:test";
import assert from "node:assert/strict";
import {EditorState} from "@codemirror/state";
import {snippetSession,snippetSessionState,snippetInsertion,moveSnippetField,snippetTransformSnapshot,snippetTransformCommit} from "../src/snippet-session.ts";
import {prepareSnippet} from "../src/snippet-prepare.ts";
import {evaluateSnippetTransforms} from "../src/snippet-transform.worker-core.ts";
const D="$";
test("final-only default text is selected while snippet navigation ends",()=>{
 let s=EditorState.create({extensions:[snippetSession]});
 s=s.update(snippetInsertion(s,prepareSnippet("call("+D+"{0:pass})"),0,0)!).state;
 assert.equal(s.doc.toString(),"call(pass)");assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),"pass");
 assert.equal(s.field(snippetSessionState),null);
 s=s.update({changes:{from:s.selection.main.from,to:s.selection.main.to,insert:"value"},userEvent:"input.type"}).state;
 assert.equal(s.doc.toString(),"call(value)");
});
test("Tab selects a nonempty final default and still ends ownership",()=>{
 let s=EditorState.create({extensions:[snippetSession]});
 s=s.update(snippetInsertion(s,prepareSnippet(D+"{1:value} "+D+"{0:tail}"),0,0)!).state;
 const view={get state(){return s;},composing:false,dispatch:(spec:any)=>{s=s.update(spec).state;}};
 assert.equal(moveSnippetField(view as any,1),true);
 assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),"tail");assert.equal(s.field(snippetSessionState),null);
});
test("transform settlement preserves final default selection",()=>{
 let s=EditorState.create({extensions:[snippetSession]});
 s=s.update(snippetInsertion(s,evaluateSnippetTransforms(prepareSnippet(D+"{1:a} "+D+"{1/a/A/} "+D+"{0:tail}")),0,0)!).state;
 s=s.update({changes:{from:0,to:1,insert:"aa"},selection:{anchor:2},userEvent:"input.type"}).state;
 const current=s.field(snippetSessionState)!;
 s=s.update(snippetTransformCommit(s,current.owner,current.revision,evaluateSnippetTransforms(snippetTransformSnapshot(s)!),1)!).state;
 assert.equal(s.doc.toString(),"aa Aa tail");assert.equal(s.sliceDoc(s.selection.main.from,s.selection.main.to),"tail");assert.equal(s.field(snippetSessionState),null);
});
