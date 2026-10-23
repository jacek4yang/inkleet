import test from "node:test";
import assert from "node:assert/strict";
import {appendExampleCases,validateCases,type LocalCase} from "../src/test-cases.ts";
test("append preserves custom case identity and expectations and is idempotent",()=>{
 const cases:LocalCase[]=[{id:"imported-example-1",name:"我的用例",input:"[9]\n2",expectation:{mode:"exact-json",target:{kind:"return"},value:"7"}}];
 const result=appendExampleCases(cases,"","[1]\n3\n[1]\n3",["a","b"]);
 assert.equal(result.added,1);assert.equal(result.cases[0],cases[0]);assert.equal(result.cases[1].id,"imported-example-2");assert.equal(result.cases[1].expectation,undefined);
 assert.equal(appendExampleCases(result.cases,"","[1]\n3",["a","b"]).cases,result.cases);
});
test("normalization never rounds huge integers or changes quoted spaces",()=>{
 const cases=[{id:"x",name:"x",input:'[9007199254740993, "a b"]\r\n9'}];
 assert.equal(appendExampleCases(cases,"",'[9007199254740993,"a b"]\n9',["a","b"]).added,0);
 assert.equal(appendExampleCases(cases,"",'[9007199254740992,"a b"]\n9',["a","b"]).added,1);
});
test("empty official input does not fabricate a case; over-limit imports are atomic",()=>{
 const cases=[{id:"x",name:"x",input:"0"}];
 assert.equal(appendExampleCases(cases," ","",[]).cases,cases);
 const full=Array.from({length:64},(_,i)=>({id:String(i),name:"x",input:String(i)}));
 assert.throws(()=>appendExampleCases(full,"100","",["x"]),/超过/);assert.equal(full.length,64);
 const large=[{id:"x",name:"x",input:"a".repeat(2*1024*1024)}];
 assert.throws(()=>appendExampleCases(large,"1","",["x"]),/超过/);assert.equal(large.length,1);
});

test("persistence reload and custom expected output do not duplicate matching examples",()=>{
 const cases:LocalCase[]=[{id:"custom",name:"边界",input:"1",expectation:{mode:"exact-json",target:{kind:"return"},value:"99"}}];
 const restored=validateCases(JSON.parse(JSON.stringify({version:2,cases,selected:"custom"})));
 const imported=appendExampleCases(restored.cases,"1","",["x"]);assert.equal(imported.added,0);assert.equal(imported.cases[0].expectation?.value,"99");
 const sixtyThree=Array.from({length:63},(_,i)=>({id:String(i),name:"x",input:String(i)}));
 assert.equal(appendExampleCases(sixtyThree,"100","",["x"]).cases.length,64);
});
