
import test from "node:test";
import assert from "node:assert/strict";
import {EditorState} from "@codemirror/state";
import {snippetVariables} from "../src/snippet-context.ts";
import {prepareSnippet} from "../src/snippet-prepare.ts";
import {evaluateSnippetTransforms} from "../src/snippet-transform.worker-core.ts";
const D="$";
test("captures bounded document values with zero and one based line numbers",()=>{
 const state=EditorState.create({doc:"first\nlet value = 1;",selection:{anchor:10,head:15}});
 const v=snippetVariables(state,12,"file:///work/solution.rs");
 assert.deepEqual(v.TM_CURRENT_LINE,{kind:"value",value:"let value = 1;"});
 assert.deepEqual(v.TM_CURRENT_WORD,{kind:"value",value:"value"});
 assert.deepEqual(v.TM_SELECTED_TEXT,{kind:"value",value:"value"});
 assert.deepEqual(v.TM_LINE_INDEX,{kind:"value",value:"1"});assert.deepEqual(v.TM_LINE_NUMBER,{kind:"value",value:"2"});
 assert.deepEqual(v.TM_FILENAME,{kind:"value",value:"solution.rs"});assert.deepEqual(v.TM_FILENAME_BASE,{kind:"value",value:"solution"});
 assert.deepEqual(v.TM_DIRECTORY,{kind:"value",value:"/work"});assert.deepEqual(v.TM_FILEPATH,{kind:"value",value:"/work/solution.rs"});
});
test("empty selection and missing path are unset while an empty line is a value",()=>{
 const v=snippetVariables(EditorState.create(),0);
 assert.deepEqual(v.TM_SELECTED_TEXT,{kind:"unset"});assert.deepEqual(v.TM_CURRENT_WORD,{kind:"unset"});
 assert.deepEqual(v.TM_CURRENT_LINE,{kind:"value",value:""});assert.deepEqual(v.TM_FILEPATH,{kind:"unset"});
 assert.equal(prepareSnippet(D+"{TM_SELECTED_TEXT:fallback}:"+D+"{TM_CURRENT_LINE:fallback}",v).text,"fallback:");
});
test("variable values remain literal and are never parsed as snippet source",()=>{
 const state=EditorState.create({doc:D+"1",selection:{anchor:0,head:2}}),v=snippetVariables(state,2,"file:///work/%24%7B2%3Ax%7D.rs");
 const r=prepareSnippet(D+"TM_SELECTED_TEXT "+D+"TM_FILENAME",v);
 assert.equal(r.text,D+"1 "+D+"{2:x}.rs");assert.equal(r.fields.length,0);
});
test("file URI context handles encoded Unicode Windows UNC roots and dotfiles",()=>{
 const s=EditorState.create();
 for(const [uri,path,base,dir] of [
  ["file:///work/%E4%B8%AD%E6%96%87.rs","/work/中文.rs","中文","/work"],
  ["file:///C:/work/solution.rs","C:\\work\\solution.rs","solution","C:\\work"],
  ["file:///C:/solution.rs","C:\\solution.rs","solution","C:\\"],
  ["file://server/share/solution.rs","\\\\server\\share\\solution.rs","solution","\\\\server\\share"],
  ["file://localhost/.gitignore","/.gitignore",".gitignore","/"]
 ]){
  const v=snippetVariables(s,0,uri);assert.deepEqual(v.TM_FILEPATH,{kind:"value",value:path});assert.deepEqual(v.TM_FILENAME_BASE,{kind:"value",value:base});assert.deepEqual(v.TM_DIRECTORY,{kind:"value",value:dir});
 }
 for(const uri of ["https://example.com/code.rs","file:///bad%ZZ","file:///secret%00.rs","file:///work/code.rs?secret=x","not-a-uri"]){
  assert.deepEqual(snippetVariables(s,0,uri).TM_FILEPATH,{kind:"unset"});
 }
});
test("context limits refuse rather than silently truncate variable contents",()=>{
 const state=EditorState.create({doc:"x".repeat(65537)});
 assert.throws(()=>snippetVariables(state,1),/context limit/);
 assert.throws(()=>snippetVariables(EditorState.create(),1),/Invalid snippet context/);
 assert.throws(()=>snippetVariables(EditorState.create(),0,"x".repeat(65537)),/URI limit/);
});
test("unresolved transformed variable evaluates empty input without creating a placeholder",()=>{
 const source=D+"{UNKNOWN/^$/fallback/}",prepared=prepareSnippet(source);
 assert.equal(prepared.transforms[0].sourceValue,"");assert.equal(prepared.fields[0].derived,true);
 const result=evaluateSnippetTransforms(prepared);assert.equal(result.text,"fallback");
 assert.deepEqual(result.navigation,[]);
 assert.equal(prepareSnippet(D+"UNKNOWN").text,"UNKNOWN","plain unknown variables stay editable");
});
