import test from "node:test";
import assert from "node:assert/strict";
import {canonicalJson,compareJson,validateExpectation,invocationCount} from "../src/case-expectations.ts";
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

test("invocation count comes from submitted input, not produced result rows",()=>{
 assert.equal(invocationCount("[1,2]\n[3,4]",1),2);
 assert.equal(invocationCount('[1]\n2\n[3]\n4',2),2);
 assert.equal(invocationCount('{"x":"a] b"}\ntrue',2),1);
 assert.throws(()=>invocationCount("[1]",2));
 assert.throws(()=>invocationCount("",1));
 assert.throws(()=>invocationCount("[1]",0));
});

test("execution counting does not inherit comparison node or exponent limits",()=>{
 const large="["+Array(10000).fill("1").join(",")+"]";
 assert.equal(invocationCount(large,1),1);
 assert.throws(()=>canonicalJson(large));
 assert.equal(invocationCount("1e999999999",1),1);
 assert.equal(invocationCount('"a,] \\"x\\""\n[1,{"x":[2]}]',2),1);
 assert.throws(()=>invocationCount("[1}]",1));
 assert.throws(()=>invocationCount("[".repeat(129)+"0"+"]".repeat(129),1));
 assert.throws(()=>invocationCount("true\n".repeat(101),1));
});

test("float policy has explicit absolute/relative bounds and preserves large integers",async()=>{
 const {compareExpectation}=await import("../src/case-expectations.ts");
 const e=(value:string,absoluteTolerance="0.000001",relativeTolerance="0.000001")=>({mode:"float-json" as const,target:{kind:"return" as const},value,absoluteTolerance,relativeTolerance});
 assert.equal(compareExpectation('[0.30000000000000004,{"x":1000001}]',e('[0.3,{"x":1000000}]')),"match");
 assert.equal(compareExpectation("0.000002",e("0","0.000001","0")),"mismatch");
 assert.equal(compareExpectation("-1.000001",e("-1","0.000001","0")),"match");
 assert.equal(compareExpectation("9007199254740993",e("9007199254740992","0","0")),"mismatch");
 assert.equal(compareExpectation("9007199254740993",e("9007199254740992","1","0")),"match");
 assert.equal(compareExpectation("[1,2]",e("[2,1]","0","0")),"mismatch");
 assert.equal(compareExpectation('"1"',e("1")),"mismatch");
 assert.equal(compareExpectation("1e-308",e("0","1e-308","0")),"match");
 assert.equal(compareExpectation("5e-324",e("0","5e-324","0")),"match");
 assert.equal(compareExpectation("6e-324",e("0","5e-324","0")),"mismatch");
 for(const tolerance of ["-1","NaN","Infinity","1e999999","",'"1"'])assert.throws(()=>compareExpectation("1",e("1",tolerance,"0")));
 for(const value of ["1e309","1".repeat(257),'{'+'"x":1,"x":1}'])assert.throws(()=>compareExpectation(value,e(value)));
});

test("unordered policy is an exact outer-array multiset, not recursive or guessed",async()=>{
 const {compareExpectation}=await import("../src/case-expectations.ts");
 const e=(value:string)=>({mode:"unordered-array" as const,target:{kind:"return" as const},value});
 assert.equal(compareExpectation('[{"a":1,"b":2},9007199254740993,2,2]',e('[2,9007199254740993,{"b":2,"a":1},2]')),"match");
 assert.equal(compareExpectation("[1,1,2]",e("[1,2,2]")),"mismatch");
 assert.equal(compareExpectation("[[1,2],[3]]",e("[[2,1],[3]]")),"mismatch");
 assert.equal(compareExpectation("[9007199254740993]",e("[9007199254740992]")),"mismatch");
 assert.throws(()=>compareExpectation("1",e("1")));
 assert.throws(()=>compareExpectation('[{"a":1,"a":1}]',e('[{"a":1}]')));
 assert.throws(()=>validateExpectation({mode:"automatic",target:{kind:"return"},value:"1"}));
});

test("zero-parameter functions use explicit empty-array invocations",()=>{
 assert.equal(invocationCount("[]\n[]",0),2);
 for(const input of ["", "[1]", "null", "{}", "[]\n1"])assert.throws(()=>invocationCount(input,0));
});
