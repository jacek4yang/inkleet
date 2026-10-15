import test from "node:test";
import assert from "node:assert/strict";
import {runResultNotice} from "../src/run-result-notice.ts";
import type {RunContext} from "../src/run-context";
const fixture=():RunContext=>({mode:"selected",documentKey:"d",clientRequestId:"r",snapshot:{code:"x",input:"[1]",metadata:"{}",title:"t",language:"python3"},cases:[{id:"a",name:"A",input:"[1]",expectation:null}],invocations:[{caseIndex:0,groupIndex:0,caseNumber:1}]});
const current=(r:RunContext)=>({codeMismatch:false,language:r.snapshot.language,metadata:r.snapshot.metadata,title:r.snapshot.title,cases:structuredClone(r.cases),selected:"a"});
test("unchanged and reverted snapshots have no notice",()=>{
 const r=fixture(),c=current(r);assert.equal(runResultNotice(r,c),null);assert.equal(runResultNotice(null,c),null);
 c.cases[0].input="[2]";assert.equal(runResultNotice(r,c),"输入已修改 · 重新运行以更新结果");
 c.cases[0].input="[1]";assert.equal(runResultNotice(r,c),null);
});
test("source and expectation notices preserve original comparison inputs",()=>{
 const r=fixture(),c=current(r);
 assert.equal(runResultNotice(r,{...c,codeMismatch:true}),"代码已修改 · 重新运行以更新结果");
 c.cases[0].input="[2]";c.cases[0].expectation={mode:"exact-json",target:{kind:"return"},value:"2"};
 assert.equal(runResultNotice(r,c),"输入、预期结果已修改 · 重新运行以更新结果");
 assert.equal(r.cases[0].input,"[1]");assert.equal(r.cases[0].expectation,null);
});
test("selection and renaming describe provenance",()=>{
 const r=fixture(),c=current(r);
 assert.equal(runResultNotice(r,{...c,selected:"b"}),"当前显示其他用例的结果");
 c.cases[0].name="Renamed";assert.equal(runResultNotice(r,c),"用例已重命名 · 结果保留运行时名称");
});
test("all and failed runs compare the appropriate case scope",()=>{
 const r=fixture(),c=current(r);c.cases.push({id:"b",name:"B",input:"[2]",expectation:null});
 assert.equal(runResultNotice(r,c),null);
 r.mode="all";assert.equal(runResultNotice(r,c),"用例列表已修改 · 重新运行以更新结果");
 r.cases=structuredClone(c.cases);c.cases.reverse();
 assert.equal(runResultNotice(r,c),"用例列表已修改 · 重新运行以更新结果");
 r.mode="failed";assert.equal(runResultNotice(r,c),null);
 c.cases=[];assert.equal(runResultNotice(r,c),"用例列表已修改 · 重新运行以更新结果");
});
test("language metadata and expectation targets are distinguished",()=>{
 const r=fixture(),c=current(r);
 assert.equal(runResultNotice(r,{...c,language:"rust",metadata:"new"}),"语言、题目信息已修改 · 重新运行以更新结果");
 r.cases[0].expectation={mode:"exact-json",target:{kind:"return"},value:"1"};
 c.cases[0].expectation={mode:"exact-json",target:{kind:"argument",index:0},value:"1"};
 assert.equal(runResultNotice(r,c),"预期结果已修改 · 重新运行以更新结果");
});
