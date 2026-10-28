import test from "node:test";
import assert from "node:assert/strict";
import { debugVariables } from "../src/debug-model.ts";
import { rustVisualKind, knownVariableCount, pageRepeats, VARIABLE_NODE_LIMIT, VARIABLE_PAGE_SIZE } from "../src/debug-visuals.ts";
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

test("map pairs bind actual fields, not tuple summary text or response order", async()=>{
  const {mapEntryPair,compactDebugType}=await import("../src/debug-visuals.ts");
  assert.deepEqual(mapEntryPair([value("1","30"),value("0","3")]), {key:value("0","3"),value:value("1","30")});
  assert.equal(mapEntryPair([value("0","3"),value("extra","30")]),null);
  const raw={...value("[raw]","{...}",9),presentationHint:{attributes:["readOnly","virtual"]}};
  assert.deepEqual(mapEntryPair([value("0","8"),value("1","80"),raw]),{key:value("0","8"),value:value("1","80")});
  assert.equal(compactDebugType("std::collections::hash::map::HashMap<alloc::string::String, alloc::vec::Vec<i32>>"),"HashMap<String, Vec<i32>>");
});
test("visible map hydration is four-way bounded and stops after collapse",async()=>{
  const {readMapPairs}=await import("../src/debug-visuals.ts");
  let active=true,inflight=0,max=0,calls=0;const pending:Array<()=>void>=[],results:number[]=[];
  const entries=Array.from({length:20},(_,i)=>value(`[${i}]`,"{...}",i+1));
  const done=readMapPairs(entries,async(reference,start,count)=>{
    calls++;inflight++;max=Math.max(max,inflight);assert.equal(start,0);assert.equal(count,3);
    await new Promise<void>(resolve=>pending.push(resolve));inflight--;
    return{items:[value("0",String(reference)),value("1",String(reference*10))],received:2,limited:false};
  },()=>active,(index)=>results.push(index));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,4);active=false;pending.splice(0).forEach(resolve=>resolve());await done;
  assert.equal(max,4);assert.equal(calls,4);assert.deepEqual(results,[]);
});
test("map hydration uses adapter fields with bounded errors and rejects truncated pairs",async()=>{
  const {readMapPairs}=await import("../src/debug-visuals.ts");const results:unknown[]=[];
  await readMapPairs([value("[0]","{...}",1),value("[1]","{...}",2),value("[2]","{...}",3)],async(ref)=>{
    if(ref===2)throw Error("transport");
    return{items:[value("0","3"),value("1","30")],received:2,limited:ref===3};
  },()=>true,(index,pair,error)=>results.push({index,pair,error}));
  assert.deepEqual(results.map((result:any)=>[result.index,!!result.pair,!!result.error]).sort(),[[0,true,false],[1,false,true],[2,false,false]]);
});

test("raw-only or opaque adapter values never claim an empty collection",async()=>{
 const {emptyDebugCollection}=await import("../src/debug-visuals.ts");
 assert.equal(emptyDebugCollection(value("map","{...}",1)),false);
 assert.equal(emptyDebugCollection(value("map","size=2",1)),false);
 assert.equal(emptyDebugCollection(value("map","size=0",1)),true);
 assert.equal(emptyDebugCollection({...value("map","{...}",1),namedVariables:0,indexedVariables:0}),true);
});
test("map request concurrency remains bounded across a canceled and replacement expansion",async()=>{
 const {MapReadQueue}=await import("../src/debug-visuals.ts");const queue=new MapReadQueue(4);
 let active=true,inflight=0,max=0,calls=0;const pending:Array<()=>void>=[];
 const work=async()=>{calls++;inflight++;max=Math.max(max,inflight);await new Promise<void>(resolve=>pending.push(resolve));inflight--;return{items:[],received:0,limited:false};};
 const first=Array.from({length:8},()=>queue.run(work,()=>active).catch(()=>null));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,4);active=false;
 const second=Array.from({length:4},()=>queue.run(work,()=>true));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,4);
 pending.splice(0).forEach(resolve=>resolve());await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,8);assert.equal(max,4);pending.splice(0).forEach(resolve=>resolve());
 await Promise.all([...first,...second]);
});

test("map queue cancellation before its scheduled microtask starts no IPC",async()=>{
 const {MapReadQueue}=await import("../src/debug-visuals.ts");const queue=new MapReadQueue();let active=true,calls=0;
 const result=queue.run(async()=>{calls++;return{items:[],received:0,limited:false};},()=>active);active=false;
 await assert.rejects(result,/取消/);assert.equal(calls,0);
});
