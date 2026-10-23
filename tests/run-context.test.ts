import test from "node:test";
import assert from "node:assert/strict";
import {validateRunContext,sameRunStatus} from "../src/run-context.ts";
const fixture=()=>({documentKey:"doc",clientRequestId:"request",snapshot:{code:"source",input:"[1]\n[2]",metadata:"{}",title:"题目",language:"python3"},cases:[{id:"a",name:"A",input:"[1]",expectation:null},{id:"b",name:"B",input:"[2]",expectation:null}],invocations:[{caseIndex:0,groupIndex:0,caseNumber:1},{caseIndex:1,groupIndex:0,caseNumber:2}]});
test("run contexts retain original source and reject foreign or malformed mappings",()=>{
 const f=fixture(),r=validateRunContext(f,"doc","request");
 assert.equal(r.snapshot.code,"source");assert.equal(r.cases[1].name,"B");
 assert.throws(()=>validateRunContext(f,"foreign","request"));
 assert.throws(()=>validateRunContext(f,"doc","foreign"));
 for(const invocations of [[],[{caseIndex:0,groupIndex:0,caseNumber:2}],[f.invocations[0],f.invocations[0]],[{caseIndex:-1,groupIndex:0,caseNumber:1}]]){
  assert.throws(()=>validateRunContext({...f,invocations},"doc","request"));
 }
 assert.throws(()=>validateRunContext({...f,snapshot:{...f.snapshot,input:"other"}},"doc","request"));
 f.cases[0].name="changed";assert.equal(r.cases[0].name,"A","validated record does not share mutable cases");
});
test("unchanged status arrays do not trigger new state but actual fields always do",()=>{
 const a={id:1,phase:"finished",results:["one"],error:""};
 assert.equal(sameRunStatus(a,{...a,results:["one"]}),true);
 for(const b of [{...a,results:["two"]},{...a,error:"failed"},{...a,id:2},{...a,newField:true},{id:1,phase:"finished",results:["one"]}]){
  assert.equal(sameRunStatus(a,b),false);
 }
 assert.equal(sameRunStatus(null,null),true);assert.equal(sameRunStatus(a,null),false);
});
