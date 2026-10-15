import test from "node:test";
import assert from "node:assert/strict";
import {canonicalJson,compareJson,validateExpectation} from "../src/case-expectations.ts";
test("exact JSON comparison preserves integers, structure and array order",()=>{
 assert.equal(compareJson("9007199254740992","9007199254740993"),"mismatch");
 assert.equal(compareJson('{"b":[9007199254740993],"a":"\\u0041"}','{"a":"A","b":[9007199254740993]}'),"match");
 assert.equal(compareJson("[1,2]","[2,1]"),"mismatch");
 assert.equal(compareJson('{"x":null}','{"x":"null"}'),"mismatch");
 assert.equal(compareJson("1","1.00e0"),"match");
 assert.equal(compareJson("-0","0e1000000"),"match");
 assert.equal(compareJson("1000000","1e6"),"match");
 assert.equal(compareJson("0.0001","1e-4"),"match");
 assert.equal(compareJson('"a b"','"ab"'),"mismatch");
 assert.equal(compareJson('{"__proto__":1}','{"__proto__":1}'),"match");
});
test("ambiguous and oversized comparisons fail rather than falsely pass",()=>{
 for(const text of ['{"a":1,"a":1}','{"a":1,"\\u0061":1}',"[1,]","[","true false","01","NaN","1e","1e1000001","1e99999999999999999999","",'"\\x00"']){
  assert.throws(()=>canonicalJson(text),text);
 }
 assert.throws(()=>canonicalJson("[".repeat(66)+"0"+"]".repeat(66)));
 assert.throws(()=>canonicalJson("["+Array(10001).fill("0").join(",")+"]"));
 assert.throws(()=>canonicalJson(" ".repeat(1024*1024+1)));
});
test("expectation record keeps null distinct from unset and validates targets",()=>{
 assert.equal(validateExpectation(undefined),null);
 assert.equal(validateExpectation(null),null);
 const e={mode:"exact-json",target:{kind:"return"},value:"null"};
 assert.deepEqual(validateExpectation(e),e);
 assert.deepEqual(validateExpectation({...e,target:{kind:"argument",index:0}})?.target,{kind:"argument",index:0});
 for(const target of [{kind:"guess"},{kind:"argument",index:-1},{kind:"argument",index:32},{kind:"argument",index:1.5}]){
  assert.throws(()=>validateExpectation({...e,target}));
 }
 assert.throws(()=>validateExpectation({...e,value:"x".repeat(65537)}));
});
