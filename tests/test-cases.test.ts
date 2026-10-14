import test from "node:test";
import assert from "node:assert/strict";
import {parameterNames,seedCases,inputParts,validateCases,displayResult,compactCaseValue} from "../src/test-cases.ts";
test("official examples split only on known parameter boundaries",()=>{
 const names=parameterNames('{"params":[{"name":"nums"},{"name":"target"}]}');
 assert.deepEqual(names,["nums","target"]);
 assert.deepEqual(seedCases("[2,7]\n9","[2,7]\n9\n[3,2,4]\n6",names).map(c=>c.input),["[2,7]\n9","[3,2,4]\n6"]);
 assert.equal(seedCases("fallback","malformed",names)[0].input,"fallback");
 assert.deepEqual(parameterNames('{"systemdesign":true,"params":[]}'),[]);
 assert.equal(inputParts("one\ntwo\nthree",names),null);
});
test("case persistence validates identity and keeps selected case",()=>{
 const value={version:1,cases:[{id:"a",name:"边界",input:"[]"}],selected:"a"};
 assert.equal(validateCases(value).selected,"a");
 assert.throws(()=>validateCases({...value,cases:[...value.cases,...value.cases]}));
 assert.throws(()=>validateCases({...value,selected:"missing"}));
 assert.throws(()=>validateCases({...value,version:2}));
});
test("protocol output hides envelope without rounding or mutating actual values",()=>{
 assert.equal(displayResult('{"case":1,"ok":true,"value":[7,0]}',0).value,"[7,0]");
 assert.equal(displayResult('{"ok":true,"value":900719925474099312345}',0).value,"900719925474099312345");
 assert.equal(displayResult('{"ok":true,"value":{"text":"a,}b"}}',0).value,'{"text":"a,}b"}');
 assert.equal(displayResult('{"ok":true,"value":null}',0).value,"null");
 assert.equal(displayResult('{"ok":true,"value":1,"value":2}',0).value,"2");
 assert.equal(displayResult('{"ok":false,"error":"failure"}',0).error,"failure");
 assert.equal(displayResult('{"ok":true}',0).raw,true);
 assert.equal(displayResult("not protocol",0).raw,true);
});
test("structured input compaction preserves string spaces and large numbers",()=>{
 assert.equal(compactCaseValue('[\n 900719925474099312345, "a b"\n]'),'[900719925474099312345,"a b"]');
 assert.equal(compactCaseValue("not valid\ninput"),"not valid\ninput");
});
