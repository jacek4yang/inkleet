import test from "node:test";
import assert from "node:assert/strict";
import {localMetadata,rustSignature} from "../src/local-metadata.ts";
test("official Rust node comments never select constructor instead of problem entry",()=>{
  const template="// impl Solution { pub fn wrong(v:i32){} }\n/* outer /* nested */ pub fn wrong(){} */\n// impl ListNode { pub fn new(val:i32)->Self { todo!() } }\nimpl Solution { pub fn two_sum(nums: Vec<i32>, target:i32) -> Vec<i32> { todo!() } }";
  assert.deepEqual(rustSignature(template),{name:"two_sum",modes:["move","move"]});
});
test("Rust mutable references, nested generic commas and trailing comma",()=>{
  assert.deepEqual(rustSignature("impl Solution { pub fn f(a:&mut Vec<i32>, b:Vec<(i32,i32)>, c: &str,){} }"),{name:"f",modes:["mut","move","ref"]});
  assert.deepEqual(rustSignature("impl Solution { pub fn r#match(mut a: &'a mut Vec<i32>){} }"),{name:"match",modes:["mut"]});
});
test("metadata rejects mismatched official signatures rather than guessing",()=>{
  const meta=JSON.stringify({name:"reverseString",params:[{name:"s",type:"character[]"}],return:{type:"void"}});
  const value=JSON.parse(localMetadata(meta,"rust","impl Solution { pub fn reverse_string(s:&mut Vec<char>){} }"));
  assert.equal(value.inkleetRustName,"reverse_string");assert.deepEqual(value.inkleetRustParameterModes,["mut"]);
  assert.ok(JSON.parse(localMetadata(meta,"rust","impl Solution { pub fn f(a:i32,b:i32){} }")).inkleetRustSignatureError);
  assert.equal(localMetadata(meta,"golang","invalid"),meta);
});
