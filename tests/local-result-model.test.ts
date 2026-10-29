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

test("empty backend error messages still count as runtime errors",()=>{
 const r=localResultReport({...output(),results:['{"case":1,"ok":false,"error":""}',output().results[1]]},context());
 assert.equal(r.errors,1);assert.equal(r.rows[0].caseId,"a");
 assert.equal(r.rows[0].comparison?.state,"error");
});

test("selected cases retain missing outputs, including raw multi-invocation input",()=>{
 const c=context();c.mode="selected";c.cases=c.cases.slice(0,1);c.invocations=c.invocations.slice(0,1);
 const empty=localResultReport({...output(),results:[]},c);
 assert.equal(empty.received,0);assert.equal(empty.expected,1);assert.equal(empty.rows.length,1);
 assert.equal(empty.rows[0].caseName,"A");assert.equal(empty.rows[0].comparison?.label,"未返回结果");
 c.invocations.push({caseIndex:0,groupIndex:1,caseNumber:2});
 const partial=localResultReport({...output(),results:[output().results[0]]},c);
 assert.equal(partial.received,1);assert.equal(partial.expected,2);assert.equal(partial.missing,1);
 assert.equal(partial.rows[1].value.caseNumber,2);assert.equal(partial.rows[1].multiple,true);
 const full=localResultReport(output(),c);assert.equal(full.complete,true);assert.equal(full.missing,0);
});
test("large valid values retain protocol identity without relaxing comparison limits",()=>{
 const c=context();c.cases=c.cases.slice(0,1);c.invocations=c.invocations.slice(0,1);
 const raw=JSON.stringify({case:1,ok:true,value:Array(10001).fill(0)});
 assert.ok(raw.length<65536);
 const report=localResultReport({...output(),results:[raw]},c);
 assert.equal(report.rows[0].caseName,"A");assert.equal(report.received,1);
 assert.equal(report.missing,0);assert.equal(report.complete,true);
 assert.equal(report.rows[0].comparison?.state,"unavailable");assert.equal(report.matched,0);
 for(const bad of ['{"case":1,"case":1,"ok":true,"value":0}','{"case":1,"ok":true,"value":0,"value":1}','{"case":1,"ok":false,"ok":true,"value":0}','{"case":1,"\\u0063ase":1,"ok":true,"value":0}']){
  const r=localResultReport({...output(),results:[bad]},c);assert.equal(r.complete,false);assert.equal(r.matched,0);assert.equal(r.received,0);
 }
});

test("receipt, comparison and provenance remain separate",()=>{
 const c=context();c.cases=c.cases.slice(0,1);c.invocations=c.invocations.slice(0,1);
 c.cases[0].expectation={mode:"exact-json",target:{kind:"return"},value:'{"a":1}'};
 const nested=localResultReport({...output(),results:['{"case":1,"ok":true,"value":{"a":0,"a":1}}']},c);
 assert.equal(nested.received,1);assert.equal(nested.complete,true);assert.equal(nested.matched,0);assert.equal(nested.rows[0].comparison?.state,"unavailable");
 const absent=localResultReport({...output(),results:['{"case":1,"ok":true}']},c);
 assert.equal(absent.received,0);assert.equal(absent.complete,false);
 const nil=localResultReport({...output(),results:['{"case":1,"ok":true,"value":null}']},c);
 assert.equal(nil.received,1);assert.equal(nil.complete,true);
 const unknown=localResultReport({...output(),results:[]},null);
 assert.equal(unknown.rows.length,0);assert.equal(unknown.expected,0);
});

test("partial selected output retains invocation ordinals",()=>{
 const c=context();c.cases=c.cases.slice(0,1);c.invocations=[{caseIndex:0,groupIndex:0,caseNumber:1},{caseIndex:0,groupIndex:1,caseNumber:2}];
 const r=localResultReport({...output(),results:[output().results[1]]},c);
 assert.equal(r.rows[0].value.caseNumber,2);assert.equal(r.rows[0].multiple,true);
 assert.equal(r.rows[1].value.caseNumber,1);assert.equal(r.rows[1].missing,true);assert.equal(r.rows[1].multiple,true);
});

test("policy settings belong to the immutable run, and invalid tolerance is never a match",()=>{
 const record={documentKey:"test",clientRequestId:"request",snapshot:{code:"",input:"[1]",metadata:JSON.stringify({name:"f",params:[{name:"v",type:"integer[]"}]}),title:"test",language:"rust" as const},cases:[{id:"a",name:"A",input:"[1]",expectation:{mode:"float-json" as const,target:{kind:"return" as const},value:"9007199254740992",absoluteTolerance:"0",relativeTolerance:"0"}}],invocations:[{caseIndex:0,groupIndex:0,caseNumber:1}]};
 const result={phase:"finished",exitCode:0,timedOut:false,canceled:false,truncated:false,error:"",results:['{"case":1,"ok":true,"value":9007199254740993}']};
 assert.equal(localResultReport(result,record).mismatched,1);
 record.cases[0].expectation.absoluteTolerance="1";
 assert.equal(localResultReport(result,record).matched,1);
 record.cases[0].expectation.absoluteTolerance="-";
 const invalid=localResultReport(result,record);assert.equal(invalid.matched,0);assert.equal(invalid.unchecked,1);
 assert.equal(invalid.rows[0].value.value,"9007199254740993");
});
