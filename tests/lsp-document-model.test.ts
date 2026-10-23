import test from "node:test";
import assert from "node:assert/strict";
import {documentationParts,documentationModel,activeParameterSpan,completionKind} from "../src/lsp-document-model.ts";
test("documentation preserves plaintext vs markdown and legacy code semantics",()=>{
 assert.deepEqual(documentationParts("**literal**"),[{kind:"plaintext",text:"**literal**"}]);
 assert.deepEqual(documentationParts({kind:"markdown",value:"**bold**"}),[{kind:"markdown",text:"**bold**"}]);
 assert.deepEqual(documentationParts([{language:"rust",value:"Vec<T>"},{kind:"plaintext",value:"<tag>"}],true),[{kind:"code",text:"Vec<T>",language:"rust"},{kind:"plaintext",text:"<tag>"}]);
 assert.deepEqual(documentationParts({value:42}),[]);
});
test("documentation bounds total UTF16 input and number of blocks",()=>{
 assert.equal(documentationParts(Array(30).fill("a")).length,20);
 assert.equal(documentationParts(["a".repeat(32760),"b".repeat(100),"c"]).reduce((n,p)=>n+p.text.length,0),32768);
});
test("active parameter prefers exact UTF16 offsets and refuses invalid or ambiguous spans",()=>{
 const label="f(😀, value: i32)";
 assert.deepEqual(activeParameterSpan(label,{label:[6,16]}),{from:6,to:16});
 assert.equal(activeParameterSpan(label,{label:[3,4]}),null);
 assert.equal(activeParameterSpan(label,{label:[0,999]}),null);
 assert.equal(activeParameterSpan("f(a, a)",{label:"a"}),null);
 assert.deepEqual(activeParameterSpan(label,{label:"value: i32"}),{from:6,to:16});
 assert.equal(activeParameterSpan(label,{label:[2,2]}),null);
});
test("semantic kinds preserve constructor interface struct and fall back safely",()=>{
 assert.equal(completionKind(4),"constructor");assert.equal(completionKind(8),"interface");assert.equal(completionKind(22),"struct");assert.equal(completionKind("<script>"),"text");
});

test("preview reports omitted content while expanded reading retains it within bounded limits",()=>{
 const value={kind:"plaintext",value:"x".repeat(40000)+"TAIL"};
 const preview=documentationModel(value),expanded=documentationModel(value,false,true);
 assert.equal(preview.truncated,true);assert.equal(preview.parts[0].text.length,32768);
 assert.equal(expanded.truncated,false);assert.ok(expanded.parts[0].text.endsWith("TAIL"));
 assert.equal(documentationModel({kind:"plaintext",value:"x".repeat(300000)},false,true).truncated,true);
 assert.equal(documentationModel(Array(21).fill("x")).truncated,true);
 assert.equal(documentationModel(Array(21).fill("x"),false,true).truncated,false);
});
test("documentation limits never leave a split surrogate pair",()=>{
 const result=documentationModel({kind:"plaintext",value:"a".repeat(32767)+"😀"});
 assert.equal(result.truncated,true);assert.equal(result.parts[0].text,"a".repeat(32767));
});
