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
