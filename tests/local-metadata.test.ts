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

test("design Rust signatures use official constructor and receiver modes",async()=>{
 const {rustDesignSignatures}=await import("../src/local-metadata.ts");
 const meta={systemdesign:true,classname:"Ledger",constructor:{params:[{name:"value",type:"integer[]"}]},methods:[{name:"appendValues",params:[{name:"value",type:"integer[]"}],return:{type:"void"}},{name:"getURLValue",params:[],return:{type:"integer"}}]};
 const template="struct Ledger {} impl Ledger { fn new(value: Vec<i32>) -> Self { todo!() } fn append_values(&mut self, value: &Vec<i32>) {} fn get_url_value(&self)->i32{0} }";
 const signatures=rustDesignSignatures(template,meta);
 assert.deepEqual(signatures,{Ledger:{name:"new",modes:["move"]},appendValues:{name:"append_values",modes:["ref"]},getURLValue:{name:"get_url_value",modes:[]}});
 const enriched=JSON.parse(localMetadata(JSON.stringify(meta),"rust",template));
 assert.deepEqual(enriched.inkleetRustDesignMethods,signatures);
 for(const invalid of [template.replace("&self","self"),template.replace("value: &Vec<i32>",""),template.replace("fn new","fn create"),template.replace("impl Ledger","impl Other")]){
  assert.throws(()=>rustDesignSignatures(invalid,meta));
  assert.ok(JSON.parse(localMetadata(JSON.stringify(meta),"rust",invalid)).inkleetRustSignatureError);
 }
});
