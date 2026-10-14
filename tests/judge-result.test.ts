import assert from "node:assert/strict";
import test from "node:test";
import {readable,resultSummary} from "../src/judge-result-model.ts";
test("run completion is not submission acceptance",()=>{
 assert.equal(resultSummary({status_msg:"Accepted"},false).verdict,"运行完成");
 assert.equal(resultSummary({status_msg:"Accepted"},false).accepted,false);
 assert.equal(resultSummary({status_msg:"Accepted"},true).accepted,true);
 assert.equal(resultSummary({status_msg:"Wrong Answer"},true).verdict,"答案错误");
});
test("zero metrics and empty output survive",()=>{
 assert.equal(resultSummary({display_runtime:0,status_memory:"0 MB"},true).runtime,"0 ms");
 assert.equal(resultSummary({status_memory:"0 MB"},true).memory,"0 MB");
 assert.equal(readable(""),"");
 assert.equal(readable(["9007199254740993"," a\n b "]),"9007199254740993\n a\n b ");
 assert.equal(readable("<img onerror=alert(1)>"),"<img onerror=alert(1)>");
});

test("explicit online comparison distinguishes failed tests from execution completion",()=>{
 for(const result of [{correct_answer:false},{compare_result:"01"},{correct_answer:true,compare_result:"10"}]){
  const summary=resultSummary({status_msg:"Accepted",...result},false);
  assert.equal(summary.verdict,"测试答案错误");assert.equal(summary.accepted,false);
 }
 for(const result of [{correct_answer:true},{compare_result:"111"}]){
  assert.equal(resultSummary({status_msg:"Accepted",...result},false).verdict,"测试通过");
 }
 for(const compare_result of ["","unknown","10?","true",null]){
  assert.equal(resultSummary({status_msg:"Accepted",compare_result},false).verdict,"运行完成");
 }
 assert.equal(resultSummary({status_msg:"Runtime Error",correct_answer:false},false).verdict,"运行错误");
 assert.equal(resultSummary({status_msg:"Accepted",correct_answer:false},true).verdict,"通过");
});
