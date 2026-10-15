
import test from "node:test";
import assert from "node:assert/strict";
import {EditorState} from "@codemirror/state";
import {completionApplication,completionTextChanges,plainCompletionChanges} from "../src/completion-application.ts";
const doc=EditorState.create({doc:"HashM"}).doc;
const span={start:{line:0,character:0},end:{line:0,character:5}};
test("snippet admission retains syntax without treating imports as snippet text",()=>{
 const item={label:"HashMap",insertTextFormat:2,textEdit:{range:span,newText:"HashMap("+String.fromCharCode(36)+"{1:value})"},additionalTextEdits:[{range:{start:{line:0,character:0},end:{line:0,character:0}},newText:"use x;\r\n"}]};
 const application=completionApplication(doc,item,0,5);assert.ok(application);
 assert.equal(application.format,2);assert.equal(application.mode,1);assert.equal(application.additional[0].insert,"use x;\n");
 assert.equal(plainCompletionChanges(doc,item,0,5),null,"snippet syntax never takes the plain-text path");
});
test("plain CRLF edits use logical offsets and import-before-primary ordering",()=>{
 const item={label:"HashMap",textEdit:{range:span,newText:"a\r\nb"},additionalTextEdits:[{range:{start:{line:0,character:0},end:{line:0,character:0}},newText:"use x;\r\n"}]};
 const result=plainCompletionChanges(doc,item,0,5)!;assert.ok(result);
 const state=EditorState.create({doc:"HashM"}).update({changes:result.changes,selection:{anchor:result.anchor}}).state;
 assert.equal(state.doc.toString(),"use x;\na\nb");assert.equal(state.selection.main.head,state.doc.length);
});
test("unknown modes formats overlaps and duplicate empty edits refuse atomically",()=>{
 for(const item of [
  {label:"x",insertTextFormat:3},{label:"x",insertTextMode:3},{label:"x",insertTextFormat:null},{label:"x",insertTextMode:null},{label:"x",textEdit:"bad"},{label:"x",textEdit:{range:span}},
  {label:"x",additionalTextEdits:[{range:span,newText:"bad"}]},
  {label:"x",additionalTextEdits:[{range:{start:{line:0,character:0},end:{line:0,character:0}},newText:"a"},{range:{start:{line:0,character:0},end:{line:0,character:0}},newText:"b"}]}
 ])assert.equal(completionApplication(doc,item,0,5),null);
 assert.equal(completionApplication(doc,{label:"x"},-1,5),null);
 assert.equal(completionApplication(doc,{label:"x",insertText:"x".repeat(65537)},0,5),null);
});
test("surrogate split ranges and over-limit edit arrays are rejected before traversal",()=>{
 const unicode=EditorState.create({doc:"😀"}).doc;
 assert.equal(completionApplication(unicode,{label:"x"},1,2),null);
 const additional=new Array(21);Object.defineProperty(additional,Symbol.iterator,{get(){throw Error("Oversized collection traversed");}});
 assert.equal(completionApplication(doc,{label:"x",additionalTextEdits:additional},0,5),null);
});
test("plain mode2 needs explicit layout rather than silently using asIs",()=>{
 const item={label:"x",insertTextMode:2},application=completionApplication(doc,item,0,5)!;
 assert.equal(plainCompletionChanges(doc,item,0,5),null);assert.equal(application.mode,2);
 assert.equal(completionTextChanges(application,"x\n  y")!.anchor,5);
});

test("primary edit contains the request cursor on one line and insert/replace is coherent",()=>{
 const doc=EditorState.create({doc:"abc\ndef"}).doc;
 const r=(a:number,b:number)=>({start:{line:0,character:a},end:{line:0,character:b}});
 assert.equal(completionApplication(doc,{label:"x",textEdit:{range:r(0,1),newText:"x"}},0,3),null);
 assert.equal(completionApplication(doc,{label:"x",textEdit:{range:{start:{line:0,character:0},end:{line:1,character:1}},newText:"x"}},0,3),null);
 assert.ok(completionApplication(doc,{label:"x",textEdit:{insert:r(0,2),replace:r(0,3),newText:"x"}},0,2));
 assert.equal(completionApplication(doc,{label:"x",textEdit:{insert:r(1,2),replace:r(0,3),newText:"x"}},0,2),null);
 assert.equal(completionApplication(doc,{label:"x",textEdit:{insert:r(0,3),replace:r(0,2),newText:"x"}},0,2),null);
 assert.equal(completionApplication(doc,{label:"x",textEdit:{replace:r(0,3),newText:"x"}},0,2),null);
});
test("final expanded plain text and imports share one aggregate insertion budget",()=>{
 const doc=EditorState.create({doc:"abcdefghijklmnopq"}).doc;
 const additionalTextEdits=Array.from({length:16},(_,i)=>({range:{start:{line:0,character:i+1},end:{line:0,character:i+1}},newText:"a".repeat(65000)}));
 const application=completionApplication(doc,{label:"x",additionalTextEdits},0,1);assert.ok(application);
 assert.equal(completionTextChanges(application,"x".repeat(10000)),null);
});
