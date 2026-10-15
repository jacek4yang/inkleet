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

test("typed numeric verdicts have readable fallback without treating a run as AC",()=>{
 for(const [status_code,verdict] of [[10,"通过"],[11,"答案错误"],[12,"超出内存限制"],[13,"超出输出限制"],[14,"超出时间限制"],[15,"运行错误"],[16,"评测服务错误"],[20,"编译错误"],[21,"未知评测错误"]] as const){
  assert.equal(resultSummary({status_code},true).verdict,verdict);
  assert.equal(resultSummary({status_code},true).accepted,status_code===10);
 }
 assert.equal(resultSummary({status_code:10},false).verdict,"运行完成");
 assert.equal(resultSummary({status_code:10,correct_answer:false},false).verdict,"测试答案错误");
 assert.equal(resultSummary({status_code:10,correct_answer:true},false).verdict,"测试通过");
 assert.equal(resultSummary({status_code:10},false).accepted,false);
 assert.equal(resultSummary({status_code:999},true).verdict,"未知评测状态（999）");
 assert.equal(resultSummary({status_code:999},true).accepted,false);
 for(const status_code of [null,"10",0,-1,10.5,Number.MAX_SAFE_INTEGER+1])
  assert.equal(resultSummary({status_code},true).accepted,false);
});
test("trim textual verdicts and never claim acceptance for contradictory known verdicts",()=>{
 assert.equal(resultSummary({status_msg:" Accepted "},true).verdict,"通过");
 for(const result of [{status_code:11,status_msg:"Accepted"},{status_code:10,status_msg:"Runtime Error"}]){
  const summary=resultSummary(result,true);assert.equal(summary.verdict,"评测状态不一致");assert.equal(summary.accepted,false);
 }
 assert.equal(resultSummary({status_code:999,status_msg:"Future server status"},true).verdict,"Future server status");
});

test("unknown textual status cannot resolve inherited object properties",()=>{
 for(const status_msg of ["__proto__","constructor","toString","hasOwnProperty"]){
  const summary=resultSummary({status_msg},true);assert.equal(summary.verdict,status_msg);assert.equal(summary.accepted,false);
 }
});
