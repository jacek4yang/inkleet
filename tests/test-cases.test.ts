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
 assert.throws(()=>validateCases({...value,version:3}));
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

test("void argument display preserves original numeric tokens and nested values",()=>{
 const r=displayResult('{"case":2,"ok":true,"value":null,"argumentsAfterCall":[[900719925474099312345],{"x":"a,}b","n":900719925474099312346},null]}',0);
 assert.equal(r.raw,false);
 assert.equal(r.caseNumber,2);
 assert.deepEqual(r.argumentsAfterCall,[{value:"[900719925474099312345]",unavailable:false},{value:'{"x":"a,}b","n":900719925474099312346}',unavailable:false},{value:"null",unavailable:false}]);
 assert.deepEqual(displayResult('{"ok":true,"value":null,"argumentsAfterCall":[1],"argumentsAfterCall":[2,3]}',0).argumentsAfterCall?.map(v=>v.value),["2","3"]);
 assert.deepEqual(displayResult('{"ok":true,"value":null,"argumentsAfterCall":[]}',0).argumentsAfterCall,[]);
 assert.equal(displayResult('{"ok":false,"error":"bad","argumentsAfterCall":[1]}',0).argumentsAfterCall,undefined);
});
test("moved Rust arguments are distinct from real null and malformed metadata is untrusted",()=>{
 const r=displayResult('{"ok":true,"value":null,"argumentsAfterCall":[null,null],"argumentsUnavailable":[1]}',0);
 assert.deepEqual(r.argumentsAfterCall,[{value:"null",unavailable:false},{value:"null",unavailable:true}]);
 for(const unavailable of [null,"x",[-1],[2],[0.5],[0,0],[9007199254740993]]){
  assert.equal(displayResult(JSON.stringify({ok:true,value:null,argumentsAfterCall:[null,null],argumentsUnavailable:unavailable}),0).raw,true);
 }
 for(const args of [null,{},1,"x",Array(33).fill(0)]){
  assert.equal(displayResult(JSON.stringify({ok:true,value:null,argumentsAfterCall:args}),0).raw,true);
 }
});

test("v1 cases migrate without changing identity or inputs and v2 expectations survive",()=>{
 const old={version:1,cases:[{id:"a",name:"原用例",input:"[1, 2]\n"}],selected:"a"};
 assert.deepEqual(validateCases(old),{cases:[{...old.cases[0],expectation:null}],selected:"a"});
 const next={version:2,cases:[{...old.cases[0],expectation:{mode:"exact-json",target:{kind:"argument",index:0},value:"[2,1]"}}],selected:"a"};
 assert.deepEqual(validateCases(next).cases,next.cases);
 assert.throws(()=>validateCases({...next,cases:[{...next.cases[0],expectation:{mode:"guess",value:"1"}}]}));
 assert.throws(()=>validateCases({...old,cases:[{...old.cases[0],id:""}]}));
});
