import test from "node:test";
import assert from "node:assert/strict";
import { debugVariables } from "../src/debug-model.ts";
import { rustVisualKind, knownVariableCount, mapEntryFields, pageRepeats, VARIABLE_NODE_LIMIT, VARIABLE_PAGE_SIZE } from "../src/debug-visuals.ts";
const value=(name:string,value="0",variablesReference=0)=>({name,value,variablesReference});
test("standard library visual hints never recognize user lookalikes",()=>{
  for(const type of ["std::collections::hash::map::HashMap<i32, String>","alloc::collections::btree::map::BTreeMap<i32, i32>"])assert.equal(rustVisualKind(type),"map");
  assert.equal(rustVisualKind("std::collections::hash::set::HashSet<i32>"),"set");
  for(const type of ["alloc::vec::Vec<i32>","alloc::collections::vec_deque::VecDeque<i32>","alloc::collections::binary_heap::BinaryHeap<i32>","alloc::collections::linked_list::LinkedList<i32>","[i32; 8]","&[i32]"])assert.equal(rustVisualKind(type),"sequence");
  for(const type of ["alloc::string::String","&str","char"])assert.equal(rustVisualKind(type),"string");
  for(const type of ["core::option::Option<i32>","core::result::Result<i32, E>"])assert.equal(rustVisualKind(type),"variant");
  for(const type of ["alloc::boxed::Box<ListNode>","alloc::rc::Rc<TreeNode>","alloc::sync::Arc<i32>"])assert.equal(rustVisualKind(type),"pointer");
  for(const type of ["HashMap<i32,i32>","my::HashMap<i32,i32>","TreeNode","VecDeque<i32>",undefined])assert.equal(rustVisualKind(type),"generic");
});
test("map column hints require exactly two known pair fields",()=>{
  assert.equal(mapEntryFields([value("0"),value("1")]),true);
  assert.equal(mapEntryFields([value("key"),value("value")]),true);
  assert.equal(mapEntryFields([value(".0"),value(".1")]),true);
  assert.equal(mapEntryFields([value("first"),value("second")]),false);
  assert.equal(mapEntryFields([value("key"),value("value"),value("extra")]),false);
});
test("unknown counts are not fabricated and unsafe counts are rejected",()=>{
  assert.equal(knownVariableCount(value("a")),undefined);
  assert.equal(knownVariableCount({...value("a"),indexedVariables:101}),undefined);
  assert.equal(knownVariableCount({...value("a"),indexedVariables:100,namedVariables:2}),102);
  assert.equal(knownVariableCount({...value("a"),indexedVariables:Number.MAX_SAFE_INTEGER,namedVariables:1}),undefined);
  assert.equal(VARIABLE_PAGE_SIZE,100);assert.equal(VARIABLE_NODE_LIMIT,1000);
});
test("an adapter repeating its first page is detected without removing new indexed entries",()=>{
  const first=Array.from({length:100},(_,i)=>value(`[${i}]`,"same"));
  assert.equal(pageRepeats(first,first),true);
  assert.equal(pageRepeats(first,[value("[100]","same")]),false);
  assert.equal(pageRepeats(first,[]),false);
  const second=Array.from({length:100},(_,i)=>value(`[${100+i}]`,"same"));
  assert.equal(pageRepeats([...first,...second],second),true);
  assert.equal(pageRepeats(first,[{...first[0],type:"different"}]),false);
});
test("long summaries preserve explicit client truncation flags and untrusted text",()=>{
  const [full,truncated]=debugVariables([{...value("v","<img src=x>"),type:"x".repeat(3000)},{...value("large","x".repeat(20000))}]);
  assert.equal(full.value,"<img src=x>");assert.equal(full.valueTruncated,false);
  assert.equal(full.type?.length,2048);assert.equal(full.typeTruncated,true);
  assert.equal(truncated.value.length,16000);assert.equal(truncated.valueTruncated,true);
});
