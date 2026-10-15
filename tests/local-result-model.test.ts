import test from "node:test";
import assert from "node:assert/strict";
import {localResultReport} from "../src/local-result-model.ts";
import type {RunContext} from "../src/run-context.ts";
const context=():RunContext=>({documentKey:"doc",clientRequestId:"request",snapshot:{code:"source",input:"1\n2",metadata:'{"params":[{"name":"value"}]}',title:"fixture",language:"python3"},cases:[{id:"a",name:"A",input:"1",expectation:{mode:"exact-json",target:{kind:"return"},value:"9007199254740993"}},{id:"b",name:"B",input:"2",expectation:{mode:"exact-json",target:{kind:"return"},value:"2"}}],invocations:[{caseIndex:0,groupIndex:0,caseNumber:1},{caseIndex:1,groupIndex:0,caseNumber:2}]});
const output=()=>({phase:"finished",exitCode:0,timedOut:false,canceled:false,truncated:false,error:"",results:['{"case":1,"ok":true,"value":9007199254740993}','{"case":2,"ok":true,"value":3}']});
test("named batch results use protocol identity and exact expected snapshots",()=>{
 const r=localResultReport(output(),context());assert.equal(r.matched,1);assert.equal(r.mismatched,1);assert.equal(r.complete,true);
 assert.deepEqual(r.rows.map(row=>row.caseName),["A","B"]);
 const reordered=localResultReport({...output(),results:[...output().results].reverse()},context());
 assert.deepEqual(reordered.rows.map(row=>row.caseName),["B","A"]);assert.equal(reordered.matched,1);
});
test("partial, failed, duplicate and foreign batches never manufacture a passing verdict",()=>{
 for(const patch of [{timedOut:true},{canceled:true},{truncated:true},{exitCode:1},{phase:"running"},{error:"failure"}]){
  const r=localResultReport({...output(),...patch},context());assert.equal(r.matched,0);assert.equal(r.complete,false);
 }
 for(const results of [[output().results[0]],[],[output().results[0],output().results[0]],['{"case":99,"ok":true,"value":2}'],['{"case":1,"ok":true,"value":1,"value":9007199254740993}',output().results[1]]]){
  const r=localResultReport({...output(),results},context());assert.equal(r.matched,0);assert.equal(r.complete,false);
 }
 const partial=localResultReport({...output(),results:[output().results[0]],timedOut:true},context());assert.equal(partial.missing,1);assert.equal(partial.rows[1].comparison?.label,"未返回结果");
 assert.equal(localResultReport(output(),null).matched,0);
});
test("runtime errors and unavailable post-call parameters remain distinct",()=>{
 const c=context();c.cases[0].expectation={mode:"exact-json",target:{kind:"argument",index:0},value:"null"};
 const r=localResultReport({...output(),results:['{"case":1,"ok":true,"value":null,"argumentsAfterCall":[null],"argumentsUnavailable":[0]}','{"case":2,"ok":false,"error":"failed"}']},c);
 assert.equal(r.matched,0);assert.equal(r.errors,1);assert.equal(r.rows[0].comparison?.label,"参数无法比较");
});
